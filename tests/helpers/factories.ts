import type { MediaItem, MediaType } from '../../src/shared/types/index.js';

export function makeItem(overrides: Partial<MediaItem> = {}): MediaItem {
  const base: MediaItem = {
    id: overrides.id ?? `id-${Math.random().toString(36).slice(2)}`,
    type: overrides.type ?? 'photo',
  };
  return { ...base, ...overrides };
}

export function makeItems(count: number, type: MediaType = 'photo'): MediaItem[] {
  return Array.from({ length: count }, (_, i) =>
    makeItem({ id: `${type}-${i}`, type, fileName: `${type}-${i}.dat` }),
  );
}
