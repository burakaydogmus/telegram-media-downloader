import type {
  MediaItem,
  MediaType,
  MediaStatistics,
  FilterState,
  DateRange,
  QueueSnapshot,
  Settings,
} from '../shared/types/index.js';
import type { LogEntry, ILogger } from '../shared/logger/index.js';
import type { II18n } from '../shared/i18n/index.js';
import { DEFAULT_FILTERS } from '../shared/constants/index.js';
import { TypedEmitter, debounce, sanitizeFileName } from '../shared/utils/index.js';
import { toMessage } from '../shared/errors/index.js';

import type { MediaRegistry } from './media-registry.js';
import type { MediaScanner } from './media-scanner.js';
import type { MutationEngine } from './mutation-engine.js';

import type { SelectionService } from '../features/selection/index.js';
import type { SearchService } from '../features/search/index.js';
import type { FilterService } from '../features/filter/index.js';
import type { DownloadQueue } from '../features/download/index.js';
import type { ReportService } from '../features/reporting/index.js';
import { type ReportFormat } from '../features/reporting/index.js';
import type { StorageService } from '../features/local-storage/index.js';

import type { PanelViewModel, PanelEvent } from '../ui/components/panel-view-model.js';

interface ControllerEvents extends Record<string, unknown> {
  panel: PanelEvent;
}

export interface AppControllerDeps {
  readonly logger: ILogger;
  readonly i18n: II18n;
  readonly registry: MediaRegistry;
  readonly scanner: MediaScanner;
  readonly mutationEngine: MutationEngine;
  readonly selection: SelectionService;
  readonly search: SearchService;
  readonly filter: FilterService;
  readonly queue: DownloadQueue;
  readonly report: ReportService;
  readonly storage: StorageService;
  readonly settings: Settings;
  readonly filters: FilterState;
}

export class AppController implements PanelViewModel {
  readonly i18n: II18n;

  private readonly logger: ILogger;
  private readonly registry: MediaRegistry;
  private readonly scanner: MediaScanner;
  private readonly mutationEngine: MutationEngine;
  private readonly selection: SelectionService;
  private readonly search: SearchService;
  private readonly filter: FilterService;
  private readonly queue: DownloadQueue;
  private readonly report: ReportService;
  private readonly storage: StorageService;

  private settings: Settings;
  private filters: FilterState;
  private visibleCache: readonly MediaItem[] = [];
  private readonly countedTasks = new Set<string>();

  private readonly emitter = new TypedEmitter<ControllerEvents>();
  private readonly persistFilters = debounce(
    (f: FilterState) => void this.storage.saveFilters(f),
    300,
  );
  private readonly emitLogs = debounce(() => this.emit('logs'), 120);

  constructor(deps: AppControllerDeps) {
    this.logger = deps.logger.child('controller');
    this.i18n = deps.i18n;
    this.registry = deps.registry;
    this.scanner = deps.scanner;
    this.mutationEngine = deps.mutationEngine;
    this.selection = deps.selection;
    this.search = deps.search;
    this.filter = deps.filter;
    this.queue = deps.queue;
    this.report = deps.report;
    this.storage = deps.storage;
    this.settings = deps.settings;
    this.filters = deps.filters;

    this.wireEvents();
  }

  start(messageContainer: Node): void {
    this.recomputeVisible();
    if (this.settings.autoScan) {
      this.performScan();
      this.mutationEngine.observe(messageContainer);
    }
  }

  stop(): void {
    this.mutationEngine.disconnect();
  }

  applySettings(settings: Settings): void {
    this.settings = settings;
    this.i18n.setLanguage(settings.language);
    this.logger.setLevel(settings.logLevel);
    this.queue.configure({
      maxConcurrent: settings.maxConcurrentDownloads,
      maxRetries: settings.maxRetries,
    });
    this.emit('media');
  }

  getStatistics(): MediaStatistics {
    return this.registry.getStatistics(this.selection.size);
  }

  getVisibleItems(): readonly MediaItem[] {
    return this.visibleCache;
  }

  getFilters(): FilterState {
    return this.filters;
  }

  getQueueSnapshot(): QueueSnapshot {
    return this.queue.snapshot();
  }

  getLogs(): readonly LogEntry[] {
    return this.logger.getEntries();
  }

  getSelectedIds(): readonly string[] {
    return this.selection.values();
  }

  isSelected(id: string): boolean {
    return this.selection.has(id);
  }

  setQuery(query: string): void {
    this.filters = { ...this.filters, query };
    this.persistFilters(this.filters);
    this.recomputeVisible();
    this.emit('filters');
    this.emit('media');
  }

  toggleType(type: MediaType): void {
    const set = new Set(this.filters.types);
    if (set.has(type)) set.delete(type);
    else set.add(type);
    this.filters = { ...this.filters, types: [...set] };
    this.persistFilters(this.filters);
    this.recomputeVisible();
    this.emit('filters');
    this.emit('media');
  }

  setDateRange(range: DateRange): void {
    this.filters = { ...this.filters, dateRange: range };
    this.persistFilters(this.filters);
    this.recomputeVisible();
    this.emit('filters');
    this.emit('media');
  }

  toggleSelection(id: string): void {
    this.selection.toggle(id);
  }

  selectAllVisible(): void {
    this.selection.selectAllVisible(this.visibleCache.map((item) => item.id));
  }

  clearSelection(): void {
    this.selection.clear();
  }

  rescan(): void {
    this.scanner.resetSeen();
    this.performScan();
  }

  downloadSelected(): void {
    const ids = new Set(this.selection.values());
    const items = this.registry.values().filter((item) => ids.has(item.id));
    if (items.length === 0) {
      this.logger.warn('Download requested with no selection');
      return;
    }
    this.queue.enqueue(items);
    this.queue.start();
  }

  startQueue(): void {
    this.queue.start();
  }

  cancelAllDownloads(): void {
    this.queue.cancelAll();
  }

  cancelTask(taskId: string): void {
    this.queue.cancel(taskId);
  }

  retryTask(taskId: string): void {
    this.queue.retry(taskId);
  }

  clearFinishedTasks(): void {
    this.queue.clearFinished();
  }

  exportReport(format: ReportFormat): void {
    try {
      const report = this.report.generate(this.visibleCache, format);
      const blob = new Blob([report.content], { type: report.mimeType });
      const url = URL.createObjectURL(blob);
      const anchor = document.createElement('a');
      anchor.href = url;
      anchor.download = sanitizeFileName(report.fileName);
      anchor.style.display = 'none';
      document.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
      setTimeout(() => URL.revokeObjectURL(url), 1000);
      this.logger.info(
        `Exported ${format.toUpperCase()} report (${this.visibleCache.length} rows)`,
      );
    } catch (error) {
      this.logger.error('Report export failed', toMessage(error));
    }
  }

  clearLogs(): void {
    this.logger.clear();
    this.emit('logs');
  }

  subscribe(listener: (event: PanelEvent) => void): () => void {
    return this.emitter.on('panel', listener);
  }

  private wireEvents(): void {
    this.registry.on('added', () => {
      this.recomputeVisible();
      this.emit('media');
    });
    this.registry.on('removed', () => {
      this.selection.prune(new Set(this.registry.values().map((i) => i.id)));
      this.recomputeVisible();
      this.emit('media');
    });
    this.registry.on('updated', () => {
      this.recomputeVisible();
      this.emit('media');
    });
    this.registry.on('cleared', () => {
      this.selection.clear();
      this.recomputeVisible();
      this.emit('media');
    });

    this.selection.onChange(() => this.emit('selection'));
    this.queue.onChange(() => this.emit('queue'));
    this.queue.onTaskChange((task) => {
      if (task.state !== 'completed' && task.state !== 'failed') return;
      if (this.countedTasks.has(task.id)) return;
      this.countedTasks.add(task.id);
      const completed = task.state === 'completed' ? 1 : 0;
      const failed = task.state === 'failed' ? 1 : 0;
      void this.storage.updateStatistics((current) => ({
        ...current,
        totalDownloaded: current.totalDownloaded + completed,
        totalFailed: current.totalFailed + failed,
      }));
    });
    this.logger.subscribe(() => this.emitLogs());
  }

  private performScan(): void {
    try {
      const result = this.scanner.scan();
      this.registry.addMany(result.items);
      void this.storage.updateStatistics((current) => ({
        ...current,
        totalDiscovered: this.registry.size,
        lastScanAt: Date.now(),
      }));
      this.logger.info(this.i18n.t('scan_done', { count: this.registry.size }));
    } catch (error) {
      this.logger.error('Scan failed', toMessage(error));
    }
  }

  handleMutations(addedRoots: readonly Element[]): void {
    try {
      const result = this.scanner.scan(addedRoots);
      if (result.items.length > 0) this.registry.addMany(result.items);
    } catch (error) {
      this.logger.error('Incremental scan failed', toMessage(error));
    }
  }

  private recomputeVisible(): void {
    const filtered = this.filter.apply(this.registry.values(), this.filters);
    this.visibleCache = this.search.filter(filtered, this.filters.query);
  }

  private emit(event: PanelEvent): void {
    this.emitter.emit('panel', event);
  }

  resetFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.recomputeVisible();
    this.emit('filters');
    this.emit('media');
  }
}
