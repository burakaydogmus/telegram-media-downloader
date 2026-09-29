import { describe, it, expect, vi } from 'vitest';
import {
  IdbCrawlCheckpointStore,
  MemoryCrawlCheckpointStore,
} from '../../src/features/local-storage/checkpoint-store.js';
import {
  MemoryKeyValueStore,
  type KeyValueStore,
} from '../../src/features/local-storage/key-value-store.js';
import { Logger } from '../../src/shared/logger/logger.js';
import type {
  CrawlCheckpoint,
  CrawlCheckpointStore,
} from '../../src/shared/types/index.js';

const checkpoint: CrawlCheckpoint = {
  peerId: '-100123',
  oldestMessageId: '42',
  oldestTimestamp: 1_700_000_000_000,
  steps: 7,
  updatedAt: 1,
  done: false,
};

async function roundTrip(store: CrawlCheckpointStore): Promise<void> {
  expect(await store.get(checkpoint.peerId)).toBeUndefined();
  await store.set(checkpoint);
  expect(await store.get(checkpoint.peerId)).toEqual(checkpoint);
  await store.set({ ...checkpoint, steps: 8, done: true });
  expect((await store.get(checkpoint.peerId))?.steps).toBe(8);
  await store.remove(checkpoint.peerId);
  expect(await store.get(checkpoint.peerId)).toBeUndefined();
}

describe('MemoryCrawlCheckpointStore', () => {
  it('round-trips checkpoints', async () => {
    await roundTrip(new MemoryCrawlCheckpointStore());
  });
});

describe('IdbCrawlCheckpointStore', () => {
  it('stores checkpoints keyed by peerId in the injected store', async () => {
    const inner = new MemoryKeyValueStore<CrawlCheckpoint>();
    const set = vi.spyOn(inner, 'set');
    const store = new IdbCrawlCheckpointStore({ store: inner });
    await roundTrip(store);
    expect(set).toHaveBeenCalledWith(checkpoint.peerId, checkpoint);
    expect(store.isMemoryFallback).toBe(false);
  });

  it('falls back to memory with a warning when the backend fails', async () => {
    const fail = () => Promise.reject(new Error('blocked'));
    const broken: KeyValueStore<CrawlCheckpoint> = {
      get: fail,
      set: fail,
      delete: fail,
      keys: fail,
      values: fail,
      clear: fail,
    };
    const logger = new Logger('error');
    const warn = vi.spyOn(logger, 'warn');
    const store = new IdbCrawlCheckpointStore({ store: broken, logger });
    await roundTrip(store);
    expect(store.isMemoryFallback).toBe(true);
    expect(warn).toHaveBeenCalledTimes(1);
  });
});
