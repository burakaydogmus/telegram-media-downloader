import type { TelegramClient } from '../../shared/types/index.js';
import { selectorsFor } from '../../shared/constants/selectors.js';

export interface MessageMarker {
  readonly id: string;
  readonly timestamp?: number;
}

const WEBK_MESSAGE = '.bubble[data-mid]';
const WEBA_MESSAGE = '[id^="message-"], [data-message-id]';
const WEBK_SCROLLER_HINTS = '.scrollable-y, .scrollable';

export function findMessageContainer(
  doc: Document,
  client: TelegramClient,
): HTMLElement | null {
  return doc.querySelector<HTMLElement>(selectorsFor(client).messageContainer);
}

function isScrollable(el: HTMLElement): boolean {
  if (el.scrollHeight <= el.clientHeight) return false;
  const view = el.ownerDocument.defaultView;
  const overflowY = view ? view.getComputedStyle(el).overflowY : '';
  return overflowY === 'auto' || overflowY === 'scroll' || overflowY === 'overlay';
}

/**
 * Web K scrolls a `.scrollable` inside `.bubbles`; Web A scrolls `.MessageList`
 * itself. Prefer an element that is measurably scrollable, then fall back to the
 * client's known shape (layout metrics may be unavailable, e.g. hidden tabs).
 */
export function findScroller(
  container: HTMLElement,
  client: TelegramClient,
): HTMLElement {
  const inner = [...container.querySelectorAll<HTMLElement>(WEBK_SCROLLER_HINTS)];
  const candidates: HTMLElement[] =
    client === 'weba' ? [container, ...inner] : [...inner, container];
  for (let el = container.parentElement; el; el = el.parentElement) candidates.push(el);

  const measured = candidates.find(isScrollable);
  if (measured) return measured;
  if (client === 'weba') return container;
  return (
    container.querySelector<HTMLElement>('.scrollable-y') ??
    container.querySelector<HTMLElement>('.scrollable') ??
    container
  );
}

function messageId(el: Element, client: TelegramClient): string | undefined {
  const mid = el.getAttribute('data-mid') ?? el.getAttribute('data-message-id');
  if (mid) return mid;
  if (client !== 'webk' && el.id.startsWith('message-')) {
    return el.id.slice('message-'.length);
  }
  return undefined;
}

function toEpochMs(value: number): number | undefined {
  if (!Number.isFinite(value) || value <= 0) return undefined;
  // Telegram stores unix seconds; anything below 1e12 cannot be milliseconds.
  return value < 1e12 ? value * 1000 : value;
}

export function parseTimestamp(el: Element): number | undefined {
  const raw = el.getAttribute('data-timestamp');
  if (raw) {
    const parsed = toEpochMs(Number(raw));
    if (parsed !== undefined) return parsed;
  }
  const timeEl = el.querySelector('time[datetime], [data-timestamp]');
  const nested =
    timeEl?.getAttribute('datetime') ?? timeEl?.getAttribute('data-timestamp');
  if (nested) {
    const numeric = Number(nested);
    const parsed = Number.isNaN(numeric) ? Date.parse(nested) : toEpochMs(numeric);
    if (parsed !== undefined && !Number.isNaN(parsed)) return parsed;
  }
  // Web A puts the full date in the title of `.message-time`.
  const title = el.querySelector('.message-time[title]')?.getAttribute('title');
  if (title) {
    const parsed = Date.parse(title);
    if (!Number.isNaN(parsed)) return parsed;
  }
  return undefined;
}

/** True when `candidate` is strictly older than `reference` (numeric ids only). */
export function isOlderId(candidate: string, reference: string): boolean {
  const a = Number(candidate);
  const b = Number(reference);
  return Number.isFinite(a) && Number.isFinite(b) && a < b;
}

/**
 * Oldest rendered message: smallest positive numeric id (ids grow monotonically
 * within a chat). Non-numeric ids (e.g. `message-list`) are ignored.
 */
export function readOldestMessage(
  container: ParentNode,
  client: TelegramClient,
): MessageMarker | undefined {
  const selector = client === 'weba' ? WEBA_MESSAGE : `${WEBK_MESSAGE}, ${WEBA_MESSAGE}`;
  let oldest: { id: string; el: Element } | undefined;
  let minTimestamp: number | undefined;

  for (const el of container.querySelectorAll(selector)) {
    const id = messageId(el, client);
    if (!id) continue;
    const numeric = Number(id);
    if (!Number.isFinite(numeric) || numeric <= 0) continue;
    const ts = parseTimestamp(el);
    if (ts !== undefined && (minTimestamp === undefined || ts < minTimestamp)) {
      minTimestamp = ts;
    }
    if (!oldest || isOlderId(id, oldest.id)) oldest = { id, el };
  }

  if (!oldest) return undefined;
  const timestamp = parseTimestamp(oldest.el) ?? minTimestamp;
  return timestamp === undefined ? { id: oldest.id } : { id: oldest.id, timestamp };
}
