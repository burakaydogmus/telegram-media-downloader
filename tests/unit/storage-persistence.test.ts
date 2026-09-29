import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  createPersistence,
  DownloadHistory,
  FailoverKeyValueStore,
  IdbCrawlCheckpointStore,
  IdbKeyValueStore,
  KeyMutex,
  MemoryCrawlCheckpointStore,
  MemoryKeyValueStore,
  MemoryStorageDriver,
  StorageService,
  isIndexedDbAvailable,
  mergeDefaults,
} from '../../src/features/local-storage/index.js';
import { Logger } from '../../src/shared/logger/logger.js';
import { IDB } from '../../src/shared/constants/index.js';
import type { DownloadRecord } from '../../src/shared/types/index.js';

afterEach(() => {
  vi.unstubAllGlobals();
});

interface FakeTx {
  oncomplete: (() => void) | null;
  onerror: (() => void) | null;
  onabort: (() => void) | null;
  error: Error | null;
  objectStore(name: string): {
    put(value: unknown, key: string): void;
    delete(key: string): void;
  };
}

function fakeDb(outcome: 'complete' | 'error' | 'abort' = 'complete') {
  const data = new Map<string, unknown>();
  const transactions: { store: string; mode: string }[] = [];
  const db = {
    transaction(store: string, mode: string): FakeTx {
      transactions.push({ store, mode });
      const tx: FakeTx = {
        oncomplete: null,
        onerror: null,
        onabort: null,
        error: outcome === 'error' ? new Error('tx failed') : null,
        objectStore: () => ({
          put: (value, key) => void data.set(key, value),
          delete: (key) => void data.delete(key),
        }),
      };
      queueMicrotask(() => {
        if (outcome === 'complete') tx.oncomplete?.();
        else if (outcome === 'error') tx.onerror?.();
        else tx.onabort?.();
      });
      return tx;
    },
  };
  return { db: db as unknown as IDBDatabase, data, transactions };
}

const rec = (key: string): DownloadRecord => ({ key, type: 'video', downloadedAt: 2 });

describe('IdbKeyValueStore bulk writes', () => {
  it('writes many entries in one readwrite transaction', async () => {
    const { db, data, transactions } = fakeDb();
    const store = new IdbKeyValueStore<DownloadRecord>(IDB.stores.history, () =>
      Promise.resolve(db),
    );
    await store.setMany([
      ['a', rec('a')],
      ['b', rec('b')],
    ]);
    await store.deleteMany(['a']);
    expect(transactions).toEqual([
      { store: IDB.stores.history, mode: 'readwrite' },
      { store: IDB.stores.history, mode: 'readwrite' },
    ]);
    expect([...data.keys()]).toEqual(['b']);
  });

  it.each(['error', 'abort'] as const)('rejects when the transaction %s', async (o) => {
    const { db } = fakeDb(o);
    const store = new IdbKeyValueStore<DownloadRecord>('s', () => Promise.resolve(db));
    await expect(store.setMany([['a', rec('a')]])).rejects.toThrow();
  });

  it('history over a failing IndexedDB degrades to memory', async () => {
    const logger = new Logger('error');
    const warn = vi.spyOn(logger, 'warn');
    const store = new IdbKeyValueStore<DownloadRecord>('s', () =>
      Promise.reject(new Error('no idb')),
    );
    const history = new DownloadHistory(store, { logger, flushDelayMs: 0 });
    await history.load();
    await history.add(rec('a'));
    expect(history.has('a')).toBe(true);
    expect(history.isMemoryFallback).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});

describe('FailoverKeyValueStore', () => {
  it('delegates to the primary while it works', async () => {
    const primary = new MemoryKeyValueStore<number>();
    const store = new FailoverKeyValueStore(primary);
    await store.set('a', 1);
    await store.setMany([['b', 2]]);
    expect(await store.get('a')).toBe(1);
    expect((await store.values()).sort()).toEqual([1, 2]);
    await store.deleteMany(['a']);
    await store.delete('b');
    await store.set('c', 3);
    await store.clear();
    expect(await primary.keys()).toEqual([]);
    expect(store.isFallback).toBe(false);
  });
});

describe('KeyMutex', () => {
  it('runs tasks for one key strictly in order and keys independently', async () => {
    const mutex = new KeyMutex();
    const log: string[] = [];
    const task = (name: string, ms: number) => () =>
      new Promise<string>((resolve) =>
        setTimeout(() => {
          log.push(name);
          resolve(name);
        }, ms),
      );
    const results = await Promise.all([
      mutex.run('a', task('a1', 20)),
      mutex.run('a', task('a2', 1)),
      mutex.run('b', task('b1', 5)),
    ]);
    await mutex.idle();
    expect(results).toEqual(['a1', 'a2', 'b1']);
    expect(log).toEqual(['b1', 'a1', 'a2']);
  });
});

describe('mergeDefaults', () => {
  it('merges nested objects and drops unknown keys', () => {
    const defaults = {
      a: 1,
      nested: { x: true, y: 'y' },
      list: [1],
      nil: null as number | null,
    };
    expect(
      mergeDefaults(defaults, {
        a: 'wrong',
        nested: { x: false, z: 1 },
        list: [2, 3],
        nil: 5,
        extra: 1,
      }),
    ).toEqual({ a: 1, nested: { x: false, y: 'y' }, list: [2, 3], nil: 5 });
    expect(mergeDefaults(defaults, { nested: 'bad' }).nested).toEqual(defaults.nested);
    expect(mergeDefaults(defaults, null)).toEqual(defaults);
  });
});

describe('createPersistence', () => {
  it('uses memory backends when IndexedDB is unavailable', () => {
    expect(isIndexedDbAvailable()).toBe(false);
    const p = createPersistence({
      logger: new Logger('error'),
      driver: new MemoryStorageDriver(),
    });
    expect(p.storage).toBeInstanceOf(StorageService);
    expect(p.history).toBeInstanceOf(DownloadHistory);
    expect(p.checkpoints).toBeInstanceOf(MemoryCrawlCheckpointStore);
  });

  it('wires IndexedDB stores through the given opener', async () => {
    const { db, data, transactions } = fakeDb();
    const p = createPersistence({
      logger: new Logger('error'),
      driver: new MemoryStorageDriver(),
      useIndexedDb: true,
      openDb: () => Promise.resolve(db),
      locks: null,
      history: { flushDelayMs: 0 },
    });
    expect(p.checkpoints).toBeInstanceOf(IdbCrawlCheckpointStore);
    await p.history.addMany([rec('a'), rec('b')]);
    expect(transactions).toEqual([{ store: IDB.stores.history, mode: 'readwrite' }]);
    expect([...data.keys()]).toEqual(['a', 'b']);
  });

  it('uses navigator.locks for cross-context serialization when present', async () => {
    const request = vi.fn(
      (_name: string, cb: () => Promise<unknown>): Promise<unknown> => cb(),
    );
    vi.stubGlobal('navigator', { locks: { request } });
    const { storage } = createPersistence({
      logger: new Logger('error'),
      driver: new MemoryStorageDriver(),
      useIndexedDb: false,
    });
    const next = await storage.updateStatistics((s) => ({ ...s, totalFailed: 2 }));
    expect(next.totalFailed).toBe(2);
    expect(request).toHaveBeenCalledTimes(1);
  });

  it('propagates lock acquisition failures', async () => {
    vi.stubGlobal('navigator', {
      locks: { request: () => Promise.reject(new Error('aborted')) },
    });
    const { storage } = createPersistence({
      logger: new Logger('error'),
      driver: new MemoryStorageDriver(),
      useIndexedDb: false,
    });
    await expect(storage.updateStatistics((s) => s)).rejects.toThrow('aborted');
  });
});
