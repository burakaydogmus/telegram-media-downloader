import type { TelegramClient } from '../shared/types/index.js';
import { selectorsFor } from '../shared/constants/selectors.js';
import { sanitizeText } from '../shared/utils/index.js';

const USERNAME = /^@?([a-z][a-z0-9_]{2,31})$/i;
const NUMERIC_PEER = /^(-?\d+)(?:[_?/].*)?$/;

/**
 * Parses a Telegram Web location hash into a stable peer id.
 *
 * Web K: `#123`, `#-100123`, `#@username`, `#?tgaddr=tg://resolve?domain=x`.
 * Web A: `#-100123`, `#123_456` (thread/topic suffix is dropped).
 * Usernames are returned as `@name` (lower-cased for stability).
 */
export function parsePeerHash(hash: string): string | undefined {
  const encoded = (hash.startsWith('#') ? hash.slice(1) : hash).trim();
  if (encoded.startsWith('?'))
    return fromTgAddress(new URLSearchParams(encoded.slice(1)));

  const raw = safeDecode(encoded).trim();
  if (raw.length === 0) return undefined;

  const numeric = NUMERIC_PEER.exec(raw);
  if (numeric?.[1]) return numeric[1];

  const name = USERNAME.exec(raw.split(/[?/]/)[0] ?? '');
  return name?.[1] ? `@${name[1].toLowerCase()}` : undefined;
}

export function currentPeerId(doc: Document, client: TelegramClient): string | undefined {
  const fromHash = parsePeerHash(doc.location?.hash ?? '');
  if (fromHash) return fromHash;

  const selectors = selectorsFor(client);
  for (const selector of splitSelectorList(selectors.chatPeer)) {
    const peer = doc.querySelector(selector)?.getAttribute('data-peer-id')?.trim();
    if (peer && NUMERIC_PEER.test(peer)) return peer;
  }
  return undefined;
}

export function currentChatTitle(
  doc: Document,
  client: TelegramClient,
): string | undefined {
  const selectors = selectorsFor(client);
  for (const selector of splitSelectorList(selectors.chatTitle)) {
    const node = doc.querySelector(selector);
    const text = node?.textContent ? sanitizeText(node.textContent) : '';
    if (text.length > 0) return text.replace(/\s+/g, ' ');
  }
  return undefined;
}

/** Splits a priority-ordered selector list (no nested commas allowed). */
export function splitSelectorList(list: string): string[] {
  return list
    .split(',')
    .map((part) => part.trim())
    .filter((part) => part.length > 0);
}

function fromTgAddress(params: URLSearchParams): string | undefined {
  const address = params.get('tgaddr');
  if (!address) return undefined;
  let url: URL;
  try {
    url = new URL(address);
  } catch {
    return undefined;
  }
  // `tg://resolve?domain=x` parses with host `resolve`; normalise both forms.
  const action = (url.hostname || url.pathname.replace(/^\/+/, '')).toLowerCase();
  const query = url.searchParams;
  switch (action) {
    case 'resolve': {
      const domain = query.get('domain');
      if (domain && USERNAME.test(domain)) return `@${domain.toLowerCase()}`;
      const phone = query.get('phone');
      return phone && /^\d+$/.test(phone) ? `+${phone}` : undefined;
    }
    case 'privatepost': {
      const channel = query.get('channel');
      return channel && /^\d+$/.test(channel) ? `-${channel}` : undefined;
    }
    case 'user': {
      const id = query.get('id');
      return id && /^\d+$/.test(id) ? id : undefined;
    }
    default:
      return undefined;
  }
}

function safeDecode(value: string): string {
  try {
    return decodeURIComponent(value);
  } catch {
    return value;
  }
}
