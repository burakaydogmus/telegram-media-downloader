import type {
  MediaItem,
  MediaItemPatch,
  MediaType,
  TelegramClient,
} from '../shared/types/index.js';
import { selectorsFor, type ClientSelectors } from '../shared/constants/selectors.js';
import {
  mediaIdFromKey,
  mediaKey,
  parseSizeLabel,
  sanitizeText,
} from '../shared/utils/index.js';
import { ScanError, toMessage } from '../shared/errors/index.js';
import type { ILogger } from '../shared/logger/index.js';
import { currentChatTitle, currentPeerId } from './peer.js';

export interface ScanUpdate {
  readonly id: string;
  readonly patch: MediaItemPatch;
}

export interface ScanResult {
  /** Items never emitted before (or re-emitted after `resetSeen()` / `force`). */
  readonly items: readonly MediaItem[];
  /** Changes (better URL, size, date…) for items emitted by an earlier scan. */
  readonly updates: readonly ScanUpdate[];
  readonly scannedNodes: number;
  readonly durationMs: number;
}

interface ScanContext {
  readonly peerId: string | undefined;
  readonly chatTitle: string | undefined;
}

/** One classifiable media slot: a whole message or one album item. */
interface MediaUnit {
  readonly element: Element;
  readonly message: Element;
  readonly albumIndex: number;
  readonly messageId: string | undefined;
}

interface Extracted {
  readonly item: MediaItem;
  readonly urlRank: number;
  readonly thumbRank: number;
}

interface UrlCandidate {
  readonly url: string;
  readonly rank: number;
}

type MutablePatch = { -readonly [K in keyof MediaItemPatch]: MediaItemPatch[K] };

const PATCHABLE_FIELDS = [
  'fileName',
  'size',
  'byteSize',
  'date',
  'timestamp',
  'chatTitle',
  'mimeType',
] as const satisfies ReadonlyArray<keyof MediaItemPatch>;

const SIZE_PATTERN = /(\d[\d.,\u00a0\u202f]*)\s*(TB|GB|MB|KB|B)\b/gi;

export class MediaScanner {
  private seen = new WeakSet<Element>();
  private readonly emitted = new Map<string, EmittedEntry>();
  private generation = 0;
  private readonly selectors: ClientSelectors;
  private readonly dates: MessageDateReader;

  constructor(
    private readonly client: TelegramClient,
    private readonly doc: Document = document,
    private readonly logger?: ILogger,
  ) {
    this.selectors = selectorsFor(client);
    this.dates = new MessageDateReader(this.selectors, (el, msg) =>
      this.isIgnored(el, msg),
    );
  }

  /**
   * Without `roots` scans the whole message list, skipping units already seen.
   * With `roots` (mutation roots) re-extracts every message they touch and
   * reports changes of known items as `updates` instead of duplicates.
   */
  scan(roots?: readonly Element[], force = false): ScanResult {
    const started = performance.now();
    const context: ScanContext = {
      peerId: currentPeerId(this.doc, this.client),
      chatTitle: currentChatTitle(this.doc, this.client),
    };
    const batch = new ScanBatch(this.emitted, this.generation, force);
    const incremental = roots !== undefined && roots.length > 0;
    let scannedNodes = 0;

    try {
      const messages = incremental ? this.messagesFrom(roots) : this.allMessages();
      for (const message of messages) {
        if (message.matches(this.selectors.skipMessage)) continue;
        for (const unit of this.unitsOf(message)) {
          scannedNodes += 1;
          if (!incremental && !force && this.seen.has(unit.element)) continue;
          this.seen.add(unit.element);
          const extracted = this.extract(unit, context);
          if (extracted) batch.record(extracted);
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
      `Scanned ${scannedNodes} unit(s): ${batch.items.length} new, ${batch.updates.length} updated in ${durationMs.toFixed(1)}ms`,
    );
    return { items: batch.items, updates: batch.updates, scannedNodes, durationMs };
  }

  resetSeen(): void {
    this.seen = new WeakSet<Element>();
    // Known items are re-emitted on the next scan, with updates for any changes.
    this.generation += 1;
  }

  // ---------------------------------------------------------------- messages

  private allMessages(): Element[] {
    const active = this.doc.querySelectorAll(this.selectors.activeMessageContainer);
    const containers =
      active.length > 0
        ? active
        : this.doc.querySelectorAll(this.selectors.messageContainer);
    const messages = new Set<Element>();
    for (const container of containers) {
      for (const message of container.querySelectorAll(this.selectors.messageBubble)) {
        if (this.inMessageList(message)) messages.add(message);
      }
    }
    return [...messages];
  }

  private messagesFrom(roots: readonly Element[]): Element[] {
    const messages = new Set<Element>();
    for (const root of roots) {
      const owner = root.closest(this.selectors.messageBubble);
      if (owner) {
        if (this.inMessageList(owner)) messages.add(owner);
        continue;
      }
      for (const message of root.querySelectorAll(this.selectors.messageBubble)) {
        if (this.inMessageList(message)) messages.add(message);
      }
    }
    return [...messages];
  }

  private inMessageList(message: Element): boolean {
    return (
      message.closest(this.selectors.messageContainer) !== null &&
      message.closest(this.selectors.exclude) === null
    );
  }

  private unitsOf(message: Element): MediaUnit[] {
    const albumItems = outermost(
      this.findAll(message, message, this.selectors.albumItem),
    );
    const messageId = messageIdOf(message);
    if (albumItems.length === 0) {
      return [{ element: message, message, albumIndex: 0, messageId }];
    }
    return albumItems.map((element, albumIndex) => ({
      element,
      message,
      albumIndex,
      messageId: messageIdOf(element) ?? messageId,
    }));
  }

  // ---------------------------------------------------------- classification

  private classify(unit: MediaUnit): MediaType | undefined {
    const s = this.selectors;
    const order: ReadonlyArray<readonly [string, MediaType]> = [
      [s.roundVideo, 'video'],
      [s.gif, 'gif'],
      [s.audio, 'audio'],
      [s.document, 'document'],
      [s.video, 'video'],
      [s.photo, 'photo'],
    ];
    for (const [selector, type] of order) {
      if (this.findAll(unit.element, unit.message, selector).length > 0) return type;
    }
    return undefined;
  }

  private findAll(scope: Element, message: Element, selector: string): Element[] {
    const found: Element[] = [];
    if (scope.matches(selector)) found.push(scope);
    found.push(...scope.querySelectorAll(selector));
    return found.filter((el) => !this.isIgnored(el, message));
  }

  private isIgnored(el: Element, message: Element): boolean {
    const ignored = el.closest(this.selectors.ignore);
    return ignored !== null && ignored !== message && message.contains(ignored);
  }

  // -------------------------------------------------------------- extraction

  private extract(unit: MediaUnit, context: ScanContext): Extracted | null {
    const type = this.classify(unit);
    if (!type) return null;

    const main = pickBest(this.mediaCandidates(unit, type));
    const thumb = pickBest(this.thumbnailCandidates(unit, type)) ?? main;
    const url = main?.url;
    const domName = this.textOf(unit, this.selectors.fileName);
    const fileName =
      domName ?? fileNameFromUrl(url, this.doc.baseURI) ?? defaultName(type);
    const size = this.sizeLabel(unit);
    const byteSize = size !== undefined ? parseSizeLabel(size) : undefined;
    const { date, timestamp } = this.dates.read(unit.element, unit.message);

    const id = this.identify(unit, type, context, [
      domName ?? '',
      size ?? '',
      timestamp !== undefined ? String(timestamp) : '',
      sanitizeText(unit.element.textContent ?? '').slice(0, 120),
    ]);
    const fallbackUrl = url && !url.startsWith('data:') ? url : undefined;
    const resolvedId =
      id ?? (fallbackUrl ? mediaIdFromKey(`url|${fallbackUrl}`) : undefined);
    if (!resolvedId) return null;

    const item: MediaItem = {
      id: resolvedId,
      type,
      ...(fileName !== undefined ? { fileName } : {}),
      ...(date !== undefined ? { date } : {}),
      ...(size !== undefined ? { size } : {}),
      ...(unit.messageId !== undefined ? { messageId: unit.messageId } : {}),
      albumIndex: unit.albumIndex,
      ...(url !== undefined ? { url } : {}),
      ...(thumb !== undefined ? { thumbnailUrl: thumb.url } : {}),
      ...(byteSize !== undefined ? { byteSize } : {}),
      ...(timestamp !== undefined ? { timestamp } : {}),
      ...(context.peerId !== undefined ? { peerId: context.peerId } : {}),
      ...(context.chatTitle !== undefined ? { chatTitle: context.chatTitle } : {}),
    };
    return { item, urlRank: main?.rank ?? 0, thumbRank: thumb?.rank ?? 0 };
  }

  /** Stable id from the media key; falls back to a DOM signature (never the URL). */
  private identify(
    unit: MediaUnit,
    type: MediaType,
    context: ScanContext,
    signals: readonly string[],
  ): string | undefined {
    const key = mediaKey({
      peerId: context.peerId,
      messageId: unit.messageId,
      albumIndex: unit.albumIndex,
      type,
    });
    if (key) return mediaIdFromKey(key);
    if (signals.every((signal) => signal.length === 0)) return undefined;
    return mediaIdFromKey(
      ['dom', context.peerId ?? '_', type, unit.albumIndex, ...signals].join('|'),
    );
  }

  private mediaCandidates(unit: MediaUnit, type: MediaType): UrlCandidate[] {
    switch (type) {
      case 'photo':
        return this.imageCandidates(unit, this.selectors.photo);
      case 'video':
      case 'gif':
        return this.sourceCandidates(unit, 'video');
      case 'audio':
        return this.sourceCandidates(unit, 'audio');
      case 'document':
        return [
          ...this.findAll(unit.element, unit.message, 'a[href]').flatMap((el) =>
            candidate((el as HTMLAnchorElement).href, el),
          ),
          ...this.sourceCandidates(unit, 'audio, video'),
        ];
      default:
        return [];
    }
  }

  private thumbnailCandidates(unit: MediaUnit, type: MediaType): UrlCandidate[] {
    const images = this.imageCandidates(unit, `${this.selectors.photo}, img`);
    if (type !== 'video' && type !== 'gif') return images;
    const posters = this.findAll(unit.element, unit.message, 'video[poster]').flatMap(
      (el) => candidate((el as HTMLVideoElement).poster, el),
    );
    return [...posters, ...images];
  }

  private imageCandidates(unit: MediaUnit, selector: string): UrlCandidate[] {
    return this.findAll(unit.element, unit.message, selector).flatMap((el) => {
      if (el instanceof HTMLImageElement) return candidate(el.src, el);
      return candidate(backgroundUrl(el), el);
    });
  }

  private sourceCandidates(unit: MediaUnit, mediaSelector: string): UrlCandidate[] {
    return this.findAll(unit.element, unit.message, mediaSelector).flatMap((el) => {
      const media = el as HTMLMediaElement;
      const sources = [...el.querySelectorAll<HTMLSourceElement>('source[src]')];
      return [
        ...candidate(media.src || el.getAttribute('src') || undefined, el),
        ...sources.flatMap((source) => candidate(source.src, el)),
      ];
    });
  }

  private textOf(unit: MediaUnit, selector: string): string | undefined {
    for (const node of this.findAll(unit.element, unit.message, selector)) {
      const text = sanitizeText(node.textContent ?? '').replace(/\s+/g, ' ');
      if (text.length > 0) return text;
    }
    return undefined;
  }

  private sizeLabel(unit: MediaUnit): string | undefined {
    for (const node of this.findAll(
      unit.element,
      unit.message,
      this.selectors.fileSize,
    )) {
      const matches = sanitizeText(node.textContent ?? '').match(SIZE_PATTERN);
      const label = matches?.[matches.length - 1]?.trim();
      if (label && parseSizeLabel(label) !== undefined) return label;
    }
    return undefined;
  }
}

interface EmittedEntry {
  readonly extracted: Extracted;
  /** `resetSeen()` generation in which the item was last handed out as an item. */
  readonly generation: number;
}

/** Accumulates one scan's output, diffing against previously emitted items. */
class ScanBatch {
  readonly items: MediaItem[] = [];
  readonly updates: ScanUpdate[] = [];
  private readonly itemIndex = new Map<string, number>();

  constructor(
    private readonly emitted: Map<string, EmittedEntry>,
    private readonly generation: number,
    private readonly force: boolean,
  ) {}

  record(next: Extracted): void {
    const id = next.item.id;
    const previous = this.emitted.get(id);
    if (!previous) {
      this.emitted.set(id, { extracted: next, generation: this.generation });
      this.pushItem(next.item);
      return;
    }

    const patch = diff(previous.extracted, next);
    const merged = patch
      ? mergeExtracted(previous.extracted, next, patch)
      : previous.extracted;
    this.emitted.set(id, { extracted: merged, generation: this.generation });

    const index = this.itemIndex.get(id);
    if (index !== undefined) {
      this.items[index] = merged.item;
      return;
    }
    if (this.force || previous.generation !== this.generation) this.pushItem(merged.item);
    if (patch) this.updates.push({ id, patch });
  }

  private pushItem(item: MediaItem): void {
    this.itemIndex.set(item.id, this.items.length);
    this.items.push(item);
  }
}

function diff(previous: Extracted, next: Extracted): MediaItemPatch | null {
  const patch: MutablePatch = {};
  const before = previous.item;
  const after = next.item;
  if (after.url && after.url !== before.url && next.urlRank >= previous.urlRank) {
    patch.url = after.url;
  }
  if (
    after.thumbnailUrl &&
    after.thumbnailUrl !== before.thumbnailUrl &&
    next.thumbRank >= previous.thumbRank
  ) {
    patch.thumbnailUrl = after.thumbnailUrl;
  }
  const target = patch as Record<string, unknown>;
  for (const field of PATCHABLE_FIELDS) {
    const value = after[field];
    if (value !== undefined && value !== before[field]) target[field] = value;
  }
  return Object.keys(patch).length > 0 ? patch : null;
}

function mergeExtracted(
  previous: Extracted,
  next: Extracted,
  patch: MediaItemPatch,
): Extracted {
  return {
    item: { ...previous.item, ...patch, id: previous.item.id },
    urlRank: patch.url !== undefined ? next.urlRank : previous.urlRank,
    thumbRank: patch.thumbnailUrl !== undefined ? next.thumbRank : previous.thumbRank,
  };
}

// ------------------------------------------------------------------ helpers

function messageIdOf(el: Element): string | undefined {
  const direct = el.getAttribute('data-mid') ?? el.getAttribute('data-message-id');
  if (direct && direct.trim().length > 0) return direct.trim();
  const fromId = /message-?(\d+(?:\.\d+)?)$/.exec(el.id);
  if (fromId?.[1]) return fromId[1];
  // Web A album items wrap the media element that carries the id.
  const inner = el.querySelector('[id*="message"]');
  const nested = inner ? /message-?(\d+(?:\.\d+)?)$/.exec(inner.id) : null;
  return nested?.[1] ?? undefined;
}

function outermost(elements: readonly Element[]): Element[] {
  return elements.filter(
    (el) => !elements.some((other) => other !== el && other.contains(el)),
  );
}

/** blob:/http(s) beat data:, full-size beats thumbnail-looking elements. */
function candidate(url: string | undefined, source: Element): UrlCandidate[] {
  if (!url) return [];
  const scheme = urlSchemeRank(url);
  if (scheme === 0) return [];
  const thumbLike = /thumb|blur|preview|poster/i.test(source.getAttribute('class') ?? '');
  return [{ url, rank: scheme * 2 + (thumbLike ? 0 : 1) }];
}

function urlSchemeRank(url: string): number {
  if (/^(https?:|blob:)/i.test(url)) return 2;
  if (/^data:/i.test(url)) return 1;
  return 0;
}

function pickBest(candidates: readonly UrlCandidate[]): UrlCandidate | undefined {
  let best: UrlCandidate | undefined;
  for (const c of candidates) {
    if (!best || c.rank > best.rank) best = c;
  }
  return best;
}

function backgroundUrl(element: Element): string | undefined {
  const bg = (element as HTMLElement).style?.backgroundImage;
  const match = bg ? /url\(["']?(.*?)["']?\)/.exec(bg) : null;
  return match?.[1] || undefined;
}

function fileNameFromUrl(url: string | undefined, base: string): string | undefined {
  if (!url || !/^https?:/i.test(url)) return undefined;
  try {
    const last = new URL(url, base).pathname.split('/').filter(Boolean).pop();
    if (last && /\.[a-z0-9]{2,5}$/i.test(last)) return decodeURIComponent(last);
  } catch {
    // Malformed URL: no usable name.
  }
  return undefined;
}

function defaultName(type: MediaType): string | undefined {
  switch (type) {
    case 'photo':
      return 'photo.jpg';
    case 'video':
      return 'video.mp4';
    case 'gif':
      return 'gif.mp4';
    case 'audio':
      return 'audio.ogg';
    default:
      return undefined;
  }
}

// -------------------------------------------------------------------- dates

interface DateParts {
  readonly date?: string;
  readonly timestamp?: number;
}

interface Day {
  readonly year: number;
  readonly month: number;
  readonly day: number;
}

interface TimeOfDay {
  readonly hours: number;
  readonly minutes: number;
  readonly seconds: number;
}

const MONTHS = [
  'jan',
  'feb',
  'mar',
  'apr',
  'may',
  'jun',
  'jul',
  'aug',
  'sep',
  'oct',
  'nov',
  'dec',
] as const;
const MONTH_RE = '(jan|feb|mar|apr|may|jun|jul|aug|sep|oct|nov|dec)[a-z]*\\.?';
const MONTH_FIRST = new RegExp(
  `\\b${MONTH_RE}\\s+(\\d{1,2})(?:st|nd|rd|th)?\\b(?:,?\\s+(\\d{4}))?`,
  'i',
);
const DAY_FIRST = new RegExp(
  `\\b(\\d{1,2})(?:st|nd|rd|th)?\\s+${MONTH_RE}(?:,?\\s+(\\d{4}))?`,
  'i',
);
const ISO_DAY = /\b(\d{4})-(\d{1,2})-(\d{1,2})(?!\d)/;
const NUMERIC_DAY = /\b(\d{1,2})([./])(\d{1,2})\2(\d{2,4})\b/;
const TIME_OF_DAY = /\b(\d{1,2}):(\d{2})(?::(\d{2}))?(?:\s*([ap])\.?\s?m\.?(?![a-z]))?/i;

/**
 * Reads a message's date: own attributes → stamped descendants → the time
 * node's title → time text combined with the day-group header. Localised
 * strings that cannot be parsed deterministically yield no date.
 */
export class MessageDateReader {
  constructor(
    private readonly selectors: ClientSelectors,
    private readonly isIgnored: (el: Element, message: Element) => boolean,
    private readonly now: () => Date = () => new Date(),
  ) {}

  read(unit: Element, message: Element): DateParts {
    for (const el of new Set([unit, message])) {
      const own = attributeTimestamp(el);
      if (own !== undefined) return toParts(own);
    }

    const stamped = this.first(message, '[data-timestamp], time[datetime]');
    const fromStamp = stamped ? attributeTimestamp(stamped) : undefined;
    if (fromStamp !== undefined) return toParts(fromStamp);

    const timeNode = this.first(message, this.selectors.time);
    const title = timeNode?.getAttribute('title') ?? '';
    const titleDay = parseDay(title, this.now());
    if (titleDay) return toParts(compose(titleDay, parseTimeOfDay(title)));

    const day = this.groupDay(message);
    if (!day) return {};
    return toParts(compose(day, parseTimeOfDay(timeNode?.textContent ?? '')));
  }

  private groupDay(message: Element): Day | undefined {
    const group = message.closest(this.selectors.dateGroup);
    if (!group) return undefined;
    const header = group.querySelector(this.selectors.dateGroupHeader);
    const stamp =
      attributeTimestamp(group) ??
      (header ? attributeTimestamp(header) : undefined) ??
      (header ? stampedDescendant(header) : undefined);
    if (stamp !== undefined) {
      const d = new Date(stamp);
      return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
    }
    return parseDay(header?.textContent ?? '', this.now());
  }

  private first(message: Element, selector: string): Element | undefined {
    for (const el of message.querySelectorAll(selector)) {
      if (!this.isIgnored(el, message)) return el;
    }
    return undefined;
  }
}

function stampedDescendant(el: Element): number | undefined {
  const node = el.querySelector('[data-timestamp], time[datetime]');
  return node ? attributeTimestamp(node) : undefined;
}

function attributeTimestamp(el: Element): number | undefined {
  const raw = (
    el.getAttribute('data-timestamp') ??
    el.getAttribute('datetime') ??
    ''
  ).trim();
  if (raw.length === 0) return undefined;
  if (/^\d+(\.\d+)?$/.test(raw)) {
    const numeric = Number(raw);
    if (!Number.isFinite(numeric) || numeric <= 0) return undefined;
    // Telegram timestamps are seconds; normalise to ms.
    return numeric < 1e12 ? numeric * 1000 : numeric;
  }
  // `datetime` is machine-readable (ISO 8601), unlike localised labels.
  if (!/^\d{4}-\d{2}-\d{2}/.test(raw)) return undefined;
  const parsed = Date.parse(raw);
  return Number.isFinite(parsed) ? parsed : undefined;
}

function toParts(timestamp: number | undefined): DateParts {
  if (timestamp === undefined || !Number.isFinite(timestamp)) return {};
  return { date: new Date(timestamp).toISOString(), timestamp };
}

function compose(day: Day, time: TimeOfDay | undefined): number | undefined {
  const value = new Date(
    day.year,
    day.month - 1,
    day.day,
    time?.hours ?? 0,
    time?.minutes ?? 0,
    time?.seconds ?? 0,
  );
  const valid =
    value.getFullYear() === day.year &&
    value.getMonth() === day.month - 1 &&
    value.getDate() === day.day;
  return valid ? value.getTime() : undefined;
}

/** Parses the calendar day out of free text (ISO, numeric, English month names). */
export function parseDay(text: string, now: Date): Day | undefined {
  const input = text.trim();
  if (input.length === 0) return undefined;

  const iso = ISO_DAY.exec(input);
  if (iso) return makeDay(Number(iso[1]), Number(iso[2]), Number(iso[3]));

  const numeric = NUMERIC_DAY.exec(input);
  if (numeric) {
    const first = Number(numeric[1]);
    const second = Number(numeric[3]);
    const year = normaliseYear(Number(numeric[4]));
    // `.` is day-first everywhere; `/` is month-first unless impossible.
    const dayFirst = numeric[2] === '.' || first > 12;
    return dayFirst ? makeDay(year, second, first) : makeDay(year, first, second);
  }

  const monthFirst = MONTH_FIRST.exec(input);
  if (monthFirst) {
    return withYear(monthIndex(monthFirst[1]), Number(monthFirst[2]), monthFirst[3], now);
  }
  const dayFirst = DAY_FIRST.exec(input);
  if (dayFirst) {
    return withYear(monthIndex(dayFirst[2]), Number(dayFirst[1]), dayFirst[3], now);
  }

  const lower = input.toLowerCase();
  if (lower === 'today' || lower === 'yesterday') {
    const d = new Date(now);
    if (lower === 'yesterday') d.setDate(d.getDate() - 1);
    return { year: d.getFullYear(), month: d.getMonth() + 1, day: d.getDate() };
  }
  return undefined;
}

export function parseTimeOfDay(text: string): TimeOfDay | undefined {
  const match = TIME_OF_DAY.exec(text);
  if (!match) return undefined;
  let hours = Number(match[1]);
  const minutes = Number(match[2]);
  const seconds = match[3] ? Number(match[3]) : 0;
  const meridiem = match[4]?.toLowerCase();
  if (meridiem === 'p' && hours < 12) hours += 12;
  if (meridiem === 'a' && hours === 12) hours = 0;
  if (hours > 23 || minutes > 59 || seconds > 59) return undefined;
  return { hours, minutes, seconds };
}

function withYear(
  month: number,
  day: number,
  rawYear: string | undefined,
  now: Date,
): Day | undefined {
  if (rawYear) return makeDay(Number(rawYear), month, day);
  const candidate = makeDay(now.getFullYear(), month, day);
  if (!candidate) return undefined;
  // Year-less headers refer to the past: "Dec 31" seen in January is last year.
  const asDate = new Date(candidate.year, candidate.month - 1, candidate.day);
  return asDate.getTime() > now.getTime() + 86_400_000
    ? makeDay(candidate.year - 1, month, day)
    : candidate;
}

function makeDay(year: number, month: number, day: number): Day | undefined {
  if (month < 1 || month > 12 || day < 1 || day > 31 || year < 2000 || year > 2100) {
    return undefined;
  }
  return { year, month, day };
}

function normaliseYear(year: number): number {
  return year < 100 ? 2000 + year : year;
}

function monthIndex(name: string | undefined): number {
  const key = (name ?? '').slice(0, 3).toLowerCase();
  return MONTHS.indexOf(key as (typeof MONTHS)[number]) + 1;
}
