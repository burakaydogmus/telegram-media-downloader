import { afterEach, describe, expect, it, vi } from 'vitest';
import { ChatCrawler, type ChatCrawlerDeps } from '../../src/content/chat-crawler.js';
import {
  findScroller,
  parseTimestamp,
  readOldestMessage,
} from '../../src/content/crawler/chat-dom.js';
import type {
  CrawlCheckpoint,
  CrawlCheckpointStore,
  CrawlState,
  TelegramClient,
} from '../../src/shared/types/index.js';

type Shape = Exclude<TelegramClient, 'unknown'>;

const DAY = 86_400_000;
const BASE_TS = Date.UTC(2024, 0, 1);

interface FakeChat {
  readonly scroller: HTMLElement;
  readonly container: HTMLElement;
  /** Total history size; message ids are 1..total, oldest first. */
  readonly total: number;
  loads: number;
  remove(): void;
}

function timestampFor(id: number): number {
  return BASE_TS + id * DAY;
}

function createMessage(shape: Shape, id: number): HTMLElement {
  const el = document.createElement('div');
  if (shape === 'webk') {
    el.className = 'bubble';
    el.setAttribute('data-mid', String(id));
    el.setAttribute('data-timestamp', String(Math.floor(timestampFor(id) / 1000)));
  } else {
    el.className = 'Message message-list-item';
    el.id = `message-${id}`;
    const time = document.createElement('span');
    time.className = 'message-time';
    time.title = new Date(timestampFor(id)).toISOString();
    el.appendChild(time);
  }
  return el;
}

/**
 * Simulates a virtualized Telegram message list: scrolling to the top loads an
 * older page asynchronously, prepends it and restores scrollTop (as Telegram does).
 */
function createChat(
  shape: Shape,
  options: { total?: number; pageSize?: number; loadDelayMs?: number } = {},
): FakeChat {
  const total = options.total ?? 50;
  const pageSize = options.pageSize ?? 10;
  const loadDelayMs = options.loadDelayMs ?? 5;

  let container: HTMLElement;
  let scroller: HTMLElement;
  let list: HTMLElement;
  if (shape === 'webk') {
    container = document.createElement('div');
    container.className = 'bubbles';
    scroller = document.createElement('div');
    scroller.className = 'scrollable scrollable-y';
    list = document.createElement('div');
    list.className = 'bubbles-inner';
    scroller.appendChild(list);
    container.appendChild(scroller);
  } else {
    container = document.createElement('div');
    container.className = 'MessageList';
    scroller = container;
    list = document.createElement('div');
    list.className = 'messages-container';
    container.appendChild(list);
  }
  document.body.appendChild(container);

  let oldestLoaded = total - pageSize + 1;
  for (let id = oldestLoaded; id <= total; id += 1)
    list.appendChild(createMessage(shape, id));

  let loading = false;
  const chat: FakeChat = {
    scroller,
    container,
    total,
    loads: 0,
    remove: () => container.remove(),
  };
  scroller.addEventListener('scroll', () => {
    if (loading || scroller.scrollTop !== 0 || oldestLoaded <= 1) return;
    loading = true;
    setTimeout(() => {
      loading = false;
      const from = Math.max(1, oldestLoaded - pageSize);
      const fragment = document.createDocumentFragment();
      for (let id = from; id < oldestLoaded; id += 1) {
        fragment.appendChild(createMessage(shape, id));
      }
      list.prepend(fragment);
      oldestLoaded = from;
      chat.loads += 1;
      // Virtualization: drop the newest messages far from the viewport.
      while (list.children.length > pageSize * 3) list.lastElementChild?.remove();
      scroller.scrollTop = 400;
    }, loadDelayMs);
  });
  return chat;
}

class MemoryCheckpoints implements CrawlCheckpointStore {
  readonly writes: CrawlCheckpoint[] = [];
  constructor(private readonly data = new Map<string, CrawlCheckpoint>()) {}
  get(peerId: string): Promise<CrawlCheckpoint | undefined> {
    return Promise.resolve(this.data.get(peerId));
  }
  set(checkpoint: CrawlCheckpoint): Promise<void> {
    this.writes.push(checkpoint);
    this.data.set(checkpoint.peerId, checkpoint);
    return Promise.resolve();
  }
  remove(peerId: string): Promise<void> {
    this.data.delete(peerId);
    return Promise.resolve();
  }
}

function makeCrawler(
  shape: Shape,
  overrides: Partial<ChatCrawlerDeps> = {},
): { crawler: ChatCrawler; states: CrawlState[]; onStep: ReturnType<typeof vi.fn> } {
  const onStep = vi.fn(() => Promise.resolve(2));
  const crawler = new ChatCrawler({
    doc: document,
    client: shape,
    getPeerId: () => 'peer-1',
    onStep,
    stepDelayMs: 1,
    settleTimeoutMs: 40,
    settleQuietMs: 2,
    random: () => 0,
    ...overrides,
  });
  const states: CrawlState[] = [];
  crawler.onChange((state) => states.push(state));
  return { crawler, states, onStep };
}

afterEach(() => {
  vi.useRealTimers();
  vi.unstubAllGlobals();
});

describe('chat-dom helpers', () => {
  it('finds the Web K inner scrollable and the Web A list itself', () => {
    const k = createChat('webk');
    expect(findScroller(k.container, 'webk')).toBe(k.scroller);
    k.remove();
    const a = createChat('weba');
    expect(findScroller(a.container, 'weba')).toBe(a.container);
  });

  it('prefers a measurably scrollable element', () => {
    const outer = document.createElement('div');
    outer.className = 'bubbles';
    const inner = document.createElement('div');
    inner.className = 'scrollable';
    outer.appendChild(inner);
    document.body.appendChild(outer);
    Object.defineProperty(outer, 'scrollHeight', { value: 2000 });
    Object.defineProperty(outer, 'clientHeight', { value: 500 });
    outer.style.overflowY = 'auto';
    expect(findScroller(outer, 'webk')).toBe(outer);
  });

  it('reads the oldest message id and timestamp for both shapes', () => {
    const k = createChat('webk', { total: 30, pageSize: 10 });
    expect(readOldestMessage(k.container, 'webk')).toEqual({
      id: '21',
      timestamp: timestampFor(21),
    });
    k.remove();
    const a = createChat('weba', { total: 30, pageSize: 10 });
    expect(readOldestMessage(a.container, 'weba')).toEqual({
      id: '21',
      timestamp: timestampFor(21),
    });
  });

  it('parses seconds, milliseconds and nested datetime values', () => {
    const el = document.createElement('div');
    el.setAttribute('data-timestamp', '1700000000');
    expect(parseTimestamp(el)).toBe(1_700_000_000_000);
    el.setAttribute('data-timestamp', '1700000000123');
    expect(parseTimestamp(el)).toBe(1_700_000_000_123);
    const nested = document.createElement('div');
    nested.innerHTML = '<time datetime="2024-01-02T00:00:00Z"></time>';
    expect(parseTimestamp(nested)).toBe(Date.parse('2024-01-02T00:00:00Z'));
    expect(parseTimestamp(document.createElement('div'))).toBeUndefined();
  });
});

describe.each<Shape>(['webk', 'weba'])('ChatCrawler (%s)', (shape) => {
  it('walks to the beginning, accumulates found items and marks done', async () => {
    const chat = createChat(shape, { total: 50, pageSize: 10 });
    const checkpoints = new MemoryCheckpoints();
    const { crawler, states, onStep } = makeCrawler(shape, { checkpoints });

    await crawler.start();

    const state = crawler.getState();
    expect(state.status).toBe('done');
    expect(chat.loads).toBe(4);
    // 4 progressing steps + 3 idle steps to confirm the beginning.
    expect(state.steps).toBe(7);
    expect(state.foundItems).toBe(14);
    expect(onStep).toHaveBeenCalledTimes(7);
    expect(state.oldestTimestamp).toBe(timestampFor(1));
    expect(readOldestMessage(chat.container, shape)?.id).toBe('1');
    expect(states[0]?.status).toBe('running');

    expect(checkpoints.writes).toHaveLength(7);
    const last = checkpoints.writes.at(-1);
    expect(last).toMatchObject({
      peerId: 'peer-1',
      oldestMessageId: '1',
      oldestTimestamp: timestampFor(1),
      steps: 7,
      done: true,
    });
    expect(checkpoints.writes.slice(0, -1).every((c) => !c.done)).toBe(true);
  });
});

describe('ChatCrawler end conditions', () => {
  it('stops once untilTimestamp is passed', async () => {
    createChat('webk', { total: 50, pageSize: 10 });
    const checkpoints = new MemoryCheckpoints();
    const { crawler } = makeCrawler('webk', { checkpoints });
    await crawler.start({ untilTimestamp: timestampFor(25) });
    const state = crawler.getState();
    expect(state.status).toBe('done');
    expect(state.steps).toBe(2);
    expect(state.oldestTimestamp).toBe(timestampFor(21));
    expect(checkpoints.writes.at(-1)?.done).toBe(false);
  });

  it('respects maxSteps', async () => {
    createChat('weba', { total: 100, pageSize: 10 });
    const { crawler } = makeCrawler('weba');
    await crawler.start({ maxSteps: 3 });
    expect(crawler.getState()).toMatchObject({ status: 'done', steps: 3, foundItems: 6 });
  });

  it('errors when the chat switches mid-crawl', async () => {
    createChat('webk', { total: 100, pageSize: 10 });
    let peer = 'peer-1';
    const { crawler } = makeCrawler('webk', {
      getPeerId: () => peer,
      onStep: () => {
        peer = 'peer-2';
        return Promise.resolve(0);
      },
    });
    await crawler.start();
    expect(crawler.getState().status).toBe('error');
    expect(crawler.getState().error).toMatch(/Chat changed/);
    expect(crawler.getErrorKey()).toBe('crawl_error_chat_switched');
    expect(crawler.getState().steps).toBe(1);
  });

  it('errors when the message container disappears', async () => {
    const chat = createChat('webk', { total: 100, pageSize: 10 });
    const { crawler } = makeCrawler('webk', {
      onStep: () => {
        chat.remove();
        return Promise.resolve(0);
      },
    });
    await crawler.start();
    expect(crawler.getState().status).toBe('error');
    expect(crawler.getErrorKey()).toBe('crawl_error_container_lost');
  });

  it('errors without an open chat or message list', async () => {
    const noPeer = makeCrawler('webk', { getPeerId: () => undefined }).crawler;
    await noPeer.start();
    expect(noPeer.getErrorKey()).toBe('crawl_error_no_chat');

    const noList = makeCrawler('webk').crawler;
    await noList.start();
    expect(noList.getState().status).toBe('error');
    expect(noList.getErrorKey()).toBe('crawl_error_no_container');
  });

  it('reports onStep failures as errors', async () => {
    createChat('webk');
    const { crawler } = makeCrawler('webk', {
      onStep: () => Promise.reject(new Error('boom')),
    });
    await crawler.start();
    expect(crawler.getState()).toMatchObject({ status: 'error' });
    expect(crawler.getState().error).toMatch(/boom/);
    expect(crawler.getErrorKey()).toBe('crawl_error_step_failed');
  });
});

describe('ChatCrawler control', () => {
  it('pauses and resumes without losing position', async () => {
    const chat = createChat('webk', { total: 60, pageSize: 10 });
    let crawlerRef: ChatCrawler | undefined;
    const { crawler, states } = makeCrawler('webk', {
      onStep: ({ step }) => {
        if (step === 2) crawlerRef?.pause();
        return Promise.resolve(1);
      },
    });
    crawlerRef = crawler;
    const done = crawler.start();

    await vi.waitFor(() => expect(crawler.getState().status).toBe('paused'));
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(crawler.getState().steps).toBe(2);
    const loadsWhilePaused = chat.loads;
    await new Promise((resolve) => setTimeout(resolve, 60));
    expect(chat.loads).toBe(loadsWhilePaused);

    crawler.resume();
    await done;
    expect(crawler.getState().status).toBe('done');
    expect(readOldestMessage(chat.container, 'webk')?.id).toBe('1');
    const statuses = states.map((s) => s.status);
    expect(statuses).toContain('paused');
    expect(statuses.lastIndexOf('running')).toBeGreaterThan(statuses.indexOf('paused'));
  });

  it('stop aborts pending waits immediately and leaves no timers or observers', async () => {
    vi.useFakeTimers();
    let active = 0;
    const Native = MutationObserver;
    class CountingObserver extends Native {
      private on = false;
      override observe(target: Node, options?: MutationObserverInit): void {
        if (!this.on) active += 1;
        this.on = true;
        super.observe(target, options);
      }
      override disconnect(): void {
        if (this.on) active -= 1;
        this.on = false;
        super.disconnect();
      }
    }
    vi.stubGlobal('MutationObserver', CountingObserver);

    createChat('webk', { total: 100, pageSize: 10, loadDelayMs: 1_000_000 });
    const { crawler } = makeCrawler('webk', { settleTimeoutMs: 60_000 });
    const done = crawler.start();
    await vi.advanceTimersByTimeAsync(10);
    expect(active).toBe(1);

    crawler.stop();
    await done;
    expect(crawler.getState().status).toBe('done');
    expect(active).toBe(0);
    // Only the fake chat's own pending page load remains.
    expect(vi.getTimerCount()).toBe(1);
  });

  it('stop while paused ends the crawl', async () => {
    createChat('webk', { total: 100, pageSize: 10 });
    let crawlerRef: ChatCrawler | undefined;
    const { crawler } = makeCrawler('webk', {
      onStep: () => {
        crawlerRef?.pause();
        return Promise.resolve(0);
      },
    });
    crawlerRef = crawler;
    const done = crawler.start();
    await vi.waitFor(() => expect(crawler.getState().status).toBe('paused'));
    crawler.stop();
    await done;
    expect(crawler.getState()).toMatchObject({ status: 'done', steps: 1 });
  });

  it('stop aborts a long-running onStep', async () => {
    createChat('weba');
    const { crawler } = makeCrawler('weba', {
      onStep: () => new Promise<number>(() => undefined),
    });
    const done = crawler.start();
    await vi.waitFor(() => expect(crawler.getState().status).toBe('running'));
    await new Promise((resolve) => setTimeout(resolve, 30));
    crawler.stop();
    await done;
    expect(crawler.getState().status).toBe('done');
    expect(crawler.getState().steps).toBe(0);
  });

  it('leaves no timers behind after reaching the beginning', async () => {
    vi.useFakeTimers();
    createChat('weba', { total: 30, pageSize: 10 });
    const { crawler } = makeCrawler('weba');
    const done = crawler.start();
    await vi.advanceTimersByTimeAsync(5_000);
    await done;
    expect(crawler.getState().status).toBe('done');
    expect(vi.getTimerCount()).toBe(0);
  });

  it('returns the same promise when started twice', () => {
    createChat('webk');
    const { crawler } = makeCrawler('webk');
    const first = crawler.start();
    expect(crawler.start()).toBe(first);
    crawler.stop();
    return first;
  });
});

describe('ChatCrawler checkpoints', () => {
  it('resumes a non-done checkpoint without regressing its progress', async () => {
    createChat('webk', { total: 50, pageSize: 10 });
    const stored: CrawlCheckpoint = {
      peerId: 'peer-1',
      oldestMessageId: '15',
      oldestTimestamp: timestampFor(15),
      steps: 9,
      updatedAt: 1,
      done: false,
    };
    const checkpoints = new MemoryCheckpoints(new Map([['peer-1', stored]]));
    const info = vi.fn();
    const logger = {
      debug: vi.fn(),
      info,
      warn: vi.fn(),
      error: vi.fn(),
    } as unknown as NonNullable<ChatCrawlerDeps['logger']>;
    const { crawler } = makeCrawler('webk', { checkpoints, logger, now: () => 42 });

    await crawler.start({ maxSteps: 1 });

    expect(
      info.mock.calls.some(([msg]) => String(msg).startsWith('Resuming crawl')),
    ).toBe(true);
    expect(checkpoints.writes).toEqual([
      {
        peerId: 'peer-1',
        oldestMessageId: '15',
        oldestTimestamp: timestampFor(15),
        steps: 10,
        updatedAt: 42,
        done: false,
      },
    ]);
  });

  it('keeps crawling when checkpoint writes fail', async () => {
    createChat('webk', { total: 20, pageSize: 10 });
    const checkpoints: CrawlCheckpointStore = {
      get: () => Promise.resolve(undefined),
      set: () => Promise.reject(new Error('quota')),
      remove: () => Promise.resolve(),
    };
    const { crawler } = makeCrawler('webk', { checkpoints });
    await crawler.start();
    expect(crawler.getState().status).toBe('done');
  });
});
