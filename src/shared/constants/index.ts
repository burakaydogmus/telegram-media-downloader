import type { Settings, FilterState, PanelState } from '../types/index.js';

export const APP_ID = 'tg-media-downloader' as const;
export const APP_NAME = 'Telegram Media Downloader' as const;

export const PANEL_ROOT_ID = `${APP_ID}-root` as const;

export const TAGS = {
  panel: 'tgmd-panel',
  statistics: 'tgmd-statistics',
  search: 'tgmd-search',
  filters: 'tgmd-filters',
  selection: 'tgmd-selection',
  queue: 'tgmd-queue',
  logs: 'tgmd-logs',
} as const;

export const STORAGE_KEYS = {
  settings: `${APP_ID}:settings`,
  filters: `${APP_ID}:filters`,
  panel: `${APP_ID}:panel`,
  statistics: `${APP_ID}:statistics`,
  logs: `${APP_ID}:logs`,
} as const;

export const PERF = {
  mutationDebounceMs: 80,

  scanBatchSize: 200,

  maxLogEntries: 1000,

  downloadPollMs: 500,

  /** Base delay for exponential retry backoff in the download queue. */
  retryBaseDelayMs: 1000,

  /** Upper bound for a single retry backoff. */
  retryMaxDelayMs: 30_000,
} as const;

/** IndexedDB database used for large/structured persistence. */
export const IDB = {
  name: 'tg-media-downloader',
  version: 1,
  stores: {
    history: 'downloadHistory',
    crawl: 'crawlCheckpoints',
    handles: 'fileHandles',
  },
} as const;

export const DEFAULT_SETTINGS: Settings = {
  autoScan: true,
  theme: 'auto',
  language: 'en',
  logLevel: 'info',
  maxConcurrentDownloads: 3,
  maxRetries: 3,
  downloadDelayMs: 800,
  downloadJitterMs: 600,
  fileNameTemplate: 'Telegram/{chat}/{date}_{msgId}_{index}_{name}',
  preferNativeDownload: true,
  largeFileThresholdMb: 200,
  skipDownloaded: true,
};

export const DEFAULT_FILTERS: FilterState = {
  types: ['photo', 'video', 'gif', 'document', 'audio'],
  dateRange: 'all',
  query: '',
  scope: 'currentChat',
  hideDownloaded: false,
};

export const DEFAULT_PANEL_STATE: PanelState = {
  x: 24,
  y: 96,
  collapsed: false,
  visible: true,
};
