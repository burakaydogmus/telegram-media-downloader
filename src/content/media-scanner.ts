import type { MediaItem, MediaType, TelegramClient } from '../shared/types/index.js';
import { selectorsFor, type ClientSelectors } from '../shared/constants/selectors.js';
import { hashString, parseSizeLabel, sanitizeText } from '../shared/utils/index.js';
import { ScanError, toMessage } from '../shared/errors/index.js';
import type { ILogger } from '../shared/logger/index.js';

export interface ScanResult {
  readonly items: readonly MediaItem[];
  readonly scannedNodes: number;
  readonly durationMs: number;
}

export class MediaScanner {
  private readonly seenAttr = 'data-tgmd-seen';

  constructor(
    private readonly client: TelegramClient,
    private readonly doc: Document = document,
    private readonly logger?: ILogger,
  ) {}

  scan(roots?: readonly Element[], force = false): ScanResult {
    const started = performance.now();
    const selectors = selectorsFor(this.client);
    const scopes = this.resolveScopes(roots, selectors);

    const items: MediaItem[] = [];
    const dedupe = new Set<string>();
    let scannedNodes = 0;

    try {
      for (const scope of scopes) {
        for (const { type, selector } of this.typeSelectors(selectors)) {
          for (const element of this.collect(scope, selector)) {
            scannedNodes += 1;
            if (!force && element.getAttribute(this.seenAttr) === '1') continue;
            element.setAttribute(this.seenAttr, '1');

            const item = this.extract(element, type);
            if (item && !dedupe.has(item.id)) {
              dedupe.add(item.id);
              items.push(item);
            }
          }
        }
      }
    } catch (error) {
      throw new ScanError(`Scan failed: ${toMessage(error)}`, {
        cause: error,
        userMessageKey: 'error_scan_failed',
      });
    }

    const durationMs = performance.now() - started;
    this.logger?.debug(
      `Scanned ${scannedNodes} node(s), found ${items.length} item(s) in ${durationMs.toFixed(1)}ms`,
    );
    return { items, scannedNodes, durationMs };
  }

  resetSeen(): void {
    for (const el of this.doc.querySelectorAll(`[${this.seenAttr}]`)) {
      el.removeAttribute(this.seenAttr);
    }
  }

  private collect(scope: ParentNode, selector: string): HTMLElement[] {
    const found: HTMLElement[] = [];
    if (scope instanceof HTMLElement && scope.matches(selector)) {
      found.push(scope);
    }
    found.push(...scope.querySelectorAll<HTMLElement>(selector));
    return found;
  }

  private resolveScopes(
    roots: readonly Element[] | undefined,
    selectors: ClientSelectors,
  ): readonly ParentNode[] {
    if (roots && roots.length > 0) return roots;
    const container = this.doc.querySelector(selectors.messageContainer);
    return [container ?? this.doc];
  }

  private typeSelectors(
    selectors: ClientSelectors,
  ): ReadonlyArray<{ type: MediaType; selector: string }> {
    // Order matters: more specific types (gif/audio) are matched before the
    // broader photo/video selectors to reduce mis-classification.
    return [
      { type: 'gif', selector: selectors.gif },
      { type: 'audio', selector: selectors.audio },
      { type: 'document', selector: selectors.document },
      { type: 'video', selector: selectors.video },
      { type: 'photo', selector: selectors.photo },
    ];
  }

  private extract(element: HTMLElement, type: MediaType): MediaItem | null {
    const url = this.extractMediaUrl(element, type);
    const thumbnailUrl = this.extractThumbnail(element) ?? url;
    const message = element.closest('[data-mid], [data-message-id], .Message, .bubble');

    const fileName = this.extractFileName(element, type, url);
    const sizeLabel = this.extractSize(element);
    const byteSize = sizeLabel ? parseSizeLabel(sizeLabel) : undefined;
    const { date, timestamp } = this.extractDate(message);
    const messageId = this.extractMessageId(message);
    const peerId = this.extractPeerId();

    const signature = [
      type,
      url ?? '',
      messageId ?? '',
      fileName ?? '',
      peerId ?? '',
    ].join('|');
    // Skip pure-noise elements that carry no identifying signal at all.
    if (signature === `${type}||||`) return null;
    const id = hashString(signature);

    const item: MediaItem = {
      id,
      type,
      ...(fileName !== undefined ? { fileName } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(sizeLabel !== undefined ? { size: sizeLabel } : {}),
      ...(messageId !== undefined ? { messageId } : {}),
      ...(url !== undefined ? { url } : {}),
      ...(thumbnailUrl !== undefined ? { thumbnailUrl } : {}),
      ...(byteSize !== undefined ? { byteSize } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
      ...(peerId !== undefined ? { peerId } : {}),
    };
    return item;
  }

  private extractMediaUrl(element: HTMLElement, type: MediaType): string | undefined {
    switch (type) {
      case 'photo':
        return this.imageUrl(element);
      case 'video':
      case 'gif':
        return this.videoUrl(element);
      case 'audio':
        return this.audioUrl(element);
      case 'document':
        return this.documentUrl(element);
      default:
        return undefined;
    }
  }

  private imageUrl(element: HTMLElement): string | undefined {
    if (element instanceof HTMLImageElement && element.src) return element.src;
    const img = element.querySelector<HTMLImageElement>('img[src]');
    if (img?.src) return img.src;
    return this.backgroundUrl(element);
  }

  private videoUrl(element: HTMLElement): string | undefined {
    const video =
      element instanceof HTMLVideoElement
        ? element
        : element.querySelector<HTMLVideoElement>('video');
    if (!video) return undefined;
    if (video.src) return video.src;
    const source = video.querySelector<HTMLSourceElement>('source[src]');
    return source?.src ?? undefined;
  }

  private audioUrl(element: HTMLElement): string | undefined {
    const audio =
      element instanceof HTMLAudioElement
        ? element
        : element.querySelector<HTMLAudioElement>('audio');
    if (!audio) return undefined;
    if (audio.src) return audio.src;
    const source = audio.querySelector<HTMLSourceElement>('source[src]');
    return source?.src ?? undefined;
  }

  private documentUrl(element: HTMLElement): string | undefined {
    const link = element.querySelector<HTMLAnchorElement>('a[href]');
    if (link?.href) return link.href;
    const media = element.querySelector<HTMLMediaElement>('audio[src], video[src]');
    if (media?.src) return media.src;
    const source = element.querySelector<HTMLSourceElement>('source[src]');
    return source?.src ?? undefined;
  }

  private extractThumbnail(element: HTMLElement): string | undefined {
    if (element instanceof HTMLImageElement && element.src) return element.src;
    const img = element.querySelector<HTMLImageElement>('img[src]');
    if (img?.src) return img.src;
    const video =
      element instanceof HTMLVideoElement
        ? element
        : element.querySelector<HTMLVideoElement>('video');
    if (video?.poster) return video.poster;
    return this.backgroundUrl(element);
  }

  private backgroundUrl(element: HTMLElement): string | undefined {
    const bg = element.style.backgroundImage;
    const match = bg ? /url\(["']?(.*?)["']?\)/.exec(bg) : null;
    return match?.[1] ?? undefined;
  }

  private extractFileName(
    element: HTMLElement,
    type: MediaType,
    url: string | undefined,
  ): string | undefined {
    const nameNode = element.querySelector(
      '.document-name, .file-name, .name, .File-name',
    );
    const text = nameNode?.textContent ? sanitizeText(nameNode.textContent) : '';
    if (text.length > 0) return text;

    if (url) {
      try {
        const parsed = new URL(url, this.doc.baseURI);
        const last = parsed.pathname.split('/').filter(Boolean).pop();
        if (last && /\.[a-z0-9]{2,5}$/i.test(last)) {
          return decodeURIComponent(last);
        }
      } catch {
        // Blob/relative URL with no usable name; fall through to default.
      }
    }
    return type === 'document' ? undefined : `${type}.${defaultExtension(type)}`;
  }

  private extractSize(element: HTMLElement): string | undefined {
    const sizeNode = element.querySelector(
      '.document-size, .file-size, .size, .File-size',
    );
    const text = sizeNode?.textContent ? sanitizeText(sizeNode.textContent) : '';
    if (text.length > 0 && parseSizeLabel(text) !== undefined) return text;
    return undefined;
  }

  private extractDate(message: Element | null): {
    date?: string;
    timestamp?: number;
  } {
    if (!message) return {};
    const timeNode = message.querySelector<HTMLElement>('time, .time, [data-timestamp]');
    if (!timeNode) return {};

    const raw =
      timeNode.getAttribute('datetime') ??
      timeNode.getAttribute('data-timestamp') ??
      timeNode.title ??
      '';
    if (raw.length === 0) return {};

    const numeric = Number(raw);
    if (Number.isFinite(numeric) && numeric > 0) {
      // Telegram timestamps are seconds; normalise to ms.
      const ms = numeric < 1e12 ? numeric * 1000 : numeric;
      return { date: new Date(ms).toISOString(), timestamp: ms };
    }
    const parsed = Date.parse(raw);
    if (Number.isFinite(parsed)) {
      return { date: new Date(parsed).toISOString(), timestamp: parsed };
    }
    return {};
  }

  private extractMessageId(message: Element | null): string | undefined {
    if (!message) return undefined;
    return (
      message.getAttribute('data-mid') ??
      message.getAttribute('data-message-id') ??
      (message.id || undefined)
    );
  }

  private extractPeerId(): string | undefined {
    const hash = this.doc.location?.hash ?? '';
    const match = /#?-?\d+/.exec(hash);
    return match?.[0]?.replace('#', '') ?? undefined;
  }
}

function defaultExtension(type: MediaType): string {
  switch (type) {
    case 'photo':
      return 'jpg';
    case 'video':
      return 'mp4';
    case 'gif':
      return 'mp4';
    case 'audio':
      return 'ogg';
    case 'document':
      return 'bin';
    default:
      return 'bin';
  }
}
