import { describe, it, expect, beforeEach } from 'vitest';
import { MediaScanner } from '../../src/content/media-scanner.js';
import { mediaIdFromKey, mediaKey } from '../../src/shared/utils/media-key.js';
import { loadDomFixture, setLocation } from '../fixtures/dom/load-fixture.js';

const PEER = '-1001234567890';

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

function bubble(mid: string): HTMLElement {
  return document.querySelector<HTMLElement>(`.bubble[data-mid="${mid}"]`)!;
}

describe('MediaScanner (integration)', () => {
  beforeEach(() => setLocation('https://web.telegram.org/k/'));

  it('scans photos, videos, documents and audio from Web K DOM', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    const { items, updates } = scanner.scan();

    expect(items.map((i) => i.type).sort()).toEqual([
      'audio',
      'document',
      'photo',
      'video',
    ]);
    expect(updates).toEqual([]);

    const doc = items.find((i) => i.type === 'document');
    expect(doc?.fileName).toBe('report.pdf');
    expect(doc?.size).toBe('2.4 MB');
    expect(doc?.byteSize).toBeGreaterThan(0);

    const photo = items.find((i) => i.type === 'photo');
    expect(photo?.url).toContain('photo1.jpg');
    expect(photo?.messageId).toBe('1001');
    expect(photo?.date).toContain('2026-06-19');
  });

  it('remembers seen elements without touching the DOM', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    const first = scanner.scan();
    expect(first.items.length).toBeGreaterThan(0);
    expect(document.querySelector('[data-tgmd-seen]')).toBeNull();

    expect(scanner.scan().items).toHaveLength(0);

    scanner.resetSeen();
    expect(scanner.scan().items).toHaveLength(first.items.length);
  });

  it('scans only provided roots for incremental updates', () => {
    seedWebKDom();
    const scanner = new MediaScanner('webk', document);
    scanner.scan();

    const fresh = document.createElement('div');
    fresh.className = 'bubble';
    fresh.setAttribute('data-mid', '2001');
    const img = document.createElement('img');
    img.className = 'media-photo';
    img.src = 'https://cdn.telegram.org/new.jpg';
    fresh.appendChild(img);
    document.querySelector('.bubbles')!.appendChild(fresh);

    const { items } = scanner.scan([fresh]);
    expect(items).toHaveLength(1);
    expect(items[0]?.url).toContain('new.jpg');
  });

  it('picks up media inserted later into an existing bubble (lazy load)', () => {
    seedWebKDom();
    const host = document.createElement('div');
    host.className = 'bubble';
    host.setAttribute('data-mid', '3001');
    document.querySelector('.bubbles')!.appendChild(host);
    const scanner = new MediaScanner('webk', document);
    scanner.scan();

    const img = document.createElement('img');
    img.className = 'media-photo';
    img.src = 'https://cdn.telegram.org/lazy.jpg';
    host.appendChild(img);

    const { items } = scanner.scan([img]);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('photo');
    expect(items[0]?.messageId).toBe('3001');
    expect(items[0]?.url).toContain('lazy.jpg');
  });
});

describe('MediaScanner on a realistic Web K chat', () => {
  beforeEach(() => {
    setLocation(`https://web.telegram.org/k/#${PEER}`);
    loadDomFixture('webk-chat');
  });

  it('classifies every message exactly once', () => {
    const { items } = new MediaScanner('webk', document).scan();
    const summary = items.map((i) => `${i.messageId}:${i.albumIndex}:${i.type}`);
    expect(summary).toEqual([
      '101:0:photo',
      '102:0:video',
      '103:0:video',
      '104:0:gif',
      '105:0:document',
      '106:0:audio',
      '107:0:audio',
      '108:0:photo',
      '109:1:video',
      '110:2:photo',
      '121:0:photo',
    ]);
  });

  it('derives ids from peer + message + album index + type', () => {
    const { items } = new MediaScanner('webk', document).scan();
    for (const item of items) {
      const key = mediaKey({ ...item, peerId: PEER });
      expect(item.id).toBe(mediaIdFromKey(key!));
      expect(item.peerId).toBe(PEER);
      expect(item.chatTitle).toBe('Design Team');
    }
  });

  it('yields one video (not an extra photo) for a video bubble with a poster thumb', () => {
    const { items } = new MediaScanner('webk', document).scan([bubble('102')]);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('video');
    expect(items[0]?.url).toBe('blob:https://web.telegram.org/video-102');
    expect(items[0]?.thumbnailUrl).toMatch(/^data:image\/jpeg/);
  });

  it('yields one item per album element with its own message id', () => {
    const { items } = new MediaScanner('webk', document).scan([bubble('110')]);
    expect(items.map((i) => [i.messageId, i.albumIndex, i.type])).toEqual([
      ['108', 0, 'photo'],
      ['109', 1, 'video'],
      ['110', 2, 'photo'],
    ]);
    expect(new Set(items.map((i) => i.id)).size).toBe(3);
  });

  it('ignores stickers, link previews, reply thumbnails, avatars and service messages', () => {
    const { items } = new MediaScanner('webk', document).scan();
    const urls = items.flatMap((i) => [i.url, i.thumbnailUrl]).join(' ');
    expect(urls).not.toMatch(/sticker|emoji|og\.jpg|reply-thumb|avatar|group-photo/);
    for (const mid of ['111', '112', '113', '120']) {
      expect(items.some((i) => i.messageId === mid)).toBe(false);
    }
  });

  it('never scans the media viewer, shared media sidebar, chat list or own panel', () => {
    const scanner = new MediaScanner('webk', document);
    const outside = [
      document.querySelector('.media-viewer-whole')!,
      document.querySelector('#column-right')!,
      document.querySelector('.chatlist')!,
      document.querySelector('#tg-media-downloader-root')!,
    ];
    const result = scanner.scan(outside);
    expect(result.items).toEqual([]);
    expect(scanner.scan().items.some((i) => i.messageId === '999')).toBe(false);
  });

  it('reads the timestamp from the bubble attribute', () => {
    const { items } = new MediaScanner('webk', document).scan([bubble('101')]);
    expect(items[0]?.timestamp).toBe(1749117600 * 1000);
    expect(items[0]?.date).toBe('2025-06-05T10:00:00.000Z');
  });

  it('falls back to the date-group header plus the time text', () => {
    const { items } = new MediaScanner('webk', document).scan([bubble('121')]);
    expect(items[0]?.timestamp).toBe(new Date(2025, 5, 6, 9, 15).getTime());
  });

  it('reads document and audio names and sizes', () => {
    const { items } = new MediaScanner('webk', document).scan();
    const doc = items.find((i) => i.messageId === '105');
    expect(doc?.fileName).toBe('Quarterly Report.pdf');
    expect(doc?.size).toBe('2.4 MB');
    const song = items.find((i) => i.messageId === '107');
    expect(song?.fileName).toBe('Morning Song.mp3');
    expect(song?.size).toBe('3.4 MB');
  });

  it('keeps the id when the data: thumb is replaced by a blob: image and emits an update', () => {
    const scanner = new MediaScanner('webk', document);
    const first = scanner.scan([bubble('101')]);
    const original = first.items[0]!;
    expect(original.url).toMatch(/^data:/);

    const full = document.createElement('img');
    full.className = 'media-photo';
    full.src = 'blob:https://web.telegram.org/photo-101-full';
    bubble('101').querySelector('.attachment')!.appendChild(full);

    const second = scanner.scan([full]);
    expect(second.items).toEqual([]);
    expect(second.updates).toEqual([
      {
        id: original.id,
        patch: {
          url: 'blob:https://web.telegram.org/photo-101-full',
          thumbnailUrl: 'blob:https://web.telegram.org/photo-101-full',
        },
      },
    ]);
  });

  it('turns a src attribute change into an update, not a duplicate', () => {
    const scanner = new MediaScanner('webk', document);
    const [original] = scanner.scan([bubble('121')]).items;
    const img = bubble('121').querySelector<HTMLImageElement>('img')!;
    img.src = 'blob:https://web.telegram.org/photo-121-v2';

    const result = scanner.scan([img]);
    expect(result.items).toEqual([]);
    expect(result.updates).toHaveLength(1);
    expect(result.updates[0]?.id).toBe(original?.id);
    expect(result.updates[0]?.patch.url).toBe(
      'blob:https://web.telegram.org/photo-121-v2',
    );

    expect(scanner.scan([img]).updates).toEqual([]);
  });

  it('never downgrades a full URL back to a data: thumbnail', () => {
    const scanner = new MediaScanner('webk', document);
    const img = bubble('121').querySelector<HTMLImageElement>('img')!;
    scanner.scan([img]);
    img.src = 'data:image/jpeg;base64,/9j/BLUR';
    expect(scanner.scan([img]).updates).toEqual([]);
  });

  it('re-emits known items after resetSeen together with their changes', () => {
    const scanner = new MediaScanner('webk', document);
    const first = scanner.scan();
    const img = bubble('121').querySelector<HTMLImageElement>('img')!;
    img.src = 'blob:https://web.telegram.org/photo-121-v3';

    scanner.resetSeen();
    const again = scanner.scan();
    expect(again.items).toHaveLength(first.items.length);
    expect(again.updates.map((u) => u.patch.url)).toEqual([
      'blob:https://web.telegram.org/photo-121-v3',
    ]);
  });

  it('falls back to a DOM signature id when there is no message id', () => {
    const container = document.querySelector('.bubbles-group')!;
    const orphan = document.createElement('div');
    orphan.className = 'bubble';
    const doc = document.createElement('div');
    doc.className = 'document';
    const name = document.createElement('div');
    name.className = 'document-name';
    name.textContent = 'notes.txt';
    doc.appendChild(name);
    orphan.appendChild(doc);
    container.appendChild(orphan);

    const scanner = new MediaScanner('webk', document);
    const [item] = scanner.scan([orphan]).items;
    expect(item?.messageId).toBeUndefined();
    expect(item?.fileName).toBe('notes.txt');

    const link = document.createElement('a');
    link.href = 'blob:https://web.telegram.org/notes';
    doc.appendChild(link);
    const again = scanner.scan([link]);
    expect(again.items).toEqual([]);
    expect(again.updates[0]?.id).toBe(item?.id);
  });
});
