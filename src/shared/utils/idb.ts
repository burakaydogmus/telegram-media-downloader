import { IDB } from '../constants/index.js';

/**
 * Minimal promise wrapper around IndexedDB for the extension's object stores.
 * All stores are created in one upgrade so every feature shares one schema.
 * Out-of-line keys: callers pass the key explicitly.
 */
let dbPromise: Promise<IDBDatabase> | null = null;

export function openDatabase(factory: IDBFactory = indexedDB): Promise<IDBDatabase> {
  if (dbPromise) return dbPromise;
  dbPromise = new Promise<IDBDatabase>((resolve, reject) => {
    const request = factory.open(IDB.name, IDB.version);
    request.onupgradeneeded = () => {
      const db = request.result;
      for (const store of Object.values(IDB.stores)) {
        if (!db.objectStoreNames.contains(store)) db.createObjectStore(store);
      }
    };
    request.onsuccess = () => resolve(request.result);
    request.onerror = () => {
      dbPromise = null;
      reject(request.error ?? new Error('IndexedDB open failed'));
    };
  });
  return dbPromise;
}

/** Test hook: forget the cached connection. */
export function resetDatabaseCache(): void {
  dbPromise = null;
}

function wrap<T>(request: IDBRequest<T>): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    request.onsuccess = () => resolve(request.result);
    request.onerror = () =>
      reject(request.error ?? new Error('IndexedDB request failed'));
  });
}

export class IdbStore<V> {
  constructor(
    private readonly storeName: string,
    private readonly open: () => Promise<IDBDatabase> = () => openDatabase(),
  ) {}

  private async store(mode: IDBTransactionMode): Promise<IDBObjectStore> {
    const db = await this.open();
    return db.transaction(this.storeName, mode).objectStore(this.storeName);
  }

  async get(key: string): Promise<V | undefined> {
    return wrap((await this.store('readonly')).get(key)) as Promise<V | undefined>;
  }

  async set(key: string, value: V): Promise<void> {
    await wrap((await this.store('readwrite')).put(value, key));
  }

  async delete(key: string): Promise<void> {
    await wrap((await this.store('readwrite')).delete(key));
  }

  async keys(): Promise<string[]> {
    const result = await wrap((await this.store('readonly')).getAllKeys());
    return result.map(String);
  }

  async values(): Promise<V[]> {
    return wrap((await this.store('readonly')).getAll()) as Promise<V[]>;
  }

  async clear(): Promise<void> {
    await wrap((await this.store('readwrite')).clear());
  }
}
