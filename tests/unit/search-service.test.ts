import { describe, it, expect, vi } from 'vitest';
import { SearchService } from '../../src/features/search/search-service.js';
import { makeItem } from '../helpers/factories.js';

describe('SearchService', () => {
  const service = new SearchService();
  const items = [
    makeItem({
      id: '1',
      type: 'photo',
      fileName: 'vacation-beach.jpg',
      date: '2026-06-01',
    }),
    makeItem({
      id: '2',
      type: 'video',
      fileName: 'birthday-party.mp4',
      date: '2026-05-20',
    }),
    makeItem({
      id: '3',
      type: 'document',
      fileName: 'report-final.pdf',
      date: '2026-06-15',
    }),
  ];

  it('returns all items for an empty query', () => {
    expect(service.filter(items, '')).toHaveLength(3);
  });

  it('matches by partial file name', () => {
    const result = service.filter(items, 'beach');
    expect(result.map((i) => i.id)).toEqual(['1']);
  });

  it('matches by type', () => {
    const result = service.filter(items, 'video');
    expect(result.map((i) => i.id)).toContain('2');
  });

  it('matches by date', () => {
    const result = service.filter(items, '2026-06');
    expect(result.map((i) => i.id)).toEqual(expect.arrayContaining(['1', '3']));
  });

  it('supports fuzzy subsequence matching', () => {
    const result = service.filter(items, 'vctn'); // subsequence of "vacation"
    expect(result.map((i) => i.id)).toContain('1');
  });

  it('ranks exact/substring matches above fuzzy ones', () => {
    const hits = service.search(items, 'report');
    expect(hits[0]?.item.id).toBe('3');
    expect(hits[0]?.score).toBeGreaterThanOrEqual(hits[hits.length - 1]?.score ?? 0);
  });

  it('matches by chat title', () => {
    const withChat = [
      ...items,
      makeItem({ id: '4', type: 'photo', fileName: 'x.jpg', chatTitle: 'Family Group' }),
    ];
    expect(service.filter(withChat, 'family').map((i) => i.id)).toEqual(['4']);
  });

  it('returns a copy in original order for an empty query without scoring', () => {
    const many = Array.from({ length: 10_000 }, (_, i) => makeItem({ id: `i${i}` }));
    const spy = vi.spyOn(service, 'search');
    const result = service.filter(many, '   ');
    expect(spy).not.toHaveBeenCalled();
    spy.mockRestore();
    expect(result).not.toBe(many);
    expect(result).toHaveLength(10_000);
    expect(result[0]).toBe(many[0]);
    expect(result[9_999]).toBe(many[9_999]);
  });

  it('respects the threshold', () => {
    const result = service.filter(items, 'zzzzzz', 0.5);
    expect(result).toHaveLength(0);
  });
});
