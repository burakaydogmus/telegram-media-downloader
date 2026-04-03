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
} as const;

export const DEFAULT_SETTINGS: Settings = {
  autoScan: true,
  theme: 'auto',
  language: 'en',
  logLevel: 'info',
  maxConcurrentDownloads: 3,
  maxRetries: 3,
};

export const DEFAULT_FILTERS: FilterState = {
  types: ['photo', 'video', 'gif', 'document', 'audio'],
  dateRange: 'all',
  query: '',
};

export const DEFAULT_PANEL_STATE: PanelState = {
  x: 24,
  y: 96,
  collapsed: false,
  visible: true,
};
