import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  DownloadTracker,
  NOT_STARTED_MESSAGE,
  type TrackerRuntime,
} from '../../src/features/download/download-tracker.js';
import { isNonRetryable } from '../../src/features/download/download-errors.js';
import { isAbortError } from '../../src/shared/utils/async.js';
import type { RuntimeMessage } from '../../src/shared/types/index.js';

type Listener = Parameters<TrackerRuntime['onMessage']['addListener']>[0];

class FakeRuntime implements TrackerRuntime {
  sent: RuntimeMessage[] = [];
  listeners = new Set<Listener>();
  response: unknown = { ok: true };
  fail: Error | null = null;
  sendMessage = vi.fn(async (message: RuntimeMessage) => {
    this.sent.push(message);
    if (this.fail) throw this.fail;
    return this.response;
  });
  onMessage = {
    addListener: (l: Listener) => void this.listeners.add(l),
    removeListener: (l: Listener) => void this.listeners.delete(l),
  };
  push(message: unknown): unknown[] {
    const sendResponse = vi.fn();
    const results = [...this.listeners].map((l) => l(message, {}, sendResponse));
    expect(sendResponse).not.toHaveBeenCalled();
    return results;
  }
  update(taskId: string, extra: Record<string, unknown>): void {
    this.push({ type: 'DOWNLOAD_UPDATE', taskId, ...extra });
  }
}

const tick = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

afterEach(() => {
  vi.useRealTimers();
});

describe('DownloadTracker', () => {
  it('sends EXPECT_DOWNLOAD and resolves on complete with progress', async () => {
    const runtime = new FakeRuntime();
    const tracker = new DownloadTracker(runtime);
    const handle = tracker.expect('t1', 'Telegram/a.jpg', {
      token: 'abc',
      timeoutMs: 5000,
    });
    const progress = vi.fn();
    handle.onProgress(progress);

    await handle.ready;
    expect(runtime.sent[0]).toEqual({
      type: 'EXPECT_DOWNLOAD',
      taskId: 't1',
      relativePath: 'Telegram/a.jpg',
      token: 'abc',
      timeoutMs: 5000,
    });

    runtime.update('t1', { phase: 'started', downloadId: 7 });
    await handle.started;
    runtime.update('t1', { phase: 'progress', bytesReceived: 50, totalBytes: 100 });
    runtime.update('other', { phase: 'complete' });
    runtime.update('t1', { phase: 'complete', filename: '/dl/Telegram/a.jpg' });

    await expect(handle.done).resolves.toEqual({ filename: '/dl/Telegram/a.jpg' });
    expect(progress).toHaveBeenCalledWith({ bytesReceived: 50, totalBytes: 100 });
    expect(runtime.listeners.size).toBe(0);
    expect(tracker.pending).toBe(0);
  });

  it('ignores unrelated messages and never answers them', () => {
    const runtime = new FakeRuntime();
    const tracker = new DownloadTracker(runtime);
    tracker.expect('t1', 'a.jpg', { timeoutMs: 1000 });
    expect(runtime.push({ type: 'PING' })).toEqual([false]);
    expect(runtime.push(null)).toEqual([false]);
    expect(runtime.push({ type: 'DOWNLOAD_UPDATE', taskId: 5 })).toEqual([false]);
  });

  it('rejects retryably on a network interruption', async () => {
    const runtime = new FakeRuntime();
    const handle = new DownloadTracker(runtime).expect('t1', 'a.jpg', {
      timeoutMs: 1000,
    });
    runtime.update('t1', { phase: 'interrupted', error: 'NETWORK_FAILED' });
    const error = await handle.done.catch((e: unknown) => e);
    expect(String(error)).toMatch(/NETWORK_FAILED/);
    expect(isNonRetryable(error)).toBe(false);
    await expect(handle.started).rejects.toBeDefined();
  });

  it('rejects non-retryably when the user cancelled', async () => {
    const runtime = new FakeRuntime();
    const handle = new DownloadTracker(runtime).expect('t1', 'a.jpg', {
      timeoutMs: 1000,
    });
    runtime.update('t1', { phase: 'interrupted', error: 'USER_CANCELED' });
    expect(isNonRetryable(await handle.done.catch((e: unknown) => e))).toBe(true);
  });

  it('rejects non-retryably with a clear message when expired', async () => {
    const runtime = new FakeRuntime();
    const handle = new DownloadTracker(runtime).expect('t1', 'a.jpg', {
      timeoutMs: 1000,
    });
    runtime.update('t1', { phase: 'expired' });
    const error = await handle.done.catch((e: unknown) => e);
    expect(isNonRetryable(error)).toBe(true);
    expect((error as Error).message).toBe(NOT_STARTED_MESSAGE);
  });

  it('expires locally when the service worker stays silent', async () => {
    vi.useFakeTimers();
    const runtime = new FakeRuntime();
    const handle = new DownloadTracker(runtime).expect('t1', 'a.jpg', {
      timeoutMs: 1000,
    });
    const result = handle.done.catch((e: unknown) => e);
    await vi.advanceTimersByTimeAsync(11_000);
    expect(((await result) as Error).message).toBe(NOT_STARTED_MESSAGE);
  });

  it('does not time out once the download started', async () => {
    vi.useFakeTimers();
    const runtime = new FakeRuntime();
    const handle = new DownloadTracker(runtime).expect('t1', 'a.jpg', {
      timeoutMs: 1000,
    });
    runtime.update('t1', { phase: 'progress', bytesReceived: 1 });
    await vi.advanceTimersByTimeAsync(60_000);
    runtime.update('t1', { phase: 'complete' });
    await expect(handle.done).resolves.toEqual({});
  });

  it('sends CANCEL_EXPECTED_DOWNLOAD on abort and rejects with AbortError', async () => {
    const runtime = new FakeRuntime();
    const controller = new AbortController();
    const handle = new DownloadTracker(runtime).expect('t1', 'a.jpg', {
      timeoutMs: 1000,
      signal: controller.signal,
    });
    controller.abort();
    await expect(handle.done).rejects.toSatisfy(isAbortError);
    expect(runtime.sent.at(-1)).toEqual({
      type: 'CANCEL_EXPECTED_DOWNLOAD',
      taskId: 't1',
    });
    runtime.update('t1', { phase: 'complete' });
  });

  it('handles an already-aborted signal without sending EXPECT', async () => {
    const runtime = new FakeRuntime();
    const controller = new AbortController();
    controller.abort();
    const handle = new DownloadTracker(runtime).expect('t1', 'a.jpg', {
      timeoutMs: 1000,
      signal: controller.signal,
    });
    await expect(handle.ready).rejects.toSatisfy(isAbortError);
    expect(runtime.sent.some((m) => m.type === 'EXPECT_DOWNLOAD')).toBe(false);
  });

  it('rejects retryably when the service worker is unreachable or refuses', async () => {
    const runtime = new FakeRuntime();
    runtime.fail = new Error('Receiving end does not exist');
    const tracker = new DownloadTracker(runtime);
    const a = tracker.expect('t1', 'a.jpg', { timeoutMs: 1000 });
    const errA = await a.ready.catch((e: unknown) => e);
    expect(String(errA)).toMatch(/unavailable/);
    expect(isNonRetryable(errA)).toBe(false);

    runtime.fail = null;
    runtime.response = { ok: false, error: 'busy' };
    const b = tracker.expect('t2', 'b.jpg', { timeoutMs: 1000 });
    await expect(b.done).rejects.toThrow(/busy/);
  });

  it('a new expectation for the same task cancels the previous one', async () => {
    const runtime = new FakeRuntime();
    const tracker = new DownloadTracker(runtime);
    const first = tracker.expect('t1', 'a.jpg', { timeoutMs: 1000 });
    const second = tracker.expect('t1', 'a.jpg', { timeoutMs: 1000 });
    await expect(first.done).rejects.toSatisfy(isAbortError);
    runtime.update('t1', { phase: 'complete' });
    await expect(second.done).resolves.toEqual({});
  });

  it('cancelAll cancels everything and unsubscribes', async () => {
    const runtime = new FakeRuntime();
    const tracker = new DownloadTracker(runtime);
    const a = tracker.expect('a', 'a.jpg', { timeoutMs: 1000 });
    const b = tracker.expect('b', 'b.jpg', { timeoutMs: 1000 });
    tracker.cancelAll();
    await expect(a.done).rejects.toSatisfy(isAbortError);
    await expect(b.done).rejects.toSatisfy(isAbortError);
    await tick();
    expect(runtime.listeners.size).toBe(0);
  });

  it('uses chrome.runtime by default', async () => {
    const runtime = new FakeRuntime();
    vi.stubGlobal('chrome', { runtime });
    const handle = new DownloadTracker().expect('t1', 'a.jpg', { timeoutMs: 1000 });
    await handle.ready;
    expect(runtime.sent).toHaveLength(1);
    handle.cancel();
    vi.unstubAllGlobals();
  });
});
