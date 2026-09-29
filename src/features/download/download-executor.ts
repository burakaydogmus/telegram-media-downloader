import type { DownloadTask, MediaItem } from '../../shared/types/index.js';
import { abortError } from '../../shared/utils/index.js';
import { HttpDownloadError, NonRetryableDownloadError } from './download-errors.js';

export {
  NonRetryableDownloadError,
  HttpDownloadError,
  isNonRetryable,
  isFloodError,
  floodWaitSeconds,
} from './download-errors.js';

/**
 * `progress` is a 0..1 fraction (NaN when unknown — the queue then derives it
 * from bytes); byte counts are optional.
 */
export type ProgressReporter = (
  progress: number,
  bytesReceived?: number,
  totalBytes?: number,
) => void;

export interface DownloadExecutor {
  execute(
    task: DownloadTask,
    onProgress: ProgressReporter,
    signal: AbortSignal,
  ): Promise<void>;
}

/** Tracking context for a native download (task id + templated path). */
export interface NativeDownloadRequest {
  readonly taskId: string;
  readonly relativePath: string;
  readonly onProgress?: ProgressReporter;
}

export interface NativeDownloader {
  download(
    item: MediaItem,
    signal: AbortSignal,
    request?: NativeDownloadRequest,
  ): Promise<void>;
}

/**
 * Fetches `url`. A network-level failure (e.g. a MediaSource-backed blob: URL)
 * is non-retryable; HTTP errors carry their status.
 */
export async function fetchMedia(
  url: string,
  signal: AbortSignal,
  fetchFn: typeof fetch = fetch,
): Promise<Response> {
  let response: Response;
  try {
    response = await fetchFn(url, { signal, credentials: 'include' });
  } catch (cause) {
    if (signal.aborted) throw abortError();
    throw new NonRetryableDownloadError(
      `Media is not directly downloadable (likely a stream): ${String(cause)}`,
    );
  }
  if (!response.ok) throw new HttpDownloadError(response.status);
  return response;
}

export function contentLength(response: Response): number | undefined {
  const value = Number(response.headers.get('Content-Length'));
  return Number.isFinite(value) && value > 0 ? value : undefined;
}

/** Reads a response into memory, reporting bytes as they arrive. */
export async function readBody(
  response: Response,
  signal: AbortSignal,
  onProgress: ProgressReporter,
  expectedBytes?: number,
): Promise<Blob> {
  const type = response.headers.get('Content-Type') ?? 'application/octet-stream';
  if (!response.body) {
    const blob = await response.blob();
    onProgress(0.95, blob.size, blob.size);
    return blob;
  }
  const total = contentLength(response) ?? expectedBytes;
  const reader = response.body.getReader();
  const chunks: Uint8Array[] = [];
  let received = 0;
  for (;;) {
    const { done, value } = await reader.read();
    if (signal.aborted) {
      await reader.cancel().catch(() => undefined);
      throw abortError();
    }
    if (done) break;
    if (value) {
      chunks.push(value);
      received += value.length;
      onProgress(total ? Math.min(0.95, received / total) : Number.NaN, received, total);
    }
  }
  return new Blob(chunks as BlobPart[], { type });
}

/** Triggers a browser download of `blob` via a temporary `<a download>`. */
export function saveBlob(doc: Document, blob: Blob, fileName: string): void {
  const objectUrl = URL.createObjectURL(blob);
  try {
    const anchor = doc.createElement('a');
    anchor.href = objectUrl;
    anchor.download = fileName;
    anchor.rel = 'noopener';
    anchor.style.display = 'none';
    doc.body.appendChild(anchor);
    anchor.click();
    anchor.remove();
  } finally {
    // Give the browser time to start the download before releasing the URL.
    setTimeout(() => URL.revokeObjectURL(objectUrl), 60_000);
  }
}
