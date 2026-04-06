import { debounce } from '../shared/utils/index.js';
import { PERF } from '../shared/constants/index.js';
import type { ILogger } from '../shared/logger/index.js';

export type MutationFlushHandler = (addedRoots: readonly Element[]) => void;

export interface MutationEngineOptions {
  readonly debounceMs?: number;
  readonly batchSize?: number;
}
export class MutationEngine {
  private observer: MutationObserver | null = null;
  private target: Node | null = null;
  private readonly pending = new Set<Element>();
  private readonly debounceMs: number;
  private readonly batchSize: number;
  private readonly flushDebounced: (() => void) & { cancel: () => void };

  constructor(
    private readonly handler: MutationFlushHandler,
    options: MutationEngineOptions = {},
    private readonly logger?: ILogger,
  ) {
    this.debounceMs = options.debounceMs ?? PERF.mutationDebounceMs;
    this.batchSize = options.batchSize ?? PERF.scanBatchSize;
    this.flushDebounced = debounce(() => this.flush(), this.debounceMs);
  }

  observe(target: Node): void {
    if (this.observer && this.target === target) return;
    this.disconnect();

    this.target = target;
    this.observer = new MutationObserver((records) => this.onMutations(records));
    this.observer.observe(target, { childList: true, subtree: true });
    this.logger?.debug('MutationEngine observing target');
  }

  disconnect(): void {
    this.flushDebounced.cancel();
    this.observer?.disconnect();
    this.observer = null;
    this.target = null;
    this.pending.clear();
  }

  flushNow(): void {
    this.flushDebounced.cancel();
    this.flush();
  }

  private onMutations(records: readonly MutationRecord[]): void {
    for (const record of records) {
      record.addedNodes.forEach((node) => {
        if (node.nodeType === Node.ELEMENT_NODE) {
          this.pending.add(node as Element);
        }
      });
    }
    if (this.pending.size > 0) this.flushDebounced();
  }

  private flush(): void {
    if (this.pending.size === 0) return;
    const roots = this.dedupeRoots([...this.pending]).slice(0, this.batchSize);
    this.pending.clear();
    if (roots.length === 0) return;
    this.logger?.debug(`MutationEngine flush: ${roots.length} root(s)`);
    this.handler(roots);
  }

  private dedupeRoots(elements: readonly Element[]): Element[] {
    return elements.filter(
      (candidate) =>
        !elements.some((other) => other !== candidate && other.contains(candidate)),
    );
  }
}
