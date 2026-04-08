import type {
  MediaItem,
  MediaType,
  FilterState,
  DateRange,
} from '../../shared/types/index.js';

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

  apply(items: readonly MediaItem[], filters: FilterState): MediaItem[] {
    const typeSet = new Set<MediaType>(filters.types);
    const start = rangeStart(filters.dateRange, this.now());
    const allTypes = typeSet.size === 0;

    return items.filter((item) => {
      if (!allTypes && !typeSet.has(item.type)) return false;
      if (filters.dateRange !== 'all') {
        if (typeof item.timestamp !== 'number') return false;
        if (item.timestamp < start) return false;
      }
      return true;
    });
  }

  matches(item: MediaItem, filters: FilterState): boolean {
    return this.apply([item], filters).length === 1;
  }
}
