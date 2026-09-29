import type {
  DownloadTask,
  MediaItem,
  Settings,
  TelegramClient,
} from '../../shared/types/index.js';
import { abortError, randomId } from '../../shared/utils/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import { NativeDownloadTrigger } from '../../content/native-download.js';
import type { DownloadExpecter } from '../../content/native-download.js';
import {
  contentLength,
  fetchMedia,
  readBody,
  saveBlob,
  type DownloadExecutor,
  type NativeDownloader,
  type ProgressReporter,
} from './download-executor.js';
import { isNonRetryable } from './download-errors.js';
import { buildRelativePath, fileNameOf } from './file-namer.js';
import type { DirectoryWriter } from './directory-writer.js';

export type DownloadRoute = 'native' | 'direct';

/** The part of `DirectoryWriter` the executor uses. */
export type DirectorySink = Pick<
  DirectoryWriter,
  'hasHandle' | 'isWritable' | 'writeStream'
>;

export interface DownloadExecutorDeps {
  readonly doc: Document;
  readonly client: TelegramClient;
  readonly logger?: ILogger;
  readonly tracker?: DownloadExpecter;
  readonly directoryWriter?: DirectorySink;
  /** Read on every task: settings may change while the queue runs. */
  readonly getSettings: () => Settings;
  /** Overrides the Telegram-menu downloader (tests). */
  readonly native?: NativeDownloader;
  readonly fetchFn?: typeof fetch;
}

const ANCHOR_EXPECT_TIMEOUT_MS = 30_000;
const TELEGRAM_HOST = 'web.telegram.org';

/** Same-origin `blob:` URLs and https URLs on web.telegram.org can be fetched. */
export function isFetchableUrl(url: string | undefined, pageOrigin?: string): boolean {
  if (!url) return false;
  try {
    if (url.startsWith('blob:')) {
      const inner = new URL(url.slice(5));
      return pageOrigin === undefined || inner.origin === pageOrigin;
    }
    const parsed = new URL(url);
    return (
      parsed.protocol === 'https:' &&
      (parsed.hostname === TELEGRAM_HOST || parsed.origin === pageOrigin)
    );
  } catch {
    return false;
  }
}

/** Where a task should go before any bytes are fetched. */
export function chooseRoute(
  item: MediaItem,
  settings: Settings,
  pageOrigin?: string,
): DownloadRoute {
  if (item.type === 'video' || item.type === 'gif') return 'native';
  // In-chat photo blobs are downscaled previews; Telegram's menu saves originals.
  if (item.type === 'photo' && settings.preferNativeDownload) return 'native';
  return isFetchableUrl(item.url, pageOrigin) ? 'direct' : 'native';
}

function shortToken(): string {
  return randomId('t')
    .replace(/[^a-z0-9]/gi, '')
    .slice(-12)
    .toLowerCase();
}

/**
 * Routes each task: native (Telegram's menu) for video/GIF and, by default,
 * photos; direct fetch for fetchable documents/audio. Large direct files are
 * streamed to the picked folder, or handed to the native path — never
 * buffered. In-memory saves embed a token in the file name so the service
 * worker can rename them to the templated path and report completion.
 */
export class StrategyDownloadExecutor implements DownloadExecutor {
  private readonly native: NativeDownloader;
  private readonly fetchFn: typeof fetch;

  constructor(private readonly deps: DownloadExecutorDeps) {
    this.native =
      deps.native ??
      new NativeDownloadTrigger(deps.client, deps.doc, deps.logger, {
        ...(deps.tracker ? { tracker: deps.tracker } : {}),
        getSettings: deps.getSettings,
      });
    this.fetchFn = deps.fetchFn ?? ((input, init) => fetch(input, init));
  }

  async execute(
    task: DownloadTask,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw abortError();
    const settings = this.deps.getSettings();
    const { item } = task;
    const relativePath = buildRelativePath(settings.fileNameTemplate, item);
    const origin = this.deps.doc.location?.origin;

    if (chooseRoute(item, settings, origin) === 'direct') {
      if (await this.direct(task, relativePath, settings, onProgress, signal)) return;
    }

    await this.native.download(item, signal, {
      taskId: task.id,
      relativePath,
      onProgress,
    });
    onProgress(1);
  }

  /** Returns false when the task should go native instead. */
  private async direct(
    task: DownloadTask,
    relativePath: string,
    settings: Settings,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<boolean> {
    const { item } = task;
    const url = item.url ?? '';
    const thresholdBytes = Math.max(1, settings.largeFileThresholdMb) * 1024 * 1024;
    const writer = this.deps.directoryWriter;
    const toDisk = writer ? await writer.isWritable() : false;

    if (!toDisk && (item.byteSize ?? 0) > thresholdBytes) return false;

    let response: Response;
    try {
      response = await fetchMedia(url, signal, this.fetchFn);
    } catch (error) {
      if (signal.aborted || !isNonRetryable(error)) throw error;
      // Not fetchable (e.g. a MediaSource stream): Telegram's menu can still save it.
      this.deps.logger?.debug(`Direct fetch of ${item.id} impossible, using Telegram`);
      return false;
    }
    const total = contentLength(response) ?? item.byteSize;

    if (toDisk && writer && response.body) {
      await writer.writeStream(
        relativePath,
        response.body,
        (written) =>
          onProgress(
            total ? Math.min(0.99, written / total) : Number.NaN,
            written,
            total,
          ),
        signal,
      );
      onProgress(1, total, total);
      return true;
    }

    if ((total ?? 0) > thresholdBytes) {
      await response.body?.cancel().catch(() => undefined);
      return false;
    }

    const blob = await readBody(response, signal, onProgress, total);
    await this.saveInMemory(task, blob, relativePath, signal);
    onProgress(1, blob.size, blob.size);
    return true;
  }

  private async saveInMemory(
    task: DownloadTask,
    blob: Blob,
    relativePath: string,
    signal: AbortSignal,
  ): Promise<void> {
    const { tracker } = this.deps;
    const token = shortToken();
    const fileName = `tgmd-${token}__${fileNameOf(relativePath)}`;
    if (!tracker) {
      saveBlob(this.deps.doc, blob, fileNameOf(relativePath));
      return;
    }
    const tracked = tracker.expect(task.id, relativePath, {
      token,
      timeoutMs: ANCHOR_EXPECT_TIMEOUT_MS,
      signal,
    });
    await tracked.ready;
    saveBlob(this.deps.doc, blob, fileName);
    await tracked.done;
  }
}

export function createDownloadExecutor(deps: DownloadExecutorDeps): DownloadExecutor {
  return new StrategyDownloadExecutor(deps);
}
