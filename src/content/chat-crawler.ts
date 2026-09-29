import type {
  CrawlCheckpoint,
  CrawlCheckpointStore,
  CrawlOptions,
  CrawlState,
  LogLevel,
  TelegramClient,
} from '../shared/types/index.js';
import type { ILogger } from '../shared/logger/index.js';
import type { crawlEn } from '../shared/i18n/catalogs/crawl.js';
import { toMessage } from '../shared/errors/index.js';
import {
  abortableDelay,
  CrawlAbortedError,
  isAborted,
  raceAbort,
  throwIfAborted,
  waitForDomChange,
} from './crawler/abortable.js';
import {
  findMessageContainer,
  findScroller,
  isOlderId,
  readOldestMessage,
  type MessageMarker,
} from './crawler/chat-dom.js';

export interface ChatCrawlerDeps {
  doc: Document;
  client: TelegramClient;
  logger?: ILogger;
  checkpoints?: CrawlCheckpointStore;
  getPeerId: () => string | undefined;
  /**
   * Called after each scroll step once the DOM settled. Returns the number of NEW
   * items found. May await downloads of on-screen items.
   */
  onStep: (info: { step: number; oldestTimestamp?: number }) => Promise<number>;
  stepDelayMs?: number;
  settleTimeoutMs?: number;
  /** Quiet window after older messages appeared before the step counts as settled. */
  settleQuietMs?: number;
  /** Consecutive steps without older messages before assuming the chat start. */
  idleStepsToFinish?: number;
  now?: () => number;
  random?: () => number;
}

export type CrawlErrorKey = Extract<keyof typeof crawlEn, `crawl_error_${string}`>;

const DEFAULTS = {
  stepDelayMs: 700,
  jitterRatio: 0.3,
  settleTimeoutMs: 4000,
  settleQuietMs: 250,
  idleStepsToFinish: 3,
} as const;

const ERROR_MESSAGES: Readonly<Record<CrawlErrorKey, string>> = {
  crawl_error_no_chat: 'No chat is open',
  crawl_error_no_container: 'Message list not found',
  crawl_error_container_lost: 'Message list disappeared during the crawl',
  crawl_error_chat_switched: 'Chat changed during the crawl',
  crawl_error_step_failed: 'Crawl step failed',
};

class CrawlFailure extends Error {
  constructor(
    readonly key: CrawlErrorKey,
    detail?: string,
  ) {
    super(detail ? `${ERROR_MESSAGES[key]}: ${detail}` : ERROR_MESSAGES[key]);
    this.name = 'CrawlFailure';
  }
}

type FinishReason = 'beginning' | 'until' | 'maxSteps' | 'stopped';

/**
 * Walks a chat's virtualized history upward by scrolling the message list to the
 * top and waiting for Telegram to prepend older messages. Only ever scrolls; it
 * never clicks or sends keys to Telegram's UI.
 *
 * Resumption limitation: Telegram cannot be jumped to an arbitrary message
 * reliably, so a non-done checkpoint only means "keep crawling upward from the
 * current position". Checkpoint progress never regresses (oldest id/timestamp
 * and step count are merged), and already-registered media is deduplicated by
 * the registry, so it is not counted twice.
 */
export class ChatCrawler {
  private state: CrawlState = { status: 'idle', steps: 0, foundItems: 0 };
  private readonly listeners = new Set<(state: CrawlState) => void>();
  private controller: AbortController | null = null;
  private running: Promise<void> | null = null;
  private resumeWaiter: (() => void) | null = null;
  private errorKey: CrawlErrorKey | undefined;
  private readonly now: () => number;
  private readonly random: () => number;

  constructor(private readonly deps: ChatCrawlerDeps) {
    this.now = deps.now ?? Date.now;
    this.random = deps.random ?? Math.random;
  }

  getState(): CrawlState {
    return this.state;
  }

  /** Translation key for the current error, if any (pair with `crawlEn`). */
  getErrorKey(): CrawlErrorKey | undefined {
    return this.errorKey;
  }

  onChange(listener: (state: CrawlState) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }

  start(options: CrawlOptions = {}): Promise<void> {
    if (this.running) return this.running;
    const controller = new AbortController();
    this.controller = controller;
    this.errorKey = undefined;
    this.running = this.run(options, controller.signal).finally(() => {
      if (this.controller === controller) this.controller = null;
      this.resumeWaiter = null;
      this.running = null;
    });
    return this.running;
  }

  pause(): void {
    if (this.state.status !== 'running') return;
    this.update({ status: 'paused' });
    this.log('info', 'Crawl paused');
  }

  resume(): void {
    if (this.state.status !== 'paused') return;
    this.update({ status: 'running' });
    this.log('info', 'Crawl resumed');
    const waiter = this.resumeWaiter;
    this.resumeWaiter = null;
    waiter?.();
  }

  stop(): void {
    if (!this.controller) return;
    this.log('info', 'Crawl stop requested');
    this.controller.abort();
  }

  private async run(options: CrawlOptions, signal: AbortSignal): Promise<void> {
    const { client, doc } = this.deps;
    const peerId = this.deps.getPeerId();
    const base: CrawlState = { status: 'running', steps: 0, foundItems: 0 };
    this.replace(peerId === undefined ? base : { ...base, peerId });

    try {
      if (!peerId) throw new CrawlFailure('crawl_error_no_chat');
      const container = findMessageContainer(doc, client);
      if (!container) throw new CrawlFailure('crawl_error_no_container');

      const previous = await this.loadCheckpoint(peerId, signal);
      let checkpoint: CrawlCheckpoint = previous ?? {
        peerId,
        steps: 0,
        updatedAt: this.now(),
        done: false,
      };
      this.log('info', `Crawl started for ${peerId} (${client})`, options);

      let idleSteps = 0;
      let reason: FinishReason | undefined;
      const idleLimit = this.deps.idleStepsToFinish ?? DEFAULTS.idleStepsToFinish;

      while (!reason) {
        await this.waitWhilePaused(signal);
        this.assertStillValid(peerId, container);

        const before = readOldestMessage(container, client);
        this.scrollToTop(findScroller(container, client), idleSteps > 0);
        const progressed = await this.waitForOlder(container, before, signal);
        this.assertStillValid(peerId, container);

        const after = readOldestMessage(container, client);
        const step = this.state.steps + 1;
        const oldestTimestamp = minDefined(this.state.oldestTimestamp, after?.timestamp);
        const stepInfo =
          oldestTimestamp === undefined ? { step } : { step, oldestTimestamp };
        const found = await raceAbort(this.deps.onStep(stepInfo), signal);
        throwIfAborted(signal);

        idleSteps = progressed ? 0 : idleSteps + 1;
        const atBeginning = idleSteps >= idleLimit;
        this.update({
          steps: step,
          foundItems: this.state.foundItems + Math.max(0, found),
          ...(oldestTimestamp === undefined ? {} : { oldestTimestamp }),
        });
        this.log(
          'debug',
          `Crawl step ${step}: oldest=${after?.id ?? '?'} progressed=${progressed} found=${found}`,
        );

        checkpoint = mergeCheckpoint(checkpoint, after, oldestTimestamp, this.now(), {
          done: atBeginning,
        });
        await this.saveCheckpoint(checkpoint);

        if (atBeginning) reason = 'beginning';
        else if (
          options.untilTimestamp !== undefined &&
          oldestTimestamp !== undefined &&
          oldestTimestamp < options.untilTimestamp
        ) {
          reason = 'until';
        } else if (options.maxSteps !== undefined && step >= options.maxSteps) {
          reason = 'maxSteps';
        } else {
          await abortableDelay(this.stepDelay(), signal);
        }
      }
      this.finish(reason);
    } catch (error) {
      if (isAborted(error)) {
        this.finish('stopped');
      } else if (error instanceof CrawlFailure) {
        this.fail(error.key, error.message);
      } else {
        this.fail('crawl_error_step_failed', `Crawl step failed: ${toMessage(error)}`);
      }
    }
  }

  private finish(reason: FinishReason): void {
    this.update({ status: 'done' });
    this.log(
      'info',
      `Crawl finished (${reason}) after ${this.state.steps} step(s), ${this.state.foundItems} new item(s)`,
    );
  }

  private fail(key: CrawlErrorKey, message: string): void {
    this.errorKey = key;
    this.update({ status: 'error', error: message });
    this.log('warn', `Crawl stopped: ${message}`);
  }

  private assertStillValid(peerId: string, container: HTMLElement): void {
    const current = this.deps.getPeerId();
    if (current !== peerId) {
      throw new CrawlFailure(
        'crawl_error_chat_switched',
        `${peerId} -> ${current ?? 'none'}`,
      );
    }
    if (!container.isConnected) throw new CrawlFailure('crawl_error_container_lost');
  }

  private scrollToTop(scroller: HTMLElement, nudge: boolean): void {
    // When already pinned to the top Telegram may not fire its "load older"
    // handler again; bounce slightly to re-trigger the threshold check.
    if (nudge && scroller.scrollTop <= 0) {
      scroller.scrollTop = Math.max(1, Math.floor(scroller.clientHeight / 2));
      scroller.dispatchEvent(new Event('scroll'));
    }
    scroller.scrollTop = 0;
    scroller.dispatchEvent(new Event('scroll'));
  }

  private waitForOlder(
    container: HTMLElement,
    before: MessageMarker | undefined,
    signal: AbortSignal,
  ): Promise<boolean> {
    const changed = (): boolean => {
      const current = readOldestMessage(container, this.deps.client);
      if (!current) return false;
      return before === undefined || isOlderId(current.id, before.id);
    };
    return waitForDomChange({
      target: container,
      changed,
      timeoutMs: this.deps.settleTimeoutMs ?? DEFAULTS.settleTimeoutMs,
      quietMs: this.deps.settleQuietMs ?? DEFAULTS.settleQuietMs,
      signal,
    });
  }

  private waitWhilePaused(signal: AbortSignal): Promise<void> {
    if (this.state.status !== 'paused') return Promise.resolve();
    return new Promise<void>((resolve, reject) => {
      const onAbort = (): void => {
        this.resumeWaiter = null;
        reject(new CrawlAbortedError());
      };
      if (signal.aborted) {
        onAbort();
        return;
      }
      signal.addEventListener('abort', onAbort, { once: true });
      this.resumeWaiter = () => {
        signal.removeEventListener('abort', onAbort);
        resolve();
      };
    });
  }

  private stepDelay(): number {
    const base = this.deps.stepDelayMs ?? DEFAULTS.stepDelayMs;
    return Math.round(base + base * DEFAULTS.jitterRatio * this.random());
  }

  private async loadCheckpoint(
    peerId: string,
    signal: AbortSignal,
  ): Promise<CrawlCheckpoint | undefined> {
    const store = this.deps.checkpoints;
    if (!store) return undefined;
    try {
      const checkpoint = await raceAbort(store.get(peerId), signal);
      if (!checkpoint) return undefined;
      if (checkpoint.done) {
        this.log('info', `Chat ${peerId} was fully crawled before; crawling again`);
        return undefined;
      }
      this.log(
        'info',
        `Resuming crawl for ${peerId} from the current position (previous oldest message ${
          checkpoint.oldestMessageId ?? '?'
        }, ${checkpoint.steps} step(s))`,
      );
      return checkpoint;
    } catch (error) {
      if (isAborted(error)) throw error;
      this.log('warn', `Could not read crawl checkpoint: ${toMessage(error)}`);
      return undefined;
    }
  }

  private async saveCheckpoint(checkpoint: CrawlCheckpoint): Promise<void> {
    try {
      await this.deps.checkpoints?.set(checkpoint);
    } catch (error) {
      this.log('warn', `Could not save crawl checkpoint: ${toMessage(error)}`);
    }
  }

  private update(patch: Partial<CrawlState>): void {
    this.replace({ ...this.state, ...patch });
  }

  private replace(next: CrawlState): void {
    this.state = next;
    for (const listener of [...this.listeners]) {
      try {
        listener(next);
      } catch (error) {
        this.log('error', `Crawl listener failed: ${toMessage(error)}`);
      }
    }
  }

  private log(level: LogLevel, message: string, data?: unknown): void {
    this.deps.logger?.[level](message, data);
  }
}

function minDefined(a: number | undefined, b: number | undefined): number | undefined {
  if (a === undefined) return b;
  if (b === undefined) return a;
  return Math.min(a, b);
}

function mergeCheckpoint(
  prev: CrawlCheckpoint,
  oldest: MessageMarker | undefined,
  oldestTimestamp: number | undefined,
  updatedAt: number,
  flags: { done: boolean },
): CrawlCheckpoint {
  const keepPrevId =
    prev.oldestMessageId !== undefined &&
    (oldest === undefined || !isOlderId(oldest.id, prev.oldestMessageId));
  const oldestMessageId = keepPrevId ? prev.oldestMessageId : oldest?.id;
  const ts = minDefined(prev.oldestTimestamp, oldestTimestamp);
  return {
    peerId: prev.peerId,
    ...(oldestMessageId === undefined ? {} : { oldestMessageId }),
    ...(ts === undefined ? {} : { oldestTimestamp: ts }),
    steps: prev.steps + 1,
    updatedAt,
    done: flags.done,
  };
}
