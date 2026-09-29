import { describe, it, expect, vi, afterEach } from 'vitest';
import { DownloadQueue } from '../../src/features/download/download-queue.js';
import type {
  DownloadExecutor,
  ProgressReporter,
} from '../../src/features/download/download-executor.js';
import type { DownloadTask } from '../../src/shared/types/index.js';
import {
  NonRetryableDownloadError,
  HttpDownloadError,
  isFloodError,
} from '../../src/features/download/download-errors.js';
import { makeItem } from '../helpers/factories.js';

class OkExecutor implements DownloadExecutor {
  async execute(_t: DownloadTask, onProgress: ProgressReporter): Promise<void> {
    onProgress(0.5);
    onProgress(1);
  }
}

class FlakyExecutor implements DownloadExecutor {
  public calls = 0;
  public times: number[] = [];
  constructor(
    private readonly failTimes: number,
    private readonly error: () => Error = () => new Error('boom'),
  ) {}
  async execute(): Promise<void> {
    this.calls += 1;
    this.times.push(Date.now());
    if (this.calls <= this.failTimes) throw this.error();
  }
}

/** Resolves/rejects each run by hand; honours abort only when asked. */
class ManualExecutor implements DownloadExecutor {
  runs: Array<{
    task: DownloadTask;
    resolve: () => void;
    reject: (e: unknown) => void;
    onProgress: ProgressReporter;
    signal: AbortSignal;
  }> = [];
  active = 0;
  peakPerTask = new Map<string, number>();
  private perTask = new Map<string, number>();
  constructor(private readonly honourAbort = true) {}
  execute(task: DownloadTask, onProgress: ProgressReporter, signal: AbortSignal) {
    this.active += 1;
    const n = (this.perTask.get(task.id) ?? 0) + 1;
    this.perTask.set(task.id, n);
    this.peakPerTask.set(task.id, Math.max(this.peakPerTask.get(task.id) ?? 0, n));
    const done = (): void => {
      this.active -= 1;
      this.perTask.set(task.id, (this.perTask.get(task.id) ?? 1) - 1);
    };
    return new Promise<void>((resolve, reject) => {
      this.runs.push({
        task,
        onProgress,
        signal,
        resolve: () => {
          done();
          resolve();
        },
        reject: (e) => {
          done();
          reject(e);
        },
      });
      if (this.honourAbort) {
        signal.addEventListener('abort', () => {
          done();
          reject(new DOMException('Aborted', 'AbortError'));
        });
      }
    });
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));
const flushMany = async (n = 10): Promise<void> => {
  for (let i = 0; i < n; i += 1) await flush();
};

afterEach(() => {
  vi.useRealTimers();
});

describe('DownloadQueue basics', () => {
  it('processes queued tasks to completion', async () => {
    const queue = new DownloadQueue(new OkExecutor(), {
      maxConcurrent: 2,
      maxRetries: 0,
    });
    queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    await flushMany(2);
    const snap = queue.snapshot();
    expect(snap.completed).toBe(2);
    expect(snap.overallProgress).toBe(1);
    expect(snap.paused).toBe(false);
  });

  it('marks task failed after exhausting retries', async () => {
    const executor = new FlakyExecutor(99);
    const queue = new DownloadQueue(executor, {
      maxConcurrent: 1,
      maxRetries: 1,
      baseBackoffMs: 0,
    });
    queue.enqueue([makeItem({ id: 'a' })]);
    await flushMany();
    const snap = queue.snapshot();
    expect(executor.calls).toBe(2);
    expect(snap.failed).toBe(1);
    expect(snap.tasks[0]?.error).toBeTypeOf('string');
  });

  it('does not retry non-retryable errors', async () => {
    const executor = new FlakyExecutor(99, () => new NonRetryableDownloadError('no URL'));
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 5 });
    queue.enqueue([makeItem({ id: 'a' })]);
    await flushMany();
    expect(executor.calls).toBe(1);
    expect(queue.snapshot().failed).toBe(1);
  });

  it('honours concurrency limit', async () => {
    let active = 0;
    let peak = 0;
    const executor: DownloadExecutor = {
      async execute(): Promise<void> {
        active += 1;
        peak = Math.max(peak, active);
        await flush();
        active -= 1;
      },
    };
    const queue = new DownloadQueue(executor, { maxConcurrent: 2, maxRetries: 0 });
    queue.enqueue(['a', 'b', 'c', 'd'].map((id) => makeItem({ id })));
    await flushMany();
    expect(peak).toBe(2);
    expect(queue.snapshot().completed).toBe(4);
  });

  it('configure() raises concurrency at runtime', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    queue.enqueue(['a', 'b', 'c'].map((id) => makeItem({ id })));
    expect(executor.active).toBe(1);
    queue.configure({ maxConcurrent: 3 });
    expect(executor.active).toBe(3);
  });

  it('cancels running and queued tasks; cancelAll', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const [a] = queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    queue.cancel(a!.id);
    await flush();
    expect(queue.snapshot().tasks[0]?.state).toBe('cancelled');
    queue.cancelAll();
    await flush();
    expect(queue.snapshot().cancelled).toBe(2);
  });

  it('clearFinished removes terminal tasks', async () => {
    const queue = new DownloadQueue(new OkExecutor(), {
      maxConcurrent: 2,
      maxRetries: 0,
    });
    queue.enqueue([makeItem({ id: 'a' })]);
    await flushMany(3);
    queue.clearFinished();
    expect(queue.snapshot().total).toBe(0);
  });

  it('coalesces change notifications per microtask', async () => {
    const queue = new DownloadQueue(new ManualExecutor(), {
      maxConcurrent: 1,
      maxRetries: 0,
    });
    const onChange = vi.fn();
    queue.onChange(onChange);
    queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    expect(onChange).not.toHaveBeenCalled();
    await Promise.resolve();
    expect(onChange).toHaveBeenCalledTimes(1);
  });

  it('onTaskChange reports state transitions only', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const states: string[] = [];
    queue.onTaskChange((t) => states.push(t.state));
    queue.enqueue([makeItem({ id: 'a' })]);
    executor.runs[0]!.onProgress(0.5);
    executor.runs[0]!.resolve();
    await flush();
    expect(states).toEqual(['running', 'completed']);
  });
});

describe('DownloadQueue dedupe', () => {
  it('skips items that already have a queued or running task', () => {
    const queue = new DownloadQueue(new ManualExecutor(), {
      maxConcurrent: 1,
      maxRetries: 0,
    });
    const first = queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    const second = queue.enqueue([
      makeItem({ id: 'a' }),
      makeItem({ id: 'b' }),
      makeItem({ id: 'c' }),
    ]);
    expect(first).toHaveLength(2);
    expect(second.map((t) => t.item.id)).toEqual(['c']);
    expect(queue.snapshot().total).toBe(3);
  });

  it('dedupes within one batch', () => {
    const queue = new DownloadQueue(new ManualExecutor(), {
      maxConcurrent: 1,
      maxRetries: 0,
    });
    expect(queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'a' })])).toHaveLength(1);
  });

  it('re-enqueueing a finished item creates a new task', async () => {
    const queue = new DownloadQueue(new OkExecutor(), {
      maxConcurrent: 1,
      maxRetries: 0,
    });
    const [first] = queue.enqueue([makeItem({ id: 'a' })]);
    await flushMany(2);
    const [second] = queue.enqueue([makeItem({ id: 'a' })]);
    expect(second).toBeDefined();
    expect(second!.id).not.toBe(first!.id);
  });

  it('retry() is refused while a newer task for the same item is live', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const [first] = queue.enqueue([makeItem({ id: 'a' })]);
    queue.cancel(first!.id);
    await flush();
    const [second] = queue.enqueue([makeItem({ id: 'a' })]);
    queue.retry(first!.id);
    expect(queue.snapshot().tasks.find((t) => t.id === first!.id)?.state).toBe(
      'cancelled',
    );
    expect(second?.state).toBe('running');
  });
});

describe('DownloadQueue backoff', () => {
  it('waits base·2^(n-1) (+jitter) between attempts', async () => {
    vi.useFakeTimers({ now: 0 });
    const executor = new FlakyExecutor(3);
    const queue = new DownloadQueue(executor, {
      maxConcurrent: 1,
      maxRetries: 3,
      baseBackoffMs: 1000,
      maxBackoffMs: 30_000,
      random: () => 0,
    });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(executor.calls).toBe(1);
    expect(task!.state).toBe('queued');
    expect(task!.nextAttemptAt).toBe(1000);

    await vi.advanceTimersByTimeAsync(999);
    expect(executor.calls).toBe(1);
    await vi.advanceTimersByTimeAsync(1);
    expect(executor.calls).toBe(2);

    await vi.advanceTimersByTimeAsync(1999);
    expect(executor.calls).toBe(2);
    await vi.advanceTimersByTimeAsync(1);
    expect(executor.calls).toBe(3);

    await vi.advanceTimersByTimeAsync(4000);
    expect(executor.calls).toBe(4);
    expect(executor.times).toEqual([0, 1000, 3000, 7000]);
    expect(queue.snapshot().completed).toBe(1);
  });

  it('caps the delay and adds proportional jitter', async () => {
    vi.useFakeTimers({ now: 0 });
    const executor = new FlakyExecutor(1);
    const queue = new DownloadQueue(executor, {
      maxConcurrent: 1,
      maxRetries: 1,
      baseBackoffMs: 50_000,
      maxBackoffMs: 10_000,
      random: () => 0.5,
    });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(task!.nextAttemptAt).toBe(11_000);
  });

  it('lets other ready tasks run while one is backing off', async () => {
    vi.useFakeTimers({ now: 0 });
    let aCalls = 0;
    const started: string[] = [];
    const executor: DownloadExecutor = {
      async execute(task): Promise<void> {
        started.push(task.item.id);
        if (task.item.id === 'a' && aCalls++ === 0) throw new Error('boom');
      },
    };
    const queue = new DownloadQueue(executor, {
      maxConcurrent: 1,
      maxRetries: 2,
      baseBackoffMs: 5000,
      random: () => 0,
    });
    queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' }), makeItem({ id: 'c' })]);
    await vi.advanceTimersByTimeAsync(0);
    expect(started).toEqual(['a', 'b', 'c']);
    await vi.advanceTimersByTimeAsync(5000);
    expect(started).toEqual(['a', 'b', 'c', 'a']);
    expect(queue.snapshot().completed).toBe(3);
  });
});

describe('DownloadQueue cancel → retry race', () => {
  it('never runs the same task twice concurrently and ignores the stale run', async () => {
    const executor = new ManualExecutor(false); // ignores abort, finishes later
    const queue = new DownloadQueue(executor, { maxConcurrent: 2, maxRetries: 0 });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    expect(executor.runs).toHaveLength(1);

    queue.cancel(task!.id);
    queue.retry(task!.id);
    await flush();
    expect(task!.state).toBe('queued');
    expect(executor.runs).toHaveLength(1);

    // Stale run completes: must not mark the retried task completed.
    executor.runs[0]!.resolve();
    await flush();
    expect(executor.runs).toHaveLength(2);
    expect(task!.state).toBe('running');
    expect(executor.peakPerTask.get(task!.id)).toBe(1);

    executor.runs[1]!.reject(new NonRetryableDownloadError('x'));
    await flush();
    expect(task!.state).toBe('failed');
  });

  it('a stale failure does not overwrite a cancel', async () => {
    const executor = new ManualExecutor(false);
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 3 });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    queue.cancel(task!.id);
    executor.runs[0]!.reject(new Error('late'));
    await flush();
    expect(task!.state).toBe('cancelled');
    expect(executor.runs).toHaveLength(1);
  });

  it('stale progress is ignored after cancel', async () => {
    const executor = new ManualExecutor(false);
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    queue.cancel(task!.id);
    executor.runs[0]!.onProgress(0.7, 70, 100);
    expect(task!.progress).toBe(0);
    expect(task!.bytesReceived).toBeUndefined();
  });

  it('aborts the signal of a cancelled run', () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    queue.cancel(task!.id);
    expect(executor.runs[0]!.signal.aborted).toBe(true);
  });
});

describe('DownloadQueue pause / flood', () => {
  it('pause() stops new starts; resume() continues', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    queue.pause('manual');
    expect(queue.isPaused).toBe(true);
    queue.enqueue([makeItem({ id: 'a' })]);
    expect(executor.runs).toHaveLength(0);
    const snap = queue.snapshot();
    expect(snap.paused).toBe(true);
    expect(snap.pauseReason).toBe('manual');
    queue.resume();
    expect(executor.runs).toHaveLength(1);
    expect(queue.snapshot().pauseReason).toBeUndefined();
  });

  it('running tasks finish while paused', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    queue.pause();
    executor.runs[0]!.resolve();
    await flush();
    expect(queue.snapshot().completed).toBe(1);
    expect(executor.runs).toHaveLength(1);
  });

  it('auto-pauses on FLOOD_WAIT and re-queues the task at the front', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const [a] = queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    executor.runs[0]!.reject(new Error('FLOOD_WAIT_42'));
    await flush();

    expect(a!.state).toBe('queued');
    expect(a!.attempts).toBe(0);
    expect(queue.isPaused).toBe(true);
    expect(queue.snapshot().pauseReason).toMatch(/rate limit.*42s/);
    expect(executor.runs).toHaveLength(1);

    queue.resume();
    expect(executor.runs[1]!.task.id).toBe(a!.id);
  });

  it('treats HTTP 429 as flood', async () => {
    const executor = new FlakyExecutor(1, () => new HttpDownloadError(429));
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    queue.enqueue([makeItem({ id: 'a' })]);
    await flushMany(3);
    expect(queue.isPaused).toBe(true);
    expect(queue.snapshot().failed).toBe(0);
  });
});

describe('isFloodError', () => {
  it.each([
    [new Error('FLOOD_WAIT_30'), true],
    [new Error('RPC error FLOOD_PREMIUM_WAIT_5'), true],
    [new Error('429 Too Many Requests'), true],
    [new Error('HTTP 420'), true],
    [new HttpDownloadError(429), true],
    [{ code: 420 }, true],
    [new Error('Fetch failed with HTTP 404'), false],
    [new Error('photo_429.jpg missing'), false],
    [new Error('network error'), false],
    [undefined, false],
  ])('%s → %s', (error, expected) => {
    expect(isFloodError(error)).toBe(expected);
  });
});

describe('DownloadQueue progress', () => {
  it('stores bytes and throttles onProgress to the interval', async () => {
    vi.useFakeTimers({ now: 0 });
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, {
      maxConcurrent: 2,
      maxRetries: 0,
      progressIntervalMs: 100,
    });
    const events: Array<[string, number]> = [];
    queue.onProgress((t) => events.push([t.item.id, t.bytesReceived ?? -1]));
    queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    const [a, b] = executor.runs;

    for (let i = 1; i <= 50; i += 1) {
      a!.onProgress(Number.NaN, i * 10, 1000);
      b!.onProgress(i / 50);
    }
    expect(events).toHaveLength(0);
    await vi.advanceTimersByTimeAsync(0);
    expect(events).toEqual([
      ['a', 500],
      ['b', -1],
    ]);
    expect(a!.task.progress).toBeCloseTo(0.5);
    expect(a!.task.totalBytes).toBe(1000);

    a!.onProgress(Number.NaN, 600, 1000);
    await vi.advanceTimersByTimeAsync(50);
    expect(events).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(50);
    expect(events).toHaveLength(3);

    // Emissions per second stay ≤ 10 under a flood of updates.
    events.length = 0;
    for (let ms = 0; ms < 1000; ms += 5) {
      a!.onProgress(Number.NaN, 600 + ms / 10, 1000);
      await vi.advanceTimersByTimeAsync(5);
    }
    expect(events.length).toBeLessThanOrEqual(11);
  });

  it('drops pending progress for tasks that finished', async () => {
    vi.useFakeTimers({ now: 0 });
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const onProgress = vi.fn();
    queue.onProgress(onProgress);
    queue.enqueue([makeItem({ id: 'a' })]);
    executor.runs[0]!.onProgress(0.3);
    executor.runs[0]!.resolve();
    await vi.advanceTimersByTimeAsync(200);
    expect(onProgress).not.toHaveBeenCalled();
  });

  it('dispose() clears timers and aborts running work', async () => {
    const executor = new ManualExecutor();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    queue.enqueue([makeItem({ id: 'a' })]);
    queue.dispose();
    expect(executor.runs[0]!.signal.aborted).toBe(true);
  });
});
