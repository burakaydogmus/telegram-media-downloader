export const MEDIA_TYPES = ['photo', 'video', 'gif', 'document', 'audio'] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export interface MediaItem {
  /**
   * Stable identity. Derived from `peerId + messageId + albumIndex + type`
   * (see `mediaKey`), never from the URL — URLs change (thumb → full blob,
   * per-session blob URLs) and must not create duplicates.
   */
  readonly id: string;

  readonly type: MediaType;

  readonly fileName?: string;

  readonly date?: string;

  readonly size?: string;

  readonly messageId?: string;

  /** Position inside an album/grouped message (0 for single media). */
  readonly albumIndex?: number;

  readonly url?: string;

  readonly thumbnailUrl?: string;

  readonly byteSize?: number;

  readonly timestamp?: number;

  readonly peerId?: string;

  /** Human-readable chat title, used by file-name templates. */
  readonly chatTitle?: string;

  readonly mimeType?: string;
}

export type MediaItemPatch = Partial<Omit<MediaItem, 'id'>>;

export interface MediaStatistics {
  readonly total: number;
  readonly byType: Readonly<Record<MediaType, number>>;
  readonly totalBytes: number;
  readonly selected: number;
}
