import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  MutationEngine,
  outermostInDocumentOrder,
} from '../../src/content/mutation-engine.js';
import { delay } from '../../src/shared/utils/async.js';

function mountTarget(): HTMLElement {
  const target = document.createElement('div');
  document.body.appendChild(target);
  return target;
}

describe('MutationEngine', () => {
  let engine: MutationEngine | undefined;
  afterEach(() => engine?.disconnect());

  it('batches added nodes and debounces the flush', async () => {
    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 20 });
    const target = mountTarget();
    engine.observe(target);

    target.appendChild(document.createElement('p'));
    target.appendChild(document.createElement('span'));

    await delay(50);
    expect(handler).toHaveBeenCalledOnce();
    expect((handler.mock.calls[0]?.[0] as Element[]).length).toBe(2);
  });

  it('de-duplicates nested roots', async () => {
    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 10 });
    const target = mountTarget();
    engine.observe(target);

    const parent = document.createElement('div');
    const child = document.createElement('div');
    target.appendChild(parent);
    parent.appendChild(child); // separate record for the nested node

    await delay(40);
    const roots = handler.mock.calls[0]?.[0] as Element[];
    expect(roots).toEqual([parent]);
  });

  it('processes every root beyond batchSize in subsequent chunks', async () => {
    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 5, batchSize: 10 });
    const target = mountTarget();
    engine.observe(target);

    const added = Array.from({ length: 35 }, () => document.createElement('p'));
    for (const el of added) target.appendChild(el);

    await delay(80);
    expect(handler).toHaveBeenCalledTimes(4);
    const chunks = handler.mock.calls.map((call) => call[0] as Element[]);
    expect(chunks.map((c) => c.length)).toEqual([10, 10, 10, 5]);
    expect(chunks.flat()).toEqual(added);
    expect(engine.pendingCount).toBe(0);
  });

  it('flushNow delivers all pending roots synchronously, including queued records', () => {
    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 1000, batchSize: 3 });
    const target = mountTarget();
    engine.observe(target);
    const added = Array.from({ length: 7 }, () => document.createElement('p'));
    for (const el of added) target.appendChild(el);

    engine.flushNow();
    expect(handler.mock.calls.map((call) => (call[0] as Element[]).length)).toEqual([
      3, 3, 1,
    ]);
    expect(handler.mock.calls.flatMap((call) => call[0] as Element[])).toEqual(added);
  });

  it('drops nodes removed before the flush', async () => {
    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 10 });
    const target = mountTarget();
    engine.observe(target);
    const kept = document.createElement('p');
    const removed = document.createElement('p');
    target.append(kept, removed);
    removed.remove();

    await delay(40);
    expect(handler.mock.calls.flatMap((call) => call[0] as Element[])).toEqual([kept]);
  });

  it('schedules elements whose src / poster / href changes', async () => {
    const img = document.createElement('img');
    const video = document.createElement('video');
    const link = document.createElement('a');
    const target = mountTarget();
    target.append(img, video, link);

    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 10 });
    engine.observe(target);
    img.src = 'blob:https://web.telegram.org/full';
    video.setAttribute('poster', 'blob:https://web.telegram.org/poster');
    link.href = 'https://example.org/file.pdf';

    await delay(40);
    expect(handler.mock.calls.flatMap((call) => call[0] as Element[])).toEqual([
      img,
      video,
      link,
    ]);
  });

  it('only reacts to style changes that set a background image', async () => {
    const box = document.createElement('div');
    const target = mountTarget();
    target.appendChild(box);

    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 10 });
    engine.observe(target);

    box.style.transform = 'translateY(4px)';
    await delay(30);
    expect(handler).not.toHaveBeenCalled();

    box.style.backgroundImage = 'url("blob:https://web.telegram.org/bg")';
    await delay(30);
    expect(handler.mock.calls.flatMap((call) => call[0] as Element[])).toEqual([box]);
  });

  it('ignores attributes outside the filter', async () => {
    const img = document.createElement('img');
    const target = mountTarget();
    target.appendChild(img);
    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 10 });
    engine.observe(target);

    img.setAttribute('class', 'loaded');
    img.setAttribute('data-x', '1');
    await delay(30);
    expect(handler).not.toHaveBeenCalled();
  });

  it('disconnect cancels pending chunks', async () => {
    const handler = vi.fn();
    engine = new MutationEngine(handler, { debounceMs: 5, batchSize: 1 });
    const target = mountTarget();
    engine.observe(target);
    target.append(document.createElement('p'), document.createElement('p'));

    await delay(15);
    engine.disconnect();
    const calls = handler.mock.calls.length;
    await delay(30);
    expect(handler.mock.calls.length).toBe(calls);
    expect(engine.pendingCount).toBe(0);
  });

  it('observe is idempotent for the same target', () => {
    engine = new MutationEngine(vi.fn(), { debounceMs: 5 });
    const target = mountTarget();
    engine.observe(target);
    expect(() => engine?.observe(target)).not.toThrow();
  });
});

describe('outermostInDocumentOrder', () => {
  it('keeps only outermost connected roots in document order', () => {
    const root = mountTarget();
    const a = document.createElement('section');
    const a1 = document.createElement('div');
    const a11 = document.createElement('span');
    const b = document.createElement('section');
    const detached = document.createElement('div');
    a1.appendChild(a11);
    a.appendChild(a1);
    root.append(a, b);

    expect(outermostInDocumentOrder([b, a11, a1, detached, a, a1])).toEqual([a, b]);
    expect(outermostInDocumentOrder([a11, b])).toEqual([a11, b]);
  });

  it('handles a thousand nested pairs quickly', () => {
    const root = mountTarget();
    const nodes: Element[] = [];
    for (let i = 0; i < 1000; i += 1) {
      const wrapper = document.createElement('div');
      const inner = document.createElement('img');
      wrapper.appendChild(inner);
      root.appendChild(wrapper);
      nodes.push(inner, wrapper);
    }
    const started = performance.now();
    const roots = outermostInDocumentOrder(nodes);
    expect(roots).toHaveLength(1000);
    expect(performance.now() - started).toBeLessThan(2000);
  });
});
