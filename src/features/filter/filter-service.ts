import type {
  MediaItem,
  MediaType,
  FilterState,
  DateRange,
} from '../../shared/types/index.js';

/** Runtime facts the filter needs but that are not part of `FilterState`. */
export interface FilterContext {
  /** Peer of the chat currently open; when undefined, scope is not applied. */
  readonly currentPeerId?: string;
  /** Download-history lookup used by `hideDownloaded`. */
  readonly isDownloaded?: (id: string) => boolean;
}

function rangeStart(range: DateRange, now: number): number {
  const date = new Date(now);
  switch (range) {
    case 'today': {
      date.setHours(0, 0, 0, 0);
      return date.getTime();
    }
    case 'week': {
      // Start of the current week (Monday).
      const day = (date.getDay() + 6) % 7;
      date.setHours(0, 0, 0, 0);
      date.setDate(date.getDate() - day);
      return date.getTime();
    }
    case 'month': {
      date.setHours(0, 0, 0, 0);
      date.setDate(1);
      return date.getTime();
    }
    case 'all':
    default:
      return Number.NEGATIVE_INFINITY;
  }
}

export class FilterService {
  constructor(private readonly now: () => number = Date.now) {}

  /**
   * While a date range other than `all` is active, items without a `timestamp`
   * are excluded — their age is unknown.
   */
  apply(
    items: readonly MediaItem[],
    filters: FilterState,
    ctx: FilterContext = {},
  ): MediaItem[] {
    const typeSet = new Set<MediaType>(filters.types);
    const allTypes = typeSet.size === 0;
    const byDate = filters.dateRange !== 'all';
    const start = rangeStart(filters.dateRange, this.now());
    const peerId = filters.scope === 'currentChat' ? ctx.currentPeerId : undefined;
    const isDownloaded = filters.hideDownloaded ? ctx.isDownloaded : undefined;

    return items.filter((item) => {
      if (!allTypes && !typeSet.has(item.type)) return false;
      if (byDate) {
        if (typeof item.timestamp !== 'number') return false;
        if (item.timestamp < start) return false;
      }
      if (peerId !== undefined && item.peerId !== peerId) return false;
      if (isDownloaded?.(item.id) === true) return false;
      return true;
    });
  }

  matches(item: MediaItem, filters: FilterState, ctx: FilterContext = {}): boolean {
    return this.apply([item], filters, ctx).length === 1;
  }
}
