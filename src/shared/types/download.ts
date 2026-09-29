import type { MediaItem } from './media.js';

export const DOWNLOAD_STATES = [
  'queued',
  'running',
  'completed',
  'failed',
  'cancelled',
] as const;

export type DownloadState = (typeof DOWNLOAD_STATES)[number];

export interface DownloadTask {
  readonly id: string;
  readonly item: MediaItem;
  state: DownloadState;

  progress: number;

  attempts: number;

  /** Epoch ms before which a queued retry must not start (backoff). */
  nextAttemptAt?: number;

  chromeDownloadId?: number;

  bytesReceived?: number;

  totalBytes?: number;

  /** Final path reported by chrome.downloads, when known. */
  savedPath?: string;

  error?: string;
  readonly createdAt: number;
  updatedAt: number;
}

export interface QueueSnapshot {
  readonly tasks: readonly DownloadTask[];
  readonly total: number;
  readonly completed: number;
  readonly failed: number;
  readonly running: number;
  readonly queued: number;
  readonly cancelled: number;

  readonly overallProgress: number;

  /** Queue is paused (manually or automatically, e.g. on FLOOD_WAIT). */
  readonly paused: boolean;
  readonly pauseReason?: string;
}
