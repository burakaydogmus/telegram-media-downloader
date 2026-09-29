import type { ILogger } from '../../shared/logger/index.js';
import { IdbStore, openDatabase } from '../../shared/utils/idb.js';

/** Async key/value persistence. `IdbStore` from shared utils satisfies it. */
export interface KeyValueStore<V> {
  get(key: string): Promise<V | undefined>;
  set(key: string, value: V): Promise<void>;
  delete(key: string): Promise<void>;
  keys(): Promise<string[]>;
  values(): Promise<V[]>;
  clear(): Promise<void>;
  /** Optional bulk write in a single transaction. */
  setMany?(entries: readonly (readonly [string, V])[]): Promise<void>;
  /** Optional bulk delete in a single transaction. */
  deleteMany?(keys: readonly string[]): Promise<void>;
}

export class MemoryKeyValueStore<V> implements KeyValueStore<V> {
  private readonly map = new Map<string, V>();

  get(key: string): Promise<V | undefined> {
    return Promise.resolve(this.map.get(key));
  }

  set(key: string, value: V): Promise<void> {
    this.map.set(key, value);
    return Promise.resolve();
  }

  setMany(entries: readonly (readonly [string, V])[]): Promise<void> {
    for (const [key, value] of entries) this.map.set(key, value);
    return Promise.resolve();
  }

  delete(key: string): Promise<void> {
    this.map.delete(key);
    return Promise.resolve();
  }

  deleteMany(keys: readonly string[]): Promise<void> {
    for (const key of keys) this.map.delete(key);
    return Promise.resolve();
  }

  keys(): Promise<string[]> {
    return Promise.resolve([...this.map.keys()]);
  }

  values(): Promise<V[]> {
    return Promise.resolve([...this.map.values()]);
  }

  clear(): Promise<void> {
    this.map.clear();
    return Promise.resolve();
  }
}

/**
 * `IdbStore` plus single-transaction bulk writes, so a burst of history
 * records costs one IndexedDB transaction instead of one per record.
 */
export class IdbKeyValueStore<V> extends IdbStore<V> implements KeyValueStore<V> {
  constructor(
    private readonly name: string,
    private readonly openDb: () => Promise<IDBDatabase> = () => openDatabase(),
  ) {
    super(name, openDb);
  }

  setMany(entries: readonly (readonly [string, V])[]): Promise<void> {
    return this.bulk((store) => {
      for (const [key, value] of entries) store.put(value, key);
    });
  }

  deleteMany(keys: readonly string[]): Promise<void> {
    return this.bulk((store) => {
      for (const key of keys) store.delete(key);
    });
  }

  private async bulk(apply: (store: IDBObjectStore) => void): Promise<void> {
    const db = await this.openDb();
    const tx = db.transaction(this.name, 'readwrite');
    const done = new Promise<void>((resolve, reject) => {
      tx.oncomplete = () => resolve();
      tx.onerror = () => reject(tx.error ?? new Error('IndexedDB transaction failed'));
      tx.onabort = () => reject(tx.error ?? new Error('IndexedDB transaction aborted'));
    });
    apply(tx.objectStore(this.name));
    await done;
  }
}

/**
 * Wraps a primary store; the first failure logs a warning and permanently
 * switches to an in-memory store (then retries the operation there), so
 * callers never see backend errors.
 */
export class FailoverKeyValueStore<V> implements KeyValueStore<V> {
  private active: KeyValueStore<V>;
  private failedOver = false;

  constructor(
    primary: KeyValueStore<V>,
    private readonly logger?: ILogger,
    private readonly label = 'storage',
  ) {
    this.active = primary;
  }

  get isFallback(): boolean {
    return this.failedOver;
  }

  get(key: string): Promise<V | undefined> {
    return this.run((store) => store.get(key));
  }

  set(key: string, value: V): Promise<void> {
    return this.run((store) => store.set(key, value));
  }

  setMany(entries: readonly (readonly [string, V])[]): Promise<void> {
    return this.run(async (store) => {
      if (store.setMany) await store.setMany(entries);
      else await Promise.all(entries.map(([key, value]) => store.set(key, value)));
    });
  }

  delete(key: string): Promise<void> {
    return this.run((store) => store.delete(key));
  }

  deleteMany(keys: readonly string[]): Promise<void> {
    return this.run(async (store) => {
      if (store.deleteMany) await store.deleteMany(keys);
      else await Promise.all(keys.map((key) => store.delete(key)));
    });
  }

  keys(): Promise<string[]> {
    return this.run((store) => store.keys());
  }

  values(): Promise<V[]> {
    return this.run((store) => store.values());
  }

  clear(): Promise<void> {
    return this.run((store) => store.clear());
  }

  private async run<T>(op: (store: KeyValueStore<V>) => Promise<T>): Promise<T> {
    if (this.failedOver) return op(this.active);
    try {
      return await op(this.active);
    } catch (error) {
      this.logger?.warn(
        `${this.label} backend failed; falling back to in-memory storage`,
        error,
      );
      this.failedOver = true;
      this.active = new MemoryKeyValueStore<V>();
      return op(this.active);
    }
  }
}

/** True when an IndexedDB factory exists in this context. */
export function isIndexedDbAvailable(): boolean {
  return typeof indexedDB !== 'undefined' && indexedDB !== null;
}
