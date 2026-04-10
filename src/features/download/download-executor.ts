import type { DownloadTask, MediaItem } from '../../shared/types/index.js';

export type ProgressReporter = (progress: number) => void;

export class NonRetryableDownloadError extends Error {
  readonly nonRetryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableDownloadError';
  }
}

export function isNonRetryable(error: unknown): boolean {
  return (
    error instanceof NonRetryableDownloadError ||
    (typeof error === 'object' &&
      error !== null &&
      (error as { nonRetryable?: unknown }).nonRetryable === true)
  );
}

export interface DownloadExecutor {
  execute(
    task: DownloadTask,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<void>;
}

export class MessageDownloadExecutor implements DownloadExecutor {
  async execute(
    task: DownloadTask,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const url = task.item.url;
    if (url === undefined || url.length === 0) {
      throw new NonRetryableDownloadError('Media item has no downloadable URL');
    }

    onProgress(0.1);
    const response = await chrome.runtime.sendMessage({
      type: 'DOWNLOAD_FILE',
      url,
      fileName: task.item.fileName ?? `${task.item.type}_${task.item.id}`,
    });
    onProgress(1);

    if (!response || response.ok !== true) {
      throw new Error(response?.error ?? 'Background download failed');
    }
  }
}

export class BlobDownloadExecutor implements DownloadExecutor {
  constructor(private readonly doc: Document = document) {}

  async execute(
    task: DownloadTask,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const url = task.item.url;
    if (url === undefined || url.length === 0) {
      throw new NonRetryableDownloadError('Media item has no downloadable URL');
    }

    onProgress(0.02);
    const blob = await this.fetchBlob(url, signal, onProgress);
    this.saveBlob(blob, this.fileNameFor(task));
    onProgress(1);
  }

  private async fetchBlob(
    url: string,
    signal: AbortSignal,
    onProgress: ProgressReporter,
  ): Promise<Blob> {
    let response: Response;
    try {
      response = await fetch(url, { signal, credentials: 'include' });
    } catch (cause) {
      if (signal.aborted) throw new DOMException('Aborted', 'AbortError');
      // A blob: URL backed by a MediaSource (streamed video) is not fetchable.
      throw new NonRetryableDownloadError(
        `Media is not directly downloadable (likely a stream): ${String(cause)}`,
      );
    }
    if (!response.ok) {
      throw new Error(`Fetch failed with HTTP ${response.status}`);
    }

    const total = Number(response.headers.get('Content-Length')) || 0;
    const type = response.headers.get('Content-Type') ?? 'application/octet-stream';

    if (!response.body || total <= 0) {
      onProgress(0.8);
      return response.blob();
    }

    const reader = response.body.getReader();
    const chunks: Uint8Array[] = [];
    let received = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      if (signal.aborted) {
        await reader.cancel();
        throw new DOMException('Aborted', 'AbortError');
      }
      if (value) {
        chunks.push(value);
        received += value.length;
        onProgress(Math.min(0.95, received / total));
      }
    }
    return new Blob(chunks as BlobPart[], { type });
  }

  private saveBlob(blob: Blob, fileName: string): void {
    const objectUrl = URL.createObjectURL(blob);
    try {
      const anchor = this.doc.createElement('a');
      anchor.href = objectUrl;
      anchor.download = fileName;
      anchor.rel = 'noopener';
      anchor.style.display = 'none';
      this.doc.body.appendChild(anchor);
      anchor.click();
      anchor.remove();
    } finally {
      // Give the browser time to start the download before releasing the URL.
      setTimeout(() => URL.revokeObjectURL(objectUrl), 10_000);
    }
  }

  private fileNameFor(task: DownloadTask): string {
    return task.item.fileName ?? `${task.item.type}_${task.item.id}`;
  }
}
export interface NativeDownloader {
  download(item: MediaItem, signal: AbortSignal): Promise<void>;
}
export class CompositeDownloadExecutor implements DownloadExecutor {
  constructor(
    private readonly primary: DownloadExecutor,
    private readonly native: NativeDownloader,
  ) {}

  async execute(
    task: DownloadTask,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<void> {
    if (signal.aborted) throw new DOMException('Aborted', 'AbortError');

    const { item } = task;
    const streamed = item.type === 'video' || item.type === 'gif';
    const hasUrl = typeof item.url === 'string' && item.url.length > 0;

    // Photos/docs/audio with a real URL: fetch the bytes directly.
    if (hasUrl && !streamed) {
      try {
        await this.primary.execute(task, onProgress, signal);
        return;
      } catch (error) {
        if (signal.aborted || !isNonRetryable(error)) throw error;
        // Un-fetchable (e.g. stream): fall through to Telegram's own download.
      }
    }

    onProgress(0.1);
    await this.native.download(item, signal);
    onProgress(1);
  }
}
