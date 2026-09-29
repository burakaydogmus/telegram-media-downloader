import { describe, it, expect, beforeEach, vi } from 'vitest';
import {
  AppController,
  type CrawlerHooks,
  type CrawlerPort,
} from '../../src/content/app-controller.js';
import { MediaRegistry } from '../../src/content/media-registry.js';
import { MediaScanner } from '../../src/content/media-scanner.js';
import { MutationEngine } from '../../src/content/mutation-engine.js';
import { SelectionService } from '../../src/features/selection/index.js';
import { SearchService } from '../../src/features/search/index.js';
import { FilterService } from '../../src/features/filter/index.js';
import { DownloadQueue } from '../../src/features/download/index.js';
import type {
  DownloadExecutor,
  ProgressReporter,
} from '../../src/features/download/download-executor.js';
import { ReportService } from '../../src/features/reporting/index.js';
import {
  DownloadHistory,
  MemoryKeyValueStore,
  MemoryStorageDriver,
  StorageService,
} from '../../src/features/local-storage/index.js';
import { Logger } from '../../src/shared/logger/index.js';
import { I18n } from '../../src/shared/i18n/index.js';
import { DEFAULT_FILTERS, DEFAULT_SETTINGS } from '../../src/shared/constants/index.js';
import type {
  CrawlState,
  DownloadRecord,
  DownloadTask,
  Settings,
} from '../../src/shared/types/index.js';
import { historyKeyOf } from '../../src/shared/utils/index.js';

class ScriptedExecutor implements DownloadExecutor {
  readonly calls: string[] = [];
  failNext = 0;
  /** Keep tasks running (never settle) so progress can be observed. */
  hold = false;
  execute(task: DownloadTask, onProgress: ProgressReporter): Promise<void> {
    this.calls.push(task.item.id);
    onProgress(0.5, 50, 100);
    if (this.hold) return new Promise<void>(() => undefined);
    if (this.failNext > 0) {
      this.failNext -= 1;
      return Promise.reject(new Error('boom'));
    }
    return Promise.resolve();
  }
}

class FakeCrawler implements CrawlerPort {
  state: CrawlState = { status: 'idle', steps: 0, foundItems: 0 };
  constructor(readonly hooks: CrawlerHooks) {}
  getState(): CrawlState {
    return this.state;
  }
  onChange(): () => void {
    return () => undefined;
  }
  start(): Promise<void> {
    return Promise.resolve();
  }
  pause(): void {}
  resume(): void {}
  stop(): void {}
}

function seed(ids: readonly number[]): void {
  document.body.innerHTML = `<div class="bubbles"><div class="bubbles-inner">${ids
    .map(
      (id) =>
        `<div class="bubble photo" data-mid="${id}" data-timestamp="1781870000"><div class="attachment media-container"><img class="media-photo" src="https://web.telegram.org/p${id}.jpg"></div></div>`,
    )
    .join('')}</div></div>`;
}

function addBubble(id: number): void {
  const inner = document.querySelector('.bubbles-inner')!;
  const wrap = document.createElement('div');
  wrap.innerHTML = `<div class="bubble photo" data-mid="${id}" data-timestamp="1781870000"><div class="attachment media-container"><img class="media-photo" src="https://web.telegram.org/p${id}.jpg"></div></div>`;
  inner.prepend(wrap.firstElementChild!);
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

function build(settings: Partial<Settings> = {}) {
  const logger = new Logger('error');
  const driver = new MemoryStorageDriver();
  const storage = new StorageService(driver, logger);
  const history = new DownloadHistory(new MemoryKeyValueStore<DownloadRecord>(), {
    flushDelayMs: 0,
  });
  const executor = new ScriptedExecutor();
  const queue = new DownloadQueue(
    executor,
    { maxConcurrent: 1, maxRetries: 0, baseBackoffMs: 1, maxBackoffMs: 1 },
    logger,
  );
  let crawler: FakeCrawler | undefined;
  const controller = new AppController({
    logger,
    i18n: new I18n('en'),
    registry: new MediaRegistry(logger),
    scanner: new MediaScanner('webk', document, logger),
    mutationEngine: new MutationEngine(() => undefined),
    selection: new SelectionService(),
    search: new SearchService(),
    filter: new FilterService(),
    queue,
    report: new ReportService(),
    storage,
    history,
    settings: { ...DEFAULT_SETTINGS, ...settings },
    filters: { ...DEFAULT_FILTERS },
    createCrawler: (hooks) => (crawler = new FakeCrawler(hooks)),
  });
  controller.start(document.querySelector('.bubbles')!);
  return { controller, storage, history, executor, queue, crawler: () => crawler! };
}

describe('AppController wiring (integration)', () => {
  beforeEach(() => seed([1, 2, 3]));

  it('downloads only selected items that are currently visible', async () => {
    const { controller, executor } = build();
    controller.selectAllVisible();
    controller.toggleType('photo'); // hides every photo
    controller.downloadSelected();
    await tick();
    expect(executor.calls).toEqual([]);
  });

  it('records completed downloads and skips them next time', async () => {
    const { controller, executor, history } = build({ skipDownloaded: true });
    const [first] = controller.getVisibleItems();
    controller.toggleSelection(first!.id);
    controller.downloadSelected();
    await tick();
    await tick();
    expect(history.has(historyKeyOf(first!)!)).toBe(true);
    expect(controller.isDownloaded(first!.id)).toBe(true);

    controller.downloadSelected();
    await tick();
    expect(executor.calls).toEqual([first!.id]);
  });

  it('hideDownloaded filter drops downloaded items from the view', async () => {
    const { controller } = build();
    const [first] = controller.getVisibleItems();
    controller.toggleSelection(first!.id);
    controller.downloadSelected();
    await tick();
    await tick();
    controller.setHideDownloaded(true);
    expect(controller.getVisibleItems().map((i) => i.id)).not.toContain(first!.id);
  });

  it('moves a retried task from the failed to the completed counter', async () => {
    const { controller, executor, storage } = build();
    executor.failNext = 1;
    const [first] = controller.getVisibleItems();
    controller.toggleSelection(first!.id);
    controller.downloadSelected();
    await tick();
    await tick();
    const failed = controller.getQueueSnapshot().tasks[0]!;
    expect(failed.state).toBe('failed');
    controller.retryTask(failed.id);
    await tick();
    await tick();
    await tick();
    const stats = await storage.getStatistics();
    expect(stats.totalDownloaded).toBe(1);
    expect(stats.totalFailed).toBe(0);
  });

  it('emits progress separately from queue changes', async () => {
    const { controller, executor } = build();
    executor.hold = true;
    const events: string[] = [];
    controller.subscribe((e) => events.push(e));
    controller.selectAllVisible();
    controller.downloadSelected();
    await new Promise((r) => setTimeout(r, 150));
    expect(events).toContain('queue');
    expect(events).toContain('progress');
  });

  it('selectRange selects the inclusive visible range in either direction', () => {
    const { controller } = build();
    const ids = controller.getVisibleItems().map((i) => i.id);
    controller.selectRange(ids[2]!, ids[0]!);
    expect([...controller.getSelectedIds()].sort()).toEqual([...ids].sort());
  });

  it('resetFilters persists the defaults', async () => {
    const { controller, storage } = build();
    controller.setDateRange('today');
    controller.resetFilters();
    await new Promise((r) => setTimeout(r, 350));
    expect((await storage.getFilters()).dateRange).toBe('all');
  });

  it('applies settings saved elsewhere (options page) live', async () => {
    const { controller, storage } = build();
    const events: string[] = [];
    controller.subscribe((e) => events.push(e));
    await storage.saveSettings({ ...DEFAULT_SETTINGS, language: 'tr' });
    expect(controller.i18n.language).toBe('tr');
    expect(controller.getSettings().language).toBe('tr');
    expect(events).toContain('settings');
  });

  it('crawl step reports new items and, with auto-download, waits for them', async () => {
    const { controller, executor, crawler } = build({ crawlAutoDownload: true });
    expect(controller.getVisibleItems()).toHaveLength(3);
    addBubble(0);
    const found = await crawler().hooks.onStep();
    expect(found).toBe(1);
    expect(executor.calls).toHaveLength(1);
    expect(controller.getQueueSnapshot().completed).toBe(1);
  });

  it('crawl step without auto-download only discovers', async () => {
    const { executor, crawler } = build();
    addBubble(0);
    expect(await crawler().hooks.onStep()).toBe(1);
    expect(executor.calls).toHaveLength(0);
  });

  it('revealItem scrolls the located element into view', () => {
    const logger = new Logger('error');
    const scroll = vi.fn();
    const target = document.createElement('div');
    target.scrollIntoView = scroll;
    const controller = new AppController({
      logger,
      i18n: new I18n('en'),
      registry: new MediaRegistry(logger),
      scanner: new MediaScanner('webk', document, logger),
      mutationEngine: new MutationEngine(() => undefined),
      selection: new SelectionService(),
      search: new SearchService(),
      filter: new FilterService(),
      queue: new DownloadQueue(new ScriptedExecutor(), {
        maxConcurrent: 1,
        maxRetries: 0,
      }),
      report: new ReportService(),
      storage: new StorageService(new MemoryStorageDriver(), logger),
      settings: { ...DEFAULT_SETTINGS },
      filters: { ...DEFAULT_FILTERS },
      locate: () => target,
    });
    controller.start(document.querySelector('.bubbles')!);
    controller.revealItem(controller.getVisibleItems()[0]!.id);
    expect(scroll).toHaveBeenCalledOnce();
  });
});
