import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';
import type { RuntimeMessage } from '../../src/shared/types/index.js';
import { createChromeFake, flush, makeItem, suggestSpy } from './sw-chrome-fake.js';
import type { ChromeFake } from './sw-chrome-fake.js';

async function boot(fake: ChromeFake): Promise<void> {
  vi.stubGlobal('chrome', fake.chrome);
  vi.resetModules();
  await import('../../src/background/service-worker.js');
  await flush(20);
}

function send(
  fake: ChromeFake,
  message: RuntimeMessage,
  tabId: number | null = 3,
): Promise<unknown> {
  return new Promise((resolve) => {
    fake.chrome.runtime.onMessage.fire(
      message,
      tabId === null ? {} : { tab: { id: tabId } },
      resolve,
    );
  });
}

beforeEach(() => {
  vi.spyOn(console, 'info').mockImplementation(() => {});
  vi.spyOn(console, 'warn').mockImplementation(() => {});
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

describe('service worker wiring', () => {
  it('registers download listeners synchronously at top level', async () => {
    const fake = createChromeFake();
    await boot(fake);
    expect(fake.chrome.downloads.onDeterminingFilename.listeners).toHaveLength(1);
    expect(fake.chrome.downloads.onChanged.listeners.length).toBeGreaterThanOrEqual(1);
    expect(fake.chrome.runtime.onMessage.listeners).toHaveLength(1);
  });

  it('handles EXPECT / CANCEL and renames the matching download', async () => {
    const fake = createChromeFake();
    await boot(fake);

    expect(await send(fake, { type: 'PING' })).toEqual({ ok: true });
    expect(
      await send(fake, {
        type: 'EXPECT_DOWNLOAD',
        taskId: 't1',
        relativePath: 'Telegram/Chat/01_photo',
        token: 'k9',
        timeoutMs: 5000,
      }),
    ).toEqual({ ok: true });
    expect(
      await send(fake, {
        type: 'EXPECT_DOWNLOAD',
        taskId: 't2',
        relativePath: 'x',
        timeoutMs: 5000,
      }),
    ).toEqual({ ok: true });
    expect(await send(fake, { type: 'CANCEL_EXPECTED_DOWNLOAD', taskId: 't2' })).toEqual({
      ok: true,
    });

    const { calls, suggest } = suggestSpy();
    fake.chrome.downloads.onDeterminingFilename.fire(
      makeItem({ id: 11, filename: 'tgmd-k9__photo.jpg' }),
      suggest,
    );
    expect(calls).toEqual([
      { filename: 'Telegram/Chat/01_photo.jpg', conflictAction: 'uniquify' },
    ]);
    await flush();
    expect(fake.chrome.tabs.sendMessage).toHaveBeenCalledWith(
      3,
      expect.objectContaining({
        type: 'DOWNLOAD_UPDATE',
        taskId: 't1',
        phase: 'started',
      }),
    );
  });

  it('rejects EXPECT_DOWNLOAD without a sender tab', async () => {
    const fake = createChromeFake();
    await boot(fake);
    const res = await send(
      fake,
      { type: 'EXPECT_DOWNLOAD', taskId: 't', relativePath: 'x', timeoutMs: 1 },
      null,
    );
    expect(res).toEqual(expect.objectContaining({ ok: false }));
  });

  it('rehydrates pending expectations after a worker restart', async () => {
    const sessionData = new Map<string, unknown>();
    const first = createChromeFake(sessionData);
    await boot(first);
    await send(first, {
      type: 'EXPECT_DOWNLOAD',
      taskId: 't1',
      relativePath: 'Telegram/a.png',
      timeoutMs: 60_000,
    });

    const second = createChromeFake(sessionData);
    await boot(second);
    const { calls, suggest } = suggestSpy();
    second.chrome.downloads.onDeterminingFilename.fire(makeItem({ id: 2 }), suggest);
    expect(calls).toEqual([{ filename: 'Telegram/a.png', conflictAction: 'uniquify' }]);
  });

  it('keeps DOWNLOAD_FILE working with sub-folder paths', async () => {
    const fake = createChromeFake();
    await boot(fake);
    const pending = send(fake, {
      type: 'DOWNLOAD_FILE',
      url: 'https://web.telegram.org/a/progressive/1',
      fileName: '../Telegram/Chat:1/v.mp4',
    });
    await flush();
    expect(fake.chrome.downloads.download).toHaveBeenCalledWith(
      expect.objectContaining({
        filename: 'Telegram/Chat_1/v.mp4',
        conflictAction: 'uniquify',
      }),
    );
    fake.chrome.downloads.onChanged.fire({ id: 99, state: { current: 'complete' } });
    expect(await pending).toEqual({ ok: true });
  });
});
