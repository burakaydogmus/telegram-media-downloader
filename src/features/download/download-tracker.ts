import type { RuntimeMessage } from '../../shared/types/index.js';
import { abortError } from '../../shared/utils/index.js';
import { toMessage } from '../../shared/errors/index.js';
import { NonRetryableDownloadError } from './download-errors.js';

type UpdateMessage = Extract<RuntimeMessage, { type: 'DOWNLOAD_UPDATE' }>;
type RuntimeListener = (
  message: unknown,
  sender: unknown,
  sendResponse: (response?: unknown) => void,
) => boolean | void;

/** The slice of `chrome.runtime` the tracker needs (injectable for tests). */
export interface TrackerRuntime {
  sendMessage(message: RuntimeMessage): Promise<unknown>;
  readonly onMessage: {
    addListener(listener: RuntimeListener): void;
    removeListener(listener: RuntimeListener): void;
  };
}

export interface ExpectOptions {
  /** Unique marker embedded in the saved file name (anchor downloads). */
  readonly token?: string;
  /** How long the service worker waits for the download to appear. */
  readonly timeoutMs: number;
  readonly signal?: AbortSignal;
}

export interface TrackedDownloadProgress {
  readonly bytesReceived: number;
  readonly totalBytes?: number;
}

export interface TrackedDownload {
  /** Service worker acknowledged the expectation; click only after this. */
  readonly ready: Promise<void>;
  /** The browser download began (or already finished/failed). */
  readonly started: Promise<void>;
  readonly done: Promise<{ filename?: string }>;
  onProgress(listener: (progress: TrackedDownloadProgress) => void): () => void;
  cancel(): void;
}

export const NOT_STARTED_MESSAGE = 'Telegram did not start a download';

/** Chrome interrupt reasons that a retry cannot fix. */
const FATAL_INTERRUPTS = new Set([
  'USER_CANCELED',
  'USER_SHUTDOWN',
  'FILE_ACCESS_DENIED',
  'FILE_NO_SPACE',
  'FILE_NAME_TOO_LONG',
  'FILE_TOO_LARGE',
  'FILE_BLOCKED',
  'FILE_VIRUS_INFECTED',
  'FILE_SECURITY_CHECK_FAILED',
]);

/** Extra local wait beyond the SW timeout before giving up on a silent SW. */
const LOCAL_GRACE_MS = 10_000;

function isUpdate(message: unknown): message is UpdateMessage {
  return (
    typeof message === 'object' &&
    message !== null &&
    (message as { type?: unknown }).type === 'DOWNLOAD_UPDATE' &&
    typeof (message as { taskId?: unknown }).taskId === 'string'
  );
}

function defaultRuntime(): TrackerRuntime {
  return chrome.runtime as unknown as TrackerRuntime;
}

interface Entry {
  readonly handle: TrackedDownload;
  update(message: UpdateMessage): void;
  settle(error: unknown): void;
}

function settled<T>(promise: Promise<T>): Promise<T> {
  promise.catch(() => undefined);
  return promise;
}

/**
 * Content-side half of the download tracking protocol (see `RuntimeMessage`):
 * announces an upcoming browser download with `EXPECT_DOWNLOAD`, then follows
 * it through `DOWNLOAD_UPDATE` messages until it completes or fails.
 */
export class DownloadTracker {
  private readonly entries = new Map<string, Entry>();
  private listening = false;
  private readonly runtimeRef: () => TrackerRuntime;

  private readonly listener: RuntimeListener = (message) => {
    if (!isUpdate(message)) return false;
    this.entries.get(message.taskId)?.update(message);
    return false;
  };

  constructor(runtime?: TrackerRuntime) {
    this.runtimeRef = runtime ? () => runtime : defaultRuntime;
  }

  get pending(): number {
    return this.entries.size;
  }

  expect(taskId: string, relativePath: string, options: ExpectOptions): TrackedDownload {
    this.entries.get(taskId)?.handle.cancel();
    const runtime = this.runtimeRef();
    this.listen(runtime);

    const progressListeners = new Set<(progress: TrackedDownloadProgress) => void>();
    let resolveReady!: () => void;
    let rejectReady!: (error: unknown) => void;
    let resolveStarted!: () => void;
    let rejectStarted!: (error: unknown) => void;
    let resolveDone!: (value: { filename?: string }) => void;
    let rejectDone!: (error: unknown) => void;
    const ready = settled(
      new Promise<void>((res, rej) => ((resolveReady = res), (rejectReady = rej))),
    );
    const started = settled(
      new Promise<void>((res, rej) => ((resolveStarted = res), (rejectStarted = rej))),
    );
    const done = settled(
      new Promise<{ filename?: string }>(
        (res, rej) => ((resolveDone = res), (rejectDone = rej)),
      ),
    );

    let finished = false;
    let hasStarted = false;
    const { signal } = options;
    const localTimer = setTimeout(() => {
      if (!hasStarted) settle(new NonRetryableDownloadError(NOT_STARTED_MESSAGE));
    }, options.timeoutMs + LOCAL_GRACE_MS);

    const cleanup = (): void => {
      finished = true;
      clearTimeout(localTimer);
      signal?.removeEventListener('abort', onAbort);
      if (this.entries.get(taskId) === entry) this.entries.delete(taskId);
      this.unlistenIfIdle(runtime);
    };
    const settle = (error: unknown): void => {
      if (finished) return;
      cleanup();
      rejectReady(error);
      rejectStarted(error);
      rejectDone(error);
    };
    const cancel = (): void => {
      if (finished) return;
      settle(abortError());
      void runtime
        .sendMessage({ type: 'CANCEL_EXPECTED_DOWNLOAD', taskId })
        .catch(() => undefined);
    };
    const onAbort = (): void => cancel();
    const markStarted = (): void => {
      if (hasStarted) return;
      hasStarted = true;
      clearTimeout(localTimer);
      resolveStarted();
    };

    const handle: TrackedDownload = {
      ready,
      started,
      done,
      onProgress(listener) {
        progressListeners.add(listener);
        return () => progressListeners.delete(listener);
      },
      cancel,
    };

    const entry: Entry = {
      handle,
      settle,
      update: (message) => {
        if (finished) return;
        switch (message.phase) {
          case 'started':
          case 'progress': {
            markStarted();
            if (typeof message.bytesReceived === 'number') {
              const progress: TrackedDownloadProgress = {
                bytesReceived: message.bytesReceived,
                ...(typeof message.totalBytes === 'number' && message.totalBytes > 0
                  ? { totalBytes: message.totalBytes }
                  : {}),
              };
              for (const listener of progressListeners) listener(progress);
            }
            break;
          }
          case 'complete':
            markStarted();
            cleanup();
            resolveReady();
            resolveDone(
              message.filename !== undefined ? { filename: message.filename } : {},
            );
            break;
          case 'interrupted': {
            const reason = message.error ?? 'INTERRUPTED';
            settle(
              FATAL_INTERRUPTS.has(reason)
                ? new NonRetryableDownloadError(`Download interrupted: ${reason}`)
                : new Error(`Download interrupted: ${reason}`),
            );
            break;
          }
          case 'expired':
            settle(new NonRetryableDownloadError(message.error ?? NOT_STARTED_MESSAGE));
            break;
        }
      },
    };

    if (signal?.aborted) {
      this.entries.set(taskId, entry);
      settle(abortError());
      return handle;
    }
    signal?.addEventListener('abort', onAbort, { once: true });
    this.entries.set(taskId, entry);

    runtime
      .sendMessage({
        type: 'EXPECT_DOWNLOAD',
        taskId,
        relativePath,
        timeoutMs: options.timeoutMs,
        ...(options.token !== undefined ? { token: options.token } : {}),
      })
      .then((response) => {
        const failed =
          typeof response === 'object' &&
          response !== null &&
          (response as { ok?: unknown }).ok === false;
        if (failed) {
          const error = (response as { error?: unknown }).error;
          settle(
            new Error(`Download tracking unavailable: ${toMessage(error ?? 'error')}`),
          );
        } else {
          resolveReady();
        }
      })
      .catch((error: unknown) =>
        settle(new Error(`Download tracking unavailable: ${toMessage(error)}`)),
      );

    return handle;
  }

  /** Cancels every outstanding expectation. */
  cancelAll(): void {
    for (const entry of [...this.entries.values()]) entry.handle.cancel();
  }

  private listen(runtime: TrackerRuntime): void {
    if (this.listening) return;
    runtime.onMessage.addListener(this.listener);
    this.listening = true;
  }

  private unlistenIfIdle(runtime: TrackerRuntime): void {
    if (!this.listening || this.entries.size > 0) return;
    runtime.onMessage.removeListener(this.listener);
    this.listening = false;
  }
}
