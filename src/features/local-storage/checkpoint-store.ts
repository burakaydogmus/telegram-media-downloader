import type { CrawlCheckpoint, CrawlCheckpointStore } from '../../shared/types/index.js';
import { IDB } from '../../shared/constants/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import { IdbStore } from '../../shared/utils/idb.js';
import { FailoverKeyValueStore, type KeyValueStore } from './key-value-store.js';

export class MemoryCrawlCheckpointStore implements CrawlCheckpointStore {
  private readonly map = new Map<string, CrawlCheckpoint>();

  get(peerId: string): Promise<CrawlCheckpoint | undefined> {
    return Promise.resolve(this.map.get(peerId));
  }

  set(checkpoint: CrawlCheckpoint): Promise<void> {
    this.map.set(checkpoint.peerId, checkpoint);
    return Promise.resolve();
  }

  remove(peerId: string): Promise<void> {
    this.map.delete(peerId);
    return Promise.resolve();
  }
}

export interface IdbCrawlCheckpointStoreOptions {
  readonly store?: KeyValueStore<CrawlCheckpoint>;
  readonly logger?: ILogger;
}

/**
 * Crawl checkpoints in IndexedDB (`IDB.stores.crawl`), keyed by peer id.
 * On backend failure it warns once and continues in memory.
 */
export class IdbCrawlCheckpointStore implements CrawlCheckpointStore {
  private readonly store: FailoverKeyValueStore<CrawlCheckpoint>;

  constructor(options: IdbCrawlCheckpointStoreOptions = {}) {
    this.store = new FailoverKeyValueStore(
      options.store ?? new IdbStore<CrawlCheckpoint>(IDB.stores.crawl),
      options.logger,
      'Crawl checkpoint',
    );
  }

  get isMemoryFallback(): boolean {
    return this.store.isFallback;
  }

  get(peerId: string): Promise<CrawlCheckpoint | undefined> {
    return this.store.get(peerId);
  }

  set(checkpoint: CrawlCheckpoint): Promise<void> {
    return this.store.set(checkpoint.peerId, checkpoint);
  }

  remove(peerId: string): Promise<void> {
    return this.store.delete(peerId);
  }
}
