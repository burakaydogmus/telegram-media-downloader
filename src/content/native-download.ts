import type { MediaItem, TelegramClient } from '../shared/types/index.js';
import { selectorsFor } from '../shared/constants/selectors.js';
import { delay } from '../shared/utils/index.js';
import { NonRetryableDownloadError } from '../features/download/index.js';
import type { NativeDownloader } from '../features/download/index.js';
import type { ILogger } from '../shared/logger/index.js';
export class NativeDownloadTrigger implements NativeDownloader {
  private chain: Promise<unknown> = Promise.resolve();

  constructor(
    private readonly client: TelegramClient,
    private readonly doc: Document = document,
    private readonly logger?: ILogger,
  ) {}

  async download(item: MediaItem, signal: AbortSignal): Promise<void> {
    const run = this.chain.then(() => this.runOne(item, signal));
    this.chain = run.catch(() => undefined);
    return run;
  }

  private async runOne(item: MediaItem, signal: AbortSignal): Promise<void> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const bubble = this.findBubble(item);
    if (!bubble) {
      throw new NonRetryableDownloadError(
        'Media is not on screen — scroll to it in the chat, then retry this item.',
      );
    }

    this.dismissMenu();
    this.openContextMenu(this.findTarget(bubble));

    const menuItem = await this.waitForDownloadItem(1500);
    if (!menuItem) {
      this.dismissMenu();
      throw new NonRetryableDownloadError(
        'Telegram offers no download for this item (it may be save-protected).',
      );
    }

    menuItem.click();
    this.logger?.debug(`Triggered native download for ${item.type} ${item.id}`);
    await delay(150);
    this.dismissMenu();
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
  }

  private findBubble(item: MediaItem): HTMLElement | null {
    const mid = item.messageId;
    if (mid) {
      const escaped = escapeAttrValue(mid);
      const byMid = this.doc.querySelector<HTMLElement>(
        `.bubble[data-mid="${escaped}"], [data-message-id="${escaped}"]`,
      );
      if (byMid) return byMid;
    }
    if (item.thumbnailUrl) {
      const img = this.doc.querySelector<HTMLElement>(
        `img[src="${escapeAttrValue(item.thumbnailUrl)}"]`,
      );
      const bubble = img?.closest<HTMLElement>('.bubble, .Message');
      if (bubble) return bubble;
    }
    return null;
  }

  private findTarget(bubble: HTMLElement): HTMLElement {
    return (
      bubble.querySelector<HTMLElement>(
        'video, .media-photo, .media-container, .attachment, .media-video, .document',
      ) ?? bubble
    );
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

  private async waitForDownloadItem(timeoutMs: number): Promise<HTMLElement | null> {
    const selectors = selectorsFor(this.client);
    const deadline = Date.now() + timeoutMs;
    while (Date.now() < deadline) {
      const items = this.doc.querySelectorAll<HTMLElement>(selectors.contextMenuItem);
      for (const item of items) {
        if (this.isDownloadItem(item)) return item;
      }
      await delay(60);
    }
    return null;
  }

  private isDownloadItem(item: HTMLElement): boolean {
    if (item.querySelector('[class*="download"], [class*="Download"]')) return true;
    const text = (item.textContent ?? '').trim().toLowerCase();
    return /\b(download|save)\b|i̇ndir|indir|kaydet/.test(text);
  }
  // Escape kapatır; Telegram'da global Escape açık sohbeti de kapatır.
  private dismissMenu(): void {
    const selectors = selectorsFor(this.client);
    this.doc.querySelectorAll(selectors.contextMenu).forEach((menu) => menu.remove());
  }
}

function escapeAttrValue(value: string): string {
  return value.replace(/["\\]/g, '\\$&');
}
