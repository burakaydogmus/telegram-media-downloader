import type { MediaType } from './media.js';

export interface DownloadRecord {
  /** `mediaKey(item)` — stable across sessions. */
  readonly key: string;
  readonly peerId?: string;
  readonly messageId?: string;
  readonly type: MediaType;
  readonly fileName?: string;
  readonly savedPath?: string;
  readonly downloadedAt: number;
}
