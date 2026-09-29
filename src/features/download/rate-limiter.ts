import { abortableDelay, abortError } from '../../shared/utils/index.js';

export interface RateLimiterOptions {
  /** Minimum gap between two starts; read on every start (live settings). */
  readonly getDelayMs: () => number;
  /** Random extra gap in `[0, jitter)`; read on every start. */
  readonly getJitterMs?: () => number;
  readonly now?: () => number;
  readonly random?: () => number;
}

/**
 * Spaces out starts: every `acquire()` resolves at least `delay + jitter` after
 * the previous one. Waiters are served in order; an aborted waiter leaves the
 * line without consuming a slot.
 */
export class RateLimiter {
  private nextAllowedAt = 0;
  private tail: Promise<void> = Promise.resolve();
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly options: RateLimiterOptions) {
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  acquire(signal?: AbortSignal): Promise<void> {
    const turn = this.tail.then(() => this.waitTurn(signal));
    this.tail = turn.catch(() => undefined);
    return turn;
  }

  /** Forget the last start (e.g. after the user resumes a long pause). */
  reset(): void {
    this.nextAllowedAt = 0;
  }

  private async waitTurn(signal?: AbortSignal): Promise<void> {
    if (signal?.aborted) throw abortError();
    const wait = this.nextAllowedAt - this.now();
    if (wait > 0) await abortableDelay(wait, signal);
    const base = Math.max(0, finite(this.options.getDelayMs()));
    const jitter = Math.max(0, finite(this.options.getJitterMs?.() ?? 0));
    this.nextAllowedAt = this.now() + base + Math.floor(this.random() * jitter);
  }
}

function finite(value: number): number {
  return Number.isFinite(value) ? value : 0;
}
