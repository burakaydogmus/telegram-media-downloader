export interface StorageDriver {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
}

export class ChromeStorageDriver implements StorageDriver {
  async get<T>(key: string): Promise<T | undefined> {
    const result = await chrome.storage.local.get(key);
    return result[key] as T | undefined;
  }

  async set<T>(key: string, value: T): Promise<void> {
    await chrome.storage.local.set({ [key]: value });
  }

  async remove(key: string): Promise<void> {
    await chrome.storage.local.remove(key);
  }

  async clear(): Promise<void> {
    await chrome.storage.local.clear();
  }
}

export class MemoryStorageDriver implements StorageDriver {
  private readonly store = new Map<string, unknown>();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.store.get(key) as T | undefined);
  }

  set<T>(key: string, value: T): Promise<void> {
    // Clone to mimic structured-clone semantics of chrome.storage.
    this.store.set(key, structuredClone(value));
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    this.store.delete(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    this.store.clear();
    return Promise.resolve();
  }
}

export function createDefaultStorageDriver(): StorageDriver {
  const hasChromeStorage =
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.local !== 'undefined';
  return hasChromeStorage ? new ChromeStorageDriver() : new MemoryStorageDriver();
}
