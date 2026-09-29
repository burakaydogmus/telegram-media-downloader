import { vi } from 'vitest';
import { StubViewModelBase } from '../helpers/stub-view-model-base.js';
import type {
  PanelViewModel,
  PanelEvent,
} from '../../src/ui/components/panel-view-model.js';
import type {
  CrawlOptions,
  CrawlState,
  DownloadTask,
  FilterScope,
  FilterState,
  MediaItem,
  MediaStatistics,
  QueueSnapshot,
  SelectorHealthReport,
} from '../../src/shared/types/index.js';
import type { LogEntry } from '../../src/shared/logger/index.js';
import { I18n } from '../../src/shared/i18n/index.js';
import { DEFAULT_FILTERS } from '../../src/shared/constants/index.js';

export interface FrameMock {
  /** Run all queued frame callbacks; returns how many ran. */
  flush(): number;
  pending(): number;
  restore(): void;
}

/** Replace requestAnimationFrame with a manually flushed queue. */
export function installFrameMock(): FrameMock {
  let next = 1;
  const queue = new Map<number, FrameRequestCallback>();
  vi.stubGlobal('requestAnimationFrame', (cb: FrameRequestCallback) => {
    const id = next++;
    queue.set(id, cb);
    return id;
  });
  vi.stubGlobal('cancelAnimationFrame', (id: number) => {
    queue.delete(id);
  });
  return {
    flush() {
      const callbacks = [...queue.values()];
      queue.clear();
      for (const cb of callbacks) cb(performance.now());
      return callbacks.length;
    },
    pending: () => queue.size,
    restore: () => vi.unstubAllGlobals(),
  };
}

/** Full-featured stub recording calls, used by the newer UI tests. */
export class HarnessVM extends StubViewModelBase implements PanelViewModel {
  readonly i18n = new I18n('en');
  items: MediaItem[] = [];
  selected = new Set<string>();
  downloaded = new Set<string>();
  tasks: DownloadTask[] = [];
  paused = false;
  pauseReason: string | undefined;
  filters: FilterState = { ...DEFAULT_FILTERS };
  crawl: CrawlState = { status: 'idle', steps: 0, foundItems: 0 };
  health: SelectorHealthReport | null = null;
  hasDirectory = false;
  calls: Array<{ name: string; args: readonly unknown[] }> = [];
  private listeners = new Set<(e: PanelEvent) => void>();

  called(name: string): Array<readonly unknown[]> {
    return this.calls.filter((c) => c.name === name).map((c) => c.args);
  }
  private record(name: string, ...args: unknown[]): void {
    this.calls.push({ name, args });
  }

  getStatistics(): MediaStatistics {
    return {
      total: this.items.length,
      byType: { photo: this.items.length, video: 0, gif: 0, document: 0, audio: 0 },
      totalBytes: 0,
      selected: this.selected.size,
    };
  }
  getVisibleItems(): readonly MediaItem[] {
    return this.items;
  }
  getFilters(): FilterState {
    return this.filters;
  }
  getQueueSnapshot(): QueueSnapshot {
    const count = (s: DownloadTask['state']) =>
      this.tasks.filter((t) => t.state === s).length;
    return {
      tasks: this.tasks,
      total: this.tasks.length,
      completed: count('completed'),
      failed: count('failed'),
      running: count('running'),
      queued: count('queued'),
      cancelled: count('cancelled'),
      overallProgress: this.tasks.length ? count('completed') / this.tasks.length : 0,
      paused: this.paused,
      ...(this.pauseReason !== undefined ? { pauseReason: this.pauseReason } : {}),
    };
  }
  getLogs(): readonly LogEntry[] {
    return [];
  }
  getSelectedIds(): readonly string[] {
    return [...this.selected];
  }
  isSelected(id: string): boolean {
    return this.selected.has(id);
  }
  override isDownloaded(id: string): boolean {
    return this.downloaded.has(id);
  }
  setQuery(q: string): void {
    this.record('setQuery', q);
  }
  toggleType(type: string): void {
    this.record('toggleType', type);
  }
  setDateRange(range: string): void {
    this.record('setDateRange', range);
  }
  override setScope(scope: FilterScope): void {
    this.record('setScope', scope);
    this.filters = { ...this.filters, scope };
    this.emit('filters');
  }
  override setHideDownloaded(value: boolean): void {
    this.record('setHideDownloaded', value);
    this.filters = { ...this.filters, hideDownloaded: value };
    this.emit('filters');
  }
  override resetFilters(): void {
    this.record('resetFilters');
    this.filters = { ...DEFAULT_FILTERS };
    this.emit('filters');
  }
  toggleSelection(id: string): void {
    this.record('toggleSelection', id);
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.emit('selection');
  }
  override selectRange(anchorId: string, targetId: string): void {
    this.record('selectRange', anchorId, targetId);
    const ids = this.items.map((i) => i.id);
    const a = ids.indexOf(anchorId);
    const b = ids.indexOf(targetId);
    for (const id of ids.slice(Math.min(a, b), Math.max(a, b) + 1)) {
      this.selected.add(id);
    }
    this.emit('selection');
  }
  selectAllVisible(): void {
    this.record('selectAllVisible');
  }
  clearSelection(): void {
    this.record('clearSelection');
  }
  rescan(): void {
    this.record('rescan');
  }
  downloadSelected(): void {
    this.record('downloadSelected');
  }
  startQueue(): void {
    this.record('startQueue');
  }
  override pauseQueue(): void {
    this.record('pauseQueue');
  }
  override resumeQueue(): void {
    this.record('resumeQueue');
  }
  cancelAllDownloads(): void {
    this.record('cancelAllDownloads');
  }
  cancelTask(id: string): void {
    this.record('cancelTask', id);
  }
  retryTask(id: string): void {
    this.record('retryTask', id);
  }
  clearFinishedTasks(): void {
    this.record('clearFinishedTasks');
  }
  exportReport(format: string): void {
    this.record('exportReport', format);
  }
  clearLogs(): void {
    this.record('clearLogs');
  }
  override revealItem(id: string): void {
    this.record('revealItem', id);
  }
  override getCrawlState(): CrawlState {
    return this.crawl;
  }
  override startCrawl(options?: CrawlOptions): void {
    this.record('startCrawl', options);
  }
  override pauseCrawl(): void {
    this.record('pauseCrawl');
  }
  override resumeCrawl(): void {
    this.record('resumeCrawl');
  }
  override stopCrawl(): void {
    this.record('stopCrawl');
  }
  override hasDownloadDirectory(): boolean {
    return this.hasDirectory;
  }
  override pickDownloadDirectory(): Promise<boolean> {
    this.record('pickDownloadDirectory');
    this.hasDirectory = true;
    return Promise.resolve(true);
  }
  override clearDownloadDirectory(): Promise<void> {
    this.record('clearDownloadDirectory');
    this.hasDirectory = false;
    return Promise.resolve();
  }
  override getHealth(): SelectorHealthReport | null {
    return this.health;
  }
  subscribe(listener: (e: PanelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  emit(e: PanelEvent): void {
    for (const l of this.listeners) l(e);
  }
}

export function makeTask(over: Partial<DownloadTask> & { id: string }): DownloadTask {
  return {
    item: { id: `m-${over.id}`, type: 'photo', fileName: `${over.id}.jpg` },
    state: 'queued',
    progress: 0,
    attempts: 0,
    createdAt: 0,
    updatedAt: 0,
    ...over,
  };
}
