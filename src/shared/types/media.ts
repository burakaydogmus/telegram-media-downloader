export const MEDIA_TYPES = ['photo', 'video', 'gif', 'document', 'audio'] as const;

export type MediaType = (typeof MEDIA_TYPES)[number];

export interface MediaItem {
  readonly id: string;

  readonly type: MediaType;

  readonly fileName?: string;

  readonly date?: string;

  readonly size?: string;

  readonly messageId?: string;

  readonly url?: string;

  readonly thumbnailUrl?: string;

  readonly byteSize?: number;

  readonly timestamp?: number;

  readonly peerId?: string;
}

export type MediaItemPatch = Partial<Omit<MediaItem, 'id'>>;

export interface MediaStatistics {
  readonly total: number;
  readonly byType: Readonly<Record<MediaType, number>>;
  readonly totalBytes: number;
  readonly selected: number;
}
