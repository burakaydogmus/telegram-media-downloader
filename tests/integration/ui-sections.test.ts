import { StubViewModelBase } from '../helpers/stub-view-model-base.js';
import { describe, it, expect, beforeEach } from 'vitest';
import { QueueSection } from '../../src/ui/components/queue-section.js';
import { LogsSection } from '../../src/ui/components/logs-section.js';
import { SearchSection } from '../../src/ui/components/search-section.js';
import { FiltersSection } from '../../src/ui/components/filters-section.js';
import { SelectionSection } from '../../src/ui/components/selection-section.js';
import type { BaseComponent } from '../../src/ui/components/base-component.js';
import type {
  PanelViewModel,
  PanelEvent,
} from '../../src/ui/components/panel-view-model.js';
import type {
  DownloadTask,
  FilterState,
  MediaItem,
  MediaStatistics,
  QueueSnapshot,
} from '../../src/shared/types/index.js';
import type { LogEntry } from '../../src/shared/logger/index.js';
import { I18n } from '../../src/shared/i18n/index.js';
import { DEFAULT_FILTERS } from '../../src/shared/constants/index.js';

class Stub extends StubViewModelBase implements PanelViewModel {
  readonly i18n = new I18n('en');
  tasks: DownloadTask[] = [];
  logs: LogEntry[] = [];
  filters: FilterState = { ...DEFAULT_FILTERS };
  items: MediaItem[] = [];
  selected: string[] = [];
  calls: Record<string, number> = {};
  lastQuery = '';
  private listeners = new Set<(e: PanelEvent) => void>();

  private bump(name: string): void {
    this.calls[name] = (this.calls[name] ?? 0) + 1;
  }
  getStatistics(): MediaStatistics {
    return {
      total: this.items.length,
      byType: { photo: 0, video: 0, gif: 0, document: 0, audio: 0 },
      totalBytes: 0,
      selected: this.selected.length,
    };
  }
  getVisibleItems(): readonly MediaItem[] {
    return this.items;
  }
  getFilters(): FilterState {
    return this.filters;
  }
  getQueueSnapshot(): QueueSnapshot {
    const completed = this.tasks.filter((t) => t.state === 'completed').length;
    return {
      tasks: this.tasks,
      total: this.tasks.length,
      completed,
      failed: this.tasks.filter((t) => t.state === 'failed').length,
      running: this.tasks.filter((t) => t.state === 'running').length,
      queued: this.tasks.filter((t) => t.state === 'queued').length,
      cancelled: this.tasks.filter((t) => t.state === 'cancelled').length,
      overallProgress: this.tasks.length ? completed / this.tasks.length : 0,
      paused: false,
    };
  }
  getLogs(): readonly LogEntry[] {
    return this.logs;
  }
  getSelectedIds(): readonly string[] {
    return this.selected;
  }
  isSelected(id: string): boolean {
    return this.selected.includes(id);
  }
  setQuery(q: string): void {
    this.lastQuery = q;
    this.bump('setQuery');
    this.emit('filters');
  }
  toggleType(): void {
    this.bump('toggleType');
    this.emit('filters');
  }
  setDateRange(): void {
    this.bump('setDateRange');
    this.emit('filters');
  }
  toggleSelection(): void {}
  selectAllVisible(): void {
    this.bump('selectAllVisible');
  }
  clearSelection(): void {
    this.bump('clearSelection');
  }
  rescan(): void {}
  downloadSelected(): void {
    this.bump('downloadSelected');
  }
  startQueue(): void {
    this.bump('startQueue');
  }
  cancelAllDownloads(): void {
    this.bump('cancelAllDownloads');
  }
  cancelTask(): void {
    this.bump('cancelTask');
  }
  retryTask(): void {
    this.bump('retryTask');
  }
  clearFinishedTasks(): void {}
  exportReport(): void {
    this.bump('exportReport');
  }
  clearLogs(): void {
    this.bump('clearLogs');
  }
  subscribe(l: (e: PanelEvent) => void): () => void {
    this.listeners.add(l);
    return () => this.listeners.delete(l);
  }
  emit(e: PanelEvent): void {
    for (const l of this.listeners) l(e);
  }
}

function makeTask(over: Partial<DownloadTask>): DownloadTask {
  return {
    id: over.id ?? 't1',
    item: over.item ?? { id: 'm1', type: 'photo', fileName: 'p.jpg' },
    state: over.state ?? 'queued',
    progress: over.progress ?? 0,
    attempts: over.attempts ?? 0,
    createdAt: 0,
    updatedAt: 0,
    ...(over.error !== undefined ? { error: over.error } : {}),
  };
}

function mount<T extends BaseComponent>(el: T, vm: PanelViewModel): T {
  el.viewModel = vm;
  el.connect();
  document.body.appendChild(el.host);
  return el;
}

describe('UI sections (integration)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('queue section renders tasks and wires retry/cancel/start/cancel-all', () => {
    const vm = new Stub();
    vm.tasks = [
      makeTask({ id: 'a', state: 'running', progress: 0.5 }),
      makeTask({ id: 'b', state: 'failed', error: 'oops' }),
    ];
    const el = mount(new QueueSection(), vm);
    const sr = el.shadowRoot!;
    expect(sr.textContent).toContain('Running');
    expect(sr.textContent).toContain('Failed');

    const buttons = [...sr.querySelectorAll('button')];
    buttons.find((b) => b.textContent?.includes('Start'))?.click();
    buttons.find((b) => b.textContent?.includes('Cancel all'))?.click();
    // icon buttons: retry (on failed) + cancel (on running)
    sr.querySelector('[aria-label="Retry"]')?.dispatchEvent(new Event('click'));
    sr.querySelector('[aria-label="Cancel"]')?.dispatchEvent(new Event('click'));

    expect(vm.calls.startQueue).toBe(1);
    expect(vm.calls.cancelAllDownloads).toBe(1);
    expect(vm.calls.retryTask).toBe(1);
    expect(vm.calls.cancelTask).toBe(1);
  });

  it('queue section shows empty state', () => {
    const vm = new Stub();
    const el = mount(new QueueSection(), vm);
    expect(el.shadowRoot!.textContent).toContain('Queue is empty');
  });

  it('logs section renders entries and clears them', () => {
    const vm = new Stub();
    vm.logs = [{ timestamp: Date.now(), level: 'warn', scope: 'x', message: 'careful' }];
    const el = mount(new LogsSection(), vm);
    expect(el.shadowRoot!.textContent).toContain('careful');
    el.shadowRoot!.querySelector('[aria-label="Clear logs"]')?.dispatchEvent(
      new Event('click'),
    );
    expect(vm.calls.clearLogs).toBe(1);
  });

  it('logs section shows empty state', () => {
    const vm = new Stub();
    const el = mount(new LogsSection(), vm);
    expect(el.shadowRoot!.textContent).toContain('No log entries');
  });

  it('search section emits debounced queries and clears', async () => {
    const vm = new Stub();
    const el = mount(new SearchSection(), vm);
    const input = el.shadowRoot!.querySelector('input')!;
    input.value = 'beach';
    input.dispatchEvent(new Event('input'));
    await new Promise((r) => setTimeout(r, 200));
    expect(vm.lastQuery).toBe('beach');

    el.shadowRoot!.querySelector('[aria-label="Clear search"]')?.dispatchEvent(
      new Event('click'),
    );
    expect(vm.lastQuery).toBe('');
  });

  it('filters section toggles types and date ranges', () => {
    const vm = new Stub();
    const el = mount(new FiltersSection(), vm);
    const chips = [...el.shadowRoot!.querySelectorAll('button.chip')];
    chips
      .find((c) => c.textContent?.includes('Photos'))
      ?.dispatchEvent(new Event('click'));
    chips
      .find((c) => c.textContent?.includes('Today'))
      ?.dispatchEvent(new Event('click'));
    expect(vm.calls.toggleType).toBe(1);
    expect(vm.calls.setDateRange).toBe(1);
  });

  it('selection section downloads, selects all, clears and exports', () => {
    const vm = new Stub();
    vm.items = [{ id: 'm1', type: 'photo' }];
    vm.selected = ['m1'];
    const el = mount(new SelectionSection(), vm);
    const buttons = [...el.shadowRoot!.querySelectorAll('button')];
    buttons.find((b) => b.textContent?.includes('Select all visible'))?.click();
    buttons.find((b) => b.textContent?.includes('Clear selection'))?.click();
    buttons.find((b) => b.textContent?.includes('Download selected'))?.click();
    buttons.find((b) => b.textContent?.includes('CSV'))?.click();
    buttons.find((b) => b.textContent?.includes('JSON'))?.click();
    expect(vm.calls.selectAllVisible).toBe(1);
    expect(vm.calls.clearSelection).toBe(1);
    expect(vm.calls.downloadSelected).toBe(1);
    expect(vm.calls.exportReport).toBe(2);
  });

  it('selection section reacts to media updates via subscription', () => {
    const vm = new Stub();
    const el = mount(new SelectionSection(), vm);
    vm.selected = ['x'];
    vm.emit('selection');
    expect(el.shadowRoot!.textContent).toContain('1 selected');
  });
});
