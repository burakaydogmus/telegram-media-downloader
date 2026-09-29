export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
}

export function abortError(): DOMException {
  return new DOMException('Aborted', 'AbortError');
}

export function isAbortError(error: unknown): boolean {
  return (
    typeof error === 'object' &&
    error !== null &&
    (error as { name?: unknown }).name === 'AbortError'
  );
}

/** Like `delay`, but rejects with an AbortError as soon as `signal` aborts. */
export function abortableDelay(ms: number, signal?: AbortSignal): Promise<void> {
  if (signal?.aborted) return Promise.reject(abortError());
  return new Promise((resolve, reject) => {
    const onAbort = (): void => {
      clearTimeout(handle);
      reject(abortError());
    };
    const handle = setTimeout(
      () => {
        signal?.removeEventListener('abort', onAbort);
        resolve();
      },
      Math.max(0, ms),
    );
    signal?.addEventListener('abort', onAbort, { once: true });
  });
}

/**
 * Resolves after the next paint. rAF never fires in background tabs, so a
 * timer caps the wait.
 */
export function nextFrame(win?: Window | null, maxWaitMs = 50): Promise<void> {
  return new Promise((resolve) => {
    const timer = setTimeout(resolve, maxWaitMs);
    const raf = win?.requestAnimationFrame;
    if (typeof raf === 'function') {
      raf.call(win, () => {
        clearTimeout(timer);
        resolve();
      });
    }
  });
}

export function debounce<A extends readonly unknown[]>(
  fn: (...args: A) => void,
  waitMs: number,
): ((...args: A) => void) & { cancel: () => void } {
  let handle: ReturnType<typeof setTimeout> | undefined;
  let lastArgs: A | undefined;

  const debounced = (...args: A): void => {
    lastArgs = args;
    if (handle !== undefined) clearTimeout(handle);
    handle = setTimeout(() => {
      handle = undefined;
      if (lastArgs !== undefined) fn(...lastArgs);
    }, waitMs);
  };

  debounced.cancel = (): void => {
    if (handle !== undefined) {
      clearTimeout(handle);
      handle = undefined;
    }
  };

  return debounced;
}

export async function retry<T>(
  task: (attempt: number) => Promise<T>,
  options: { retries: number; baseDelayMs?: number; signal?: AbortSignal } = {
    retries: 3,
  },
): Promise<T> {
  const baseDelayMs = options.baseDelayMs ?? 200;
  let lastError: unknown;

  for (let attempt = 1; attempt <= options.retries + 1; attempt += 1) {
    if (options.signal?.aborted) {
      throw new DOMException('Aborted', 'AbortError');
    }
    try {
      return await task(attempt);
    } catch (error) {
      lastError = error;
      if (attempt > options.retries) break;
      await delay(baseDelayMs * 2 ** (attempt - 1));
    }
  }

  throw lastError;
}
