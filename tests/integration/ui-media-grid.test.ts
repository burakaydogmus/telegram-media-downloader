import { describe, it, expect, beforeEach, afterEach } from 'vitest';
import {
  MediaGridSection,
  GRID_LAYOUT,
} from '../../src/ui/components/media-grid-section.js';
import { HarnessVM, installFrameMock, type FrameMock } from './ui-harness.js';
import { makeItems } from '../helpers/factories.js';

function mount(vm: HarnessVM): MediaGridSection {
  const grid = new MediaGridSection();
  grid.viewModel = vm;
  document.body.appendChild(grid.host);
  grid.connect();
  return grid;
}

function tiles(grid: MediaGridSection): HTMLElement[] {
  return [...grid.shadowRoot.querySelectorAll<HTMLElement>('[role="gridcell"]')];
}

function tile(grid: MediaGridSection, id: string): HTMLElement {
  const el = grid.shadowRoot.querySelector<HTMLElement>(`[data-id="${id}"]`);
  if (!el) throw new Error(`tile ${id} not rendered`);
  return el;
}

function viewport(grid: MediaGridSection): HTMLElement {
  return grid.shadowRoot.querySelector<HTMLElement>('[role="grid"]')!;
}

function key(target: HTMLElement, k: string, init: KeyboardEventInit = {}): void {
  target.dispatchEvent(new KeyboardEvent('keydown', { key: k, bubbles: true, ...init }));
}

describe('MediaGridSection', () => {
  let frames: FrameMock;
  beforeEach(() => {
    frames = installFrameMock();
  });
  afterEach(() => frames.restore());

  it('virtualizes 10,000 items into a bounded number of DOM nodes', () => {
    const vm = new HarnessVM();
    vm.items = makeItems(10_000);
    const grid = mount(vm);

    const maxRows =
      Math.ceil(GRID_LAYOUT.viewportHeight / GRID_LAYOUT.rowHeight) +
      2 * GRID_LAYOUT.overscanRows +
      1;
    expect(tiles(grid).length).toBeGreaterThan(0);
    expect(tiles(grid).length).toBeLessThanOrEqual(maxRows * GRID_LAYOUT.columns);
    expect(grid.shadowRoot.querySelectorAll('*').length).toBeLessThan(600);
    expect(viewport(grid).getAttribute('aria-rowcount')).toBe('2500');

    const vp = viewport(grid);
    vp.scrollTop = 1000 * GRID_LAYOUT.rowHeight;
    vp.dispatchEvent(new Event('scroll'));
    frames.flush();
    expect(tiles(grid).length).toBeLessThanOrEqual(maxRows * GRID_LAYOUT.columns);
    expect(grid.shadowRoot.querySelector('[data-id="photo-4000"]')).not.toBeNull();
    expect(grid.shadowRoot.querySelector('[data-id="photo-0"]')).toBeNull();
  });

  it('renders thumbnails, type/size badges and the downloaded badge', () => {
    const vm = new HarnessVM();
    vm.items = [
      { id: 'a', type: 'photo', thumbnailUrl: 'blob:thumb-a', size: '1.2 MB' },
      { id: 'b', type: 'video', byteSize: 2048 },
    ];
    vm.downloaded.add('b');
    const grid = mount(vm);

    const a = tile(grid, 'a');
    const img = a.querySelector('img')!;
    expect(img.getAttribute('src')).toBe('blob:thumb-a');
    expect(img.getAttribute('loading')).toBe('lazy');
    expect(a.textContent).toContain('Photo');
    expect(a.textContent).toContain('1.2 MB');
    expect(a.querySelector<HTMLElement>('.tile__done')!.hidden).toBe(true);

    const b = tile(grid, 'b');
    expect(b.querySelector('img')!.hidden).toBe(true);
    expect(b.querySelector('.tile__icon svg')).not.toBeNull();
    expect(b.textContent).toContain('2.0 KB');
    expect(b.querySelector<HTMLElement>('.tile__done')!.hidden).toBe(false);
    expect(b.getAttribute('aria-label')).toContain('Downloaded');
  });

  it('click toggles selection and shift+click selects a range from the anchor', () => {
    const vm = new HarnessVM();
    vm.items = makeItems(12);
    const grid = mount(vm);

    tile(grid, 'photo-2').click();
    expect(vm.called('toggleSelection')).toEqual([['photo-2']]);
    frames.flush();
    expect(tile(grid, 'photo-2').getAttribute('aria-selected')).toBe('true');

    tile(grid, 'photo-6').dispatchEvent(
      new MouseEvent('click', { bubbles: true, shiftKey: true }),
    );
    expect(vm.called('selectRange')).toEqual([['photo-2', 'photo-6']]);
    frames.flush();
    for (const id of ['photo-2', 'photo-4', 'photo-6']) {
      expect(tile(grid, id).getAttribute('aria-selected')).toBe('true');
    }
    expect(tile(grid, 'photo-7').getAttribute('aria-selected')).toBe('false');
  });

  it('double-click and the locate button reveal the item in the chat', () => {
    const vm = new HarnessVM();
    vm.items = makeItems(3);
    const grid = mount(vm);
    tile(grid, 'photo-1').dispatchEvent(new MouseEvent('dblclick', { bubbles: true }));
    tile(grid, 'photo-2').querySelector<HTMLButtonElement>('.tile__locate')!.click();
    expect(vm.called('revealItem')).toEqual([['photo-1'], ['photo-2']]);
    expect(vm.called('toggleSelection')).toHaveLength(0);
  });

  it('uses a roving tabindex and moves focus with arrow keys', () => {
    const vm = new HarnessVM();
    vm.items = makeItems(20);
    const grid = mount(vm);

    const focusable = tiles(grid).filter((t) => t.getAttribute('tabindex') === '0');
    expect(focusable.map((t) => t.dataset.id)).toEqual(['photo-0']);

    const first = tile(grid, 'photo-0');
    first.focus();
    key(first, 'ArrowRight');
    expect(grid.shadowRoot.activeElement).toBe(tile(grid, 'photo-1'));
    key(tile(grid, 'photo-1'), 'ArrowDown');
    const target = tile(grid, `photo-${1 + GRID_LAYOUT.columns}`);
    expect(grid.shadowRoot.activeElement).toBe(target);
    expect(target.getAttribute('tabindex')).toBe('0');
    expect(tile(grid, 'photo-0').getAttribute('tabindex')).toBe('-1');
    key(target, 'ArrowLeft');
    key(grid.shadowRoot.activeElement as HTMLElement, 'ArrowUp');
    expect(grid.shadowRoot.activeElement).toBe(tile(grid, 'photo-0'));
    // Clamped at the start.
    key(tile(grid, 'photo-0'), 'ArrowLeft');
    expect(grid.shadowRoot.activeElement).toBe(tile(grid, 'photo-0'));
  });

  it('Space toggles, Shift+Space selects a range, Enter reveals', () => {
    const vm = new HarnessVM();
    vm.items = makeItems(8);
    const grid = mount(vm);
    const first = tile(grid, 'photo-0');
    first.focus();
    key(first, ' ');
    key(first, 'ArrowRight');
    key(grid.shadowRoot.activeElement as HTMLElement, 'ArrowRight');
    key(grid.shadowRoot.activeElement as HTMLElement, ' ', { shiftKey: true });
    key(grid.shadowRoot.activeElement as HTMLElement, 'Enter');
    expect(vm.called('toggleSelection')).toEqual([['photo-0']]);
    expect(vm.called('selectRange')).toEqual([['photo-0', 'photo-2']]);
    expect(vm.called('revealItem')).toEqual([['photo-2']]);
  });

  it('keyboard navigation scrolls far rows into view', () => {
    const vm = new HarnessVM();
    vm.items = makeItems(400);
    const grid = mount(vm);
    const first = tile(grid, 'photo-0');
    first.focus();
    key(first, 'End', { ctrlKey: true });
    expect((grid.shadowRoot.activeElement as HTMLElement).dataset.id).toBe('photo-399');
    expect(viewport(grid).scrollTop).toBeGreaterThan(0);
  });

  it('keeps tile nodes when unrelated updates arrive and shows an empty state', () => {
    const vm = new HarnessVM();
    vm.items = makeItems(4);
    const grid = mount(vm);
    const before = tile(grid, 'photo-1');
    vm.emit('selection');
    vm.emit('queue');
    frames.flush();
    expect(tile(grid, 'photo-1')).toBe(before);

    vm.items = [];
    vm.emit('media');
    frames.flush();
    expect(viewport(grid).hidden).toBe(true);
    expect(grid.shadowRoot.textContent).toContain('No media to show');
  });
});
