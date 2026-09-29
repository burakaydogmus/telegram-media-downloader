export const CRAWL_STATUSES = ['idle', 'running', 'paused', 'done', 'error'] as const;
export type CrawlStatus = (typeof CRAWL_STATUSES)[number];

export interface CrawlOptions {
  /** Stop once messages older than this epoch-ms timestamp are reached. */
  readonly untilTimestamp?: number;
  /** Hard cap on scroll steps (safety net). */
  readonly maxSteps?: number;
}

export interface CrawlState {
  readonly status: CrawlStatus;
  readonly peerId?: string;
  readonly steps: number;
  readonly foundItems: number;
  /** Oldest message timestamp reached so far (epoch ms). */
  readonly oldestTimestamp?: number;
  readonly error?: string;
}

export interface CrawlCheckpoint {
  readonly peerId: string;
  readonly oldestMessageId?: string;
  readonly oldestTimestamp?: number;
  readonly steps: number;
  readonly updatedAt: number;
  readonly done: boolean;
}

/** Persistence contract for crawl progress (implemented in local-storage). */
export interface CrawlCheckpointStore {
  get(peerId: string): Promise<CrawlCheckpoint | undefined>;
  set(checkpoint: CrawlCheckpoint): Promise<void>;
  remove(peerId: string): Promise<void>;
}
