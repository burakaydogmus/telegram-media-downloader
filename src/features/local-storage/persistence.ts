import type { CrawlCheckpointStore, DownloadRecord } from '../../shared/types/index.js';
import { IDB } from '../../shared/constants/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import { openDatabase } from '../../shared/utils/idb.js';
import {
  IdbCrawlCheckpointStore,
  MemoryCrawlCheckpointStore,
} from './checkpoint-store.js';
import { DownloadHistory, type DownloadHistoryOptions } from './download-history.js';
import type { LockManagerLike } from './key-mutex.js';
import {
  IdbKeyValueStore,
  MemoryKeyValueStore,
  isIndexedDbAvailable,
} from './key-value-store.js';
import { createDefaultStorageDriver, type StorageDriver } from './storage-driver.js';
import { StorageService } from './storage-service.js';

export interface PersistenceOptions {
  readonly logger: ILogger;
  /** Defaults to chrome.storage.local when present, memory otherwise. */
  readonly driver?: StorageDriver;
  /** Force (`true`) or disable (`false`) IndexedDB; auto-detected by default. */
  readonly useIndexedDb?: boolean;
  /** Custom IndexedDB opener (defaults to the shared `openDatabase`). */
  readonly openDb?: () => Promise<IDBDatabase>;
  /** Cross-context lock manager; defaults to `navigator.locks` when present. */
  readonly locks?: LockManagerLike | null;
  readonly history?: Omit<DownloadHistoryOptions, 'logger'>;
}

export interface Persistence {
  readonly storage: StorageService;
  /** Call `history.load()` before relying on synchronous `has()`. */
  readonly history: DownloadHistory;
  readonly checkpoints: CrawlCheckpointStore;
}

function defaultLocks(): LockManagerLike | undefined {
  const locks = typeof navigator !== 'undefined' ? navigator.locks : undefined;
  if (!locks || typeof locks.request !== 'function') return undefined;
  return {
    request: <T>(name: string, callback: () => Promise<T>): Promise<T> =>
      new Promise<T>((resolve, reject) => {
        locks.request(name, () => callback().then(resolve, reject)).catch(reject);
      }),
  };
}

export function createPersistence(options: PersistenceOptions): Persistence {
  const { logger } = options;
  const locks = options.locks === null ? undefined : (options.locks ?? defaultLocks());
  const storage = new StorageService(
    options.driver ?? createDefaultStorageDriver(),
    logger,
    locks ? { locks } : {},
  );

  const useIdb = options.useIndexedDb ?? isIndexedDbAvailable();
  if (!useIdb) {
    logger.debug('IndexedDB unavailable; using in-memory history and checkpoints');
    return {
      storage,
      history: new DownloadHistory(new MemoryKeyValueStore<DownloadRecord>(), {
        ...options.history,
        logger,
      }),
      checkpoints: new MemoryCrawlCheckpointStore(),
    };
  }

  const openDb = options.openDb ?? (() => openDatabase());
  return {
    storage,
    history: new DownloadHistory(
      new IdbKeyValueStore<DownloadRecord>(IDB.stores.history, openDb),
      { ...options.history, logger },
    ),
    checkpoints: new IdbCrawlCheckpointStore({
      store: new IdbKeyValueStore(IDB.stores.crawl, openDb),
      logger,
    }),
  };
}
