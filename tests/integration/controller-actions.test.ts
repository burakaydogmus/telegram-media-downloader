import { describe, it, expect, beforeEach, vi } from 'vitest';
import { AppController } from '../../src/content/app-controller.js';
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
import type { DownloadTask } from '../../src/shared/types/index.js';
import { ReportService } from '../../src/features/reporting/index.js';
import {
  StorageService,
  MemoryStorageDriver,
} from '../../src/features/local-storage/index.js';
import { Logger } from '../../src/shared/logger/index.js';
import { I18n } from '../../src/shared/i18n/index.js';
import { DEFAULT_SETTINGS, DEFAULT_FILTERS } from '../../src/shared/constants/index.js';

class ManualExecutor implements DownloadExecutor {
  resolvers: Array<() => void> = [];
  rejecters: Array<(e: Error) => void> = [];
  execute(
    _t: DownloadTask,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<void> {
    onProgress(0.2);
    return new Promise<void>((resolve, reject) => {
      this.resolvers.push(resolve);
      this.rejecters.push(reject);
      signal.addEventListener('abort', () =>
        reject(new DOMException('Aborted', 'AbortError')),
      );
    });
  }
}

function seedDom(): void {
  document.body.innerHTML = `
    <div class="bubbles">
      <div class="bubble" data-mid="1"><img class="media-photo" src="https://x/p1.jpg" /></div>
      <div class="bubble" data-mid="2"><video class="media-video"><source src="https://x/v.mp4" /></video></div>
    </div>`;
}

function build(executor: DownloadExecutor = new ManualExecutor()): {
  controller: AppController;
  storage: StorageService;
} {
  const logger = new Logger('debug');
  const storage = new StorageService(new MemoryStorageDriver(), logger);
  const controller = new AppController({
    logger,
    i18n: new I18n('en'),
    registry: new MediaRegistry(logger),
    scanner: new MediaScanner('webk', document, logger),
    mutationEngine: new MutationEngine(() => undefined),
    selection: new SelectionService(),
    search: new SearchService(),
    filter: new FilterService(),
    queue: new DownloadQueue(executor, { maxConcurrent: 2, maxRetries: 0 }, logger),
    report: new ReportService(),
    storage,
    settings: { ...DEFAULT_SETTINGS },
    filters: { ...DEFAULT_FILTERS },
  });
  return { controller, storage };
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('AppController actions (integration)', () => {
  beforeEach(() => seedDom());

  it('emits panel events to subscribers', () => {
    const { controller } = build();
    const events: string[] = [];
    controller.subscribe((e) => events.push(e));
    controller.start(document.querySelector('.bubbles')!);
    controller.setDateRange('today');
    expect(events).toContain('media');
    expect(events).toContain('filters');
  });

  it('applySettings reconfigures language and logger', () => {
    const { controller } = build();
    controller.applySettings({ ...DEFAULT_SETTINGS, language: 'tr', logLevel: 'error' });
    expect(controller.i18n.language).toBe('tr');
  });

  it('exports a CSV report via an anchor download', () => {
    const created = vi.fn(() => 'blob:fake');
    const revoked = vi.fn();
    vi.stubGlobal('URL', { createObjectURL: created, revokeObjectURL: revoked });
    const clickSpy = vi
      .spyOn(HTMLAnchorElement.prototype, 'click')
      .mockImplementation(() => {});

    const { controller } = build();
    controller.start(document.querySelector('.bubbles')!);
    controller.exportReport('csv');

    expect(created).toHaveBeenCalledOnce();
    expect(clickSpy).toHaveBeenCalledOnce();

    clickSpy.mockRestore();
    vi.unstubAllGlobals();
  });

  it('clearLogs empties the log buffer', () => {
    const { controller } = build();
    controller.start(document.querySelector('.bubbles')!);
    expect(controller.getLogs().length).toBeGreaterThan(0);
    controller.clearLogs();
    expect(controller.getLogs().length).toBe(0);
  });

  it('cancels and retries queue tasks', async () => {
    const executor = new ManualExecutor();
    const { controller } = build(executor);
    controller.start(document.querySelector('.bubbles')!);
    controller.selectAllVisible();
    controller.downloadSelected();
    await flush();

    const running = controller
      .getQueueSnapshot()
      .tasks.find((t) => t.state === 'running');
    expect(running).toBeDefined();
    controller.cancelTask(running!.id);
    await flush();
    expect(controller.getQueueSnapshot().cancelled).toBeGreaterThanOrEqual(1);

    controller.retryTask(running!.id);
    await flush();
    expect(
      controller.getQueueSnapshot().tasks.find((t) => t.id === running!.id)?.state,
    ).not.toBe('cancelled');

    controller.cancelAllDownloads();
    await flush();
  });

  it('downloadSelected with empty selection does nothing harmful', () => {
    const { controller } = build();
    controller.start(document.querySelector('.bubbles')!);
    controller.clearSelection();
    controller.downloadSelected();
    expect(controller.getQueueSnapshot().total).toBe(0);
  });

  it('records download statistics on completion', async () => {
    const executor = new ManualExecutor();
    const { controller, storage } = build(executor);
    controller.start(document.querySelector('.bubbles')!);
    controller.selectAllVisible();
    controller.downloadSelected();
    await flush();
    executor.resolvers.forEach((r) => r());
    for (let i = 0; i < 5; i += 1) await flush();

    const stats = await storage.getStatistics();
    expect(stats.totalDownloaded).toBeGreaterThanOrEqual(1);
  });

  it('startQueue, clearFinishedTasks and stop are callable', async () => {
    const executor = new ManualExecutor();
    const { controller } = build(executor);
    controller.start(document.querySelector('.bubbles')!);
    controller.selectAllVisible();
    controller.downloadSelected();
    await flush();
    executor.resolvers.forEach((r) => r());
    for (let i = 0; i < 3; i += 1) await flush();
    controller.startQueue();
    controller.clearFinishedTasks();
    controller.stop();
    expect(controller.getQueueSnapshot().total).toBe(0);
  });

  it('resetFilters restores defaults', () => {
    const { controller } = build();
    controller.start(document.querySelector('.bubbles')!);
    controller.setQuery('abc');
    controller.toggleType('photo');
    controller.resetFilters();
    expect(controller.getFilters()).toEqual(DEFAULT_FILTERS);
  });

  it('rescan re-reads the DOM', () => {
    const { controller } = build();
    controller.start(document.querySelector('.bubbles')!);
    const before = controller.getStatistics().total;
    controller.rescan();
    expect(controller.getStatistics().total).toBe(before);
  });
});
