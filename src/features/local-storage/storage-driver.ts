export type StorageWatchCallback = (newValue: unknown) => void;

export interface StorageDriver {
  get<T>(key: string): Promise<T | undefined>;
  set<T>(key: string, value: T): Promise<void>;
  remove(key: string): Promise<void>;
  clear(): Promise<void>;
  /**
   * Observe external and local changes to `key`. The callback receives the new
   * raw value (`undefined` when removed). Returns an unsubscribe function.
   */
  watch?(key: string, callback: StorageWatchCallback): () => void;
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

  watch(key: string, callback: StorageWatchCallback): () => void {
    const onChanged = chrome.storage.onChanged as
      | typeof chrome.storage.onChanged
      | undefined;
    if (!onChanged) return () => undefined;
    const listener = (
      changes: Record<string, chrome.storage.StorageChange>,
      area: string,
    ): void => {
      if (area !== 'local') return;
      const change = changes[key];
      if (change) callback(change.newValue);
    };
    onChanged.addListener(listener);
    return () => onChanged.removeListener(listener);
  }
}

export class MemoryStorageDriver implements StorageDriver {
  private readonly store = new Map<string, unknown>();
  private readonly watchers = new Map<string, Set<StorageWatchCallback>>();

  get<T>(key: string): Promise<T | undefined> {
    return Promise.resolve(this.store.get(key) as T | undefined);
  }

  set<T>(key: string, value: T): Promise<void> {
    // Clone to mimic structured-clone semantics of chrome.storage.
    this.store.set(key, structuredClone(value));
    this.notify(key);
    return Promise.resolve();
  }

  remove(key: string): Promise<void> {
    if (this.store.delete(key)) this.notify(key);
    return Promise.resolve();
  }

  clear(): Promise<void> {
    const keys = [...this.store.keys()];
    this.store.clear();
    for (const key of keys) this.notify(key);
    return Promise.resolve();
  }

  watch(key: string, callback: StorageWatchCallback): () => void {
    let set = this.watchers.get(key);
    if (!set) {
      set = new Set();
      this.watchers.set(key, set);
    }
    set.add(callback);
    return () => {
      set.delete(callback);
    };
  }

  private notify(key: string): void {
    const set = this.watchers.get(key);
    if (!set || set.size === 0) return;
    const value = this.store.get(key);
    for (const callback of [...set]) callback(structuredClone(value));
  }
}

export function createDefaultStorageDriver(): StorageDriver {
  const hasChromeStorage =
    typeof chrome !== 'undefined' &&
    typeof chrome.storage !== 'undefined' &&
    typeof chrome.storage.local !== 'undefined';
  return hasChromeStorage ? new ChromeStorageDriver() : new MemoryStorageDriver();
}
