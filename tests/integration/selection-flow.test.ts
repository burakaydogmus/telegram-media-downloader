import { describe, it, expect, beforeEach } from 'vitest';
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
import { ReportService } from '../../src/features/reporting/index.js';
import {
  StorageService,
  MemoryStorageDriver,
} from '../../src/features/local-storage/index.js';
import { Logger } from '../../src/shared/logger/index.js';
import { I18n } from '../../src/shared/i18n/index.js';
import { DEFAULT_SETTINGS, DEFAULT_FILTERS } from '../../src/shared/constants/index.js';
import type { DownloadTask } from '../../src/shared/types/index.js';

class InstantExecutor implements DownloadExecutor {
  public count = 0;
  async execute(_t: DownloadTask, onProgress: ProgressReporter): Promise<void> {
    this.count += 1;
    onProgress(1);
  }
}

function seedDom(): void {
  document.body.innerHTML = `
    <div class="bubbles">
      <div class="bubble" data-mid="1"><img class="media-photo" src="https://x/p1.jpg" /></div>
      <div class="bubble" data-mid="2"><img class="media-photo" src="https://x/p2.jpg" /></div>
      <div class="bubble" data-mid="3"><video class="media-video"><source src="https://x/v.mp4" /></video></div>
    </div>
  `;
}

function buildController(executor: DownloadExecutor): AppController {
  const logger = new Logger('error');
  const registry = new MediaRegistry(logger);
  const scanner = new MediaScanner('webk', document, logger);
  const mutationEngine = new MutationEngine(() => undefined);
  return new AppController({
    logger,
    i18n: new I18n('en'),
    registry,
    scanner,
    mutationEngine,
    selection: new SelectionService(),
    search: new SearchService(),
    filter: new FilterService(),
    queue: new DownloadQueue(executor, { maxConcurrent: 2, maxRetries: 0 }, logger),
    report: new ReportService(),
    storage: new StorageService(new MemoryStorageDriver(), logger),
    settings: { ...DEFAULT_SETTINGS },
    filters: { ...DEFAULT_FILTERS },
  });
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('Selection + scan + download flow (integration)', () => {
  beforeEach(() => seedDom());

  it('scans on start and exposes media', () => {
    const controller = buildController(new InstantExecutor());
    controller.start(document.querySelector('.bubbles')!);
    expect(controller.getStatistics().total).toBe(3);
    expect(controller.getVisibleItems()).toHaveLength(3);
  });

  it('selects all visible and downloads them', async () => {
    const executor = new InstantExecutor();
    const controller = buildController(executor);
    controller.start(document.querySelector('.bubbles')!);

    controller.selectAllVisible();
    expect(controller.getSelectedIds()).toHaveLength(3);

    controller.downloadSelected();
    for (let i = 0; i < 5; i += 1) await flush();

    expect(executor.count).toBe(3);
    expect(controller.getQueueSnapshot().completed).toBe(3);
  });

  it('filters by type and recomputes visible set', () => {
    const controller = buildController(new InstantExecutor());
    controller.start(document.querySelector('.bubbles')!);

    controller.toggleType('photo'); // remove photos -> only video remains
    expect(controller.getVisibleItems().every((i) => i.type !== 'photo')).toBe(true);
  });

  it('search narrows visible items', () => {
    const controller = buildController(new InstantExecutor());
    controller.start(document.querySelector('.bubbles')!);
    controller.setQuery('v.mp4');
    expect(controller.getVisibleItems().some((i) => i.type === 'video')).toBe(true);
  });

  it('clears selection', () => {
    const controller = buildController(new InstantExecutor());
    controller.start(document.querySelector('.bubbles')!);
    controller.selectAllVisible();
    controller.clearSelection();
    expect(controller.getSelectedIds()).toHaveLength(0);
  });

  it('handleMutations adds newly discovered media incrementally', () => {
    const controller = buildController(new InstantExecutor());
    controller.start(document.querySelector('.bubbles')!);
    expect(controller.getStatistics().total).toBe(3);

    const container = document.querySelector('.bubbles')!;
    const node = document.createElement('div');
    node.className = 'bubble';
    node.setAttribute('data-mid', '99');
    node.innerHTML = '<img class="media-photo" src="https://x/new.jpg" />';
    container.appendChild(node);

    controller.handleMutations([node]);
    expect(controller.getStatistics().total).toBe(4);
  });
});
