import { describe, it, expect } from 'vitest';
import { FilterService } from '../../src/features/filter/filter-service.js';
import type { FilterState } from '../../src/shared/types/index.js';
import { makeItem } from '../helpers/factories.js';

const FIXED_NOW = new Date('2026-06-19T12:00:00.000Z').getTime();
const baseFilters: FilterState = {
  types: ['photo', 'video', 'gif', 'document', 'audio'],
  dateRange: 'all',
  query: '',
  scope: 'all',
  hideDownloaded: false,
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

  it('scope currentChat keeps only items of the current peer', () => {
    const items = [
      makeItem({ id: 'here', peerId: '42' }),
      makeItem({ id: 'there', peerId: '7' }),
      makeItem({ id: 'unknown' }),
    ];
    const filters = { ...baseFilters, scope: 'currentChat' as const };
    expect(
      service.apply(items, filters, { currentPeerId: '42' }).map((i) => i.id),
    ).toEqual(['here']);
    // No open chat known: scope is not applied.
    expect(service.apply(items, filters, {})).toHaveLength(3);
    expect(service.apply(items, filters)).toHaveLength(3);
    // Scope 'all' ignores the current peer.
    expect(service.apply(items, baseFilters, { currentPeerId: '42' })).toHaveLength(3);
  });

  it('hideDownloaded drops items recorded as downloaded', () => {
    const items = [makeItem({ id: 'done' }), makeItem({ id: 'new' })];
    const isDownloaded = (id: string) => id === 'done';
    expect(
      service
        .apply(items, { ...baseFilters, hideDownloaded: true }, { isDownloaded })
        .map((i) => i.id),
    ).toEqual(['new']);
    expect(service.apply(items, baseFilters, { isDownloaded })).toHaveLength(2);
    // Without a lookup nothing can be hidden.
    expect(service.apply(items, { ...baseFilters, hideDownloaded: true })).toHaveLength(
      2,
    );
  });

  it('combines type, scope and hideDownloaded filters', () => {
    const items = [
      makeItem({ id: 'a', type: 'photo', peerId: '1' }),
      makeItem({ id: 'b', type: 'video', peerId: '1' }),
      makeItem({ id: 'c', type: 'photo', peerId: '2' }),
      makeItem({ id: 'd', type: 'photo', peerId: '1' }),
    ];
    const result = service.apply(
      items,
      { ...baseFilters, types: ['photo'], scope: 'currentChat', hideDownloaded: true },
      { currentPeerId: '1', isDownloaded: (id) => id === 'd' },
    );
    expect(result.map((i) => i.id)).toEqual(['a']);
  });

  it('matches() validates a single item', () => {
    const item = makeItem({ id: 'p', type: 'photo' });
    expect(service.matches(item, { ...baseFilters, types: ['photo'] })).toBe(true);
    expect(service.matches(item, { ...baseFilters, types: ['video'] })).toBe(false);
  });
});
