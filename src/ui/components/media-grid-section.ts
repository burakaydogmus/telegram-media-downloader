import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import type { MediaItem, MediaType } from '../../shared/types/index.js';
import { createElement, formatBytes } from '../../shared/utils/index.js';
import type { TranslationKey } from '../../shared/i18n/index.js';
import { icon } from '../icons/svg-icons.js';
import { reconcileKeyed, setAttr, setHidden, setStyle, setText } from './dom-diff.js';
import { UI_TAGS } from './tags.js';

/** Fixed geometry keeps virtualization O(visible rows). Mirrors the CSS. */
export const GRID_LAYOUT = {
  columns: 4,
  rowHeight: 80,
  viewportHeight: 248,
  overscanRows: 2,
} as const;

const TYPE_LABELS: Readonly<Record<MediaType, TranslationKey>> = {
  photo: 'grid_type_photo',
  video: 'grid_type_video',
  gif: 'grid_type_gif',
  document: 'grid_type_document',
  audio: 'grid_type_audio',
};

interface TileRefs {
  readonly img: HTMLImageElement;
  readonly type: HTMLElement;
  readonly size: HTMLElement;
  readonly done: HTMLElement;
}

interface RowSlot {
  readonly index: number;
}

export class MediaGridSection extends BaseComponent {
  private viewport: HTMLElement | null = null;
  private rowsHost: HTMLElement | null = null;
  private empty: HTMLElement | null = null;
  private readonly rowEls = new Map<string, HTMLElement>();
  private readonly rowCells = new WeakMap<HTMLElement, Map<string, HTMLElement>>();
  private readonly tiles = new WeakMap<HTMLElement, TileRefs>();

  private items: readonly MediaItem[] = [];
  private indexById: Map<string, number> | null = null;
  private focusedId: string | null = null;
  private anchorId: string | null = null;

  constructor() {
    super(UI_TAGS.mediaGrid);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    // `queue` because finished downloads change the "downloaded" badges.
    return ['media', 'filters', 'selection', 'queue', 'settings'];
  }

  protected override build(): void {
    const { t } = this.vm.i18n;
    this.rowEls.clear();

    this.rowsHost = createElement('div', {
      className: 'media-grid__rows',
      attrs: { role: 'rowgroup' },
    });
    const viewport = createElement('div', {
      className: 'media-grid',
      attrs: {
        role: 'grid',
        'aria-label': t('grid_label'),
        'aria-multiselectable': 'true',
        'aria-colcount': String(GRID_LAYOUT.columns),
        'aria-describedby': 'media-grid-hint',
      },
      children: [this.rowsHost],
    });
    viewport.addEventListener('scroll', () => this.requestUpdate('local'), {
      passive: true,
    });
    viewport.addEventListener('click', (e) => this.handleClick(e));
    viewport.addEventListener('dblclick', (e) => this.handleDoubleClick(e));
    viewport.addEventListener('keydown', (e) => this.handleKeyDown(e));
    this.viewport = viewport;

    this.empty = createElement('div', { className: 'empty', text: t('grid_empty') });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_media') },
        children: [
          createElement('h2', { className: 'section__title', text: t('section_media') }),
          createElement('p', {
            className: 'sr-only',
            id: 'media-grid-hint',
            text: t('grid_hint'),
          }),
          viewport,
          this.empty,
        ],
      }),
    );
  }

  protected override update(_changes: Changes): void {
    const viewport = this.viewport;
    const rowsHost = this.rowsHost;
    if (!viewport || !rowsHost || !this.empty) return;

    const items = this.vm.getVisibleItems();
    if (items !== this.items) {
      this.items = items;
      this.indexById = null;
    }
    const { columns, rowHeight, overscanRows } = GRID_LAYOUT;
    const count = items.length;
    const rowCount = Math.ceil(count / columns);

    setHidden(this.empty, count > 0);
    setHidden(viewport, count === 0);
    setStyle(rowsHost, 'height', `${rowCount * rowHeight}px`);
    setAttr(viewport, 'aria-rowcount', String(rowCount));

    const hadFocus = this.hasFocusWithin();
    if (this.focusedId !== null && this.indexOf(this.focusedId) < 0) {
      this.focusedId = null;
    }

    const height = this.viewportHeight();
    const scrollTop = viewport.scrollTop;
    const firstVisible = Math.floor(scrollTop / rowHeight);
    const lastVisible = Math.min(
      rowCount - 1,
      Math.ceil((scrollTop + height) / rowHeight) - 1,
    );
    const first = Math.max(0, firstVisible - overscanRows);
    const last = Math.min(rowCount - 1, lastVisible + overscanRows);

    // Roving tabindex: keep the tab stop on a rendered tile unless the user is
    // interacting with the grid right now.
    if (!hadFocus && count > 0) {
      const focusedRow =
        this.focusedId === null ? -1 : Math.floor(this.indexOf(this.focusedId) / columns);
      if (focusedRow < firstVisible || focusedRow > Math.max(firstVisible, lastVisible)) {
        this.focusedId = items[Math.min(firstVisible * columns, count - 1)]?.id ?? null;
      }
    }

    const slots: RowSlot[] = [];
    for (let row = first; row <= last; row += 1) slots.push({ index: row });
    reconcileKeyed(
      rowsHost,
      slots,
      (slot) => String(slot.index),
      this.rowEls,
      () => this.createRow(),
      (el, slot) => this.patchRow(el, slot.index),
    );

    if (hadFocus && this.focusedId !== null) {
      const tile = this.tileFor(this.focusedId);
      if (tile && this.root.activeElement !== tile) tile.focus({ preventScroll: true });
    }
  }

  private createRow(): HTMLElement {
    const row = createElement('div', {
      className: 'media-grid__row',
      attrs: { role: 'row' },
    });
    this.rowCells.set(row, new Map());
    return row;
  }

  private patchRow(row: HTMLElement, rowIndex: number): void {
    const { columns, rowHeight } = GRID_LAYOUT;
    setStyle(row, 'transform', `translateY(${rowIndex * rowHeight}px)`);
    setAttr(row, 'aria-rowindex', String(rowIndex + 1));
    const start = rowIndex * columns;
    const slice = this.items.slice(start, start + columns);
    const cells = this.rowCells.get(row);
    if (!cells) return;
    reconcileKeyed(
      row,
      slice,
      (item) => item.id,
      cells,
      (item) => this.createTile(item),
      (tile, item) => this.patchTile(tile, item, slice.indexOf(item)),
    );
  }

  private createTile(item: MediaItem): HTMLElement {
    const { t } = this.vm.i18n;
    const img = createElement('img', {
      className: 'tile__thumb',
      attrs: { alt: '', loading: 'lazy', decoding: 'async', draggable: 'false' },
    });
    const type = createElement('span', { className: 'tile__badge tile__type' });
    const size = createElement('span', { className: 'tile__badge tile__size' });
    const done = createElement('span', {
      className: 'tile__done',
      title: t('grid_downloaded'),
      children: [icon('check', 12)],
    });
    const tile = createElement('div', {
      className: 'tile',
      attrs: { role: 'gridcell', tabindex: '-1' },
      dataset: { id: item.id },
      children: [
        createElement('span', {
          className: 'tile__icon',
          children: [icon(item.type, 24)],
        }),
        img,
        type,
        size,
        done,
        createElement('button', {
          className: 'tile__locate',
          attrs: {
            type: 'button',
            tabindex: '-1',
            'aria-label': t('grid_locate'),
            title: t('grid_locate'),
          },
          children: [icon('locate', 14)],
        }),
      ],
    });
    img.addEventListener('error', () => tile.classList.add('tile--noimg'));
    this.tiles.set(tile, { img, type, size, done });
    return tile;
  }

  private patchTile(tile: HTMLElement, item: MediaItem, column: number): void {
    const refs = this.tiles.get(tile);
    if (!refs) return;
    const { t } = this.vm.i18n;
    const selected = this.vm.isSelected(item.id);
    const downloaded = this.vm.isDownloaded(item.id);
    const typeLabel = t(TYPE_LABELS[item.type]);
    const sizeLabel =
      item.size ?? (item.byteSize !== undefined ? formatBytes(item.byteSize) : '');

    setAttr(tile, 'aria-selected', String(selected));
    setAttr(tile, 'aria-colindex', String(column + 1));
    setAttr(tile, 'tabindex', item.id === this.focusedId ? '0' : '-1');
    const label = [
      item.fileName ?? typeLabel,
      sizeLabel,
      downloaded ? t('grid_downloaded') : '',
    ]
      .filter((part) => part.length > 0)
      .join(', ');
    setAttr(tile, 'aria-label', label);
    setAttr(tile, 'title', item.fileName ?? null);

    setText(refs.type, typeLabel);
    setText(refs.size, sizeLabel);
    setHidden(refs.size, sizeLabel.length === 0);
    setHidden(refs.done, !downloaded);

    const src = item.thumbnailUrl ?? null;
    if (refs.img.getAttribute('src') !== src) {
      tile.classList.remove('tile--noimg');
      setAttr(refs.img, 'src', src);
    }
    setHidden(refs.img, src === null);
  }

  private handleClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    const tile = target?.closest<HTMLElement>('.tile');
    const id = tile?.dataset.id;
    if (!tile || id === undefined) return;
    if (target?.closest('.tile__locate')) {
      this.vm.revealItem(id);
      return;
    }
    this.focusedId = id;
    if (event.shiftKey && this.anchorId !== null && this.anchorId !== id) {
      this.vm.selectRange(this.anchorId, id);
    } else {
      this.vm.toggleSelection(id);
      this.anchorId = id;
    }
    tile.focus({ preventScroll: true });
    this.requestUpdate('local');
  }

  private handleDoubleClick(event: MouseEvent): void {
    const target = event.target as Element | null;
    if (!target || target.closest('.tile__locate')) return;
    const id = target.closest<HTMLElement>('.tile')?.dataset.id;
    if (id !== undefined) this.vm.revealItem(id);
  }

  private handleKeyDown(event: KeyboardEvent): void {
    const tile = (event.target as Element | null)?.closest<HTMLElement>('.tile');
    const id = tile?.dataset.id;
    if (id === undefined) return;
    const index = this.indexOf(id);
    if (index < 0) return;

    const { columns } = GRID_LAYOUT;
    const pageSize =
      Math.max(1, Math.floor(this.viewportHeight() / GRID_LAYOUT.rowHeight)) * columns;
    let next: number | null = null;
    switch (event.key) {
      case 'ArrowRight':
        next = index + 1;
        break;
      case 'ArrowLeft':
        next = index - 1;
        break;
      case 'ArrowDown':
        next = index + columns;
        break;
      case 'ArrowUp':
        next = index - columns;
        break;
      case 'PageDown':
        next = index + pageSize;
        break;
      case 'PageUp':
        next = index - pageSize;
        break;
      case 'Home':
        next = event.ctrlKey ? 0 : index - (index % columns);
        break;
      case 'End':
        next = event.ctrlKey
          ? this.items.length - 1
          : index - (index % columns) + columns - 1;
        break;
      case ' ':
        event.preventDefault();
        if (event.shiftKey && this.anchorId !== null && this.anchorId !== id) {
          this.vm.selectRange(this.anchorId, id);
        } else {
          this.vm.toggleSelection(id);
          this.anchorId = id;
        }
        return;
      case 'Enter':
        event.preventDefault();
        this.vm.revealItem(id);
        return;
      default:
        return;
    }
    event.preventDefault();
    this.moveFocus(Math.min(Math.max(next, 0), this.items.length - 1));
  }

  private moveFocus(index: number): void {
    const item = this.items[index];
    const viewport = this.viewport;
    if (!item || !viewport) return;
    this.focusedId = item.id;

    const { rowHeight } = GRID_LAYOUT;
    const top = Math.floor(index / GRID_LAYOUT.columns) * rowHeight;
    const height = this.viewportHeight();
    if (top < viewport.scrollTop) viewport.scrollTop = top;
    else if (top + rowHeight > viewport.scrollTop + height) {
      viewport.scrollTop = top + rowHeight - height;
    }

    this.requestUpdate('local');
    this.flush();
    this.tileFor(item.id)?.focus({ preventScroll: true });
  }

  private tileFor(id: string): HTMLElement | undefined {
    const index = this.indexOf(id);
    if (index < 0) return undefined;
    const row = this.rowEls.get(String(Math.floor(index / GRID_LAYOUT.columns)));
    return row ? this.rowCells.get(row)?.get(id) : undefined;
  }

  private indexOf(id: string): number {
    if (!this.indexById) {
      this.indexById = new Map(this.items.map((item, i) => [item.id, i]));
    }
    return this.indexById.get(id) ?? -1;
  }

  private hasFocusWithin(): boolean {
    const active = this.root.activeElement;
    return active !== null && this.viewport?.contains(active) === true;
  }

  private viewportHeight(): number {
    return this.viewport?.clientHeight || GRID_LAYOUT.viewportHeight;
  }
}
