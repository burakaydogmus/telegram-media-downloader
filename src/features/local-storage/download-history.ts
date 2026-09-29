import type { DownloadRecord } from '../../shared/types/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import { FailoverKeyValueStore, type KeyValueStore } from './key-value-store.js';

export type HistoryChange =
  | { readonly type: 'add'; readonly records: readonly DownloadRecord[] }
  | { readonly type: 'remove'; readonly keys: readonly string[] }
  | { readonly type: 'clear' };

export type HistoryListener = (change: HistoryChange) => void;

export interface DownloadHistoryOptions {
  readonly logger?: ILogger;
  /** Coalescing window for writes. Default 200 ms. */
  readonly flushDelayMs?: number;
  /** Flush immediately once this many writes are pending. Default 500. */
  readonly maxBatchSize?: number;
}

/**
 * Persistent set of downloaded media keys with full records.
 *
 * Keys are mirrored in memory (after `load()`) so `has()` is synchronous.
 * Writes are queued and coalesced into one bulk write per flush window.
 * Any backend failure switches to an in-memory store (with a warning) instead
 * of throwing, so history never breaks downloads.
 */
export class DownloadHistory {
  private readonly keySet = new Set<string>();
  private readonly pending = new Map<string, DownloadRecord | null>();
  private readonly listeners = new Set<HistoryListener>();
  private readonly flushDelayMs: number;
  private readonly maxBatchSize: number;
  private readonly logger: ILogger | undefined;
  private loadPromise: Promise<void> | null = null;
  private chain: Promise<void> = Promise.resolve();
  private timer: ReturnType<typeof setTimeout> | null = null;
  private scheduled: Promise<void> | null = null;
  private resolveScheduled: ((flushed: Promise<void>) => void) | null = null;
  private loaded = false;
  /** Keys removed (or everything, after `clear()`) while `load()` was running. */
  private readonly tombstones = new Set<string>();
  private clearedDuringLoad = false;

  private readonly store: FailoverKeyValueStore<DownloadRecord>;

  constructor(
    store: KeyValueStore<DownloadRecord>,
    options: DownloadHistoryOptions = {},
  ) {
    this.logger = options.logger;
    this.store = new FailoverKeyValueStore(store, options.logger, 'Download history');
    this.flushDelayMs = options.flushDelayMs ?? 200;
    this.maxBatchSize = options.maxBatchSize ?? 500;
  }

  /** True once the backing store failed and history lives in memory only. */
  get isMemoryFallback(): boolean {
    return this.store.isFallback;
  }

  get size(): number {
    return this.keySet.size;
  }

  load(): Promise<void> {
    this.loadPromise ??= this.safe(() => this.store.keys(), []).then((keys) => {
      if (!this.clearedDuringLoad) {
        for (const key of keys) {
          if (!this.tombstones.has(key)) this.keySet.add(key);
        }
      }
      this.loaded = true;
      this.tombstones.clear();
    });
    return this.loadPromise;
  }

  /** Synchronous membership test; complete only after `load()` resolved. */
  has(key: string): boolean {
    return this.keySet.has(key);
  }

  async hasAsync(key: string): Promise<boolean> {
    await this.load();
    return this.keySet.has(key);
  }

  add(record: DownloadRecord): Promise<void> {
    return this.addMany([record]);
  }

  addMany(records: readonly DownloadRecord[]): Promise<void> {
    if (records.length === 0) return Promise.resolve();
    for (const record of records) {
      this.keySet.add(record.key);
      this.tombstones.delete(record.key);
      this.pending.set(record.key, record);
    }
    this.emit({ type: 'add', records });
    return this.schedule();
  }

  remove(key: string): Promise<void> {
    this.keySet.delete(key);
    if (!this.loaded) this.tombstones.add(key);
    this.pending.set(key, null);
    this.emit({ type: 'remove', keys: [key] });
    return this.schedule();
  }

  async forPeer(peerId: string): Promise<DownloadRecord[]> {
    await this.flush();
    const all = await this.safe(() => this.store.values(), []);
    return all.filter((record) => record.peerId === peerId);
  }

  async clear(): Promise<void> {
    this.cancelTimer();
    this.pending.clear();
    this.keySet.clear();
    if (!this.loaded) this.clearedDuringLoad = true;
    this.emit({ type: 'clear' });
    await this.enqueue(() => this.safe(() => this.store.clear(), undefined));
  }

  onChange(listener: HistoryListener): () => void {
    this.listeners.add(listener);
    return () => {
      this.listeners.delete(listener);
    };
  }

  /** Writes all queued changes now. Never rejects. */
  flush(): Promise<void> {
    const resolve = this.resolveScheduled;
    this.cancelTimer();
    const batch = new Map(this.pending);
    this.pending.clear();
    const flushed = batch.size === 0 ? this.chain : this.enqueue(() => this.write(batch));
    resolve?.(flushed);
    return flushed;
  }

  private schedule(): Promise<void> {
    if (this.pending.size >= this.maxBatchSize) return this.flush();
    this.scheduled ??= new Promise<void>((resolve) => {
      this.resolveScheduled = resolve;
      this.timer = setTimeout(() => void this.flush(), this.flushDelayMs);
    });
    return this.scheduled;
  }

  private cancelTimer(): void {
    if (this.timer !== null) clearTimeout(this.timer);
    this.timer = null;
    this.scheduled = null;
    this.resolveScheduled = null;
  }

  private enqueue(task: () => Promise<void>): Promise<void> {
    this.chain = this.chain.then(task, task);
    return this.chain;
  }

  private async write(batch: ReadonlyMap<string, DownloadRecord | null>): Promise<void> {
    const upserts: (readonly [string, DownloadRecord])[] = [];
    const deletes: string[] = [];
    for (const [key, record] of batch) {
      if (record) upserts.push([key, record]);
      else deletes.push(key);
    }
    if (upserts.length > 0) await this.safe(() => this.store.setMany(upserts), undefined);
    if (deletes.length > 0)
      await this.safe(() => this.store.deleteMany(deletes), undefined);
  }

  private async safe<T>(op: () => Promise<T>, fallback: T): Promise<T> {
    try {
      return await op();
    } catch (error) {
      this.logger?.error('Download history operation failed', error);
      return fallback;
    }
  }

  private emit(change: HistoryChange): void {
    for (const listener of [...this.listeners]) {
      try {
        listener(change);
      } catch (error) {
        this.logger?.error('Download history listener threw', error);
      }
    }
  }
}
