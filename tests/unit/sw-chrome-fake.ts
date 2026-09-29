import { vi } from 'vitest';
import type { RuntimeMessage } from '../../src/shared/types/index.js';

type DownloadItem = chrome.downloads.DownloadItem;
type Suggestion = chrome.downloads.DownloadFilenameSuggestion;

export class FakeEvent<F extends (...args: never[]) => unknown> {
  readonly listeners: F[] = [];
  addListener(listener: F): void {
    this.listeners.push(listener);
  }
  fire(...args: Parameters<F>): ReturnType<F>[] {
    return this.listeners.map((l) => l(...args) as ReturnType<F>);
  }
}

export function makeItem(overrides: Partial<DownloadItem> = {}): DownloadItem {
  return {
    id: 1,
    url: 'blob:https://web.telegram.org/0f3c',
    finalUrl: 'blob:https://web.telegram.org/0f3c',
    referrer: 'https://web.telegram.org/k/',
    filename: 'photo_2024.jpg',
    mime: 'image/jpeg',
    state: 'in_progress',
    bytesReceived: 0,
    totalBytes: 1000,
    fileSize: 1000,
    danger: 'safe',
    paused: false,
    canResume: false,
    exists: true,
    incognito: false,
    startTime: new Date(0).toISOString(),
    ...overrides,
  };
}

export interface SuggestResult {
  readonly calls: (Suggestion | undefined)[];
  readonly suggest: (s?: Suggestion) => void;
}

export function suggestSpy(): SuggestResult {
  const calls: (Suggestion | undefined)[] = [];
  return { calls, suggest: (s?: Suggestion) => void calls.push(s) };
}

/** In-memory stand-in for the subset of `chrome.*` the service worker uses. */
export function createChromeFake(sessionData: Map<string, unknown> = new Map()) {
  const items = new Map<number, DownloadItem>();
  const sent: { tabId: number; message: RuntimeMessage }[] = [];

  const chromeFake = {
    runtime: {
      id: 'ext-id',
      onInstalled: new FakeEvent<(d: { reason: string }) => void>(),
      onMessage: new FakeEvent<
        (
          message: RuntimeMessage,
          sender: { tab?: { id?: number } },
          sendResponse: (r: unknown) => void,
        ) => boolean | void
      >(),
    },
    tabs: {
      sendMessage: vi.fn(async (tabId: number, message: RuntimeMessage) => {
        sent.push({ tabId, message });
        return undefined;
      }),
    },
    storage: {
      local: {
        get: vi.fn(async () => ({})),
        set: vi.fn(async () => undefined),
      },
      session: {
        get: vi.fn(async (key: string) =>
          sessionData.has(key) ? { [key]: structuredClone(sessionData.get(key)) } : {},
        ),
        set: vi.fn(async (entries: Record<string, unknown>) => {
          for (const [k, v] of Object.entries(entries)) {
            sessionData.set(k, structuredClone(v));
          }
        }),
      },
    },
    downloads: {
      download: vi.fn(async () => 99),
      search: vi.fn(async (query: { id?: number }) => {
        const item = query.id === undefined ? undefined : items.get(query.id);
        return item ? [{ ...item }] : [];
      }),
      cancel: vi.fn(async (id: number) => {
        const item = items.get(id);
        if (item)
          items.set(id, { ...item, state: 'interrupted', error: 'USER_CANCELED' });
      }),
      onDeterminingFilename: new FakeEvent<
        (item: DownloadItem, suggest: (s?: Suggestion) => void) => boolean | void
      >(),
      onChanged: new FakeEvent<(delta: chrome.downloads.DownloadDelta) => void>(),
    },
  };

  return { chrome: chromeFake, items, sent, sessionData };
}

export type ChromeFake = ReturnType<typeof createChromeFake>;

export async function flush(times = 10): Promise<void> {
  for (let i = 0; i < times; i++) await Promise.resolve();
}
