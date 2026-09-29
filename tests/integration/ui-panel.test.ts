import { StubViewModelBase } from '../helpers/stub-view-model-base.js';
import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { PanelComponent } from '../../src/ui/components/panel.component.js';
import { UI_TAGS } from '../../src/ui/components/tags.js';
import { HarnessVM, installFrameMock, type FrameMock } from './ui-harness.js';
import type { PanelState, SelectorHealthReport } from '../../src/shared/types/index.js';
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

class StubViewModel extends StubViewModelBase implements PanelViewModel {
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
      paused: false,
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

  it('places the media grid between Filters and Selection, crawl before queue', () => {
    const panel = mountPanel(new StubViewModel());
    const order = [...panel.shadowRoot!.querySelector('.panel__body')!.children].map(
      (c) => c.tagName.toLowerCase(),
    );
    expect(order).toEqual([
      TAGS.statistics,
      TAGS.search,
      TAGS.filters,
      UI_TAGS.mediaGrid,
      TAGS.selection,
      UI_TAGS.crawl,
      TAGS.queue,
      TAGS.logs,
    ]);
  });

  it('adopts one shared constructable stylesheet across all components', () => {
    const panel = mountPanel(new StubViewModel());
    const sections = [...panel.shadowRoot!.querySelector('.panel__body')!.children];
    const firstSheets = sections.map((s) => s.shadowRoot!.adoptedStyleSheets[0]);
    expect(firstSheets[0]).toBeInstanceOf(CSSStyleSheet);
    expect(new Set(firstSheets).size).toBe(1);
    expect(panel.shadowRoot!.adoptedStyleSheets[0]).toBe(firstSheets[0]);
    expect(sections[0]!.shadowRoot!.querySelector('style')).toBeNull();
  });
});

describe('PanelComponent shell behaviour', () => {
  let frames: FrameMock;
  beforeEach(() => {
    frames = installFrameMock();
    vi.useFakeTimers({ toFake: ['setTimeout', 'clearTimeout'] });
  });
  afterEach(() => {
    vi.useRealTimers();
    frames.restore();
    setViewport(1024, 768);
  });

  function setViewport(width: number, height: number): void {
    Object.defineProperty(window, 'innerWidth', { configurable: true, value: width });
    Object.defineProperty(window, 'innerHeight', { configurable: true, value: height });
  }

  const failingHealth = (): SelectorHealthReport => ({
    client: 'webk',
    ok: false,
    checkedAt: 1,
    checks: [
      { name: 'chat', selector: '.chat', matched: false, critical: true },
      { name: 'bubbles', selector: '.bubbles', matched: true, critical: true },
      { name: 'menu', selector: '.menu', matched: false, critical: false },
    ],
  });

  it('shows a dismissible health warning listing failed critical checks', () => {
    const vm = new HarnessVM();
    const panel = mountPanel(vm);
    const banner = panel.shadowRoot!.querySelector<HTMLElement>('.health')!;
    expect(banner.hidden).toBe(true);

    vm.health = failingHealth();
    vm.emit('health');
    frames.flush();
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('layout may have changed');
    expect(banner.textContent).toContain('Failed checks: chat');
    expect(banner.textContent).not.toContain('menu');

    banner.querySelector<HTMLButtonElement>('[aria-label="Dismiss warning"]')!.click();
    expect(banner.hidden).toBe(true);
    vm.emit('health');
    frames.flush();
    expect(banner.hidden).toBe(true);

    vm.health = {
      ...failingHealth(),
      checks: [{ name: 'bubbles', selector: '.b', matched: false, critical: true }],
    };
    vm.emit('health');
    frames.flush();
    expect(banner.hidden).toBe(false);
    expect(banner.textContent).toContain('Failed checks: bubbles');

    vm.health = { ...failingHealth(), ok: true };
    vm.emit('health');
    frames.flush();
    expect(banner.hidden).toBe(true);
  });

  it('re-clamps into the viewport on (debounced) window resize and persists', () => {
    setViewport(1200, 900);
    const vm = new HarnessVM();
    const saved: PanelState[] = [];
    const panel = new PanelComponent();
    panel.viewModel = vm;
    panel.configure({ x: 800, y: 700, collapsed: false, visible: true }, (s) =>
      saved.push(s),
    );
    document.body.appendChild(panel.host);
    panel.connect();
    expect(panel.host.style.transform).toBe('translate(800px, 700px)');

    setViewport(600, 400);
    window.dispatchEvent(new Event('resize'));
    window.dispatchEvent(new Event('resize'));
    expect(panel.host.style.transform).toBe('translate(800px, 700px)');
    vi.advanceTimersByTime(500);
    expect(panel.host.style.transform).toBe('translate(260px, 280px)');
    expect(saved.at(-1)).toMatchObject({ x: 260, y: 280 });

    panel.disconnect();
    setViewport(300, 200);
    window.dispatchEvent(new Event('resize'));
    vi.advanceTimersByTime(500);
    expect(panel.host.style.transform).toBe('translate(260px, 280px)');
  });

  it('re-clamps after un-collapsing and keeps sections mounted', () => {
    setViewport(1000, 800);
    const vm = new HarnessVM();
    const panel = mountPanel(vm);
    const grid = panel.shadowRoot!.querySelector(UI_TAGS.mediaGrid);
    const collapse = panel.shadowRoot!.querySelectorAll<HTMLButtonElement>(
      '.panel__header .icon-btn',
    )[1]!;
    collapse.click();
    expect(collapse.getAttribute('aria-expanded')).toBe('false');
    expect(collapse.getAttribute('aria-label')).toBe('Expand panel');
    setViewport(200, 100);
    collapse.click();
    expect(panel.host.style.transform).toBe('translate(0px, 0px)');
    expect(panel.shadowRoot!.querySelector(UI_TAGS.mediaGrid)).toBe(grid);
  });

  it('re-renders labels on language change without replacing sections', () => {
    const vm = new HarnessVM();
    const panel = mountPanel(vm);
    const body = panel.shadowRoot!.querySelector('.panel__body')!;
    const hosts = [...body.children];
    vm.i18n.setLanguage('tr');
    expect([...body.children]).toEqual(hosts);
    const filters = panel.shadowRoot!.querySelector(TAGS.filters)!;
    expect(filters.shadowRoot!.textContent).toContain('Bu sohbet');
    expect(
      panel
        .shadowRoot!.querySelectorAll('.panel__header .icon-btn')[1]!
        .getAttribute('aria-label'),
    ).toBe(vm.i18n.t('panel_collapse'));
    expect(vm.i18n.t('panel_collapse')).not.toBe('Collapse panel');
  });

  it('drags the panel with pointer capture', () => {
    setViewport(1200, 900);
    const vm = new HarnessVM();
    const panel = mountPanel(vm);
    const header = panel.shadowRoot!.querySelector<HTMLElement>('.panel__header')!;
    const capture = vi.fn();
    header.setPointerCapture = capture;
    const pointer = (type: string, x: number, y: number) =>
      header.dispatchEvent(
        new PointerEvent(type, {
          bubbles: true,
          button: 0,
          pointerId: 7,
          clientX: x,
          clientY: y,
        }),
      );
    pointer('pointerdown', 34, 106);
    expect(capture).toHaveBeenCalledWith(7);
    pointer('pointermove', 134, 206);
    expect(panel.host.style.transform).toBe('translate(124px, 196px)');
    pointer('pointerup', 134, 206);
    pointer('pointermove', 500, 500);
    expect(panel.host.style.transform).toBe('translate(124px, 196px)');
  });
});
