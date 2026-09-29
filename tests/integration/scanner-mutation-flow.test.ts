import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { MediaScanner, type ScanUpdate } from '../../src/content/media-scanner.js';
import { MutationEngine } from '../../src/content/mutation-engine.js';
import type { MediaItem } from '../../src/shared/types/index.js';
import { delay } from '../../src/shared/utils/async.js';
import { loadDomFixture, setLocation } from '../fixtures/dom/load-fixture.js';

/** Mirrors how the controller consumes scan results. */
class Sink {
  readonly items = new Map<string, MediaItem>();
  readonly updates: ScanUpdate[] = [];

  apply(scanner: MediaScanner, roots?: readonly Element[]): void {
    const result = scanner.scan(roots);
    for (const item of result.items)
      if (!this.items.has(item.id)) this.items.set(item.id, item);
    for (const update of result.updates) {
      this.updates.push(update);
      const existing = this.items.get(update.id);
      if (existing) this.items.set(update.id, { ...existing, ...update.patch });
    }
  }
}

describe('MutationEngine → MediaScanner', () => {
  let engine: MutationEngine | undefined;
  afterEach(() => engine?.disconnect());
  beforeEach(() => {
    setLocation('https://web.telegram.org/k/#-1001234567890');
    loadDomFixture('webk-chat');
  });

  it('turns a lazy-loaded full image into an update of the same item', async () => {
    const scanner = new MediaScanner('webk', document);
    const sink = new Sink();
    sink.apply(scanner);
    const before = sink.items.size;

    engine = new MutationEngine((roots) => sink.apply(scanner, roots), { debounceMs: 5 });
    engine.observe(document.querySelector('#column-center')!);

    const thumb = document.querySelector<HTMLImageElement>(
      '.bubble[data-mid="101"] img.media-photo',
    )!;
    thumb.src = 'blob:https://web.telegram.org/photo-101-full';
    thumb.classList.remove('thumbnail');

    await delay(40);
    expect(sink.items.size).toBe(before);
    const photo = [...sink.items.values()].find((i) => i.messageId === '101');
    expect(photo?.url).toBe('blob:https://web.telegram.org/photo-101-full');
  });

  it('adds new bubbles appended in bulk beyond one batch', async () => {
    const scanner = new MediaScanner('webk', document);
    const sink = new Sink();
    sink.apply(scanner);
    const before = sink.items.size;

    engine = new MutationEngine((roots) => sink.apply(scanner, roots), {
      debounceMs: 5,
      batchSize: 7,
    });
    engine.observe(document.querySelector('#column-center')!);

    const group = document.querySelectorAll('.bubbles-group')[1]!;
    for (let i = 0; i < 30; i += 1) {
      const bubble = document.createElement('div');
      bubble.className = 'bubble photo';
      bubble.setAttribute('data-mid', String(500 + i));
      const img = document.createElement('img');
      img.className = 'media-photo';
      img.src = `blob:https://web.telegram.org/bulk-${i}`;
      bubble.appendChild(img);
      group.appendChild(bubble);
    }

    await delay(120);
    expect(sink.items.size).toBe(before + 30);
    expect(sink.updates).toEqual([]);
  });
});
