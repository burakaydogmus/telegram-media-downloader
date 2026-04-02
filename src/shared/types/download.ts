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

  chromeDownloadId?: number;

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
}
