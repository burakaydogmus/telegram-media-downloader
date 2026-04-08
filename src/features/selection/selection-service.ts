import { TypedEmitter } from '../../shared/utils/index.js';

interface SelectionEvents extends Record<string, unknown> {
  change: { readonly selected: readonly string[] };
}

export class SelectionService {
  private readonly selected = new Set<string>();
  private readonly emitter = new TypedEmitter<SelectionEvents>();

  onChange(listener: (selected: readonly string[]) => void): () => void {
    return this.emitter.on('change', (payload) => listener(payload.selected));
  }

  get size(): number {
    return this.selected.size;
  }

  has(id: string): boolean {
    return this.selected.has(id);
  }

  values(): readonly string[] {
    return [...this.selected];
  }

  selectOnly(id: string): void {
    this.selected.clear();
    this.selected.add(id);
    this.notify();
  }

  toggle(id: string): void {
    if (this.selected.has(id)) this.selected.delete(id);
    else this.selected.add(id);
    this.notify();
  }

  add(id: string): void {
    if (this.selected.has(id)) return;
    this.selected.add(id);
    this.notify();
  }

  remove(id: string): void {
    if (this.selected.delete(id)) this.notify();
  }

  selectAllVisible(visibleIds: readonly string[]): void {
    let changed = false;
    for (const id of visibleIds) {
      if (!this.selected.has(id)) {
        this.selected.add(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  clear(): void {
    if (this.selected.size === 0) return;
    this.selected.clear();
    this.notify();
  }

  prune(validIds: ReadonlySet<string>): void {
    let changed = false;
    for (const id of [...this.selected]) {
      if (!validIds.has(id)) {
        this.selected.delete(id);
        changed = true;
      }
    }
    if (changed) this.notify();
  }

  private notify(): void {
    this.emitter.emit('change', { selected: this.values() });
  }
}
