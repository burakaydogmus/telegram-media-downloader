import { describe, it, expect, beforeEach } from 'vitest';
import { MediaScanner } from '../../src/content/media-scanner.js';
import { loadDomFixture, setLocation } from '../fixtures/dom/load-fixture.js';

function message(id: string): HTMLElement {
  return document.querySelector<HTMLElement>(`#message-${id}`)!;
}

describe('MediaScanner Web A + edge cases', () => {
  beforeEach(() => setLocation('https://web.telegram.org/a/'));

  it('scans Web A markup including GIFs', () => {
    document.body.innerHTML = `
      <div class="MessageList">
        <div class="Message" data-message-id="5001">
          <div class="media-inner"><img class="full-media" src="https://x/a.jpg" /></div>
          <time datetime="2026-06-19T08:00:00Z">08:00</time>
        </div>
        <div class="Message" data-message-id="5002">
          <video class="GIF" loop><source src="https://x/anim.mp4" /></video>
        </div>
        <div class="Message" data-message-id="5003">
          <div class="File">
            <div class="File-name">spec.docx</div>
            <div class="File-size">1.2 MB</div>
          </div>
        </div>
      </div>`;
    const { items } = new MediaScanner('weba', document).scan();
    expect(items.map((i) => i.type)).toEqual(['photo', 'gif', 'document']);
    expect(items.find((i) => i.type === 'gif')?.url).toBe('https://x/anim.mp4');
    expect(items.find((i) => i.type === 'document')?.fileName).toBe('spec.docx');
  });

  it('extracts a file name from a background-image URL', () => {
    document.body.innerHTML = `
      <div class="bubbles">
        <div class="bubble" data-mid="9">
          <div class="media-photo" style="background-image: url('https://x/cover.png')"></div>
        </div>
      </div>`;
    const item = new MediaScanner('webk', document).scan().items[0];
    expect(item?.url).toContain('cover.png');
    expect(item?.fileName).toBe('cover.png');
  });

  it('parses numeric epoch-second timestamps', () => {
    document.body.innerHTML = `
      <div class="bubbles">
        <div class="bubble" data-mid="42">
          <img class="media-photo" src="https://x/p.jpg" />
          <span class="time" data-timestamp="1750000000">x</span>
        </div>
      </div>`;
    const item = new MediaScanner('webk', document).scan().items[0];
    expect(item?.timestamp).toBe(1750000000 * 1000);
    expect(item?.date).toContain('2025');
  });

  it('returns no items for an empty container', () => {
    document.body.innerHTML = '<div class="bubbles"></div>';
    expect(new MediaScanner('webk', document).scan().items).toHaveLength(0);
  });

  it('ignores media outside any message list', () => {
    document.body.innerHTML =
      '<div class="bubble" data-mid="1"><img class="media-photo" src="https://x/p.jpg" /></div>';
    const scanner = new MediaScanner('webk', document);
    expect(scanner.scan().items).toEqual([]);
    expect(scanner.scan([document.body]).items).toEqual([]);
  });
});

describe('MediaScanner on a realistic Web A chat', () => {
  beforeEach(() => {
    setLocation('https://web.telegram.org/a/#-1009876543210_12');
    loadDomFixture('weba-chat');
  });

  it('classifies every message exactly once', () => {
    const { items } = new MediaScanner('weba', document).scan();
    expect(items.map((i) => `${i.messageId}:${i.albumIndex}:${i.type}`)).toEqual([
      '5001:0:photo',
      '5002:0:video',
      '5003:0:video',
      '5004:0:gif',
      '5005:0:document',
      '5006:0:audio',
      '5007:0:audio',
      '5008:0:photo',
      '5009:1:video',
      '5010:2:photo',
      '5020:0:photo',
    ]);
    for (const item of items) {
      expect(item.peerId).toBe('-1009876543210');
      expect(item.chatTitle).toBe('Photo Club');
    }
  });

  it('prefers the full blob over the blurred data: thumbnail', () => {
    const [photo] = new MediaScanner('weba', document).scan([message('5001')]).items;
    expect(photo?.url).toBe('blob:https://web.telegram.org/a/photo-5001');
  });

  it('yields one video item for a video with a thumbnail image', () => {
    const { items } = new MediaScanner('weba', document).scan([message('5002')]);
    expect(items).toHaveLength(1);
    expect(items[0]?.type).toBe('video');
    expect(items[0]?.thumbnailUrl).toMatch(/^data:/);
  });

  it('reads album item ids from the grouped media elements', () => {
    const { items } = new MediaScanner('weba', document).scan([message('5010')]);
    expect(items.map((i) => [i.messageId, i.albumIndex, i.type])).toEqual([
      ['5008', 0, 'photo'],
      ['5009', 1, 'video'],
      ['5010', 2, 'photo'],
    ]);
  });

  it('reads document name and size', () => {
    const [doc] = new MediaScanner('weba', document).scan([message('5005')]).items;
    expect(doc?.fileName).toBe('assets-v2.zip');
    expect(doc?.size).toBe('12.5 MB');
    expect(doc?.byteSize).toBeGreaterThan(12 * 1024 * 1024);
  });

  it('ignores stickers, previews, replies, custom emoji and service messages', () => {
    const scanner = new MediaScanner('weba', document);
    const { items } = scanner.scan();
    const urls = items.flatMap((i) => [i.url, i.thumbnailUrl]).join(' ');
    expect(urls).not.toMatch(/sticker|emoji|og-a|reply-thumb|avatar|action-photo/);
    expect(items.some((i) => ['5011', '5012', '5013'].includes(i.messageId ?? ''))).toBe(
      false,
    );
  });

  it('never scans the media viewer or the right column', () => {
    const scanner = new MediaScanner('weba', document);
    const roots = [
      document.querySelector('#MediaViewer')!,
      document.querySelector('#RightColumn')!,
    ];
    expect(scanner.scan(roots).items).toEqual([]);
  });

  it('reads the full date from the message-time title', () => {
    const [photo] = new MediaScanner('weba', document).scan([message('5001')]).items;
    expect(photo?.timestamp).toBe(new Date(2025, 5, 5, 10, 0, 0).getTime());
  });

  it('combines the sticky date with a 12-hour time', () => {
    const [photo] = new MediaScanner('weba', document).scan([message('5020')]).items;
    expect(photo?.timestamp).toBe(new Date(2025, 5, 6, 20, 30).getTime());
  });

  it('leaves the date undefined when it cannot be parsed', () => {
    const time = message('5001').querySelector('.message-time')!;
    time.setAttribute('title', 'четверг, 5 июня');
    message('5001')
      .closest('.message-date-group')!
      .querySelector('.sticky-date')!.textContent = 'Четверг';
    const [photo] = new MediaScanner('weba', document).scan([message('5001')]).items;
    expect(photo?.date).toBeUndefined();
    expect(photo?.timestamp).toBeUndefined();
  });
});
