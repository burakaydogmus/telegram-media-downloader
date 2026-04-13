import type {
  MediaItem,
  MediaStatistics,
  MediaType,
  FilterState,
  DateRange,
  QueueSnapshot,
} from '../../shared/types/index.js';
import type { LogEntry } from '../../shared/logger/index.js';
import type { II18n } from '../../shared/i18n/index.js';
import type { ReportFormat } from '../../features/reporting/index.js';

export type PanelEvent = 'media' | 'selection' | 'queue' | 'logs' | 'filters';

export interface PanelViewModel {
  readonly i18n: II18n;

  getStatistics(): MediaStatistics;
  getVisibleItems(): readonly MediaItem[];
  getFilters(): FilterState;
  getQueueSnapshot(): QueueSnapshot;
  getLogs(): readonly LogEntry[];
  getSelectedIds(): readonly string[];
  isSelected(id: string): boolean;

  setQuery(query: string): void;
  toggleType(type: MediaType): void;
  setDateRange(range: DateRange): void;

  toggleSelection(id: string): void;
  selectAllVisible(): void;
  clearSelection(): void;

  rescan(): void;
  downloadSelected(): void;
  startQueue(): void;
  cancelAllDownloads(): void;
  cancelTask(taskId: string): void;
  retryTask(taskId: string): void;
  clearFinishedTasks(): void;
  exportReport(format: ReportFormat): void;
  clearLogs(): void;

  subscribe(listener: (event: PanelEvent) => void): () => void;
}
