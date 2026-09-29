import type {
  MediaItem,
  DownloadTask,
  DownloadState,
  QueueSnapshot,
} from '../../shared/types/index.js';
import { PERF } from '../../shared/constants/index.js';
import { TypedEmitter, randomId } from '../../shared/utils/index.js';
import { DownloadError, toMessage } from '../../shared/errors/index.js';
import type { ILogger } from '../../shared/logger/index.js';
import type { DownloadExecutor } from './download-executor.js';
import { isFloodError, isNonRetryable, floodWaitSeconds } from './download-errors.js';

interface QueueEvents extends Record<string, unknown> {
  change: QueueSnapshot;
  taskChange: { readonly task: DownloadTask };
  progress: { readonly task: DownloadTask };
}

export interface DownloadQueueOptions {
  readonly maxConcurrent: number;
  readonly maxRetries: number;
  /** First retry delay; doubles per attempt. Defaults to `PERF.retryBaseDelayMs`. */
  readonly baseBackoffMs?: number;
  /** Cap for a single retry delay. Defaults to `PERF.retryMaxDelayMs`. */
  readonly maxBackoffMs?: number;
  /** Minimum gap between two progress flushes (default 100 ms → ≤10/s). */
  readonly progressIntervalMs?: number;
  readonly now?: () => number;
  readonly random?: () => number;
}

const TERMINAL: ReadonlySet<DownloadState> = new Set([
  'completed',
  'failed',
  'cancelled',
]);
const JITTER_RATIO = 0.2;

interface RunHandle {
  readonly generation: number;
  readonly controller: AbortController;
}

/**
 * Concurrency-limited download queue with exponential backoff, pause/resume
 * (automatic on Telegram flood errors), per-run generations so a stale run can
 * never overwrite a newer state, and throttled progress events.
 *
 * Events: `onChange` (snapshot, coalesced per microtask), `onTaskChange`
 * (state transitions only), `onProgress` (bytes/progress, throttled).
 */
export class DownloadQueue {
  private readonly tasks = new Map<string, DownloadTask>();
  private order: string[] = [];
  private readonly emitter = new TypedEmitter<QueueEvents>();

  /** FIFO of queued task ids; entries are validated lazily when popped. */
  private ready: string[] = [];
  private readyHead = 0;
  private readonly inReady = new Set<string>();
  /** Queued tasks in backoff, keyed by task id → nextAttemptAt. */
  private readonly waiting = new Map<string, number>();
  /** Re-queued while their previous (stale) run is still settling. */
  private readonly blocked = new Set<string>();
  private readonly active = new Map<string, RunHandle>();
  private readonly generations = new Map<string, number>();
  /** item.id → id of the non-terminal task for it (enqueue dedupe). */
  private readonly liveByItem = new Map<string, string>();

  private running = 0;
  private generationSeq = 0;
  private maxConcurrent: number;
  private maxRetries: number;
  private readonly baseBackoffMs: number;
  private readonly maxBackoffMs: number;
  private readonly progressIntervalMs: number;
  private readonly now: () => number;
  private readonly random: () => number;

  private paused = false;
  private pauseReason: string | undefined;
  private wakeTimer: ReturnType<typeof setTimeout> | undefined;
  private wakeAt = Infinity;
  private changeScheduled = false;

  private readonly dirtyProgress = new Set<string>();
  private progressTimer: ReturnType<typeof setTimeout> | undefined;
  private lastProgressFlush = -Infinity;

  constructor(
    private readonly executor: DownloadExecutor,
    options: DownloadQueueOptions,
    private readonly logger?: ILogger,
  ) {
    this.maxConcurrent = Math.max(1, options.maxConcurrent);
    this.maxRetries = Math.max(0, options.maxRetries);
    this.maxBackoffMs = Math.max(0, options.maxBackoffMs ?? PERF.retryMaxDelayMs);
    this.baseBackoffMs = Math.min(
      this.maxBackoffMs,
      Math.max(0, options.baseBackoffMs ?? PERF.retryBaseDelayMs),
    );
    this.progressIntervalMs = Math.max(0, options.progressIntervalMs ?? 100);
    this.now = options.now ?? Date.now;
    this.random = options.random ?? Math.random;
  }

  get isPaused(): boolean {
    return this.paused;
  }

  onChange(listener: (snapshot: QueueSnapshot) => void): () => void {
    return this.emitter.on('change', listener);
  }

  /** State transitions (queued/running/completed/failed/cancelled). */
  onTaskChange(listener: (task: DownloadTask) => void): () => void {
    return this.emitter.on('taskChange', (payload) => listener(payload.task));
  }

  /** Byte/progress updates of running tasks, throttled to `progressIntervalMs`. */
  onProgress(listener: (task: DownloadTask) => void): () => void {
    return this.emitter.on('progress', (payload) => listener(payload.task));
  }

  configure(
    options: Partial<Pick<DownloadQueueOptions, 'maxConcurrent' | 'maxRetries'>>,
  ): void {
    if (typeof options.maxConcurrent === 'number') {
      this.maxConcurrent = Math.max(1, options.maxConcurrent);
    }
    if (typeof options.maxRetries === 'number') {
      this.maxRetries = Math.max(0, options.maxRetries);
    }
    this.pump();
  }

  /** Adds items; items that already have a queued/running task are skipped. */
  enqueue(items: readonly MediaItem[]): readonly DownloadTask[] {
    const created: DownloadTask[] = [];
    const now = this.now();
    for (const item of items) {
      if (this.liveByItem.has(item.id)) continue;
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
      this.liveByItem.set(item.id, task.id);
      this.pushReady(task.id);
      created.push(task);
    }
    if (created.length > 0) {
      this.logger?.info(`Enqueued ${created.length} download(s)`);
      this.scheduleChange();
      this.pump();
    }
    return created;
  }

  start(): void {
    this.pump();
  }

  pause(reason?: string): void {
    if (this.paused && reason === this.pauseReason) return;
    this.paused = true;
    this.pauseReason = reason;
    this.logger?.info(`Download queue paused${reason ? `: ${reason}` : ''}`);
    this.scheduleChange();
  }

  resume(): void {
    if (!this.paused) return;
    this.paused = false;
    this.pauseReason = undefined;
    this.logger?.info('Download queue resumed');
    this.scheduleChange();
    this.pump();
  }

  cancel(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task || TERMINAL.has(task.state)) return;

    this.bumpGeneration(taskId);
    this.active.get(taskId)?.controller.abort();
    this.forgetQueued(taskId);
    this.transition(task, 'cancelled');
  }

  cancelAll(): void {
    for (const task of this.tasks.values()) {
      if (!TERMINAL.has(task.state)) this.cancel(task.id);
    }
  }

  retry(taskId: string): void {
    const task = this.tasks.get(taskId);
    if (!task) return;
    if (task.state !== 'failed' && task.state !== 'cancelled') return;
    const live = this.liveByItem.get(task.item.id);
    if (live !== undefined && live !== taskId) return;

    this.bumpGeneration(taskId);
    task.attempts = 0;
    delete task.nextAttemptAt;
    delete task.bytesReceived;
    delete task.totalBytes;
    this.transition(task, 'queued', { progress: 0 });
    this.pushReady(taskId);
    this.pump();
  }

  clearFinished(): void {
    const kept: string[] = [];
    for (const id of this.order) {
      const task = this.tasks.get(id);
      if (!task) continue;
      if (TERMINAL.has(task.state)) {
        this.tasks.delete(id);
        if (!this.active.has(id)) this.generations.delete(id);
      } else {
        kept.push(id);
      }
    }
    this.order = kept;
    this.scheduleChange();
  }

  snapshot(): QueueSnapshot {
    const tasks: DownloadTask[] = [];
    let completed = 0;
    let failed = 0;
    let running = 0;
    let queued = 0;
    let cancelled = 0;
    let progressSum = 0;

    for (const id of this.order) {
      const task = this.tasks.get(id);
      if (!task) continue;
      tasks.push(task);
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
      paused: this.paused,
      ...(this.pauseReason !== undefined ? { pauseReason: this.pauseReason } : {}),
    };
  }

  /** Stops timers and listeners; running executors are aborted. */
  dispose(): void {
    for (const handle of this.active.values()) handle.controller.abort();
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer);
    if (this.progressTimer !== undefined) clearTimeout(this.progressTimer);
    this.wakeTimer = undefined;
    this.progressTimer = undefined;
    this.emitter.removeAll();
  }

  private pump(): void {
    if (this.paused) return;
    while (this.running < this.maxConcurrent) {
      const task = this.popReady();
      if (!task) break;
      if (this.active.has(task.id)) {
        // The previous run of this task has not settled yet; resume it after.
        this.blocked.add(task.id);
        continue;
      }
      void this.run(task);
    }
  }

  private popReady(): DownloadTask | undefined {
    while (this.readyHead < this.ready.length) {
      const id = this.ready[this.readyHead];
      this.readyHead += 1;
      if (id === undefined || !this.inReady.has(id)) continue;
      this.inReady.delete(id);
      const task = this.tasks.get(id);
      if (task?.state === 'queued') {
        this.compactReady();
        return task;
      }
    }
    this.ready = [];
    this.readyHead = 0;
    return undefined;
  }

  private compactReady(): void {
    if (this.readyHead > 1024 && this.readyHead * 2 > this.ready.length) {
      this.ready = this.ready.slice(this.readyHead);
      this.readyHead = 0;
    }
  }

  private pushReady(taskId: string, front = false): void {
    if (this.inReady.has(taskId)) return;
    this.inReady.add(taskId);
    if (!front) this.ready.push(taskId);
    else if (this.readyHead > 0) this.ready[--this.readyHead] = taskId;
    else this.ready.unshift(taskId);
  }

  private forgetQueued(taskId: string): void {
    this.inReady.delete(taskId);
    this.waiting.delete(taskId);
    this.blocked.delete(taskId);
  }

  private bumpGeneration(taskId: string): number {
    this.generationSeq += 1;
    this.generations.set(taskId, this.generationSeq);
    return this.generationSeq;
  }

  private async run(task: DownloadTask): Promise<void> {
    const generation = this.bumpGeneration(task.id);
    const controller = new AbortController();
    this.active.set(task.id, { generation, controller });
    this.running += 1;
    task.attempts += 1;
    delete task.nextAttemptAt;
    this.transition(task, 'running', { progress: 0 });

    const isCurrent = (): boolean =>
      this.generations.get(task.id) === generation && task.state === 'running';

    let outcome: { ok: true } | { ok: false; error: unknown };
    try {
      await this.executor.execute(
        task,
        (progress, bytesReceived, totalBytes) => {
          if (!isCurrent()) return;
          this.recordProgress(task, progress, bytesReceived, totalBytes);
        },
        controller.signal,
      );
      outcome = { ok: true };
    } catch (error) {
      outcome = { ok: false, error };
    }

    this.active.delete(task.id);
    this.running -= 1;

    if (isCurrent()) {
      if (controller.signal.aborted) this.transition(task, 'cancelled');
      else if (outcome.ok) this.transition(task, 'completed', { progress: 1 });
      else this.handleFailure(task, outcome.error);
    }

    if (this.blocked.delete(task.id) && this.tasks.get(task.id)?.state === 'queued') {
      this.pushReady(task.id, true);
    }
    if (!this.tasks.has(task.id)) this.generations.delete(task.id);
    this.pump();
  }

  private handleFailure(task: DownloadTask, error: unknown): void {
    if (isFloodError(error)) {
      // Not the item's fault: don't burn an attempt, keep its place, stop.
      task.attempts = Math.max(0, task.attempts - 1);
      this.transition(task, 'queued', { progress: 0 });
      this.pushReady(task.id, true);
      const wait = floodWaitSeconds(error);
      this.pause(
        `Telegram rate limit${wait !== undefined ? ` (wait ${wait}s)` : ''}: ${toMessage(error)}`,
      );
      return;
    }

    if (!isNonRetryable(error) && task.attempts <= this.maxRetries) {
      const delayMs = this.backoffDelay(task.attempts);
      this.logger?.warn(
        `Download ${task.id} failed (attempt ${task.attempts}), retrying in ${delayMs} ms`,
        toMessage(error),
      );
      task.nextAttemptAt = this.now() + delayMs;
      this.transition(task, 'queued', { progress: 0 });
      this.waiting.set(task.id, task.nextAttemptAt);
      this.scheduleWake(task.nextAttemptAt);
      return;
    }

    const message = toMessage(
      new DownloadError(`Download failed: ${toMessage(error)}`, {
        cause: error,
        userMessageKey: 'error_download_failed',
      }),
    );
    this.transition(task, 'failed', { error: message });
  }

  private backoffDelay(attempt: number): number {
    const exponential = this.baseBackoffMs * 2 ** Math.max(0, attempt - 1);
    const capped = Math.min(this.maxBackoffMs, exponential);
    return Math.round(capped + this.random() * capped * JITTER_RATIO);
  }

  private scheduleWake(at: number): void {
    if (at >= this.wakeAt && this.wakeTimer !== undefined) return;
    if (this.wakeTimer !== undefined) clearTimeout(this.wakeTimer);
    this.wakeAt = at;
    this.wakeTimer = setTimeout(() => this.wake(), Math.max(0, at - this.now()));
  }

  private wake(): void {
    this.wakeTimer = undefined;
    this.wakeAt = Infinity;
    const now = this.now();
    let next = Infinity;
    for (const [id, at] of this.waiting) {
      if (at <= now) {
        this.waiting.delete(id);
        const task = this.tasks.get(id);
        if (task?.state === 'queued') {
          delete task.nextAttemptAt;
          this.pushReady(id);
        }
      } else {
        next = Math.min(next, at);
      }
    }
    if (next !== Infinity) this.scheduleWake(next);
    this.pump();
  }

  private recordProgress(
    task: DownloadTask,
    progress: number,
    bytesReceived?: number,
    totalBytes?: number,
  ): void {
    if (typeof totalBytes === 'number' && totalBytes > 0) task.totalBytes = totalBytes;
    if (typeof bytesReceived === 'number' && bytesReceived >= 0) {
      task.bytesReceived = bytesReceived;
    }
    let fraction = progress;
    if (
      !Number.isFinite(fraction) &&
      task.totalBytes &&
      task.bytesReceived !== undefined
    ) {
      fraction = task.bytesReceived / task.totalBytes;
    }
    if (Number.isFinite(fraction)) task.progress = Math.max(0, Math.min(1, fraction));
    task.updatedAt = this.now();
    this.dirtyProgress.add(task.id);
    this.scheduleProgressFlush();
  }

  private scheduleProgressFlush(): void {
    if (this.progressTimer !== undefined) return;
    const wait = Math.max(
      0,
      this.lastProgressFlush + this.progressIntervalMs - this.now(),
    );
    this.progressTimer = setTimeout(() => this.flushProgress(), wait);
  }

  private flushProgress(): void {
    this.progressTimer = undefined;
    this.lastProgressFlush = this.now();
    const ids = [...this.dirtyProgress];
    this.dirtyProgress.clear();
    for (const id of ids) {
      const task = this.tasks.get(id);
      if (task?.state === 'running') this.emitter.emit('progress', { task });
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
    task.updatedAt = this.now();

    if (TERMINAL.has(state)) {
      if (this.liveByItem.get(task.item.id) === task.id) {
        this.liveByItem.delete(task.item.id);
      }
      this.dirtyProgress.delete(task.id);
      delete task.nextAttemptAt;
    } else {
      this.liveByItem.set(task.item.id, task.id);
    }

    this.emitter.emit('taskChange', { task });
    this.scheduleChange();
  }

  private scheduleChange(): void {
    if (this.changeScheduled) return;
    this.changeScheduled = true;
    queueMicrotask(() => {
      this.changeScheduled = false;
      this.emitter.emit('change', this.snapshot());
    });
  }
}
