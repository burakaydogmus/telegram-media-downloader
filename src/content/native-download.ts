import type { MediaItem, Settings, TelegramClient } from '../shared/types/index.js';
import { selectorsFor } from '../shared/constants/selectors.js';
import { abortError, abortableDelay, clamp, nextFrame } from '../shared/utils/index.js';
import type { ILogger } from '../shared/logger/index.js';
import { NonRetryableDownloadError } from '../features/download/download-errors.js';
import type {
  NativeDownloader,
  NativeDownloadRequest,
} from '../features/download/download-executor.js';
import { RateLimiter } from '../features/download/rate-limiter.js';
import type {
  ExpectOptions,
  TrackedDownload,
} from '../features/download/download-tracker.js';

/** The part of `DownloadTracker` the trigger uses. */
export interface DownloadExpecter {
  expect(taskId: string, relativePath: string, options: ExpectOptions): TrackedDownload;
}

export interface NativeDownloadOptions {
  readonly tracker?: DownloadExpecter;
  /** Read live on every download (delay/jitter can change at runtime). */
  readonly getSettings?: () => Settings;
  /** Defaults to a limiter driven by `downloadDelayMs/downloadJitterMs`. */
  readonly limiter?: RateLimiter;
  readonly menuTimeoutMs?: number;
}

const OPEN_MENU_CLASS = /(^|\s)(active|open|was-open|shown)(\s|$)/;
const DOWNLOAD_ICON_SELECTOR = '.tgico-download, .icon-download, [class*="download"]';
const NEGATIVE_CLASS = /cancel|stop|abort|pause/i;
const NEGATIVE_TEXT = /cancel|iptal|stop|durdur/i;
const DOWNLOAD_TEXT = /^(download|indir|i̇ndir)(\s|$)/i;
const MEDIA_TARGET =
  'video, img.media-photo, .media-photo, .media-video, .media-container, .album-item-media, ' +
  '.attachment, .document, .audio, .media-inner, .full-media, .File, .Audio, .Document';
const WEBK_ALBUM_ITEM = '.album-item';
const WEBA_ALBUM_ITEM = '.Album .album-item-select-wrapper, .Album > .media-inner';

function escapeAttrValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}

function mediaTargetWithin(container: HTMLElement): HTMLElement {
  if (container.matches(MEDIA_TARGET)) return container;
  return container.querySelector<HTMLElement>(MEDIA_TARGET) ?? container;
}

function pickAlbumItem(
  message: HTMLElement,
  item: MediaItem,
  client: TelegramClient,
): HTMLElement | null | undefined {
  const selector = client === 'weba' ? WEBA_ALBUM_ITEM : WEBK_ALBUM_ITEM;
  const albumItems = message.querySelectorAll<HTMLElement>(selector);
  if (albumItems.length === 0) {
    // The item claims to be inside an album we cannot see: never guess.
    return (item.albumIndex ?? 0) > 0 ? null : undefined;
  }
  const picked = albumItems[item.albumIndex ?? 0];
  return picked ? mediaTargetWithin(picked) : null;
}

/**
 * Finds the on-screen element for `item` to open Telegram's context menu on.
 * Exact per-message album items first (Web K gives every album item its own
 * `data-mid`), then the message bubble, picking the album slot at
 * `albumIndex`. Returns null rather than falling back to another media.
 */
export function findMediaElement(
  doc: Document,
  client: TelegramClient,
  item: MediaItem,
): HTMLElement | null {
  const mid = item.messageId;
  if (mid) {
    const escaped = escapeAttrValue(mid);
    if (client !== 'weba') {
      const albumItem = doc.querySelector<HTMLElement>(
        `.album-item[data-mid="${escaped}"]`,
      );
      if (albumItem) {
        // An album item's own data-mid identifies exactly one media.
        return mediaTargetWithin(albumItem);
      }
    }

    const message =
      doc.querySelector<HTMLElement>(`.bubble[data-mid="${escaped}"]`) ??
      doc.getElementById(`message-${mid}`) ??
      doc.querySelector<HTMLElement>(`[data-message-id="${escaped}"]`);
    if (message) {
      const inAlbum = pickAlbumItem(message, item, client);
      if (inAlbum !== undefined) return inAlbum;
      return mediaTargetWithin(message);
    }
    return null;
  }

  if (item.thumbnailUrl) {
    const img = doc.querySelector<HTMLElement>(
      `img[src="${escapeAttrValue(item.thumbnailUrl)}"]`,
    );
    if (img) return img.closest<HTMLElement>('.album-item, .media-inner') ?? img;
  }
  return null;
}

function hasDownloadClass(el: Element): boolean {
  return Array.from(el.classList).some(
    (name) => /download/i.test(name) && !NEGATIVE_CLASS.test(name),
  );
}

/** Whether a context-menu entry is "Download", by icon class. */
export function hasDownloadIcon(menuItem: HTMLElement): boolean {
  if (NEGATIVE_TEXT.test(menuItem.textContent ?? '')) return false;
  if (hasDownloadClass(menuItem)) return true;
  return Array.from(menuItem.querySelectorAll(DOWNLOAD_ICON_SELECTOR)).some(
    hasDownloadClass,
  );
}

function hasDownloadText(menuItem: HTMLElement): boolean {
  const text = (menuItem.textContent ?? '').trim().toLowerCase();
  return DOWNLOAD_TEXT.test(text) && !NEGATIVE_TEXT.test(text);
}

/**
 * Picks the Download entry among visible context-menu items: icon class in an
 * open menu, icon anywhere, then (last resort) the item's leading word.
 */
export function findDownloadMenuItem(
  doc: Document,
  client: TelegramClient,
): HTMLElement | null {
  const selectors = selectorsFor(client);
  const all = Array.from(doc.querySelectorAll<HTMLElement>(selectors.contextMenuItem));
  const open = all.filter((el) => {
    const menu = el.closest<HTMLElement>(selectors.contextMenu);
    return menu !== null && OPEN_MENU_CLASS.test(menu.className);
  });
  return (
    open.find(hasDownloadIcon) ??
    all.find(hasDownloadIcon) ??
    open.find(hasDownloadText) ??
    all.find(hasDownloadText) ??
    null
  );
}

/** Generous: Telegram may fetch the whole file before handing it to Chrome. */
export function nativeExpectTimeoutMs(item: MediaItem): number {
  const bytes = item.byteSize ?? 0;
  return clamp(90_000 + (bytes / (200 * 1024)) * 1000, 90_000, 30 * 60_000);
}

/**
 * Downloads media through Telegram's own context-menu "Download" entry (full
 * quality, works for streamed video). Menu interaction is strictly serial and
 * rate-limited; with a tracker, the next item waits until the browser download
 * of the previous one has started (FIFO matching in the service worker), and
 * each call resolves only when its file is actually complete.
 */
export class NativeDownloadTrigger implements NativeDownloader {
  private chain: Promise<unknown> = Promise.resolve();
  private readonly limiter: RateLimiter | undefined;

  constructor(
    private readonly client: TelegramClient,
    private readonly doc: Document = document,
    private readonly logger?: ILogger,
    private readonly options: NativeDownloadOptions = {},
  ) {
    const { getSettings } = options;
    this.limiter =
      options.limiter ??
      (getSettings
        ? new RateLimiter({
            getDelayMs: () => getSettings().downloadDelayMs,
            getJitterMs: () => getSettings().downloadJitterMs,
          })
        : undefined);
  }

  async download(
    item: MediaItem,
    signal: AbortSignal,
    request?: NativeDownloadRequest,
  ): Promise<void> {
    const serial = this.chain.then(() => this.trigger(item, signal, request));
    // Hold the line until the browser download started (or failed).
    this.chain = serial.then((tracked) => tracked?.started).catch(() => undefined);

    const tracked = await serial;
    if (!tracked) return;
    const off = tracked.onProgress(({ bytesReceived, totalBytes }) => {
      request?.onProgress?.(
        totalBytes ? bytesReceived / totalBytes : Number.NaN,
        bytesReceived,
        totalBytes,
      );
    });
    try {
      await tracked.done;
    } finally {
      off();
    }
  }

  private async trigger(
    item: MediaItem,
    signal: AbortSignal,
    request?: NativeDownloadRequest,
  ): Promise<TrackedDownload | null> {
    if (signal.aborted) throw abortError();
    await this.limiter?.acquire(signal);

    const target = findMediaElement(this.doc, this.client, item);
    if (!target) {
      throw new NonRetryableDownloadError(
        'Media is not on screen — scroll to it in the chat, then retry this item.',
      );
    }
    target.scrollIntoView?.({ block: 'center', inline: 'nearest' });
    await nextFrame(this.doc.defaultView);
    if (signal.aborted) throw abortError();

    this.closeMenus();
    this.openContextMenu(target);
    const menuItem = await this.waitForDownloadItem(
      this.options.menuTimeoutMs ?? 1500,
      signal,
    );
    if (!menuItem) {
      this.closeMenus();
      throw new NonRetryableDownloadError(
        'Telegram offers no download for this item (it may be save-protected).',
      );
    }

    let tracked: TrackedDownload | null = null;
    const { tracker } = this.options;
    if (tracker && request) {
      tracked = tracker.expect(request.taskId, request.relativePath, {
        timeoutMs: nativeExpectTimeoutMs(item),
        signal,
      });
      try {
        await tracked.ready;
      } catch (error) {
        this.closeMenus();
        throw error;
      }
    }

    menuItem.click();
    this.logger?.debug(`Triggered native download for ${item.type} ${item.id}`);
    await nextFrame(this.doc.defaultView);
    this.closeMenus();
    return tracked;
  }

  private openContextMenu(target: HTMLElement): void {
    const rect = target.getBoundingClientRect();
    const clientX = rect.left + Math.min(rect.width / 2 || 10, 40);
    const clientY = rect.top + Math.min(rect.height / 2 || 10, 40);
    const view = this.doc.defaultView ?? undefined;
    target.dispatchEvent(
      new MouseEvent('contextmenu', {
        bubbles: true,
        cancelable: true,
        ...(view ? { view } : {}),
        clientX,
        clientY,
        button: 2,
      }),
    );
  }

  private async waitForDownloadItem(
    timeoutMs: number,
    signal: AbortSignal,
  ): Promise<HTMLElement | null> {
    const deadline = Date.now() + timeoutMs;
    for (;;) {
      const found = findDownloadMenuItem(this.doc, this.client);
      if (found) return found;
      if (Date.now() >= deadline) return null;
      await abortableDelay(50, signal);
    }
  }

  private openMenus(): HTMLElement[] {
    const { contextMenu } = selectorsFor(this.client);
    return Array.from(this.doc.querySelectorAll<HTMLElement>(contextMenu)).filter(
      (menu) => OPEN_MENU_CLASS.test(menu.className),
    );
  }

  /**
   * Closes a still-open menu the way a user would: a click on the menu's
   * backdrop, else on the page body (never Escape — that closes the chat —
   * and never by removing Telegram's own nodes).
   */
  private closeMenus(): void {
    if (this.openMenus().length === 0) return;
    const backdrop = this.doc.querySelector<HTMLElement>(
      '.btn-menu-overlay, .Menu .backdrop, .menu-container .backdrop',
    );
    const target = backdrop ?? this.doc.body;
    const view = this.doc.defaultView ?? undefined;
    for (const type of ['mousedown', 'mouseup', 'click'] as const) {
      target.dispatchEvent(
        new MouseEvent(type, {
          bubbles: true,
          cancelable: true,
          ...(view ? { view } : {}),
          clientX: 1,
          clientY: 1,
          button: 0,
        }),
      );
    }
  }
}
