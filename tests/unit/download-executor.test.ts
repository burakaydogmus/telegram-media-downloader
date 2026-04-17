import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MessageDownloadExecutor,
  BlobDownloadExecutor,
  CompositeDownloadExecutor,
  NonRetryableDownloadError,
} from '../../src/features/download/download-executor.js';
import type {
  DownloadExecutor,
  NativeDownloader,
  ProgressReporter,
} from '../../src/features/download/download-executor.js';
import type { DownloadTask, MediaItem } from '../../src/shared/types/index.js';

function task(url?: string): DownloadTask {
  return {
    id: 't1',
    item: { id: 'm1', type: 'photo', fileName: 'p.jpg', ...(url ? { url } : {}) },
    state: 'running',
    progress: 0,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

afterEach(() => {
  vi.unstubAllGlobals();
});

describe('MessageDownloadExecutor', () => {
  it('sends a DOWNLOAD_FILE message and reports progress on success', async () => {
    const sendMessage = vi.fn().mockResolvedValue({ ok: true });
    vi.stubGlobal('chrome', { runtime: { sendMessage } });

    const onProgress = vi.fn();
    const executor = new MessageDownloadExecutor();
    await executor.execute(
      task('https://x/p.jpg'),
      onProgress,
      new AbortController().signal,
    );

    expect(sendMessage).toHaveBeenCalledWith(
      expect.objectContaining({ type: 'DOWNLOAD_FILE', url: 'https://x/p.jpg' }),
    );
    expect(onProgress).toHaveBeenCalledWith(0.1);
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  it('throws when the media item has no URL', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
    const executor = new MessageDownloadExecutor();
    await expect(
      executor.execute(task(), vi.fn(), new AbortController().signal),
    ).rejects.toThrow(/no downloadable URL/);
  });

  it('throws when the background reports failure', async () => {
    vi.stubGlobal('chrome', {
      runtime: { sendMessage: vi.fn().mockResolvedValue({ ok: false, error: 'nope' }) },
    });
    const executor = new MessageDownloadExecutor();
    await expect(
      executor.execute(task('https://x/p.jpg'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow('nope');
  });

  it('throws AbortError when already aborted', async () => {
    vi.stubGlobal('chrome', { runtime: { sendMessage: vi.fn() } });
    const controller = new AbortController();
    controller.abort();
    const executor = new MessageDownloadExecutor();
    await expect(
      executor.execute(task('https://x/p.jpg'), vi.fn(), controller.signal),
    ).rejects.toThrow('Aborted');
  });
});

describe('BlobDownloadExecutor', () => {
  it('fetches the URL and saves the bytes via an anchor click', async () => {
    const blob = new Blob(['hello'], { type: 'image/jpeg' });
    const fetchMock = vi.fn().mockResolvedValue({
      ok: true,
      body: null,
      headers: { get: (): string | null => null },
      blob: () => Promise.resolve(blob),
    });
    vi.stubGlobal('fetch', fetchMock);
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:object-url'),
      revokeObjectURL: vi.fn(),
    });

    const click = vi.fn();
    const realCreate = document.createElement.bind(document);
    const createSpy = vi
      .spyOn(document, 'createElement')
      .mockImplementation((tag: string) => {
        const el = realCreate(tag) as HTMLElement;
        if (tag === 'a') el.click = click;
        return el;
      });

    const onProgress = vi.fn();
    const executor = new BlobDownloadExecutor(document);
    await executor.execute(task('blob:abc'), onProgress, new AbortController().signal);

    expect(fetchMock).toHaveBeenCalledWith('blob:abc', expect.anything());
    expect(click).toHaveBeenCalledOnce();
    expect(onProgress).toHaveBeenCalledWith(1);
    createSpy.mockRestore();
  });

  it('reports streamed progress from Content-Length', async () => {
    const part = new Uint8Array([1, 2, 3, 4]);
    let read = 0;
    const reader = {
      read: vi.fn(async () => {
        read += 1;
        return read === 1
          ? { done: false, value: part }
          : { done: true, value: undefined };
      }),
      cancel: vi.fn(),
    };
    vi.stubGlobal(
      'fetch',
      vi.fn().mockResolvedValue({
        ok: true,
        body: { getReader: () => reader },
        headers: {
          get: (h: string): string | null => (h === 'Content-Length' ? '4' : null),
        },
      }),
    );
    vi.stubGlobal('URL', {
      createObjectURL: vi.fn(() => 'blob:object-url'),
      revokeObjectURL: vi.fn(),
    });

    const onProgress = vi.fn();
    const executor = new BlobDownloadExecutor(document);
    await executor.execute(task('blob:abc'), onProgress, new AbortController().signal);
    expect(onProgress).toHaveBeenCalledWith(1);
    expect(reader.read).toHaveBeenCalled();
  });

  it('marks a missing URL as non-retryable', async () => {
    const executor = new BlobDownloadExecutor(document);
    await expect(
      executor.execute(task(), vi.fn(), new AbortController().signal),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
  });

  it('marks an un-fetchable stream as non-retryable', async () => {
    vi.stubGlobal('fetch', vi.fn().mockRejectedValue(new TypeError('Failed to fetch')));
    const executor = new BlobDownloadExecutor(document);
    await expect(
      executor.execute(task('blob:stream'), vi.fn(), new AbortController().signal),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
  });
});

describe('CompositeDownloadExecutor', () => {
  function videoTask(): DownloadTask {
    const item: MediaItem = { id: 'v1', type: 'video', url: 'blob:stream' };
    return { ...task('blob:stream'), item };
  }

  class SpyPrimary implements DownloadExecutor {
    public calls = 0;
    constructor(private readonly behaviour: 'ok' | (() => Error)) {}
    async execute(_t: DownloadTask, onProgress: ProgressReporter): Promise<void> {
      this.calls += 1;
      if (this.behaviour !== 'ok') throw this.behaviour();
      onProgress(1);
    }
  }

  class SpyNative implements NativeDownloader {
    public calls = 0;
    public lastItem: MediaItem | null = null;
    async download(item: MediaItem): Promise<void> {
      this.calls += 1;
      this.lastItem = item;
    }
  }

  it('uses the byte fetch for photos and skips the native path', async () => {
    const primary = new SpyPrimary('ok');
    const native = new SpyNative();
    const exec = new CompositeDownloadExecutor(primary, native);

    await exec.execute(task('https://x/p.jpg'), vi.fn(), new AbortController().signal);

    expect(primary.calls).toBe(1);
    expect(native.calls).toBe(0);
  });

  it('routes videos straight to the native downloader', async () => {
    const primary = new SpyPrimary('ok');
    const native = new SpyNative();
    const exec = new CompositeDownloadExecutor(primary, native);

    await exec.execute(videoTask(), vi.fn(), new AbortController().signal);

    expect(primary.calls).toBe(0);
    expect(native.calls).toBe(1);
    expect(native.lastItem?.type).toBe('video');
  });

  it('falls back to native when a fetch is non-retryable', async () => {
    const primary = new SpyPrimary(() => new NonRetryableDownloadError('stream'));
    const native = new SpyNative();
    const exec = new CompositeDownloadExecutor(primary, native);

    await exec.execute(task('blob:abc'), vi.fn(), new AbortController().signal);

    expect(primary.calls).toBe(1);
    expect(native.calls).toBe(1);
  });

  it('propagates retryable fetch errors without falling back', async () => {
    const primary = new SpyPrimary(() => new Error('temporary'));
    const native = new SpyNative();
    const exec = new CompositeDownloadExecutor(primary, native);

    await expect(
      exec.execute(task('https://x/p.jpg'), vi.fn(), new AbortController().signal),
    ).rejects.toThrow('temporary');
    expect(native.calls).toBe(0);
  });
});
