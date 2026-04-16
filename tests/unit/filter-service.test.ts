import { describe, it, expect } from 'vitest';
import { FilterService } from '../../src/features/filter/filter-service.js';
import type { FilterState } from '../../src/shared/types/index.js';
import { makeItem } from '../helpers/factories.js';

const FIXED_NOW = new Date('2026-06-19T12:00:00.000Z').getTime();
const baseFilters: FilterState = {
  types: ['photo', 'video', 'gif', 'document', 'audio'],
  dateRange: 'all',
  query: '',
};

describe('FilterService', () => {
  const service = new FilterService(() => FIXED_NOW);

  it('filters by type', () => {
    const items = [
      makeItem({ id: 'p', type: 'photo' }),
      makeItem({ id: 'v', type: 'video' }),
    ];
    const result = service.apply(items, { ...baseFilters, types: ['photo'] });
    expect(result.map((i) => i.id)).toEqual(['p']);
  });

  it('returns all when no type restriction (empty types means all)', () => {
    const items = [makeItem({ id: 'p', type: 'photo' })];
    expect(service.apply(items, { ...baseFilters, types: [] })).toHaveLength(1);
  });

  it('filters by today', () => {
    const items = [
      makeItem({ id: 'today', timestamp: FIXED_NOW - 1000 }),
      makeItem({ id: 'old', timestamp: FIXED_NOW - 1000 * 60 * 60 * 48 }),
    ];
    const result = service.apply(items, { ...baseFilters, dateRange: 'today' });
    expect(result.map((i) => i.id)).toEqual(['today']);
  });

  it('filters by this week', () => {
    const items = [
      makeItem({ id: 'recent', timestamp: FIXED_NOW - 1000 * 60 * 60 * 24 }),
      makeItem({ id: 'lastmonth', timestamp: FIXED_NOW - 1000 * 60 * 60 * 24 * 20 }),
    ];
    const result = service.apply(items, { ...baseFilters, dateRange: 'week' });
    expect(result.map((i) => i.id)).toContain('recent');
    expect(result.map((i) => i.id)).not.toContain('lastmonth');
  });

  it('filters by this month', () => {
    const items = [
      makeItem({
        id: 'thismonth',
        timestamp: new Date('2026-06-02T00:00:00Z').getTime(),
      }),
      makeItem({ id: 'prev', timestamp: new Date('2026-05-15T00:00:00Z').getTime() }),
    ];
    const result = service.apply(items, { ...baseFilters, dateRange: 'month' });
    expect(result.map((i) => i.id)).toEqual(['thismonth']);
  });

  it('excludes items lacking a timestamp under date filters', () => {
    const items = [makeItem({ id: 'no-ts' })];
    expect(service.apply(items, { ...baseFilters, dateRange: 'today' })).toHaveLength(0);
  });

  it('matches() validates a single item', () => {
    const item = makeItem({ id: 'p', type: 'photo' });
    expect(service.matches(item, { ...baseFilters, types: ['photo'] })).toBe(true);
    expect(service.matches(item, { ...baseFilters, types: ['video'] })).toBe(false);
  });
});
