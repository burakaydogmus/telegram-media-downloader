import { describe, it, expect } from 'vitest';
import { MediaScanner } from '../../src/content/media-scanner.js';

describe('MediaScanner Web A + edge cases', () => {
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
    const scanner = new MediaScanner('weba', document);
    const { items } = scanner.scan();
    const types = items.map((i) => i.type);
    expect(types).toContain('photo');
    expect(types).toContain('gif');
    expect(items.find((i) => i.type === 'document')?.fileName).toBe('spec.docx');
  });

  it('extracts a file name from a background-image URL', () => {
    document.body.innerHTML = `
      <div class="bubbles">
        <div class="bubble" data-mid="9">
          <div class="media-photo" style="background-image: url('https://x/cover.png')"></div>
        </div>
      </div>`;
    const scanner = new MediaScanner('webk', document);
    const item = scanner.scan().items[0];
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
    const scanner = new MediaScanner('webk', document);
    const item = scanner.scan().items[0];
    expect(item?.timestamp).toBe(1750000000 * 1000);
    expect(item?.date).toContain('2025');
  });

  it('returns no items for an empty container', () => {
    document.body.innerHTML = '<div class="bubbles"></div>';
    const scanner = new MediaScanner('webk', document);
    expect(scanner.scan().items).toHaveLength(0);
  });
});
