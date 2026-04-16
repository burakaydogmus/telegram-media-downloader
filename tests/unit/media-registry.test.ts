import { describe, it, expect, vi } from 'vitest';
import { MediaRegistry } from '../../src/content/media-registry.js';
import { makeItem } from '../helpers/factories.js';

describe('MediaRegistry', () => {
  it('adds items and reports size with O(1) lookups', () => {
    const registry = new MediaRegistry();
    registry.add(makeItem({ id: 'a', type: 'photo' }));
    registry.add(makeItem({ id: 'b', type: 'video' }));

    expect(registry.size).toBe(2);
    expect(registry.has('a')).toBe(true);
    expect(registry.get('b')?.type).toBe('video');
  });

  it('de-duplicates by id', () => {
    const registry = new MediaRegistry();
    expect(registry.add(makeItem({ id: 'dup' }))).toBe(true);
    expect(registry.add(makeItem({ id: 'dup' }))).toBe(false);
    expect(registry.size).toBe(1);
  });

  it('returns only newly inserted items from addMany', () => {
    const registry = new MediaRegistry();
    registry.addMany([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    const inserted = registry.addMany([makeItem({ id: 'b' }), makeItem({ id: 'c' })]);
    expect(inserted.map((i) => i.id)).toEqual(['c']);
  });

  it('removes items and updates type indexes', () => {
    const registry = new MediaRegistry();
    registry.add(makeItem({ id: 'a', type: 'photo' }));
    expect(registry.countOfType('photo')).toBe(1);
    expect(registry.remove('a')).toBe(true);
    expect(registry.remove('a')).toBe(false);
    expect(registry.countOfType('photo')).toBe(0);
  });

  it('updates items and re-indexes on type change', () => {
    const registry = new MediaRegistry();
    registry.add(makeItem({ id: 'a', type: 'photo' }));
    const updated = registry.update('a', { type: 'video', fileName: 'x.mp4' });
    expect(updated?.type).toBe('video');
    expect(registry.countOfType('photo')).toBe(0);
    expect(registry.countOfType('video')).toBe(1);
    expect(registry.update('missing', { type: 'gif' })).toBeNull();
  });

  it('computes statistics including byte totals and selection', () => {
    const registry = new MediaRegistry();
    registry.add(makeItem({ id: 'a', type: 'photo', byteSize: 100 }));
    registry.add(makeItem({ id: 'b', type: 'video', byteSize: 200 }));
    const stats = registry.getStatistics(1);
    expect(stats.total).toBe(2);
    expect(stats.totalBytes).toBe(300);
    expect(stats.byType.photo).toBe(1);
    expect(stats.byType.video).toBe(1);
    expect(stats.selected).toBe(1);
  });

  it('emits add/remove/update/clear events', () => {
    const registry = new MediaRegistry();
    const added = vi.fn();
    const removed = vi.fn();
    const updated = vi.fn();
    const cleared = vi.fn();
    registry.on('added', added);
    registry.on('removed', removed);
    registry.on('updated', updated);
    registry.on('cleared', cleared);

    registry.add(makeItem({ id: 'a' }));
    registry.update('a', { fileName: 'n' });
    registry.remove('a');
    registry.clear();

    expect(added).toHaveBeenCalledOnce();
    expect(updated).toHaveBeenCalledOnce();
    expect(removed).toHaveBeenCalledOnce();
    expect(cleared).toHaveBeenCalledOnce();
  });

  it('lists ids of a type', () => {
    const registry = new MediaRegistry();
    registry.addMany([
      makeItem({ id: 'p1', type: 'photo' }),
      makeItem({ id: 'p2', type: 'photo' }),
      makeItem({ id: 'v1', type: 'video' }),
    ]);
    expect([...registry.idsOfType('photo')].sort()).toEqual(['p1', 'p2']);
  });
});
