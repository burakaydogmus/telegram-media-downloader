import { StubViewModelBase } from '../helpers/stub-view-model-base.js';
import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import { QueueSection } from '../../src/ui/components/queue-section.js';
import { LogsSection } from '../../src/ui/components/logs-section.js';
import { SearchSection } from '../../src/ui/components/search-section.js';
import { FiltersSection } from '../../src/ui/components/filters-section.js';
import { SelectionSection } from '../../src/ui/components/selection-section.js';
import { CrawlSection, parseDateInput } from '../../src/ui/components/crawl-section.js';
import {
  HarnessVM,
  installFrameMock,
  makeTask as harnessTask,
  type FrameMock,
} from './ui-harness.js';
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
    el.flush();
    expect(el.shadowRoot!.textContent).toContain('1 selected');
  });

  it('search section keeps the typed text while the input is focused', () => {
    const vm = new Stub();
    const el = mount(new SearchSection(), vm);
    const input = el.shadowRoot!.querySelector('input')!;
    input.focus();
    input.value = 'bea';
    vm.emit('media');
    el.flush();
    expect(input.value).toBe('bea');
    input.blur();
    vm.emit('filters');
    el.flush();
    expect(input.value).toBe('');
  });

  it('logs section patches existing lines in place', () => {
    const vm = new Stub();
    vm.logs = [{ timestamp: 0, level: 'info', scope: 'x', message: 'one' }];
    const el = mount(new LogsSection(), vm);
    const list = el.shadowRoot!.querySelector('[role="log"]')!;
    const first = list.firstElementChild;
    vm.logs = [...vm.logs, { timestamp: 0, level: 'error', scope: 'x', message: 'two' }];
    vm.emit('logs');
    el.flush();
    expect(list.children).toHaveLength(2);
    expect(list.firstElementChild).toBe(first);
    expect(first!.textContent).toContain('two');
    expect(first!.className).toContain('log-line--error');
  });
});

describe('QueueSection live updates', () => {
  let frames: FrameMock;
  beforeEach(() => {
    frames = installFrameMock();
  });
  afterEach(() => {
    frames.restore();
    delete (window as { showDirectoryPicker?: unknown }).showDirectoryPicker;
  });

  const row = (el: QueueSection, id: string): HTMLElement =>
    el.shadowRoot.querySelector<HTMLElement>(`[data-task-id="${id}"]`)!;

  it('patches progress in place on a progress event without rebuilding rows', () => {
    const vm = new HarnessVM();
    const task = harnessTask({ id: 'a', state: 'running', progress: 0.1 });
    vm.tasks = [task];
    const el = mount(new QueueSection(), vm);
    const before = row(el, 'a');
    const bar = before.querySelector<HTMLElement>('[role="progressbar"]')!;
    expect(bar.getAttribute('aria-valuenow')).toBe('10');

    task.progress = 0.42;
    task.bytesReceived = 12.3 * 1024 * 1024;
    task.totalBytes = 45 * 1024 * 1024;
    vm.emit('progress');
    frames.flush();

    const after = row(el, 'a');
    expect(after).toBe(before);
    expect(after.querySelector('[role="progressbar"]')).toBe(bar);
    expect(bar.getAttribute('aria-valuenow')).toBe('42');
    expect(bar.querySelector<HTMLElement>('.progress__bar')!.style.width).toBe('42%');
    expect(after.textContent).toContain('12.3 MB / 45.0 MB');
  });

  it('reconciles rows by task id on queue events', () => {
    const vm = new HarnessVM();
    vm.tasks = [harnessTask({ id: 'a' }), harnessTask({ id: 'b' })];
    const el = mount(new QueueSection(), vm);
    const a = row(el, 'a');
    const b = row(el, 'b');

    vm.tasks = [
      harnessTask({ id: 'b', state: 'failed', error: 'boom' }),
      harnessTask({ id: 'c' }),
      harnessTask({ id: 'a', state: 'completed', progress: 1 }),
    ];
    vm.emit('queue');
    frames.flush();

    const ids = [...el.shadowRoot.querySelectorAll<HTMLElement>('[data-task-id]')].map(
      (r) => r.dataset.taskId,
    );
    expect(ids).toEqual(['b', 'c', 'a']);
    expect(row(el, 'a')).toBe(a);
    expect(row(el, 'b')).toBe(b);
    expect(b.textContent).toContain('Failed');
    expect(b.textContent).toContain('boom');
    expect(b.querySelector('[aria-label="Retry"]')).not.toBeNull();
    expect(b.querySelector('[aria-label="Cancel"]')).toBeNull();
    expect(a.textContent).toContain('Completed');

    vm.tasks = [];
    vm.emit('queue');
    frames.flush();
    expect(el.shadowRoot.querySelectorAll('[data-task-id]')).toHaveLength(0);
    expect(el.shadowRoot.textContent).toContain('Queue is empty');
  });

  it('batches many events within one frame into a single render', () => {
    const vm = new HarnessVM();
    vm.tasks = [harnessTask({ id: 'a' })];
    const el = mount(new QueueSection(), vm);
    let reads = 0;
    const original = vm.getQueueSnapshot.bind(vm);
    vm.getQueueSnapshot = () => {
      reads += 1;
      return original();
    };
    for (let i = 0; i < 10; i += 1) {
      vm.emit('progress');
      vm.emit('queue');
    }
    expect(reads).toBe(0);
    expect(frames.flush()).toBe(1);
    expect(reads).toBe(1);
    expect(el.shadowRoot.querySelectorAll('[data-task-id]')).toHaveLength(1);
  });

  it('shows the paused state with its reason and toggles pause/resume', () => {
    const vm = new HarnessVM();
    const el = mount(new QueueSection(), vm);
    const pauseBtn = [...el.shadowRoot.querySelectorAll('button')].find(
      (b) => b.textContent === 'Pause',
    )!;
    pauseBtn.click();
    expect(vm.called('pauseQueue')).toHaveLength(1);

    vm.paused = true;
    vm.pauseReason = 'FLOOD_WAIT 30s';
    vm.emit('queue');
    frames.flush();
    expect(el.shadowRoot.textContent).toContain('Queue paused: FLOOD_WAIT 30s');
    expect(pauseBtn.textContent).toBe('Resume');
    pauseBtn.click();
    expect(vm.called('resumeQueue')).toHaveLength(1);

    const clear = [...el.shadowRoot.querySelectorAll('button')].find(
      (b) => b.textContent === 'Clear finished',
    )!;
    clear.click();
    expect(vm.called('clearFinishedTasks')).toHaveLength(1);
  });

  it('hides the save-folder control when the directory picker is unavailable', () => {
    const vm = new HarnessVM();
    const el = mount(new QueueSection(), vm);
    expect(el.shadowRoot.querySelector<HTMLElement>('.folder')!.hidden).toBe(true);
  });

  it('picks and clears the save folder from a user gesture', async () => {
    (window as { showDirectoryPicker?: unknown }).showDirectoryPicker = () => undefined;
    const vm = new HarnessVM();
    const el = mount(new QueueSection(), vm);
    const folder = el.shadowRoot.querySelector<HTMLElement>('.folder')!;
    expect(folder.hidden).toBe(false);
    expect(folder.textContent).toContain('No folder chosen');

    const buttons = [...folder.querySelectorAll('button')];
    buttons.find((b) => b.textContent === 'Choose folder')!.click();
    expect(vm.called('pickDownloadDirectory')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    frames.flush();
    expect(folder.textContent).toContain('Change folder');
    const clear = buttons.find((b) => b.textContent === 'Forget folder')!;
    expect(clear.hidden).toBe(false);
    clear.click();
    expect(vm.called('clearDownloadDirectory')).toHaveLength(1);
    await new Promise((r) => setTimeout(r, 0));
    frames.flush();
    expect(clear.hidden).toBe(true);
  });
});

describe('FiltersSection scope / hide downloaded / reset', () => {
  let frames: FrameMock;
  beforeEach(() => {
    frames = installFrameMock();
  });
  afterEach(() => frames.restore());

  it('wires scope, hide-downloaded and reset, patching state in place', () => {
    const vm = new HarnessVM();
    const el = mount(new FiltersSection(), vm);
    const sr = el.shadowRoot;
    const chip = (label: string) =>
      [...sr.querySelectorAll<HTMLButtonElement>('button.chip')].find(
        (c) => c.textContent === label,
      )!;
    expect(chip('This chat').getAttribute('aria-pressed')).toBe('true');

    const allChats = chip('All chats');
    allChats.click();
    frames.flush();
    expect(vm.called('setScope')).toEqual([['all']]);
    expect(chip('All chats')).toBe(allChats);
    expect(allChats.getAttribute('aria-pressed')).toBe('true');
    expect(chip('This chat').getAttribute('aria-pressed')).toBe('false');

    const checkbox = sr.querySelector<HTMLInputElement>('input[type="checkbox"]')!;
    checkbox.checked = true;
    checkbox.dispatchEvent(new Event('change'));
    expect(vm.called('setHideDownloaded')).toEqual([[true]]);

    [...sr.querySelectorAll('button')]
      .find((b) => b.textContent === 'Reset filters')!
      .click();
    frames.flush();
    expect(vm.called('resetFilters')).toHaveLength(1);
    expect(checkbox.checked).toBe(false);
    expect(chip('This chat').getAttribute('aria-pressed')).toBe('true');
  });
});

describe('CrawlSection', () => {
  let frames: FrameMock;
  beforeEach(() => {
    frames = installFrameMock();
  });
  afterEach(() => frames.restore());

  const visibleButtons = (el: CrawlSection) =>
    [...el.shadowRoot.querySelectorAll('button')]
      .filter((b) => !b.hidden)
      .map((b) => b.textContent);

  it('starts a crawl with and without an until date', () => {
    const vm = new HarnessVM();
    const el = mount(new CrawlSection(), vm);
    expect(visibleButtons(el)).toEqual(['Scan whole chat']);
    const start = el.shadowRoot.querySelector<HTMLButtonElement>('.btn--primary')!;
    start.click();
    const input = el.shadowRoot.querySelector<HTMLInputElement>('input[type="date"]')!;
    input.value = '2025-01-15';
    start.click();
    expect(vm.called('startCrawl')).toEqual([
      [undefined],
      [{ untilTimestamp: new Date(2025, 0, 15).getTime() }],
    ]);
  });

  it('reflects crawl state and wires pause/resume/stop', () => {
    const vm = new HarnessVM();
    const el = mount(new CrawlSection(), vm);
    vm.crawl = {
      status: 'running',
      steps: 12,
      foundItems: 340,
      oldestTimestamp: new Date(2024, 5, 1).getTime(),
    };
    vm.emit('crawl');
    frames.flush();
    expect(visibleButtons(el)).toEqual(['Pause', 'Stop']);
    expect(el.shadowRoot.textContent).toContain('Scanning…');
    expect(el.shadowRoot.textContent).toContain('12 step(s) · 340 item(s) found');
    expect(el.shadowRoot.textContent).toContain(
      new Date(2024, 5, 1).toLocaleDateString(),
    );
    expect(el.shadowRoot.querySelector<HTMLInputElement>('input')!.disabled).toBe(true);

    const click = (label: string) =>
      [...el.shadowRoot.querySelectorAll('button')]
        .find((b) => b.textContent === label)!
        .click();
    click('Pause');
    click('Stop');
    vm.crawl = { status: 'paused', steps: 12, foundItems: 340 };
    vm.emit('crawl');
    frames.flush();
    expect(visibleButtons(el)).toEqual(['Resume', 'Stop']);
    click('Resume');
    expect(vm.called('pauseCrawl')).toHaveLength(1);
    expect(vm.called('stopCrawl')).toHaveLength(1);
    expect(vm.called('resumeCrawl')).toHaveLength(1);

    vm.crawl = { status: 'error', steps: 3, foundItems: 0, error: 'Chat not found' };
    vm.emit('crawl');
    frames.flush();
    expect(visibleButtons(el)).toEqual(['Scan whole chat']);
    expect(el.shadowRoot.querySelector('[role="alert"]')!.textContent).toBe(
      'Chat not found',
    );
  });

  it('parses date input values as local midnight', () => {
    expect(parseDateInput('')).toBeUndefined();
    expect(parseDateInput('garbage')).toBeUndefined();
    expect(parseDateInput('2024-02-29')).toBe(new Date(2024, 1, 29).getTime());
  });
});
