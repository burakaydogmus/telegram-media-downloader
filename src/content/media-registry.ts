import type {
  MediaItem,
  MediaItemPatch,
  MediaType,
  MediaStatistics,
} from '../shared/types/index.js';
import { MEDIA_TYPES } from '../shared/types/index.js';
import { TypedEmitter } from '../shared/utils/index.js';
import type { ILogger } from '../shared/logger/index.js';

export interface RegistryEvents extends Record<string, unknown> {
  added: { readonly items: readonly MediaItem[] };
  removed: { readonly ids: readonly string[] };
  updated: { readonly item: MediaItem };
  cleared: Record<string, never>;
}

export class MediaRegistry {
  private readonly byId = new Map<string, MediaItem>();
  private readonly byType = new Map<MediaType, Set<string>>();
  private readonly emitter = new TypedEmitter<RegistryEvents>();

  constructor(private readonly logger?: ILogger) {
    for (const type of MEDIA_TYPES) this.byType.set(type, new Set());
  }

  on<K extends keyof RegistryEvents>(
    event: K,
    listener: (payload: RegistryEvents[K]) => void,
  ): () => void {
    return this.emitter.on(event, listener);
  }

  get size(): number {
    return this.byId.size;
  }

  has(id: string): boolean {
    return this.byId.has(id);
  }

  get(id: string): MediaItem | undefined {
    return this.byId.get(id);
  }

  addMany(items: readonly MediaItem[]): readonly MediaItem[] {
    const inserted: MediaItem[] = [];
    for (const item of items) {
      if (this.byId.has(item.id)) continue;
      this.byId.set(item.id, item);
      this.indexFor(item.type).add(item.id);
      inserted.push(item);
    }
    if (inserted.length > 0) {
      this.logger?.debug(`Registry +${inserted.length} (total ${this.byId.size})`);
      this.emitter.emit('added', { items: inserted });
    }
    return inserted;
  }

  add(item: MediaItem): boolean {
    return this.addMany([item]).length === 1;
  }

  remove(id: string): boolean {
    const item = this.byId.get(id);
    if (!item) return false;
    this.byId.delete(id);
    this.indexFor(item.type).delete(id);
    this.emitter.emit('removed', { ids: [id] });
    return true;
  }

  update(id: string, patch: MediaItemPatch): MediaItem | null {
    const existing = this.byId.get(id);
    if (!existing) return null;

    const next: MediaItem = { ...existing, ...patch, id: existing.id };
    if (next.type !== existing.type) {
      this.indexFor(existing.type).delete(id);
      this.indexFor(next.type).add(id);
    }
    this.byId.set(id, next);
    this.emitter.emit('updated', { item: next });
    return next;
  }

  clear(): void {
    this.byId.clear();
    for (const set of this.byType.values()) set.clear();
    this.emitter.emit('cleared', {});
  }

  values(): readonly MediaItem[] {
    return [...this.byId.values()];
  }

  idsOfType(type: MediaType): readonly string[] {
    return [...this.indexFor(type)];
  }

  countOfType(type: MediaType): number {
    return this.indexFor(type).size;
  }

  getStatistics(selectedCount = 0): MediaStatistics {
    const byType = {} as Record<MediaType, number>;
    for (const type of MEDIA_TYPES) byType[type] = this.countOfType(type);

    let totalBytes = 0;
    for (const item of this.byId.values()) {
      if (typeof item.byteSize === 'number') totalBytes += item.byteSize;
    }

    return {
      total: this.byId.size,
      byType,
      totalBytes,
      selected: selectedCount,
    };
  }

  private indexFor(type: MediaType): Set<string> {
    let set = this.byType.get(type);
    if (!set) {
      set = new Set();
      this.byType.set(type, set);
    }
    return set;
  }
}
