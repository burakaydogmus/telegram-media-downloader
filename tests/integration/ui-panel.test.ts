import { describe, it, expect, beforeEach } from 'vitest';
import { PanelComponent } from '../../src/ui/components/panel.component.js';
import { TAGS, DEFAULT_PANEL_STATE } from '../../src/shared/constants/index.js';
import type {
  PanelViewModel,
  PanelEvent,
} from '../../src/ui/components/panel-view-model.js';
import type {
  MediaItem,
  MediaStatistics,
  QueueSnapshot,
  FilterState,
} from '../../src/shared/types/index.js';
import type { LogEntry } from '../../src/shared/logger/index.js';
import { I18n } from '../../src/shared/i18n/index.js';
import { DEFAULT_FILTERS } from '../../src/shared/constants/index.js';

class StubViewModel implements PanelViewModel {
  readonly i18n = new I18n('en');
  selectAllCalled = 0;
  rescanCalled = 0;
  downloadCalled = 0;
  query = '';
  filters: FilterState = { ...DEFAULT_FILTERS };
  selected: string[] = [];
  items: MediaItem[] = [];
  private listeners = new Set<(e: PanelEvent) => void>();

  getStatistics(): MediaStatistics {
    return {
      total: this.items.length,
      byType: { photo: this.items.length, video: 0, gif: 0, document: 0, audio: 0 },
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
    return {
      tasks: [],
      total: 0,
      completed: 0,
      failed: 0,
      running: 0,
      queued: 0,
      cancelled: 0,
      overallProgress: 0,
    };
  }
  getLogs(): readonly LogEntry[] {
    return [];
  }
  getSelectedIds(): readonly string[] {
    return this.selected;
  }
  isSelected(id: string): boolean {
    return this.selected.includes(id);
  }
  setQuery(q: string): void {
    this.query = q;
    this.emit('filters');
  }
  toggleType(): void {
    this.emit('filters');
  }
  setDateRange(): void {
    this.emit('filters');
  }
  toggleSelection(): void {
    this.emit('selection');
  }
  selectAllVisible(): void {
    this.selectAllCalled += 1;
    this.selected = this.items.map((i) => i.id);
    this.emit('selection');
  }
  clearSelection(): void {
    this.selected = [];
    this.emit('selection');
  }
  rescan(): void {
    this.rescanCalled += 1;
  }
  downloadSelected(): void {
    this.downloadCalled += 1;
  }
  startQueue(): void {}
  cancelAllDownloads(): void {}
  cancelTask(): void {}
  retryTask(): void {}
  clearFinishedTasks(): void {}
  exportReport(): void {}
  clearLogs(): void {
    this.emit('logs');
  }
  subscribe(listener: (e: PanelEvent) => void): () => void {
    this.listeners.add(listener);
    return () => this.listeners.delete(listener);
  }
  private emit(e: PanelEvent): void {
    for (const l of this.listeners) l(e);
  }
}

function mountPanel(vm: PanelViewModel): PanelComponent {
  const panel = new PanelComponent();
  panel.viewModel = vm;
  panel.configure({ ...DEFAULT_PANEL_STATE }, () => {});
  panel.connect();
  document.body.appendChild(panel.host);
  return panel;
}

describe('PanelComponent (integration)', () => {
  beforeEach(() => {
    document.body.replaceChildren();
  });

  it('renders all six sections', () => {
    const vm = new StubViewModel();
    const panel = mountPanel(vm);
    const body = panel.shadowRoot!.querySelector('.panel__body')!;
    for (const tag of [
      TAGS.statistics,
      TAGS.search,
      TAGS.filters,
      TAGS.selection,
      TAGS.queue,
      TAGS.logs,
    ]) {
      expect(body.querySelector(tag)).not.toBeNull();
    }
  });

  it('reflects statistics in the Statistics section', () => {
    const vm = new StubViewModel();
    vm.items = [
      { id: 'a', type: 'photo' },
      { id: 'b', type: 'photo' },
    ];
    const panel = mountPanel(vm);
    const stats = panel.shadowRoot!.querySelector(TAGS.statistics) as HTMLElement;
    expect(stats.shadowRoot!.textContent).toContain('2');
  });

  it('invokes selectAllVisible from the Selection section button', () => {
    const vm = new StubViewModel();
    vm.items = [{ id: 'a', type: 'photo' }];
    const panel = mountPanel(vm);
    const selection = panel.shadowRoot!.querySelector(TAGS.selection) as HTMLElement;
    const buttons = selection.shadowRoot!.querySelectorAll('button');
    const selectAll = [...buttons].find((b) =>
      b.textContent?.includes('Select all visible'),
    );
    (selectAll as HTMLButtonElement).click();
    expect(vm.selectAllCalled).toBe(1);
  });

  it('toggles collapsed state', () => {
    const vm = new StubViewModel();
    const panel = mountPanel(vm);
    const collapseBtn = panel.shadowRoot!.querySelectorAll(
      '.panel__header .icon-btn',
    )[1] as HTMLButtonElement;
    collapseBtn.click();
    expect(
      panel.shadowRoot!.querySelector('.panel')!.classList.contains('collapsed'),
    ).toBe(true);
  });

  it('toggles visibility', () => {
    const vm = new StubViewModel();
    const panel = mountPanel(vm);
    expect(panel.isVisible).toBe(true);
    panel.toggleVisible();
    expect(panel.isVisible).toBe(false);
  });

  it('rescan button calls the view-model', () => {
    const vm = new StubViewModel();
    const panel = mountPanel(vm);
    const rescanBtn = panel.shadowRoot!.querySelectorAll(
      '.panel__header .icon-btn',
    )[0] as HTMLButtonElement;
    rescanBtn.click();
    expect(vm.rescanCalled).toBe(1);
  });
});
