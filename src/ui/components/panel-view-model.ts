import type {
  MediaItem,
  MediaStatistics,
  MediaType,
  FilterState,
  FilterScope,
  DateRange,
  QueueSnapshot,
  CrawlOptions,
  CrawlState,
  SelectorHealthReport,
} from '../../shared/types/index.js';
import type { LogEntry } from '../../shared/logger/index.js';
import type { II18n } from '../../shared/i18n/index.js';
import type { ReportFormat } from '../../features/reporting/index.js';

/**
 * Change channels. `queue` fires on task state transitions / list changes;
 * `progress` fires (throttled) on per-task byte progress only, so views can
 * patch progress bars without rebuilding the list.
 */
export type PanelEvent =
  | 'media'
  | 'selection'
  | 'queue'
  | 'progress'
  | 'logs'
  | 'filters'
  | 'crawl'
  | 'health'
  | 'settings';

export interface PanelViewModel {
  readonly i18n: II18n;

  getStatistics(): MediaStatistics;
  getVisibleItems(): readonly MediaItem[];
  getFilters(): FilterState;
  getQueueSnapshot(): QueueSnapshot;
  getLogs(): readonly LogEntry[];
  getSelectedIds(): readonly string[];
  isSelected(id: string): boolean;
  /** True when the item is recorded in the persistent download history. */
  isDownloaded(id: string): boolean;
  /** Peer id of the chat currently open in Telegram, if any. */
  getCurrentPeerId(): string | undefined;

  setQuery(query: string): void;
  toggleType(type: MediaType): void;
  setDateRange(range: DateRange): void;
  setScope(scope: FilterScope): void;
  setHideDownloaded(value: boolean): void;
  resetFilters(): void;

  toggleSelection(id: string): void;
  /** Select every visible item between `anchorId` and `targetId` (inclusive). */
  selectRange(anchorId: string, targetId: string): void;
  selectAllVisible(): void;
  clearSelection(): void;

  rescan(): void;
  downloadSelected(): void;
  startQueue(): void;
  pauseQueue(): void;
  resumeQueue(): void;
  cancelAllDownloads(): void;
  cancelTask(taskId: string): void;
  retryTask(taskId: string): void;
  clearFinishedTasks(): void;
  exportReport(format: ReportFormat): void;
  clearLogs(): void;

  /** Scroll the Telegram chat so the message holding this item is visible. */
  revealItem(id: string): void;

  getCrawlState(): CrawlState;
  startCrawl(options?: CrawlOptions): void;
  pauseCrawl(): void;
  resumeCrawl(): void;
  stopCrawl(): void;

  /** A directory handle is available for streaming large files to disk. */
  hasDownloadDirectory(): boolean;
  /** Must be called from a user gesture. Resolves false if the user cancels. */
  pickDownloadDirectory(): Promise<boolean>;
  clearDownloadDirectory(): Promise<void>;

  getHealth(): SelectorHealthReport | null;

  subscribe(listener: (event: PanelEvent) => void): () => void;
}
