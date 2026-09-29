import type {
  MediaItem,
  DownloadTask,
  DownloadState,
  QueueSnapshot,
} from '../../shared/types/index.js';
import { TypedEmitter, randomId } from '../../shared/utils/index.js';
import { DownloadError, toMessage } from '../../shared/errors/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import type { DownloadExecutor } from './download-executor.js';
import { isNonRetryable } from './download-executor.js';

interface QueueEvents extends Record<string, unknown> {
  change: QueueSnapshot;
  taskChange: { readonly task: DownloadTask };
}

export interface DownloadQueueOptions {
  readonly maxConcurrent: number;
  readonly maxRetries: number;
}

export class DownloadQueue {
  private readonly tasks = new Map<string, DownloadTask>();
  private readonly order: string[] = [];
  private readonly controllers = new Map<string, AbortController>();
  private readonly emitter = new TypedEmitter<QueueEvents>();
  private running = 0;
  private maxConcurrent: number;
  private maxRetries: number;

  constructor(
    private readonly executor: DownloadExecutor,
    options: DownloadQueueOptions,
    private readonly logger?: ILogger,
  ) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent);
    this.maxRetries = Math.max(0, options.maxRetries);
  }

  onChange(listener: (snapshot: QueueSnapshot) => void): () => void {
    return this.emitter.on('change', listener);
  }

  onTaskChange(listener: (task: DownloadTask) => void): () => void {
    return this.emitter.on('taskChange', (payload) => listener(payload.task));
  }

  configure(options: Partial<DownloadQueueOptions>): void {
    if (typeof options.maxConcurrent === 'number') {
      this.maxConcurrent = Math.max(1, options.maxConcurrent);
    }
    if (typeof options.maxRetries === 'number') {
      this.maxRetries = Math.max(0, options.maxRetries);
    }
    this.pump();
  }

  enqueue(items: readonly MediaItem[]): readonly DownloadTask[] {
    const created: DownloadTask[] = [];
    const now = Date.now();
    for (const item of items) {
      const task: DownloadTask = {
        id: randomId('dl'),
        item,
        state: 'queued',
        progress: 0,
        attempts: 0,
        createdAt: now,
        updatedAt: now,
      };
      this.tasks.set(task.id, task);
      this.order.push(task.id);
      created.push(task);
    }
    if (created.length > 0) {
      this.logger?.info(`Enqueued ${created.length} download(s)`);
      this.emitChange();
      this.pump();
    }
    return created;
  }

  start(): void {
    this.pump();
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.state === 'completed' || task.state === 'cancelled') return;

    this.controllers.get(taskId)?.abort();
    this.transition(task, 'cancelled');
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) {
      if (task.state === 'queued' || task.state === 'running') {
        this.cancel(task.id);
      }
    }
  }

  retry(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.state !== 'failed' && task.state !== 'cancelled') return;
    task.attempts = 0;
    this.transition(task, 'queued', { progress: 0 });
    this.pump();
  }

  clearFinished(): void {
    for (const id of [...this.order]) {
      const task = this.tasks.get(id);
      if (!task) continue;
      if (
        task.state === 'completed' ||
        task.state === 'failed' ||
        task.state === 'cancelled'
      ) {
        this.tasks.delete(id);
        const idx = this.order.indexOf(id);
        if (idx !== -1) this.order.splice(idx, 1);
      }
    }
    this.emitChange();
  }

  snapshot(): QueueSnapshot {
    const tasks = this.order
      .map((id) => this.tasks.get(id))
      .filter((t): t is DownloadTask => t !== undefined);

    let completed = 0;
    let failed = 0;
    let running = 0;
    let queued = 0;
    let cancelled = 0;
    let progressSum = 0;

    for (const task of tasks) {
      progressSum += task.state === 'completed' ? 1 : task.progress;
      switch (task.state) {
        case 'completed':
          completed += 1;
          break;
        case 'failed':
          failed += 1;
          break;
        case 'running':
          running += 1;
          break;
        case 'queued':
          queued += 1;
          break;
        case 'cancelled':
          cancelled += 1;
          break;
      }
    }

    return {
      tasks,
      total: tasks.length,
      completed,
      failed,
      running,
      queued,
      cancelled,
      overallProgress: tasks.length === 0 ? 0 : progressSum / tasks.length,
      paused: false,
    };
  }

  private pump(): void {
    while (this.running < this.maxConcurrent) {
      const next = this.order
        .map((id) => this.tasks.get(id))
        .find((t): t is DownloadTask => t !== undefined && t.state === 'queued');
      if (!next) break;
      void this.run(next);
    }
  }

  private async run(task: DownloadTask): Promise<void> {
    this.running += 1;
    const controller = new AbortController();
    this.controllers.set(task.id, controller);
    task.attempts += 1;
    this.transition(task, 'running', { progress: 0 });

    try {
      await this.executor.execute(
        task,
        (progress) => {
          if (task.state !== 'running') return;
          task.progress = Math.max(0, Math.min(1, progress));
          task.updatedAt = Date.now();
          this.emitter.emit('taskChange', { task });
        },
        controller.signal,
      );

      if (controller.signal.aborted) {
        this.transition(task, 'cancelled');
      } else {
        this.transition(task, 'completed', { progress: 1 });
      }
    } catch (error) {
      if (controller.signal.aborted) {
        this.transition(task, 'cancelled');
      } else if (!isNonRetryable(error) && task.attempts <= this.maxRetries) {
        this.logger?.warn(
          `Download ${task.id} failed (attempt ${task.attempts}), retrying`,
          toMessage(error),
        );
        this.transition(task, 'queued', { progress: 0 });
      } else {
        const message = toMessage(
          new DownloadError(`Download failed: ${toMessage(error)}`, {
            cause: error,
            userMessageKey: 'error_download_failed',
          }),
        );
        this.transition(task, 'failed', { error: message });
      }
    } finally {
      this.controllers.delete(task.id);
      this.running -= 1;
      this.pump();
    }
  }

  private transition(
    task: DownloadTask,
    state: DownloadState,
    extra: Partial<Pick<DownloadTask, 'progress' | 'error'>> = {},
  ): void {
    task.state = state;
    if (typeof extra.progress === 'number') task.progress = extra.progress;
    if (typeof extra.error === 'string') task.error = extra.error;
    else if (state !== 'failed') delete task.error;
    task.updatedAt = Date.now();
    this.emitter.emit('taskChange', { task });
    this.emitChange();
  }

  private emitChange(): void {
    this.emitter.emit('change', this.snapshot());
  }
}
