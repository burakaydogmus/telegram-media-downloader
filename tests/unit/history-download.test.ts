import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DownloadHistory,
  type HistoryChange,
} from '../../src/features/local-storage/download-history.js';
import {
  MemoryKeyValueStore,
  type KeyValueStore,
} from '../../src/features/local-storage/key-value-store.js';
import { Logger } from '../../src/shared/logger/logger.js';
import type { DownloadRecord } from '../../src/shared/types/index.js';

function rec(key: string, peerId = 'p1'): DownloadRecord {
  return { key, peerId, type: 'photo', downloadedAt: 1 };
}

/** Store without bulk methods that counts calls. */
function countingStore(seed: DownloadRecord[] = []) {
  const inner = new MemoryKeyValueStore<DownloadRecord>();
  for (const r of seed) void inner.set(r.key, r);
  const calls = { set: 0, delete: 0 };
  const store: KeyValueStore<DownloadRecord> = {
    get: (k) => inner.get(k),
    set: (k, v) => {
      calls.set++;
      return inner.set(k, v);
    },
    delete: (k) => {
      calls.delete++;
      return inner.delete(k);
    },
    keys: () => inner.keys(),
    values: () => inner.values(),
    clear: () => inner.clear(),
  };
  return { store, inner, calls };
}

function failingStore(): KeyValueStore<DownloadRecord> {
  const fail = () => Promise.reject(new Error('idb broken'));
  return { get: fail, set: fail, delete: fail, keys: fail, values: fail, clear: fail };
}

afterEach(() => {
  vi.useRealTimers();
});

describe('DownloadHistory', () => {
  it('loads existing keys for synchronous checks', async () => {
    const { store } = countingStore([rec('a'), rec('b')]);
    const history = new DownloadHistory(store);
    expect(history.has('a')).toBe(false);
    await history.load();
    expect(history.has('a')).toBe(true);
    expect(history.size).toBe(2);
    expect(await history.hasAsync('b')).toBe(true);
    expect(await history.hasAsync('z')).toBe(false);
  });

  it('hasAsync triggers the load itself', async () => {
    const history = new DownloadHistory(countingStore([rec('a')]).store);
    expect(await history.hasAsync('a')).toBe(true);
  });

  it('coalesces a burst of writes into one bulk write', async () => {
    vi.useFakeTimers();
    const inner = new MemoryKeyValueStore<DownloadRecord>();
    const setMany = vi.spyOn(inner, 'setMany');
    const set = vi.spyOn(inner, 'set');
    const history = new DownloadHistory(inner, { flushDelayMs: 100 });

    const writes = Array.from({ length: 20 }, (_, i) => history.add(rec(`k${i}`)));
    expect(history.has('k5')).toBe(true);
    expect(setMany).not.toHaveBeenCalled();
    await vi.advanceTimersByTimeAsync(100);
    await Promise.all(writes);

    expect(setMany).toHaveBeenCalledTimes(1);
    expect(setMany.mock.calls[0]?.[0]).toHaveLength(20);
    expect(set).not.toHaveBeenCalled();
    expect(await inner.keys()).toHaveLength(20);
  });

  it('flushes immediately at maxBatchSize and dedupes by key', async () => {
    const inner = new MemoryKeyValueStore<DownloadRecord>();
    const setMany = vi.spyOn(inner, 'setMany');
    const history = new DownloadHistory(inner, { flushDelayMs: 60_000, maxBatchSize: 3 });
    await history.addMany([rec('a'), rec('a'), rec('b'), rec('c')]);
    expect(setMany).toHaveBeenCalledTimes(1);
    expect(setMany.mock.calls[0]?.[0]).toHaveLength(3);
  });

  it('falls back to per-item writes for stores without bulk methods', async () => {
    const { store, calls, inner } = countingStore([rec('old')]);
    const history = new DownloadHistory(store, { flushDelayMs: 0 });
    await history.addMany([rec('a'), rec('b')]);
    await history.remove('old');
    expect(calls).toEqual({ set: 2, delete: 1 });
    expect((await inner.keys()).sort()).toEqual(['a', 'b']);
  });

  it('remove before a pending add is flushed cancels the write', async () => {
    const inner = new MemoryKeyValueStore<DownloadRecord>();
    const history = new DownloadHistory(inner, { flushDelayMs: 10 });
    void history.add(rec('a'));
    await history.remove('a');
    expect(history.has('a')).toBe(false);
    expect(await inner.keys()).toEqual([]);
  });

  it('does not resurrect keys removed or cleared while loading', async () => {
    const { store } = countingStore([rec('a'), rec('b')]);
    const history = new DownloadHistory(store, { flushDelayMs: 0 });
    const loading = history.load();
    void history.remove('a');
    await loading;
    expect(history.has('a')).toBe(false);
    expect(history.has('b')).toBe(true);

    const second = new DownloadHistory(countingStore([rec('x')]).store, {
      flushDelayMs: 0,
    });
    const loading2 = second.load();
    void second.clear();
    await second.add(rec('y'));
    await loading2;
    expect(second.has('x')).toBe(false);
    expect(second.has('y')).toBe(true);
  });

  it('returns records for a peer including unflushed ones', async () => {
    const history = new DownloadHistory(new MemoryKeyValueStore(), {
      flushDelayMs: 60_000,
    });
    void history.addMany([rec('a', 'p1'), rec('b', 'p2'), rec('c', 'p1')]);
    const records = await history.forPeer('p1');
    expect(records.map((r) => r.key).sort()).toEqual(['a', 'c']);
  });

  it('clears memory and store and notifies listeners', async () => {
    const inner = new MemoryKeyValueStore<DownloadRecord>();
    const history = new DownloadHistory(inner, { flushDelayMs: 0 });
    const changes: HistoryChange[] = [];
    const off = history.onChange((c) => changes.push(c));
    await history.add(rec('a'));
    await history.remove('a');
    await history.add(rec('b'));
    await history.clear();
    off();
    await history.add(rec('c'));

    expect(history.size).toBe(1);
    expect((await inner.keys()).sort()).toEqual(['c']);
    expect(changes.map((c) => c.type)).toEqual(['add', 'remove', 'add', 'clear']);
  });

  it('ignores empty batches and isolates throwing listeners', async () => {
    const history = new DownloadHistory(new MemoryKeyValueStore(), { flushDelayMs: 0 });
    const good = vi.fn();
    history.onChange(() => {
      throw new Error('listener');
    });
    history.onChange(good);
    await history.addMany([]);
    expect(good).not.toHaveBeenCalled();
    await history.add(rec('a'));
    expect(good).toHaveBeenCalledTimes(1);
    await expect(history.flush()).resolves.toBeUndefined();
  });

  it('falls back to memory when the backend fails, never throwing', async () => {
    const logger = new Logger('error');
    const warn = vi.spyOn(logger, 'warn');
    const history = new DownloadHistory(failingStore(), { logger, flushDelayMs: 0 });
    await expect(history.load()).resolves.toBeUndefined();
    expect(history.isMemoryFallback).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);

    await history.add(rec('a'));
    expect(history.has('a')).toBe(true);
    expect(await history.forPeer('p1')).toEqual([rec('a')]);
    await history.clear();
    expect(history.size).toBe(0);
  });
});
