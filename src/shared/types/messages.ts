import type { MediaItem } from './media.js';
import type { LogLevel } from './settings.js';

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
}
