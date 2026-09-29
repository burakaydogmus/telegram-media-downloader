import type { MediaItem } from './media.js';
import type { LogLevel } from './settings.js';
import type { SelectorHealthReport } from './health.js';

export type NativeDownloadPhase =
  | 'started'
  | 'progress'
  | 'complete'
  | 'interrupted'
  | 'expired';

/**
 * Protocol between content script and service worker for download tracking.
 *
 * Content → SW: `EXPECT_DOWNLOAD` right before it triggers a browser download
 * (Telegram's native menu item, or an `<a download>` click). The SW matches the
 * next Telegram-originated download to it (exactly by `token` when the file
 * name contains it, otherwise FIFO), renames it via
 * `chrome.downloads.onDeterminingFilename` to `relativePath`, and reports
 * progress back with `DOWNLOAD_UPDATE` messages to the sender tab.
 */
export type RuntimeMessage =
  | { readonly type: 'PING' }
  | { readonly type: 'GET_STATE' }
  | { readonly type: 'TOGGLE_PANEL' }
  | { readonly type: 'START_SCAN' }
  | { readonly type: 'DOWNLOAD_ITEMS'; readonly items: readonly MediaItem[] }
  | {
      readonly type: 'DOWNLOAD_FILE';
      readonly url: string;
      readonly fileName: string;
    }
  | {
      readonly type: 'EXPECT_DOWNLOAD';
      readonly taskId: string;
      /** Relative path (may contain `/`) the file should be saved as. */
      readonly relativePath: string;
      /** Unique marker embedded in the anchor file name, when applicable. */
      readonly token?: string;
      /** How long the SW keeps the expectation before reporting `expired`. */
      readonly timeoutMs: number;
    }
  | { readonly type: 'CANCEL_EXPECTED_DOWNLOAD'; readonly taskId: string }
  | {
      readonly type: 'DOWNLOAD_UPDATE';
      readonly taskId: string;
      readonly phase: NativeDownloadPhase;
      readonly downloadId?: number;
      readonly bytesReceived?: number;
      readonly totalBytes?: number;
      readonly filename?: string;
      readonly error?: string;
    }
  | {
      readonly type: 'LOG';
      readonly level: LogLevel;
      readonly scope: string;
      readonly message: string;
    };

export interface MessageResponse<T = unknown> {
  readonly ok: boolean;
  readonly data?: T;
  readonly error?: string;
}

export interface ContentState {
  readonly detected: boolean;
  readonly client: string;
  readonly totalMedia: number;
  readonly selected: number;
  readonly health?: SelectorHealthReport;
}
