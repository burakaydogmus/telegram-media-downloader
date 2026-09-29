import type { MediaItem, MediaType } from '../types/index.js';
import { hashString } from './id.js';

export interface MediaKeyParts {
  readonly peerId?: string | undefined;
  readonly messageId?: string | undefined;
  readonly albumIndex?: number | undefined;
  readonly type: MediaType;
}

/**
 * Stable, human-readable identity of a media item across sessions:
 * `peer:msg:index:type`. Returns `undefined` when there is no message id,
 * because without it the item cannot be identified reliably.
 */
export function mediaKey(parts: MediaKeyParts): string | undefined {
  if (!parts.messageId) return undefined;
  return [parts.peerId ?? '_', parts.messageId, parts.albumIndex ?? 0, parts.type].join(
    ':',
  );
}

/** Registry id for an item: hash of its media key (or of a fallback signature). */
export function mediaIdFromKey(key: string): string {
  return hashString(key);
}

export function historyKeyOf(item: MediaItem): string | undefined {
  return mediaKey(item);
}
