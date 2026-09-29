import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  NativeDownloadTrigger,
  findMediaElement,
  findDownloadMenuItem,
  hasDownloadIcon,
  nativeExpectTimeoutMs,
} from '../../src/content/native-download.js';
import { NonRetryableDownloadError } from '../../src/features/download/download-errors.js';
import type { RateLimiter } from '../../src/features/download/rate-limiter.js';
import type {
  ExpectOptions,
  TrackedDownload,
  TrackedDownloadProgress,
} from '../../src/features/download/download-tracker.js';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/index.js';
import type { MediaItem } from '../../src/shared/types/index.js';

function item(overrides: Partial<MediaItem> = {}): MediaItem {
  return { id: 'v1', type: 'video', ...overrides };
}

function el(
  tag: string,
  className = '',
  attrs: Record<string, string> = {},
): HTMLElement {
  const node = document.createElement(tag);
  if (className) node.className = className;
  for (const [k, v] of Object.entries(attrs)) node.setAttribute(k, v);
  return node;
}

/** Web K bubble with an album of `count` items, each with its own data-mid. */
function webkAlbum(bubbleMid: string, mids: string[]): HTMLElement {
  const bubble = el('div', 'bubble', { 'data-mid': bubbleMid });
  const album = el('div', 'album');
  mids.forEach((mid, i) => {
    const albumItem = el('div', 'album-item grouped-item', {
      'data-mid': mid,
      'data-idx': String(i),
    });
    albumItem.append(el('img', 'media-photo', { alt: `m${mid}` }));
    album.append(albumItem);
  });
  bubble.append(album);
  return bubble;
}

interface MenuOptions {
  entries?: Array<{ text: string; icon?: string }>;
  onClick?: (text: string, target: EventTarget | null) => void;
  menuClass?: string;
  closeOnClick?: boolean;
}

let contextTargets: Array<EventTarget | null> = [];
let menuHandler: ((event: Event) => void) | null = null;
function wireMenu(opts: MenuOptions = {}): void {
  const entries = opts.entries ?? [
    { text: 'Reply', icon: 'tgico-reply' },
    { text: 'Download', icon: 'tgico-download' },
  ];
  menuHandler = (event: Event): void => {
    contextTargets.push(event.target);
    const menu = el('div', opts.menuClass ?? 'btn-menu contextmenu active was-open');
    for (const entry of entries) {
      const row = el('div', 'btn-menu-item rp-overflow');
      if (entry.icon) row.append(el('span', `tgico ${entry.icon}`));
      row.append(document.createTextNode(entry.text));
      row.addEventListener('click', () => {
        opts.onClick?.(entry.text, event.target);
        if (opts.closeOnClick !== false) menu.classList.remove('active', 'was-open');
      });
      menu.append(row);
    }
    document.body.append(menu);
  };
  document.addEventListener('contextmenu', menuHandler);
}

class FakeTracker {
  calls: Array<{ taskId: string; path: string; options: ExpectOptions; at: string[] }> =
    [];
  log: string[] = [];
  handles: Array<{
    complete: () => void;
    fail: (e: Error) => void;
    start: () => void;
    progress: (p: TrackedDownloadProgress) => void;
  }> = [];
  expect(taskId: string, relativePath: string, options: ExpectOptions): TrackedDownload {
    this.log.push(`expect:${taskId}`);
    this.calls.push({ taskId, path: relativePath, options, at: [...this.log] });
    let resolveDone!: (v: { filename?: string }) => void;
    let rejectDone!: (e: unknown) => void;
    let resolveStarted!: () => void;
    let rejectStarted!: (e: unknown) => void;
    const done = new Promise<{ filename?: string }>(
      (r, j) => ((resolveDone = r), (rejectDone = j)),
    );
    const started = new Promise<void>(
      (r, j) => ((resolveStarted = r), (rejectStarted = j)),
    );
    done.catch(() => undefined);
    started.catch(() => undefined);
    const listeners = new Set<(p: TrackedDownloadProgress) => void>();
    this.handles.push({
      complete: () => {
        resolveStarted();
        resolveDone({});
      },
      fail: (e) => {
        rejectStarted(e);
        rejectDone(e);
      },
      start: () => resolveStarted(),
      progress: (p) => listeners.forEach((l) => l(p)),
    });
    options.signal?.addEventListener('abort', () => {
      const e = new DOMException('Aborted', 'AbortError');
      rejectStarted(e);
      rejectDone(e);
    });
    return {
      ready: Promise.resolve(),
      started,
      done,
      onProgress: (l) => {
        listeners.add(l);
        return () => listeners.delete(l);
      },
      cancel: vi.fn(),
    };
  }
}

const tick = (ms = 0): Promise<void> => new Promise((r) => setTimeout(r, ms));
async function until(predicate: () => boolean, ms = 2000): Promise<void> {
  const end = Date.now() + ms;
  while (!predicate()) {
    if (Date.now() > end) throw new Error('timeout');
    await tick(5);
  }
}

beforeEach(() => {
  document.body.replaceChildren();
  contextTargets = [];
  Element.prototype.scrollIntoView = vi.fn();
});

afterEach(() => {
  if (menuHandler) document.removeEventListener('contextmenu', menuHandler);
  menuHandler = null;
});

describe('findMediaElement', () => {
  it('Web K: prefers the album item with the exact data-mid', () => {
    document.body.append(webkAlbum('103', ['101', '102', '103']));
    const found = findMediaElement(
      document,
      'webk',
      item({ messageId: '102', albumIndex: 1 }),
    );
    expect(found?.getAttribute('alt')).toBe('m102');
  });

  it('Web K: exact album data-mid wins even over the bubble with the same mid', () => {
    document.body.append(webkAlbum('103', ['101', '102', '103']));
    const found = findMediaElement(
      document,
      'webk',
      item({ messageId: '103', albumIndex: 2 }),
    );
    expect(found?.getAttribute('alt')).toBe('m103');
  });

  it('Web K: bubble mid + albumIndex picks that slot', () => {
    const bubble = el('div', 'bubble', { 'data-mid': '50' });
    const album = el('div', 'album');
    for (let i = 0; i < 3; i += 1) {
      const albumItem = el('div', 'album-item');
      albumItem.append(el('img', 'media-photo', { alt: `slot${i}` }));
      album.append(albumItem);
    }
    bubble.append(album);
    document.body.append(bubble);
    expect(
      findMediaElement(
        document,
        'webk',
        item({ messageId: '50', albumIndex: 2 }),
      )?.getAttribute('alt'),
    ).toBe('slot2');
    expect(
      findMediaElement(document, 'webk', item({ messageId: '50', albumIndex: 7 })),
    ).toBeNull();
  });

  it('never falls back to the first media for an album item it cannot see', () => {
    const bubble = el('div', 'bubble', { 'data-mid': '60' });
    bubble.append(el('video', 'media-video'));
    document.body.append(bubble);
    expect(
      findMediaElement(document, 'webk', item({ messageId: '60', albumIndex: 1 })),
    ).toBeNull();
    expect(
      findMediaElement(document, 'webk', item({ messageId: '60', albumIndex: 0 }))
        ?.tagName,
    ).toBe('VIDEO');
  });

  it('Web A: #message-<id> with album slot and [data-message-id]', () => {
    const message = el('div', 'Message', { id: 'message-77' });
    const album = el('div', 'Album');
    for (let i = 0; i < 2; i += 1) {
      const wrapper = el('div', 'album-item-select-wrapper');
      wrapper.append(el('div', 'media-inner', { 'data-slot': String(i) }));
      album.append(wrapper);
    }
    message.append(album);
    const single = el('div', 'Message', { 'data-message-id': '78' });
    single.append(el('video'));
    document.body.append(message, single);

    expect(
      findMediaElement(document, 'weba', item({ messageId: '77', albumIndex: 1 }))
        ?.dataset.slot,
    ).toBe('1');
    expect(findMediaElement(document, 'weba', item({ messageId: '78' }))?.tagName).toBe(
      'VIDEO',
    );
  });

  it('returns null for unknown ids and falls back to the thumbnail without an id', () => {
    const bubble = el('div', 'bubble');
    const albumItem = el('div', 'album-item');
    albumItem.append(el('img', '', { src: 'https://x/t.jpg' }));
    bubble.append(albumItem);
    document.body.append(bubble);
    expect(findMediaElement(document, 'webk', item({ messageId: '1' }))).toBeNull();
    expect(
      findMediaElement(document, 'webk', item({ thumbnailUrl: 'https://x/t.jpg' }))
        ?.className,
    ).toBe('album-item');
    expect(findMediaElement(document, 'webk', item())).toBeNull();
  });

  it('escapes quotes in ids', () => {
    expect(findMediaElement(document, 'webk', item({ messageId: 'a"b' }))).toBeNull();
  });
});

describe('download menu detection', () => {
  function menu(
    entries: Array<{ text: string; icon?: string }>,
    className = 'btn-menu active',
  ) {
    const root = el('div', className);
    for (const entry of entries) {
      const row = el('div', 'btn-menu-item');
      if (entry.icon) row.append(el('i', entry.icon));
      row.append(document.createTextNode(entry.text));
      root.append(row);
    }
    document.body.append(root);
    return root;
  }

  it('matches by icon class regardless of language', () => {
    menu([
      { text: 'Yanıtla', icon: 'tgico-reply' },
      { text: 'Скачать', icon: 'tgico-download' },
    ]);
    expect(findDownloadMenuItem(document, 'webk')?.textContent).toBe('Скачать');
  });

  it('Web A icon-download inside MenuItem', () => {
    const root = el('div', 'Menu');
    const bubble = el('div', 'bubble menu-container open');
    const row = el('div', 'MenuItem');
    row.append(el('i', 'icon icon-download'), document.createTextNode('Herunterladen'));
    bubble.append(row);
    root.append(bubble);
    document.body.append(root);
    expect(findDownloadMenuItem(document, 'weba')).toBe(row);
  });

  it('excludes cancel-download variants and generic "save"', () => {
    menu([
      { text: 'Cancel download', icon: 'tgico-download' },
      { text: 'Stop', icon: 'tgico-download_cancel' },
      { text: 'Save as GIF', icon: 'tgico-gifs' },
      { text: 'Save to Downloads' },
    ]);
    expect(findDownloadMenuItem(document, 'webk')).toBeNull();
  });

  it('prefers icons over text, and open menus over closed ones', () => {
    menu([{ text: 'Download', icon: 'tgico-download' }], 'btn-menu');
    const open = menu([
      { text: 'Download all' },
      { text: 'Get', icon: 'tgico-download' },
    ]);
    const found = findDownloadMenuItem(document, 'webk');
    expect(found?.parentElement).toBe(open);
    expect(found?.textContent).toBe('Get');
  });

  it('falls back to text only as a last resort', () => {
    menu([{ text: 'Reply' }, { text: 'İndir' }]);
    expect(findDownloadMenuItem(document, 'webk')?.textContent).toBe('İndir');
  });

  it('hasDownloadIcon checks the item itself too', () => {
    const row = el('div', 'btn-menu-item tgico-download');
    expect(hasDownloadIcon(row)).toBe(true);
  });

  it('timeout grows with size within bounds', () => {
    expect(nativeExpectTimeoutMs(item())).toBe(90_000);
    expect(nativeExpectTimeoutMs(item({ byteSize: 10 * 1024 ** 3 }))).toBe(30 * 60_000);
  });
});

describe('NativeDownloadTrigger', () => {
  it('opens the menu on the exact album item and clicks Download (no tracker)', async () => {
    document.body.append(webkAlbum('3', ['1', '2', '3']));
    const clicked = vi.fn();
    wireMenu({ onClick: clicked });
    const trigger = new NativeDownloadTrigger('webk', document);
    await trigger.download(
      item({ messageId: '2', albumIndex: 1 }),
      new AbortController().signal,
    );

    expect(clicked).toHaveBeenCalledOnce();
    expect(clicked.mock.calls[0]?.[0]).toBe('Download');
    expect((contextTargets[0] as HTMLElement).getAttribute('alt')).toBe('m2');
    expect(Element.prototype.scrollIntoView).toHaveBeenCalledWith(
      expect.objectContaining({ block: 'center' }),
    );
  });

  it('never removes Telegram menu nodes and never dispatches Escape', async () => {
    document.body.append(webkAlbum('3', ['3']));
    wireMenu({ closeOnClick: false });
    const keys = vi.fn();
    document.addEventListener('keydown', keys);
    const backdropClicks = vi.fn();
    document.body.addEventListener('mousedown', backdropClicks);

    const trigger = new NativeDownloadTrigger('webk', document);
    await trigger.download(item({ messageId: '3' }), new AbortController().signal);

    expect(document.querySelector('.btn-menu')).not.toBeNull();
    expect(keys).not.toHaveBeenCalled();
    expect(backdropClicks).toHaveBeenCalled();
    document.removeEventListener('keydown', keys);
  });

  it('prefers the menu overlay for closing when present', async () => {
    document.body.append(webkAlbum('3', ['3']));
    const overlay = el('div', 'btn-menu-overlay');
    document.body.append(overlay);
    const overlayClicks = vi.fn();
    overlay.addEventListener('click', overlayClicks);
    wireMenu({ closeOnClick: false });
    await new NativeDownloadTrigger('webk', document).download(
      item({ messageId: '3' }),
      new AbortController().signal,
    );
    expect(overlayClicks).toHaveBeenCalled();
  });

  it('rejects (non-retryable) when the media is not on screen', async () => {
    const trigger = new NativeDownloadTrigger('webk', document);
    await expect(
      trigger.download(item({ messageId: '9999' }), new AbortController().signal),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
  });

  it('rejects when Telegram exposes no download option', async () => {
    document.body.append(webkAlbum('7', ['7']));
    wireMenu({ entries: [{ text: 'Reply', icon: 'tgico-reply' }] });
    const trigger = new NativeDownloadTrigger('webk', document, undefined, {
      menuTimeoutMs: 100,
    });
    await expect(
      trigger.download(item({ messageId: '7' }), new AbortController().signal),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
  });

  it('expects before clicking and resolves only on real completion', async () => {
    document.body.append(webkAlbum('5', ['5']));
    const tracker = new FakeTracker();
    wireMenu({ onClick: () => tracker.log.push('click') });
    const trigger = new NativeDownloadTrigger('webk', document, undefined, {
      tracker,
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        downloadDelayMs: 0,
        downloadJitterMs: 0,
      }),
    });
    const progress = vi.fn();
    let resolved = false;
    const pending = trigger
      .download(item({ messageId: '5' }), new AbortController().signal, {
        taskId: 'task-5',
        relativePath: 'Telegram/Chat/x.mp4',
        onProgress: progress,
      })
      .then(() => (resolved = true));

    await until(() => tracker.log.includes('click'));
    expect(tracker.calls[0]).toMatchObject({
      taskId: 'task-5',
      path: 'Telegram/Chat/x.mp4',
    });
    expect(tracker.log).toEqual(['expect:task-5', 'click']);
    await tick(10);
    expect(resolved).toBe(false);

    tracker.handles[0]!.progress({ bytesReceived: 25, totalBytes: 100 });
    expect(progress).toHaveBeenCalledWith(0.25, 25, 100);
    tracker.handles[0]!.complete();
    await pending;
    expect(resolved).toBe(true);
  });

  it('propagates tracker failures (e.g. expired)', async () => {
    document.body.append(webkAlbum('5', ['5']));
    const tracker = new FakeTracker();
    wireMenu();
    const trigger = new NativeDownloadTrigger('webk', document, undefined, { tracker });
    const pending = trigger.download(
      item({ messageId: '5' }),
      new AbortController().signal,
      {
        taskId: 't',
        relativePath: 'x.mp4',
      },
    );
    await until(() => tracker.handles.length === 1);
    tracker.handles[0]!.fail(
      new NonRetryableDownloadError('Telegram did not start a download'),
    );
    await expect(pending).rejects.toThrow('did not start');
  });

  it('is strictly serial until the previous download started', async () => {
    document.body.append(webkAlbum('2', ['1', '2']));
    const tracker = new FakeTracker();
    wireMenu({ onClick: () => tracker.log.push('click') });
    const trigger = new NativeDownloadTrigger('webk', document, undefined, { tracker });
    const signal = new AbortController().signal;
    const a = trigger.download(item({ id: 'a', messageId: '1' }), signal, {
      taskId: 'a',
      relativePath: 'a.mp4',
    });
    const b = trigger.download(item({ id: 'b', messageId: '2' }), signal, {
      taskId: 'b',
      relativePath: 'b.mp4',
    });

    await until(() => tracker.log.includes('click'));
    await tick(30);
    expect(tracker.log).toEqual(['expect:a', 'click']);

    tracker.handles[0]!.start();
    await until(() => tracker.handles.length === 2);
    expect(tracker.log.slice(0, 3)).toEqual(['expect:a', 'click', 'expect:b']);
    tracker.handles[1]!.complete();
    await b;
    tracker.handles[0]!.complete();
    await a;
  });

  it('waits for the rate limiter between downloads', async () => {
    document.body.append(webkAlbum('2', ['1', '2']));
    wireMenu();
    const acquire = vi.fn(() => Promise.resolve());
    const limiter = { acquire } as unknown as RateLimiter;
    const trigger = new NativeDownloadTrigger('webk', document, undefined, { limiter });
    const signal = new AbortController().signal;
    await Promise.all([
      trigger.download(item({ messageId: '1' }), signal),
      trigger.download(item({ messageId: '2' }), signal),
    ]);
    expect(acquire).toHaveBeenCalledTimes(2);
  });

  it('builds a live limiter from settings', async () => {
    document.body.append(webkAlbum('2', ['1', '2']));
    wireMenu();
    let delayMs = 0;
    const trigger = new NativeDownloadTrigger('webk', document, undefined, {
      getSettings: () => ({
        ...DEFAULT_SETTINGS,
        downloadDelayMs: delayMs,
        downloadJitterMs: 0,
      }),
    });
    const signal = new AbortController().signal;
    await trigger.download(item({ messageId: '1' }), signal);
    delayMs = 60;
    const t0 = Date.now();
    await trigger.download(item({ messageId: '2' }), signal);
    await trigger.download(item({ messageId: '1' }), signal);
    expect(Date.now() - t0).toBeGreaterThanOrEqual(55);
  });

  it('aborts while waiting and frees the chain', async () => {
    document.body.append(webkAlbum('2', ['1', '2']));
    const tracker = new FakeTracker();
    wireMenu();
    const trigger = new NativeDownloadTrigger('webk', document, undefined, { tracker });
    const controller = new AbortController();
    const a = trigger.download(item({ messageId: '1' }), controller.signal, {
      taskId: 'a',
      relativePath: 'a.mp4',
    });
    await until(() => tracker.handles.length === 1);
    controller.abort();
    await expect(a).rejects.toThrow('Aborted');

    const b = trigger.download(item({ messageId: '2' }), new AbortController().signal, {
      taskId: 'b',
      relativePath: 'b.mp4',
    });
    await until(() => tracker.handles.length === 2);
    tracker.handles[1]!.complete();
    await b;
  });

  it('rejects immediately when already aborted', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      new NativeDownloadTrigger('webk', document).download(item(), controller.signal),
    ).rejects.toThrow('Aborted');
  });
});
