import type { MediaType } from './media.js';

export const THEMES = ['light', 'dark', 'auto'] as const;
export type Theme = (typeof THEMES)[number];

export const LANGUAGES = ['en', 'tr'] as const;
export type Language = (typeof LANGUAGES)[number];

export const LOG_LEVELS = ['debug', 'info', 'warn', 'error'] as const;
export type LogLevel = (typeof LOG_LEVELS)[number];

export const DATE_RANGES = ['all', 'today', 'week', 'month'] as const;
export type DateRange = (typeof DATE_RANGES)[number];

export interface Settings {
  autoScan: boolean;
  theme: Theme;
  language: Language;
  logLevel: LogLevel;

  maxConcurrentDownloads: number;

  maxRetries: number;
}

export interface FilterState {
  readonly types: readonly MediaType[];
  readonly dateRange: DateRange;
  readonly query: string;
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
