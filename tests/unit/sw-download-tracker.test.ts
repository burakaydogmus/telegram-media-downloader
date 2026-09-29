import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import {
  DownloadTracker,
  isTelegramDownload,
} from '../../src/background/download-tracker.js';
import {
  SessionExpectationStore,
  MemoryExpectationStore,
  TRACKER_STATE_KEY,
  parseState,
} from '../../src/background/expectation-store.js';
import type { ExpectationStore } from '../../src/background/expectation-store.js';
import { Logger } from '../../src/shared/logger/index.js';
import type { RuntimeMessage } from '../../src/shared/types/index.js';
import { createChromeFake, flush, makeItem, suggestSpy } from './sw-chrome-fake.js';
import type { ChromeFake } from './sw-chrome-fake.js';

const TAB = 7;
const silent = { debug() {}, info() {}, warn() {}, error() {} };

function expectMsg(
  taskId: string,
  relativePath: string,
  token?: string,
  timeoutMs = 10_000,
): Extract<RuntimeMessage, { type: 'EXPECT_DOWNLOAD' }> {
  return {
    type: 'EXPECT_DOWNLOAD',
    taskId,
    relativePath,
    timeoutMs,
    ...(token ? { token } : {}),
  };
}

function makeTracker(fake: ChromeFake, store?: ExpectationStore): DownloadTracker {
  return new DownloadTracker({
    downloads: fake.chrome.downloads,
    sendToTab: (tabId, message) => fake.chrome.tabs.sendMessage(tabId, message),
    store: store ?? new SessionExpectationStore(fake.chrome.storage.session),
    logger: new Logger('error', 'test', 100, silent),
    pollIntervalMs: 500,
  });
}

/** Simulates the worker dying: pending timers vanish, the clock keeps its time. */
function killTimers(): void {
  const now = Date.now();
  vi.clearAllTimers();
  vi.setSystemTime(now);
}

function updates(fake: ChromeFake): RuntimeMessage[] {
  return fake.sent.map((s) => s.message);
}

let fake: ChromeFake;

beforeEach(() => {
  vi.useFakeTimers();
  vi.setSystemTime(1_000_000);
  fake = createChromeFake();
});

afterEach(() => {
  vi.useRealTimers();
});

describe('DownloadTracker matching', () => {
  it('matches exactly by token regardless of registration order', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('fifo', 'T/c/fifo'));
    await tracker.expect(TAB, expectMsg('tok', 'T/c/by-token', 'abc123'));

    const item = makeItem({ id: 5, filename: 'tgmd-abc123__photo.jpg' });
    const { calls, suggest } = suggestSpy();
    expect(tracker.onDeterminingFilename(item, suggest)).toBe(false);

    expect(calls).toEqual([{ filename: 'T/c/by-token.jpg', conflictAction: 'uniquify' }]);
    await flush();
    expect(fake.sent[0]).toEqual({
      tabId: TAB,
      message: {
        type: 'DOWNLOAD_UPDATE',
        taskId: 'tok',
        phase: 'started',
        downloadId: 5,
        filename: 'T/c/by-token.jpg',
      },
    });
  });

  it('matches token-less expectations FIFO and skips token ones', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('tok', 'T/tok.jpg', 'zz'));
    await tracker.expect(TAB, expectMsg('a', 'T/a'));
    await tracker.expect(TAB, expectMsg('b', 'T/b.png'));

    const s1 = suggestSpy();
    tracker.onDeterminingFilename(makeItem({ id: 1, filename: 'photo.jpg' }), s1.suggest);
    const s2 = suggestSpy();
    tracker.onDeterminingFilename(makeItem({ id: 2, filename: 'photo.jpg' }), s2.suggest);
    const s3 = suggestSpy();
    tracker.onDeterminingFilename(makeItem({ id: 3, filename: 'photo.jpg' }), s3.suggest);

    expect(s1.calls).toEqual([{ filename: 'T/a.jpg', conflictAction: 'uniquify' }]);
    expect(s2.calls).toEqual([{ filename: 'T/b.png', conflictAction: 'uniquify' }]);
    expect(s3.calls).toEqual([undefined]);
  });

  it('leaves unrelated downloads untouched', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', 'T/a'));

    const other = makeItem({
      url: 'https://example.com/x.zip',
      finalUrl: 'https://example.com/x.zip',
      referrer: 'https://example.com/',
    });
    const own = makeItem({ byExtensionId: 'ext-id' });
    for (const item of [other, own]) {
      const { calls, suggest } = suggestSpy();
      expect(tracker.onDeterminingFilename(item, suggest)).toBe(false);
      expect(calls).toEqual([undefined]);
    }
    await flush();
    expect(fake.sent).toEqual([]);
  });

  it('leaves manual Telegram downloads untouched when nothing is expected', async () => {
    const tracker = makeTracker(fake);
    await tracker.whenReady();
    const { calls, suggest } = suggestSpy();
    tracker.onDeterminingFilename(makeItem(), suggest);
    expect(calls).toEqual([undefined]);
  });

  it('strips the marker of an orphaned tokenised download', async () => {
    const tracker = makeTracker(fake);
    await tracker.whenReady();
    const { calls, suggest } = suggestSpy();
    tracker.onDeterminingFilename(makeItem({ filename: 'tgmd-gone__pic.jpg' }), suggest);
    expect(calls).toEqual([{ filename: 'pic.jpg', conflictAction: 'uniquify' }]);
  });

  it('recognises Telegram origins by url, finalUrl or referrer', () => {
    const none = { url: 'https://x/', finalUrl: 'https://x/', referrer: '' };
    expect(isTelegramDownload(makeItem(none))).toBe(false);
    expect(
      isTelegramDownload(
        makeItem({ ...none, url: 'https://web.telegram.org/a/progressive/1' }),
      ),
    ).toBe(true);
    expect(
      isTelegramDownload(
        makeItem({ ...none, finalUrl: 'blob:https://web.telegram.org/u' }),
      ),
    ).toBe(true);
    expect(
      isTelegramDownload(makeItem({ ...none, referrer: 'https://web.telegram.org/k/' })),
    ).toBe(true);
    expect(
      isTelegramDownload(
        makeItem({ ...none, url: 'https://web.telegram.org.evil.com/' }),
      ),
    ).toBe(false);
  });

  it('suggests asynchronously when an event arrives before hydration', async () => {
    const tracker = makeTracker(fake);
    const { calls, suggest } = suggestSpy();
    expect(tracker.onDeterminingFilename(makeItem(), suggest)).toBe(true);
    expect(calls).toEqual([]);
    await tracker.whenReady();
    await flush();
    expect(calls).toEqual([undefined]);
  });

  it('sanitizes the requested relative path', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', '/../Chat:1/pic'));
    const { calls, suggest } = suggestSpy();
    tracker.onDeterminingFilename(makeItem(), suggest);
    expect(calls).toEqual([{ filename: 'Chat_1/pic.jpg', conflictAction: 'uniquify' }]);
  });
});

describe('DownloadTracker expiry and cancel', () => {
  it('reports expired expectations via timer and never matches them', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', 'T/a', undefined, 1000));

    await vi.advanceTimersByTimeAsync(1000);
    expect(updates(fake)).toEqual([
      { type: 'DOWNLOAD_UPDATE', taskId: 'a', phase: 'expired' },
    ]);

    const { calls, suggest } = suggestSpy();
    tracker.onDeterminingFilename(makeItem(), suggest);
    expect(calls).toEqual([undefined]);
  });

  it('expires lazily on the next event when the timer never fired', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', 'T/a', undefined, 1000));
    killTimers();
    vi.setSystemTime(1_000_000 + 5000);

    const { calls, suggest } = suggestSpy();
    tracker.onDeterminingFilename(makeItem(), suggest);
    expect(calls).toEqual([undefined]);
    await flush();
    expect(updates(fake)).toEqual([
      { type: 'DOWNLOAD_UPDATE', taskId: 'a', phase: 'expired' },
    ]);
  });

  it('cancel before match removes the expectation', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', 'T/a'));
    await tracker.cancel('a');

    const { calls, suggest } = suggestSpy();
    tracker.onDeterminingFilename(makeItem(), suggest);
    expect(calls).toEqual([undefined]);
    await vi.advanceTimersByTimeAsync(20_000);
    expect(fake.sent).toEqual([]);
  });

  it('cancel after match cancels the in-progress chrome download', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', 'T/a'));
    const item = makeItem({ id: 9 });
    fake.items.set(9, item);
    tracker.onDeterminingFilename(item, suggestSpy().suggest);

    await tracker.cancel('a');
    expect(fake.chrome.downloads.cancel).toHaveBeenCalledWith(9);

    fake.sent.length = 0;
    tracker.onChanged({
      id: 9,
      state: { current: 'interrupted', previous: 'in_progress' },
    });
    await vi.advanceTimersByTimeAsync(2000);
    expect(fake.sent).toEqual([]);
  });

  it('does not cancel a download that already finished', async () => {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', 'T/a'));
    fake.items.set(9, makeItem({ id: 9, state: 'complete' }));
    tracker.onDeterminingFilename(makeItem({ id: 9 }), suggestSpy().suggest);
    await tracker.cancel('a');
    expect(fake.chrome.downloads.cancel).not.toHaveBeenCalled();
  });
});

describe('DownloadTracker progress', () => {
  async function started(): Promise<DownloadTracker> {
    const tracker = makeTracker(fake);
    await tracker.expect(TAB, expectMsg('a', 'T/a'));
    const item = makeItem({ id: 3 });
    fake.items.set(3, item);
    tracker.onDeterminingFilename(item, suggestSpy().suggest);
    await flush();
    fake.sent.length = 0;
    return tracker;
  }

  it('polls bytes while in progress and reports completion', async () => {
    const tracker = await started();

    fake.items.set(3, makeItem({ id: 3, bytesReceived: 400 }));
    await vi.advanceTimersByTimeAsync(500);
    await vi.advanceTimersByTimeAsync(500); // unchanged bytes -> no duplicate
    fake.items.set(3, makeItem({ id: 3, bytesReceived: 800 }));
    await vi.advanceTimersByTimeAsync(500);

    fake.items.set(
      3,
      makeItem({
        id: 3,
        state: 'complete',
        bytesReceived: 1000,
        filename: '/Users/me/Downloads/T/a (1).jpg',
      }),
    );
    tracker.onChanged({ id: 3, state: { current: 'complete', previous: 'in_progress' } });
    await flush();

    expect(updates(fake)).toEqual([
      {
        type: 'DOWNLOAD_UPDATE',
        taskId: 'a',
        phase: 'progress',
        downloadId: 3,
        bytesReceived: 400,
        totalBytes: 1000,
      },
      {
        type: 'DOWNLOAD_UPDATE',
        taskId: 'a',
        phase: 'progress',
        downloadId: 3,
        bytesReceived: 800,
        totalBytes: 1000,
      },
      {
        type: 'DOWNLOAD_UPDATE',
        taskId: 'a',
        phase: 'complete',
        downloadId: 3,
        filename: '/Users/me/Downloads/T/a (1).jpg',
        bytesReceived: 1000,
        totalBytes: 1000,
      },
    ]);

    const searches = fake.chrome.downloads.search.mock.calls.length;
    await vi.advanceTimersByTimeAsync(3000);
    expect(fake.chrome.downloads.search.mock.calls.length).toBe(searches);
  });

  it('reports interruptions with the chrome error', async () => {
    const tracker = await started();
    fake.items.set(3, makeItem({ id: 3, state: 'interrupted', error: 'USER_CANCELED' }));
    tracker.onChanged({
      id: 3,
      state: { current: 'interrupted', previous: 'in_progress' },
      error: { current: 'USER_CANCELED' },
    });
    await flush();
    expect(updates(fake)).toEqual([
      {
        type: 'DOWNLOAD_UPDATE',
        taskId: 'a',
        phase: 'interrupted',
        downloadId: 3,
        filename: 'photo_2024.jpg',
        error: 'USER_CANCELED',
      },
    ]);
  });

  it('finishes from polling when the onChanged event was missed', async () => {
    await started();
    fake.items.set(3, makeItem({ id: 3, state: 'interrupted', error: 'NETWORK_FAILED' }));
    await vi.advanceTimersByTimeAsync(500);
    expect(updates(fake)).toEqual([
      expect.objectContaining({ phase: 'interrupted', error: 'NETWORK_FAILED' }),
    ]);
  });

  it('tracks filename deltas and ignores unknown download ids', async () => {
    const tracker = await started();
    tracker.onChanged({ id: 404, state: { current: 'complete' } });
    tracker.onChanged({ id: 3, filename: { current: '/dl/T/a.jpg' } });
    fake.items.delete(3);
    tracker.onChanged({ id: 3, state: { current: 'complete' } });
    await flush();
    expect(updates(fake)).toEqual([
      {
        type: 'DOWNLOAD_UPDATE',
        taskId: 'a',
        phase: 'complete',
        downloadId: 3,
        filename: '/dl/T/a.jpg',
      },
    ]);
  });
});

describe('DownloadTracker persistence', () => {
  it('rehydrates expectations and active downloads after a restart', async () => {
    const first = makeTracker(fake);
    await first.expect(TAB, expectMsg('a', 'T/a'));
    await first.expect(TAB, expectMsg('b', 'T/b'));
    const item = makeItem({ id: 4 });
    fake.items.set(4, item);
    first.onDeterminingFilename(item, suggestSpy().suggest);
    await flush();
    killTimers();

    const persisted = parseState(fake.sessionData.get(TRACKER_STATE_KEY));
    expect(persisted.expectations.map((e) => e.taskId)).toEqual(['b']);
    expect(persisted.active.map((a) => a.downloadId)).toEqual([4]);

    // "Restart": a fresh tracker backed by the same session storage.
    fake.sent.length = 0;
    fake.items.set(4, makeItem({ id: 4, state: 'complete', filename: '/dl/T/a.jpg' }));
    const second = makeTracker(fake);
    await second.whenReady();
    expect(updates(fake)).toEqual([
      expect.objectContaining({
        taskId: 'a',
        phase: 'complete',
        filename: '/dl/T/a.jpg',
      }),
    ]);

    const { calls, suggest } = suggestSpy();
    second.onDeterminingFilename(makeItem({ id: 5 }), suggest);
    expect(calls).toEqual([{ filename: 'T/b.jpg', conflictAction: 'uniquify' }]);
  });

  it('reports expectations that expired while the worker was dead', async () => {
    const first = makeTracker(fake);
    await first.expect(TAB, expectMsg('a', 'T/a', undefined, 1000));
    killTimers();
    vi.setSystemTime(1_000_000 + 60_000);

    const second = makeTracker(fake);
    await second.whenReady();
    await flush();
    expect(updates(fake)).toEqual([
      { type: 'DOWNLOAD_UPDATE', taskId: 'a', phase: 'expired' },
    ]);
    expect(parseState(fake.sessionData.get(TRACKER_STATE_KEY)).expectations).toEqual([]);
  });

  it('falls back to memory without session storage and ignores corrupt state', async () => {
    const memoryOnly = new SessionExpectationStore(undefined);
    await memoryOnly.save({ expectations: [], active: [] });
    expect(await memoryOnly.load()).toEqual({ expectations: [], active: [] });

    const failing = new SessionExpectationStore({
      get: () => Promise.reject(new Error('nope')),
      set: () => Promise.reject(new Error('nope')),
    });
    await failing.save({ expectations: [], active: [] });
    expect(await failing.load()).toEqual({ expectations: [], active: [] });

    expect(parseState('garbage')).toEqual({ expectations: [], active: [] });
    expect(parseState({ expectations: [{ taskId: 1 }], active: 'x' })).toEqual({
      expectations: [],
      active: [],
    });

    const tracker = makeTracker(fake, new MemoryExpectationStore());
    await tracker.expect(TAB, expectMsg('a', 'T/a'));
    const { calls, suggest } = suggestSpy();
    tracker.onDeterminingFilename(makeItem(), suggest);
    expect(calls).toEqual([{ filename: 'T/a.jpg', conflictAction: 'uniquify' }]);
  });
});
