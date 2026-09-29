import { debounce } from '../shared/utils/index.js';
import { PERF } from '../shared/constants/index.js';
import type { ILogger } from '../shared/logger/index.js';

/**
 * Receives disjoint, connected roots in document order: added sub-trees plus
 * elements whose media attributes (`src`, `poster`, `href`, background) changed.
 */
export type MutationFlushHandler = (roots: readonly Element[]) => void;

export interface MutationEngineOptions {
  readonly debounceMs?: number;
  readonly batchSize?: number;
}

export const OBSERVED_ATTRIBUTES = ['src', 'poster', 'style', 'href'] as const;

interface Cancelable {
  cancel(): void;
}

export class MutationEngine {
  private observer: MutationObserver | null = null;
  private target: Node | null = null;
  private pending = new Set<Element>();
  private chunkTask: Cancelable | null = null;
  private readonly debounceMs: number;
  private readonly batchSize: number;
  private readonly flushDebounced: (() => void) & { cancel: () => void };

  constructor(
    private readonly handler: MutationFlushHandler,
    options: MutationEngineOptions = {},
    private readonly logger?: ILogger,
  ) {
    this.debounceMs = options.debounceMs ?? PERF.mutationDebounceMs;
    this.batchSize = Math.max(1, options.batchSize ?? PERF.scanBatchSize);
    this.flushDebounced = debounce(() => this.flushChunk(), this.debounceMs);
  }

  observe(target: Node): void {
    if (this.observer && this.target === target) return;
    this.disconnect();

    this.target = target;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(target, {
      childList: true,
      subtree: true,
      attributes: true,
      attributeFilter: [...OBSERVED_ATTRIBUTES],
    });
    this.logger?.debug('MutationEngine observing target');
  }

  disconnect(): void {
    this.flushDebounced.cancel();
    this.cancelChunkTask();
    this.observer?.disconnect();
    this.observer = null;
    this.target = null;
    this.pending.clear();
  }

  /** Synchronously delivers everything pending (including queued records), chunk by chunk. */
  flushNow(): void {
    this.flushDebounced.cancel();
    this.cancelChunkTask();
    if (this.observer) this.collect(this.observer.takeRecords());
    while (this.pending.size > 0) this.deliverChunk();
  }

  get pendingCount(): number {
    return this.pending.size;
  }

  private onMutations(records: readonly MutationRecord[]): void {
    this.collect(records);
    if (this.pending.size > 0 && this.chunkTask === null) this.flushDebounced();
  }

  private collect(records: readonly MutationRecord[]): void {
    for (const record of records) {
      if (record.type === 'childList') {
        record.addedNodes.forEach((node) => {
          if (node.nodeType === Node.ELEMENT_NODE) this.pending.add(node as Element);
        });
      } else if (record.type === 'attributes' && isMediaAttributeChange(record)) {
        this.pending.add(record.target as Element);
      }
    }
  }

  private flushChunk(): void {
    this.chunkTask = null;
    this.deliverChunk();
    if (this.pending.size > 0) this.chunkTask = scheduleIdle(() => this.flushChunk());
  }

  /** Hands one batch to the handler; the remainder stays pending. */
  private deliverChunk(): void {
    if (this.pending.size === 0) return;
    const roots = outermostInDocumentOrder(this.pending);
    const batch = roots.slice(0, this.batchSize);
    this.pending = new Set(roots.slice(this.batchSize));
    if (batch.length === 0) return;
    this.logger?.debug(
      `MutationEngine flush: ${batch.length} root(s), ${this.pending.size} pending`,
    );
    this.handler(batch);
  }

  private cancelChunkTask(): void {
    this.chunkTask?.cancel();
    this.chunkTask = null;
  }
}

function isMediaAttributeChange(record: MutationRecord): boolean {
  if (record.target.nodeType !== Node.ELEMENT_NODE) return false;
  if (record.attributeName !== 'style') return true;
  // Style churns constantly (animations); only background images matter.
  const style = (record.target as HTMLElement).style as CSSStyleDeclaration | undefined;
  return (style?.backgroundImage ?? '').includes('url(');
}

/**
 * Drops disconnected nodes and nodes nested in another candidate (one parent
 * walk per node against a set: O(n·depth)), then orders the survivors by
 * document position (O(k log k)).
 */
export function outermostInDocumentOrder(elements: Iterable<Element>): Element[] {
  const candidates = new Set<Element>();
  for (const el of elements) if (el.isConnected) candidates.add(el);
  const roots: Element[] = [];
  for (const el of candidates) {
    let ancestor = el.parentElement;
    while (ancestor !== null && !candidates.has(ancestor))
      ancestor = ancestor.parentElement;
    if (ancestor === null) roots.push(el);
  }
  return roots.sort(compareDocumentOrder);
}

function compareDocumentOrder(a: Element, b: Element): number {
  if (a === b) return 0;
  const position = a.compareDocumentPosition(b);
  if (position & Node.DOCUMENT_POSITION_FOLLOWING) return -1;
  if (position & Node.DOCUMENT_POSITION_PRECEDING) return 1;
  return 0;
}

function scheduleIdle(task: () => void): Cancelable {
  if (typeof globalThis.requestIdleCallback === 'function') {
    const handle = globalThis.requestIdleCallback(task, { timeout: 200 });
    return { cancel: () => globalThis.cancelIdleCallback(handle) };
  }
  const handle = setTimeout(task, 0);
  return { cancel: () => clearTimeout(handle) };
}
