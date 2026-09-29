import type {
  MediaItem,
  MediaType,
  MediaStatistics,
  FilterState,
  FilterScope,
  DateRange,
  QueueSnapshot,
  Settings,
  CrawlOptions,
  CrawlState,
  DownloadState,
  DownloadTask,
  SelectorHealthReport,
} from '../shared/types/index.js';
import type { LogEntry, ILogger } from '../shared/logger/index.js';
import type { II18n } from '../shared/i18n/index.js';
import { DEFAULT_FILTERS } from '../shared/constants/index.js';
import {
  TypedEmitter,
  debounce,
  historyKeyOf,
  sanitizeFileName,
} from '../shared/utils/index.js';
import { toMessage } from '../shared/errors/index.js';

import type { MediaRegistry } from './media-registry.js';
import type { MediaScanner, ScanResult } from './media-scanner.js';
import type { MutationEngine } from './mutation-engine.js';

import type { SelectionService } from '../features/selection/index.js';
import type { SearchService } from '../features/search/index.js';
import type { FilterContext, FilterService } from '../features/filter/index.js';
import type { DownloadQueue } from '../features/download/index.js';
import type { ReportService } from '../features/reporting/index.js';
import { type ReportFormat } from '../features/reporting/index.js';
import type { DownloadHistory, StorageService } from '../features/local-storage/index.js';

import type { PanelViewModel, PanelEvent } from '../ui/components/panel-view-model.js';

interface ControllerEvents extends Record<string, unknown> {
  panel: PanelEvent;
}

/** The part of `DownloadHistory` the controller needs. */
export type HistoryPort = Pick<DownloadHistory, 'has' | 'add' | 'onChange'>;

/** The part of `DirectoryWriter` the controller needs. */
export interface DirectoryPort {
  isSupported(): boolean;
  hasHandle(): boolean;
  pick(): Promise<boolean>;
  clear(): Promise<void>;
}

/** The part of `ChatCrawler` the controller needs. */
export interface CrawlerPort {
  getState(): CrawlState;
  onChange(listener: (state: CrawlState) => void): () => void;
  start(options?: CrawlOptions): Promise<void>;
  pause(): void;
  resume(): void;
  stop(): void;
}

export interface CrawlerHooks {
  readonly getPeerId: () => string | undefined;
  readonly onStep: () => Promise<number>;
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
  readonly history?: HistoryPort;
  readonly directory?: DirectoryPort;
  readonly createCrawler?: (hooks: CrawlerHooks) => CrawlerPort;
  readonly getPeerId?: () => string | undefined;
  /** Finds the on-page element of an item (for "reveal in chat"). */
  readonly locate?: (item: MediaItem) => HTMLElement | null;
}

const IDLE_CRAWL: CrawlState = { status: 'idle', steps: 0, foundItems: 0 };

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
  private readonly history: HistoryPort | undefined;
  private readonly directory: DirectoryPort | undefined;
  private readonly crawler: CrawlerPort | undefined;
  private readonly peerIdOf: () => string | undefined;
  private readonly locate: ((item: MediaItem) => HTMLElement | null) | undefined;

  private settings: Settings;
  private filters: FilterState;
  private health: SelectorHealthReport | null = null;
  private visibleCache: readonly MediaItem[] = [];
  private currentPeer: string | undefined;
  /** Last terminal state already counted in persisted statistics, per task. */
  private readonly countedTasks = new Map<string, DownloadState>();
  private readonly disposers: Array<() => void> = [];

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
    this.history = deps.history;
    this.directory = deps.directory;
    this.peerIdOf = deps.getPeerId ?? (() => undefined);
    this.locate = deps.locate;
    this.settings = deps.settings;
    this.filters = deps.filters;
    this.currentPeer = this.peerIdOf();
    this.crawler = deps.createCrawler?.({
      getPeerId: () => this.peerIdOf(),
      onStep: () => this.crawlStep(),
    });

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
    this.crawler?.stop();
    for (const dispose of this.disposers.splice(0)) dispose();
  }

  applySettings(settings: Settings): void {
    const autoScanTurnedOff = this.settings.autoScan && !settings.autoScan;
    this.settings = settings;
    this.i18n.setLanguage(settings.language);
    this.logger.setLevel(settings.logLevel);
    this.queue.configure({
      maxConcurrent: settings.maxConcurrentDownloads,
      maxRetries: settings.maxRetries,
    });
    if (autoScanTurnedOff) this.mutationEngine.disconnect();
    this.emit('settings');
    this.emit('media');
  }

  getSettings(): Settings {
    return this.settings;
  }

  /** Re-reads the open chat; call on navigation (hash changes). */
  notifyLocationChanged(): void {
    const peer = this.peerIdOf();
    if (peer === this.currentPeer) return;
    this.currentPeer = peer;
    this.recomputeVisible();
    this.emit('media');
  }

  setHealth(report: SelectorHealthReport): void {
    this.health = report;
    this.emit('health');
  }

  getHealth(): SelectorHealthReport | null {
    return this.health;
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

  isDownloaded(id: string): boolean {
    const item = this.registry.get(id);
    return item !== undefined && this.isItemDownloaded(item);
  }

  getCurrentPeerId(): string | undefined {
    return this.currentPeer;
  }

  setQuery(query: string): void {
    this.updateFilters({ query });
  }

  toggleType(type: MediaType): void {
    const set = new Set(this.filters.types);
    if (set.has(type)) set.delete(type);
    else set.add(type);
    this.updateFilters({ types: [...set] });
  }

  setDateRange(range: DateRange): void {
    this.updateFilters({ dateRange: range });
  }

  setScope(scope: FilterScope): void {
    this.updateFilters({ scope });
  }

  setHideDownloaded(value: boolean): void {
    this.updateFilters({ hideDownloaded: value });
  }

  resetFilters(): void {
    this.filters = { ...DEFAULT_FILTERS };
    this.persistFilters(this.filters);
    this.recomputeVisible();
    this.emit('filters');
    this.emit('media');
  }

  toggleSelection(id: string): void {
    this.selection.toggle(id);
  }

  selectRange(anchorId: string, targetId: string): void {
    const ids = this.visibleCache.map((item) => item.id);
    const from = ids.indexOf(anchorId);
    const to = ids.indexOf(targetId);
    if (from === -1 || to === -1) return;
    const [start, end] = from <= to ? [from, to] : [to, from];
    this.selection.selectAllVisible(ids.slice(start, end + 1));
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

  /** Downloads the selected items that are currently visible (filters apply). */
  downloadSelected(): void {
    const items = this.visibleCache.filter((item) => this.selection.has(item.id));
    if (items.length === 0) {
      this.logger.warn('Download requested with no visible selection');
      return;
    }
    this.enqueueItems(items);
  }

  startQueue(): void {
    this.queue.start();
  }

  pauseQueue(): void {
    this.queue.pause();
  }

  resumeQueue(): void {
    this.queue.resume();
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
      const report = this.report.generate(this.visibleCache, format, {
        isDownloaded: (id) => this.isDownloaded(id),
      });
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

  revealItem(id: string): void {
    const item = this.registry.get(id);
    const element = item ? this.locate?.(item) : null;
    if (!element) {
      this.logger.warn('Item is not rendered in the chat right now; scroll to load it.');
      return;
    }
    element.scrollIntoView({ block: 'center', behavior: 'smooth' });
  }

  getCrawlState(): CrawlState {
    return this.crawler?.getState() ?? IDLE_CRAWL;
  }

  startCrawl(options?: CrawlOptions): void {
    if (!this.crawler) return;
    this.crawler.start(options).catch((error: unknown) => {
      this.logger.error('Chat scan failed', toMessage(error));
    });
  }

  pauseCrawl(): void {
    this.crawler?.pause();
  }

  resumeCrawl(): void {
    this.crawler?.resume();
  }

  stopCrawl(): void {
    this.crawler?.stop();
  }

  hasDownloadDirectory(): boolean {
    return this.directory?.hasHandle() ?? false;
  }

  async pickDownloadDirectory(): Promise<boolean> {
    if (!this.directory?.isSupported()) return false;
    try {
      const picked = await this.directory.pick();
      this.emit('settings');
      return picked;
    } catch (error) {
      this.logger.warn('Choosing a save folder failed', toMessage(error));
      return false;
    }
  }

  async clearDownloadDirectory(): Promise<void> {
    await this.directory?.clear();
    this.emit('settings');
  }

  subscribe(listener: (event: PanelEvent) => void): () => void {
    return this.emitter.on('panel', listener);
  }

  handleMutations(addedRoots: readonly Element[]): void {
    try {
      this.applyScan(this.scanner.scan(addedRoots));
    } catch (error) {
      this.logger.error('Incremental scan failed', toMessage(error));
    }
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
    this.queue.onChange((snapshot) => {
      this.pruneCountedTasks(snapshot);
      this.emit('queue');
    });
    this.queue.onProgress(() => this.emit('progress'));
    this.queue.onTaskChange((task) => this.onTaskStateChange(task));
    this.logger.subscribe(() => this.emitLogs());

    if (this.history) {
      this.disposers.push(
        this.history.onChange(() => {
          if (this.filters.hideDownloaded) this.recomputeVisible();
          this.emit('media');
        }),
      );
    }
    this.disposers.push(
      this.storage.onSettingsChanged((settings) => this.applySettings(settings)),
    );
    if (this.crawler) {
      this.disposers.push(this.crawler.onChange(() => this.emit('crawl')));
    }
  }

  private onTaskStateChange(task: DownloadTask): void {
    if (task.state === 'completed') this.recordDownloaded(task);
    if (task.state !== 'completed' && task.state !== 'failed') return;

    const previous = this.countedTasks.get(task.id);
    if (previous === task.state) return;
    this.countedTasks.set(task.id, task.state);

    // A retried task can go failed → completed; move it between the counters.
    const completed =
      (task.state === 'completed' ? 1 : 0) - (previous === 'completed' ? 1 : 0);
    const failed = (task.state === 'failed' ? 1 : 0) - (previous === 'failed' ? 1 : 0);
    void this.storage.updateStatistics((current) => ({
      ...current,
      totalDownloaded: current.totalDownloaded + completed,
      totalFailed: Math.max(0, current.totalFailed + failed),
    }));
  }

  private pruneCountedTasks(snapshot: QueueSnapshot): void {
    if (this.countedTasks.size <= snapshot.tasks.length) return;
    const live = new Set(snapshot.tasks.map((t) => t.id));
    for (const id of this.countedTasks.keys()) {
      if (!live.has(id)) this.countedTasks.delete(id);
    }
  }

  private recordDownloaded(task: DownloadTask): void {
    const { item } = task;
    const key = historyKeyOf(item);
    if (!this.history || key === undefined) return;
    void this.history.add({
      key,
      type: item.type,
      downloadedAt: Date.now(),
      ...(item.peerId !== undefined ? { peerId: item.peerId } : {}),
      ...(item.messageId !== undefined ? { messageId: item.messageId } : {}),
      ...(item.fileName !== undefined ? { fileName: item.fileName } : {}),
      ...(task.savedPath !== undefined ? { savedPath: task.savedPath } : {}),
    });
  }

  private isItemDownloaded(item: MediaItem): boolean {
    const key = historyKeyOf(item);
    return key !== undefined && (this.history?.has(key) ?? false);
  }

  private enqueueItems(items: readonly MediaItem[]): number {
    const pending = this.settings.skipDownloaded
      ? items.filter((item) => !this.isItemDownloaded(item))
      : items;
    const skipped = items.length - pending.length;
    if (skipped > 0) this.logger.info(`Skipped ${skipped} already downloaded item(s)`);
    if (pending.length === 0) return 0;
    const created = this.queue.enqueue(pending);
    this.queue.start();
    return created.length;
  }

  private async crawlStep(): Promise<number> {
    this.mutationEngine.flushNow();
    const before = new Set(this.registry.values().map((item) => item.id));
    this.performScan(false);
    const found = this.registry.values().filter((item) => !before.has(item.id));

    if (this.settings.crawlAutoDownload && found.length > 0) {
      const matching = this.filter.apply(found, this.filters, this.filterContext());
      if (this.enqueueItems(matching) > 0) await this.waitForQueueIdle();
    }
    return found.length;
  }

  /** Resolves once nothing is queued or running (or the queue is paused). */
  private waitForQueueIdle(): Promise<void> {
    const idle = (s: QueueSnapshot): boolean =>
      s.paused || (s.queued === 0 && s.running === 0);
    if (idle(this.queue.snapshot())) return Promise.resolve();
    return new Promise<void>((resolve) => {
      const off = this.queue.onChange((snapshot) => {
        if (!idle(snapshot)) return;
        off();
        resolve();
      });
    });
  }

  private performScan(log = true): void {
    try {
      this.applyScan(this.scanner.scan());
      void this.storage.updateStatistics((current) => ({
        ...current,
        totalDiscovered: this.registry.size,
        lastScanAt: Date.now(),
      }));
      if (log) this.logger.info(this.i18n.t('scan_done', { count: this.registry.size }));
    } catch (error) {
      this.logger.error('Scan failed', toMessage(error));
    }
  }

  private applyScan(result: ScanResult): void {
    if (result.items.length > 0) this.registry.addMany(result.items);
    for (const { id, patch } of result.updates) this.registry.update(id, patch);
  }

  private updateFilters(patch: Partial<FilterState>): void {
    this.filters = { ...this.filters, ...patch };
    this.persistFilters(this.filters);
    this.recomputeVisible();
    this.emit('filters');
    this.emit('media');
  }

  private filterContext(): FilterContext {
    return {
      ...(this.currentPeer !== undefined ? { currentPeerId: this.currentPeer } : {}),
      isDownloaded: (id) => this.isDownloaded(id),
    };
  }

  private recomputeVisible(): void {
    const filtered = this.filter.apply(
      this.registry.values(),
      this.filters,
      this.filterContext(),
    );
    this.visibleCache = this.search.filter(filtered, this.filters.query);
  }

  private emit(event: PanelEvent): void {
    this.emitter.emit('panel', event);
  }
}
