import { describe, it, expect, vi, afterEach } from 'vitest';
import { RateLimiter } from '../../src/features/download/rate-limiter.js';
import { isAbortError } from '../../src/shared/utils/async.js';

afterEach(() => {
  vi.useRealTimers();
});

describe('RateLimiter', () => {
  it('spaces starts by delay + jitter, serving waiters in order', async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = new RateLimiter({
      getDelayMs: () => 1000,
      getJitterMs: () => 500,
      random: () => 0.5,
    });
    const starts: number[] = [];
    const order: number[] = [];
    for (let i = 0; i < 3; i += 1) {
      void limiter.acquire().then(() => {
        starts.push(Date.now());
        order.push(i);
      });
    }
    await vi.advanceTimersByTimeAsync(5000);
    expect(starts).toEqual([0, 1250, 2500]);
    expect(order).toEqual([0, 1, 2]);
  });

  it('reads settings live on every start', async () => {
    vi.useFakeTimers({ now: 0 });
    let delayMs = 1000;
    const limiter = new RateLimiter({ getDelayMs: () => delayMs, random: () => 0 });
    await limiter.acquire();
    delayMs = 100;
    const second = limiter.acquire().then(() => Date.now());
    await vi.advanceTimersByTimeAsync(1000);
    expect(await second).toBe(1000);
    const third = limiter.acquire().then(() => Date.now());
    await vi.advanceTimersByTimeAsync(100);
    expect(await third).toBe(1100);
  });

  it('an aborted waiter leaves the line without taking a slot', async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = new RateLimiter({ getDelayMs: () => 1000, random: () => 0 });
    await limiter.acquire();
    const controller = new AbortController();
    const aborted = limiter.acquire(controller.signal);
    const next = limiter.acquire().then(() => Date.now());
    controller.abort();
    await expect(aborted).rejects.toSatisfy(isAbortError);
    await vi.advanceTimersByTimeAsync(1000);
    expect(await next).toBe(1000);
  });

  it('rejects immediately with an already-aborted signal', async () => {
    const limiter = new RateLimiter({ getDelayMs: () => 0 });
    const controller = new AbortController();
    controller.abort();
    await expect(limiter.acquire(controller.signal)).rejects.toSatisfy(isAbortError);
  });

  it('reset() forgets the previous start and ignores bad values', async () => {
    vi.useFakeTimers({ now: 0 });
    const limiter = new RateLimiter({
      getDelayMs: () => Number.NaN,
      getJitterMs: () => -5,
    });
    await limiter.acquire();
    limiter.reset();
    const t = limiter.acquire().then(() => Date.now());
    await vi.advanceTimersByTimeAsync(0);
    expect(await t).toBe(0);
  });
});
