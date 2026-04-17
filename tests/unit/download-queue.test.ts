import { describe, it, expect, vi } from 'vitest';
import { DownloadQueue } from '../../src/features/download/download-queue.js';
import type {
  DownloadExecutor,
  ProgressReporter,
} from '../../src/features/download/download-executor.js';
import type { DownloadTask } from '../../src/shared/types/index.js';
import { NonRetryableDownloadError } from '../../src/features/download/download-executor.js';
import { makeItem } from '../helpers/factories.js';

class OkExecutor implements DownloadExecutor {
  async execute(_t: DownloadTask, onProgress: ProgressReporter): Promise<void> {
    onProgress(0.5);
    onProgress(1);
  }
}

class FlakyExecutor implements DownloadExecutor {
  public calls = 0;
  constructor(private readonly failTimes: number) {}
  async execute(): Promise<void> {
    this.calls += 1;
    if (this.calls <= this.failTimes) throw new Error('boom');
  }
}

const flush = (): Promise<void> => new Promise((r) => setTimeout(r, 0));

describe('DownloadQueue', () => {
  it('processes queued tasks to completion', async () => {
    const queue = new DownloadQueue(new OkExecutor(), {
      maxConcurrent: 2,
      maxRetries: 0,
    });
    queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);

    await flush();
    await flush();

    const snap = queue.snapshot();
    expect(snap.completed).toBe(2);
    expect(snap.overallProgress).toBe(1);
  });

  it('retries failed tasks up to maxRetries then succeeds', async () => {
    const executor = new FlakyExecutor(2);
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 3 });
    queue.enqueue([makeItem({ id: 'a' })]);

    for (let i = 0; i < 10; i += 1) await flush();

    expect(executor.calls).toBe(3);
    expect(queue.snapshot().completed).toBe(1);
  });

  it('marks task failed after exhausting retries', async () => {
    const executor = new FlakyExecutor(99);
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 1 });
    queue.enqueue([makeItem({ id: 'a' })]);

    for (let i = 0; i < 10; i += 1) await flush();

    const snap = queue.snapshot();
    expect(snap.failed).toBe(1);
    const failed = snap.tasks[0];
    expect(failed?.state).toBe('failed');
    expect(failed?.error).toBeTypeOf('string');
  });

  it('does not retry non-retryable errors', async () => {
    const executor = new (class implements DownloadExecutor {
      public calls = 0;
      async execute(): Promise<void> {
        this.calls += 1;
        throw new NonRetryableDownloadError('no URL');
      }
    })();
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 5 });
    queue.enqueue([makeItem({ id: 'a' })]);

    for (let i = 0; i < 10; i += 1) await flush();

    expect(executor.calls).toBe(1); // failed immediately, no retries
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
    queue.enqueue([
      makeItem({ id: 'a' }),
      makeItem({ id: 'b' }),
      makeItem({ id: 'c' }),
      makeItem({ id: 'd' }),
    ]);

    for (let i = 0; i < 10; i += 1) await flush();
    expect(peak).toBeLessThanOrEqual(2);
    expect(queue.snapshot().completed).toBe(4);
  });

  it('cancels a running/queued task', async () => {
    const executor: DownloadExecutor = {
      execute: (_t, _p, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    };
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    await flush();
    queue.cancel(task!.id);
    await flush();
    expect(queue.snapshot().cancelled).toBe(1);
  });

  it('cancelAll cancels everything pending', async () => {
    const executor: DownloadExecutor = {
      execute: (_t, _p, signal) =>
        new Promise((_resolve, reject) => {
          signal.addEventListener('abort', () =>
            reject(new DOMException('Aborted', 'AbortError')),
          );
        }),
    };
    const queue = new DownloadQueue(executor, { maxConcurrent: 5, maxRetries: 0 });
    queue.enqueue([makeItem({ id: 'a' }), makeItem({ id: 'b' })]);
    await flush();
    queue.cancelAll();
    await flush();
    expect(queue.snapshot().cancelled).toBe(2);
  });

  it('retry() re-queues a failed task', async () => {
    const executor = new FlakyExecutor(1);
    const queue = new DownloadQueue(executor, { maxConcurrent: 1, maxRetries: 0 });
    const [task] = queue.enqueue([makeItem({ id: 'a' })]);
    await flush();
    await flush();
    expect(queue.snapshot().failed).toBe(1);

    queue.retry(task!.id);
    for (let i = 0; i < 5; i += 1) await flush();
    expect(queue.snapshot().completed).toBe(1);
  });

  it('clearFinished removes terminal tasks', async () => {
    const queue = new DownloadQueue(new OkExecutor(), {
      maxConcurrent: 2,
      maxRetries: 0,
    });
    queue.enqueue([makeItem({ id: 'a' })]);
    for (let i = 0; i < 3; i += 1) await flush();
    queue.clearFinished();
    expect(queue.snapshot().total).toBe(0);
  });

  it('notifies change listeners', async () => {
    const queue = new DownloadQueue(new OkExecutor(), {
      maxConcurrent: 1,
      maxRetries: 0,
    });
    const onChange = vi.fn();
    queue.onChange(onChange);
    queue.enqueue([makeItem({ id: 'a' })]);
    for (let i = 0; i < 3; i += 1) await flush();
    expect(onChange).toHaveBeenCalled();
  });
});
