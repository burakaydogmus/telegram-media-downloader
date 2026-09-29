import { describe, it, expect, vi, afterEach, beforeEach } from 'vitest';
import {
  BlobDownloadExecutor,
  CompositeDownloadExecutor,
  NonRetryableDownloadError,
  HttpDownloadError,
  fetchMedia,
  readBody,
} from '../../src/features/download/download-executor.js';
import type {
  DownloadExecutor,
  NativeDownloader,
  NativeDownloadRequest,
  ProgressReporter,
} from '../../src/features/download/download-executor.js';
import {
  createDownloadExecutor,
  chooseRoute,
  isFetchableUrl,
  type DirectorySink,
} from '../../src/features/download/strategy-executor.js';
import type {
  ExpectOptions,
  TrackedDownload,
} from '../../src/features/download/download-tracker.js';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/index.js';
import type { DownloadTask, MediaItem, Settings } from '../../src/shared/types/index.js';

function task(url?: string, overrides: Partial<MediaItem> = {}): DownloadTask {
  return {
    id: 't1',
    item: {
      id: 'm1',
      type: 'photo',
      fileName: 'p.jpg',
      messageId: '9',
      chatTitle: 'Chat',
      timestamp: new Date(2026, 1, 2).getTime(),
      ...(url ? { url } : {}),
      ...overrides,
    },
    state: 'running',
    progress: 0,
    attempts: 1,
    createdAt: 0,
    updatedAt: 0,
  };
}

function bodyResponse(bytes: number, headers: Record<string, string> = {}): Response {
  return new Response(new Uint8Array(bytes), { status: 200, headers });
}

let clicks: string[];
beforeEach(() => {
  clicks = [];
  vi.spyOn(HTMLAnchorElement.prototype, 'click').mockImplementation(function (
    this: HTMLAnchorElement,
  ) {
    clicks.push(this.download);
  });
  vi.stubGlobal(
    'URL',
    Object.assign(URL, {
      createObjectURL: vi.fn(() => 'blob:object-url'),
      revokeObjectURL: vi.fn(),
    }),
  );
});

afterEach(() => {
  vi.restoreAllMocks();
  vi.unstubAllGlobals();
});

describe('fetch helpers', () => {
  it('fetchMedia maps network failures to non-retryable and HTTP errors to status', async () => {
    const signal = new AbortController().signal;
    await expect(
      fetchMedia('blob:x', signal, vi.fn().mockRejectedValue(new TypeError('nope'))),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
    const err = await fetchMedia(
      'https://x',
      signal,
      vi.fn().mockResolvedValue(new Response('', { status: 429 })),
    ).catch((e: unknown) => e);
    expect(err).toBeInstanceOf(HttpDownloadError);
    expect((err as HttpDownloadError).status).toBe(429);
  });

  it('fetchMedia reports AbortError when aborted mid-flight', async () => {
    const controller = new AbortController();
    controller.abort();
    await expect(
      fetchMedia(
        'https://x',
        controller.signal,
        vi.fn().mockRejectedValue(new Error('x')),
      ),
    ).rejects.toThrow('Aborted');
  });

  it('readBody reports bytes; unknown totals give NaN fractions', async () => {
    const onProgress = vi.fn();
    const blob = await readBody(
      bodyResponse(10),
      new AbortController().signal,
      onProgress,
    );
    expect(blob.size).toBe(10);
    expect(onProgress).toHaveBeenCalledWith(Number.NaN, 10, undefined);

    const withLength = vi.fn();
    await readBody(
      bodyResponse(8, { 'Content-Length': '8' }),
      new AbortController().signal,
      withLength,
    );
    expect(withLength).toHaveBeenCalledWith(0.95, 8, 8);
  });
});

describe('BlobDownloadExecutor (compat)', () => {
  it('fetches and saves via an anchor click', async () => {
    vi.stubGlobal('fetch', vi.fn().mockResolvedValue(bodyResponse(5)));
    const onProgress = vi.fn();
    await new BlobDownloadExecutor(document).execute(
      task('blob:abc'),
      onProgress,
      new AbortController().signal,
    );
    expect(clicks).toEqual(['p.jpg']);
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  it('rejects missing URLs and aborted signals', async () => {
    const executor = new BlobDownloadExecutor(document);
    await expect(
      executor.execute(task(), vi.fn(), new AbortController().signal),
    ).rejects.toBeInstanceOf(NonRetryableDownloadError);
    const controller = new AbortController();
    controller.abort();
    await expect(
      executor.execute(task('blob:x'), vi.fn(), controller.signal),
    ).rejects.toThrow('Aborted');
  });
});

describe('CompositeDownloadExecutor (compat)', () => {
  class SpyNative implements NativeDownloader {
    calls = 0;
    async download(): Promise<void> {
      this.calls += 1;
    }
  }
  const failing = (error: Error): DownloadExecutor => ({
    execute: () => Promise.reject(error),
  });

  it('falls back to native only on non-retryable errors', async () => {
    const native = new SpyNative();
    await new CompositeDownloadExecutor(
      failing(new NonRetryableDownloadError('stream')),
      native,
    ).execute(task('blob:a'), vi.fn(), new AbortController().signal);
    expect(native.calls).toBe(1);

    await expect(
      new CompositeDownloadExecutor(failing(new Error('temp')), native).execute(
        task('blob:a'),
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow('temp');
  });

  it('routes videos straight to native', async () => {
    const native = new SpyNative();
    const primary = { execute: vi.fn() };
    await new CompositeDownloadExecutor(primary, native).execute(
      task('blob:v', { type: 'video' }),
      vi.fn(),
      new AbortController().signal,
    );
    expect(primary.execute).not.toHaveBeenCalled();
    expect(native.calls).toBe(1);
  });
});

describe('routing', () => {
  const origin = 'https://web.telegram.org';
  it.each<[Partial<MediaItem>, Partial<Settings>, 'native' | 'direct']>([
    [{ type: 'video', url: `blob:${origin}/1` }, {}, 'native'],
    [{ type: 'gif', url: `blob:${origin}/1` }, {}, 'native'],
    [{ type: 'photo', url: `blob:${origin}/1` }, {}, 'native'],
    [
      { type: 'photo', url: `blob:${origin}/1` },
      { preferNativeDownload: false },
      'direct',
    ],
    [{ type: 'photo' }, { preferNativeDownload: false }, 'native'],
    [{ type: 'document', url: `blob:${origin}/1` }, {}, 'direct'],
    [{ type: 'audio', url: `${origin}/a/progressive/doc1` }, {}, 'direct'],
    [{ type: 'document', url: 'blob:https://evil.example/1' }, {}, 'native'],
    [{ type: 'document', url: 'http://web.telegram.org/x' }, {}, 'native'],
    [{ type: 'document', url: 'not a url' }, {}, 'native'],
  ])('%j %j → %s', (item, settings, expected) => {
    expect(
      chooseRoute(
        { id: 'x', type: 'photo', ...item },
        { ...DEFAULT_SETTINGS, ...settings },
        origin,
      ),
    ).toBe(expected);
  });

  it('isFetchableUrl accepts any blob: without a known origin', () => {
    expect(isFetchableUrl('blob:https://a/b')).toBe(true);
    expect(isFetchableUrl(undefined)).toBe(false);
  });
});

class FakeTracker {
  expectations: Array<{ taskId: string; path: string; options: ExpectOptions }> = [];
  outcome: 'complete' | Error = 'complete';
  expect(taskId: string, relativePath: string, options: ExpectOptions): TrackedDownload {
    this.expectations.push({ taskId, path: relativePath, options });
    const done =
      this.outcome === 'complete' ? Promise.resolve({}) : Promise.reject(this.outcome);
    done.catch(() => undefined);
    return {
      ready: Promise.resolve(),
      started: Promise.resolve(),
      done,
      onProgress: () => () => undefined,
      cancel: vi.fn(),
    };
  }
}

class SpyNative implements NativeDownloader {
  requests: NativeDownloadRequest[] = [];
  async download(_item: MediaItem, _s: AbortSignal, request?: NativeDownloadRequest) {
    if (request) this.requests.push(request);
  }
}

function sink(
  writable: boolean,
): DirectorySink & { writeStream: ReturnType<typeof vi.fn> } {
  return {
    hasHandle: () => writable,
    isWritable: async () => writable,
    writeStream: vi.fn(
      async (
        path: string,
        stream: ReadableStream<Uint8Array>,
        onProgress: (n: number) => void,
      ) => {
        const reader = stream.getReader();
        let total = 0;
        for (;;) {
          const { done, value } = await reader.read();
          if (done) break;
          total += value.byteLength;
          onProgress(total);
        }
        return path;
      },
    ),
  };
}

describe('createDownloadExecutor', () => {
  const origin = document.location.origin;
  const blobUrl = `blob:${origin}/abc`;
  const MB = 1024 * 1024;

  function build(opts: {
    settings?: Partial<Settings>;
    fetchFn?: typeof fetch;
    writer?: DirectorySink;
    tracker?: FakeTracker | null;
  }) {
    const native = new SpyNative();
    const tracker =
      opts.tracker === null ? undefined : (opts.tracker ?? new FakeTracker());
    const settings: Settings = {
      ...DEFAULT_SETTINGS,
      preferNativeDownload: false,
      largeFileThresholdMb: 1,
      ...opts.settings,
    };
    const executor = createDownloadExecutor({
      doc: document,
      client: 'webk',
      getSettings: () => settings,
      native,
      ...(tracker ? { tracker } : {}),
      ...(opts.writer ? { directoryWriter: opts.writer } : {}),
      ...(opts.fetchFn ? { fetchFn: opts.fetchFn } : {}),
    });
    return { executor, native, tracker, settings };
  }

  it('sends videos native with the templated path', async () => {
    const { executor, native } = build({});
    const onProgress: ProgressReporter = vi.fn();
    await executor.execute(
      task(blobUrl, { type: 'video', fileName: 'clip.mov' }),
      onProgress,
      new AbortController().signal,
    );
    expect(native.requests[0]).toMatchObject({
      taskId: 't1',
      relativePath: 'Telegram/Chat/2026-02-02_9_0_clip.mov',
    });
    expect(onProgress).toHaveBeenCalledWith(1);
  });

  it('small direct files are saved via a tokenised anchor and tracked', async () => {
    const fetchFn = vi
      .fn()
      .mockResolvedValue(bodyResponse(10, { 'Content-Length': '10' }));
    const { executor, tracker } = build({ fetchFn });
    await executor.execute(
      task(blobUrl, { type: 'document', fileName: 'doc.pdf' }),
      vi.fn(),
      new AbortController().signal,
    );
    const expectation = tracker!.expectations[0]!;
    expect(expectation.path).toBe('Telegram/Chat/2026-02-02_9_0_doc.pdf');
    expect(expectation.options.token).toMatch(/^[a-z0-9]{6,}$/);
    expect(clicks).toEqual([`tgmd-${expectation.options.token}__2026-02-02_9_0_doc.pdf`]);
  });

  it('without a tracker, saves under the plain file name', async () => {
    const fetchFn = vi.fn().mockResolvedValue(bodyResponse(10));
    const { executor } = build({ fetchFn, tracker: null });
    await executor.execute(
      task(blobUrl, { type: 'document', fileName: 'doc.pdf' }),
      vi.fn(),
      new AbortController().signal,
    );
    expect(clicks).toEqual(['2026-02-02_9_0_doc.pdf']);
  });

  it('propagates tracker failures of anchor saves', async () => {
    const fetchFn = vi.fn().mockResolvedValue(bodyResponse(10));
    const tracker = new FakeTracker();
    tracker.outcome = new Error('Download interrupted: NETWORK_FAILED');
    const { executor, native } = build({ fetchFn, tracker });
    await expect(
      executor.execute(
        task(blobUrl, { type: 'document' }),
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toThrow(/NETWORK_FAILED/);
    expect(native.requests).toHaveLength(0);
  });

  it('large file (byteSize) without a folder goes native without fetching', async () => {
    const fetchFn = vi.fn();
    const { executor, native } = build({ fetchFn });
    await executor.execute(
      task(blobUrl, { type: 'document', byteSize: 5 * MB }),
      vi.fn(),
      new AbortController().signal,
    );
    expect(fetchFn).not.toHaveBeenCalled();
    expect(native.requests).toHaveLength(1);
  });

  it('large file (Content-Length) without a folder is not buffered', async () => {
    const response = bodyResponse(16, { 'Content-Length': String(2 * MB) });
    const cancel = vi.spyOn(response.body!, 'cancel');
    const { executor, native } = build({ fetchFn: vi.fn().mockResolvedValue(response) });
    await executor.execute(
      task(blobUrl, { type: 'document' }),
      vi.fn(),
      new AbortController().signal,
    );
    expect(cancel).toHaveBeenCalled();
    expect(native.requests).toHaveLength(1);
    expect(clicks).toHaveLength(0);
  });

  it('large file with a writable folder streams to disk', async () => {
    const writer = sink(true);
    const fetchFn = vi
      .fn()
      .mockResolvedValue(bodyResponse(32, { 'Content-Length': String(2 * MB) }));
    const onProgress = vi.fn();
    const { executor, native } = build({ fetchFn, writer });
    await executor.execute(
      task(blobUrl, { type: 'document', byteSize: 2 * MB, fileName: 'big.zip' }),
      onProgress,
      new AbortController().signal,
    );
    expect(writer.writeStream).toHaveBeenCalledWith(
      'Telegram/Chat/2026-02-02_9_0_big.zip',
      expect.anything(),
      expect.any(Function),
      expect.anything(),
    );
    expect(native.requests).toHaveLength(0);
    expect(clicks).toHaveLength(0);
    expect(onProgress).toHaveBeenCalledWith(expect.any(Number), 32, 2 * MB);
  });

  it('ignores a folder whose permission is gone', async () => {
    const writer = sink(false);
    const { executor, native } = build({ writer, fetchFn: vi.fn() });
    await executor.execute(
      task(blobUrl, { type: 'document', byteSize: 5 * MB }),
      vi.fn(),
      new AbortController().signal,
    );
    expect(writer.writeStream).not.toHaveBeenCalled();
    expect(native.requests).toHaveLength(1);
  });

  it('falls back to native when the URL cannot be fetched', async () => {
    const fetchFn = vi.fn().mockRejectedValue(new TypeError('Failed to fetch'));
    const { executor, native } = build({ fetchFn });
    await executor.execute(
      task(blobUrl, { type: 'audio' }),
      vi.fn(),
      new AbortController().signal,
    );
    expect(native.requests).toHaveLength(1);
  });

  it('propagates HTTP errors (e.g. 429 for flood handling)', async () => {
    const fetchFn = vi.fn().mockResolvedValue(new Response('', { status: 429 }));
    const { executor, native } = build({ fetchFn });
    await expect(
      executor.execute(
        task(blobUrl, { type: 'audio' }),
        vi.fn(),
        new AbortController().signal,
      ),
    ).rejects.toBeInstanceOf(HttpDownloadError);
    expect(native.requests).toHaveLength(0);
  });

  it('reads settings live for every task', async () => {
    const { executor, native, settings } = build({ fetchFn: vi.fn() });
    settings.preferNativeDownload = true;
    await executor.execute(task(blobUrl), vi.fn(), new AbortController().signal);
    expect(native.requests).toHaveLength(1);
  });

  it('rejects an already-aborted signal', async () => {
    const { executor } = build({});
    const controller = new AbortController();
    controller.abort();
    await expect(
      executor.execute(task(blobUrl), vi.fn(), controller.signal),
    ).rejects.toThrow('Aborted');
  });

  it('builds a real NativeDownloadTrigger by default', () => {
    expect(
      createDownloadExecutor({
        doc: document,
        client: 'webk',
        getSettings: () => DEFAULT_SETTINGS,
      }),
    ).toBeDefined();
  });
});
