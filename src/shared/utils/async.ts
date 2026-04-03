export function delay(ms: number): Promise<void> {
  return new Promise((resolve) => setTimeout(resolve, ms));
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
