import { describe, it, expect } from 'vitest';
import { MediaScanner } from '../../src/content/media-scanner.js';

function seedWebKDom(): void {
  document.body.innerHTML = `
    <div class="bubbles">
      <div class="bubble" data-mid="1001">
        <img class="media-photo" src="https://cdn.telegram.org/photo1.jpg" />
        <time datetime="2026-06-19T10:00:00Z">10:00</time>
      </div>
      <div class="bubble" data-mid="1002">
        <video class="media-video"><source src="https://cdn.telegram.org/clip.mp4" /></video>
        <time datetime="2026-06-18T09:00:00Z">09:00</time>
      </div>
      <div class="bubble" data-mid="1003">
        <div class="document">
          <a href="https://cdn.telegram.org/report.pdf"></a>
          <div class="document-name">report.pdf</div>
          <div class="document-size">2.4 MB</div>
        </div>
      </div>
      <div class="bubble" data-mid="1004">
        <audio src="https://cdn.telegram.org/voice.ogg"></audio>
      </div>
    </div>
  `;
}

describe('MediaScanner (integration)', () => {
  it('scans photos, videos, documents and audio from Web K DOM', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    const { items } = scanner.scan();

    const types = items.map((i) => i.type).sort();
    expect(types).toEqual(
      expect.arrayContaining(['photo', 'video', 'document', 'audio']),
    );

    const doc = items.find((i) => i.type === 'document');
    expect(doc?.fileName).toBe('report.pdf');
    expect(doc?.size).toBe('2.4 MB');
    expect(doc?.byteSize).toBeGreaterThan(0);

    const photo = items.find((i) => i.type === 'photo');
    expect(photo?.url).toContain('photo1.jpg');
    expect(photo?.messageId).toBe('1001');
    expect(photo?.date).toContain('2026-06-19');
  });

  it('marks nodes as seen so incremental scans skip them', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    const first = scanner.scan();
    expect(first.items.length).toBeGreaterThan(0);

    const second = scanner.scan();
    expect(second.items.length).toBe(0); // already seen

    scanner.resetSeen();
    const third = scanner.scan();
    expect(third.items.length).toBe(first.items.length);
  });

  it('produces stable, de-duplicated ids', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    const ids = scanner.scan().items.map((i) => i.id);
    expect(new Set(ids).size).toBe(ids.length);
  });

  it('scans only provided roots for incremental updates', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    scanner.scan(); // mark all seen

    const container = document.querySelector('.bubbles')!;
    const fresh = document.createElement('div');
    fresh.className = 'bubble';
    fresh.setAttribute('data-mid', '2001');
    fresh.innerHTML =
      '<img class="media-photo" src="https://cdn.telegram.org/new.jpg" />';
    container.appendChild(fresh);

    const { items } = scanner.scan([fresh]);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toContain('new.jpg');
  });

  it('matches a media element handed in directly as the root (lazy load)', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    scanner.scan(); // mark all seen

    // Telegram inserts the <img> itself later; the MutationEngine then reports
    // that node as the added root rather than a containing bubble.
    const container = document.querySelector('.bubbles')!;
    const img = document.createElement('img');
    img.className = 'media-photo';
    img.src = 'https://cdn.telegram.org/lazy.jpg';
    container.appendChild(img);

    const { items } = scanner.scan([img]);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('photo');
    expect(items[0]?.url).toContain('lazy.jpg');
  });
});
