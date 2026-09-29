import { toMessage } from '../../shared/errors/index.js';

export class NonRetryableDownloadError extends Error {
  readonly nonRetryable = true;
  constructor(message: string) {
    super(message);
    this.name = 'NonRetryableDownloadError';
  }
}

/** HTTP-ish failure carrying the status code (429 → flood handling). */
export class HttpDownloadError extends Error {
  constructor(
    readonly status: number,
    message = `Fetch failed with HTTP ${status}`,
  ) {
    super(message);
    this.name = 'HttpDownloadError';
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

const FLOOD_TEXT =
  /FLOOD_WAIT|FLOOD_PREMIUM_WAIT|too many requests|(?:^|\b(?:http|status|code|error)\s*:?\s*)(?:420|429)\b/i;

/** Telegram / HTTP rate limiting: FLOOD_WAIT_X, "Too Many Requests", 420/429. */
export function isFloodError(error: unknown): boolean {
  if (typeof error === 'object' && error !== null) {
    const { status, code } = error as { status?: unknown; code?: unknown };
    if (status === 420 || status === 429 || code === 420 || code === 429) return true;
  }
  if (error === undefined || error === null) return false;
  return FLOOD_TEXT.test(toMessage(error));
}

/** Seconds requested by a `FLOOD_WAIT_<n>` error, when present. */
export function floodWaitSeconds(error: unknown): number | undefined {
  const match = /FLOOD(?:_PREMIUM)?_WAIT_(\d+)/i.exec(toMessage(error));
  return match?.[1] !== undefined ? Number(match[1]) : undefined;
}
