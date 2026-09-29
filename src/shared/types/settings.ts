import type { MediaType } from './media.js';

export const THEMES = ['light', 'dark', 'auto'] as const;
export type Theme = (typeof THEMES)[number];

export const LANGUAGES = ['en', 'tr'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DATE_RANGES = ['all', 'today', 'week', 'month'] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export const FILTER_SCOPES = ['all', 'currentChat'] as const;
export type FilterScope = (typeof FILTER_SCOPES)[number];

export interface Settings {
  autoScan: boolean;
  theme: Theme;
  language: Language;
  logLevel: LogLevel;

  maxConcurrentDownloads: number;

  maxRetries: number;

  /** Minimum pause between two native (Telegram-menu) downloads. */
  downloadDelayMs: number;

  /** Random extra delay (0..jitter) added to `downloadDelayMs`. */
  downloadJitterMs: number;

  /**
   * Relative path template for saved files. Tokens: {chat} {peer} {date}
   * {time} {msgId} {index} {type} {name} {ext}. `/` creates sub-folders.
   */
  fileNameTemplate: string;

  /** Use Telegram's own download (full resolution) for photos too. */
  preferNativeDownload: boolean;

  /** Above this size (MB) never buffer in memory: stream to disk or go native. */
  largeFileThresholdMb: number;

  /** Skip items already recorded in the download history. */
  skipDownloaded: boolean;

  /**
   * While crawling a chat, queue newly found media that match the current
   * filters and wait for them before scrolling on (Telegram only downloads
   * media that is on screen).
   */
  crawlAutoDownload: boolean;
}

export interface FilterState {
  readonly types: readonly MediaType[];
  readonly dateRange: DateRange;
  readonly query: string;
  readonly scope: FilterScope;
  readonly hideDownloaded: boolean;
}

export interface PanelState {
  x: number;
  y: number;
  collapsed: boolean;
  visible: boolean;
}

export interface PersistedStatistics {
  totalDiscovered: number;
  totalDownloaded: number;
  totalFailed: number;
  lastScanAt: number | null;
}
