export class CrawlAbortedError extends Error {
  constructor() {
    super('Crawl aborted');
    this.name = 'CrawlAbortedError';
  }
}

export function isAborted(error: unknown): boolean {
  return error instanceof CrawlAbortedError;
}

export function throwIfAborted(signal: AbortSignal): void {
  if (signal.aborted) throw new CrawlAbortedError();
}

export function abortableDelay(ms: number, signal: AbortSignal): Promise<void> {
  return new Promise((resolve, reject) => {
    if (signal.aborted) {
      reject(new CrawlAbortedError());
      return;
    }
    const onAbort = (): void => {
      clearTimeout(handle);
      reject(new CrawlAbortedError());
    };
    const handle = setTimeout(() => {
      signal.removeEventListener('abort', onAbort);
      resolve();
    }, ms);
    signal.addEventListener('abort', onAbort, { once: true });
  });
}

/** Resolves/rejects with `task`, or rejects as soon as `signal` aborts. */
export function raceAbort<T>(task: Promise<T>, signal: AbortSignal): Promise<T> {
  return new Promise<T>((resolve, reject) => {
    if (signal.aborted) {
      reject(new CrawlAbortedError());
      return;
    }
    const onAbort = (): void => reject(new CrawlAbortedError());
    signal.addEventListener('abort', onAbort, { once: true });
    task.then(
      (value) => {
        signal.removeEventListener('abort', onAbort);
        resolve(value);
      },
      (error: unknown) => {
        signal.removeEventListener('abort', onAbort);
        reject(error instanceof Error ? error : new Error(String(error)));
      },
    );
  });
}

export interface GrowthWaitOptions {
  readonly target: Node;
  /** Returns true once the awaited change is visible in the DOM. */
  readonly changed: () => boolean;
  readonly timeoutMs: number;
  /** Once changed, keep waiting until mutations stay quiet this long. */
  readonly quietMs: number;
  readonly signal: AbortSignal;
}

/**
 * Waits until `changed()` holds and the DOM stopped mutating for `quietMs`, or
 * until `timeoutMs` elapses. Resolves with whether the change was observed.
 */
export function waitForDomChange(options: GrowthWaitOptions): Promise<boolean> {
  const { target, changed, timeoutMs, quietMs, signal } = options;
  return new Promise<boolean>((resolve, reject) => {
    if (signal.aborted) {
      reject(new CrawlAbortedError());
      return;
    }
    let seen = false;
    let quietHandle: ReturnType<typeof setTimeout> | undefined;

    const cleanup = (): void => {
      observer.disconnect();
      clearTimeout(timeoutHandle);
      if (quietHandle !== undefined) clearTimeout(quietHandle);
      signal.removeEventListener('abort', onAbort);
    };
    const finish = (result: boolean): void => {
      cleanup();
      resolve(result);
    };
    const onAbort = (): void => {
      cleanup();
      reject(new CrawlAbortedError());
    };
    const armQuiet = (): void => {
      if (quietHandle !== undefined) clearTimeout(quietHandle);
      quietHandle = setTimeout(() => finish(true), quietMs);
    };

    const observer = new MutationObserver(() => {
      if (!seen && changed()) seen = true;
      if (seen) armQuiet();
    });
    const timeoutHandle = setTimeout(() => finish(seen || changed()), timeoutMs);
    signal.addEventListener('abort', onAbort, { once: true });
    observer.observe(target, { childList: true, subtree: true });

    if (changed()) {
      seen = true;
      armQuiet();
    }
  });
}
