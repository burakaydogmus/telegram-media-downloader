import type { MediaItem } from '../../shared/types/index.js';
import { fuzzyScore } from '../../shared/utils/index.js';

export interface SearchHit {
  readonly item: MediaItem;
  readonly score: number;
}

export class SearchService {
  search(items: readonly MediaItem[], query: string, threshold = 0.3): SearchHit[] {
    const trimmed = query.trim();
    if (trimmed.length === 0) {
      return items.map((item) => ({ item, score: 1 }));
    }

    const hits: SearchHit[] = [];
    for (const item of items) {
      const score = this.scoreItem(item, trimmed);
      if (score >= threshold) hits.push({ item, score });
    }

    hits.sort((a, b) => b.score - a.score);
    return hits;
  }

  filter(items: readonly MediaItem[], query: string, threshold = 0.3): MediaItem[] {
    return this.search(items, query, threshold).map((hit) => hit.item);
  }

  private scoreItem(item: MediaItem, query: string): number {
    const fields = [item.fileName ?? '', item.type, item.date ?? ''];
    let best = 0;
    for (const field of fields) {
      if (field.length === 0) continue;
      const score = fuzzyScore(query, field);
      if (score > best) best = score;
      if (best === 1) break;
    }
    return best;
  }
}
