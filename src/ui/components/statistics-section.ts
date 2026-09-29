import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import type { MediaStatistics } from '../../shared/types/index.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement, formatBytes } from '../../shared/utils/index.js';
import type { TranslationKey } from '../../shared/i18n/index.js';
import { setAttr, setText } from './dom-diff.js';

const CELLS: ReadonlyArray<{
  key: TranslationKey;
  value: (stats: MediaStatistics) => string;
}> = [
  { key: 'stat_total', value: (s) => String(s.total) },
  { key: 'stat_photos', value: (s) => String(s.byType.photo) },
  { key: 'stat_videos', value: (s) => String(s.byType.video) },
  { key: 'stat_gifs', value: (s) => String(s.byType.gif) },
  { key: 'stat_documents', value: (s) => String(s.byType.document) },
  { key: 'stat_audio', value: (s) => String(s.byType.audio) },
  { key: 'stat_size', value: (s) => formatBytes(s.totalBytes) },
  { key: 'stat_selected', value: (s) => String(s.selected) },
];

interface CellRefs {
  readonly group: HTMLElement;
  readonly value: HTMLElement;
  readonly label: string;
}

export class StatisticsSection extends BaseComponent {
  private cells: CellRefs[] = [];

  constructor() {
    super(TAGS.statistics);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['media', 'selection'];
  }

  protected override build(): void {
    const { t } = this.vm.i18n;
    const grid = createElement('div', { className: 'stats-grid' });
    this.cells = CELLS.map(({ key }) => {
      const label = t(key);
      const value = createElement('div', { className: 'stat__value' });
      const group = createElement('div', {
        className: 'stat',
        attrs: { role: 'group' },
        children: [
          value,
          createElement('div', { className: 'stat__label', text: label }),
        ],
      });
      grid.appendChild(group);
      return { group, value, label };
    });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_statistics') },
        children: [
          createElement('h2', {
            className: 'section__title',
            text: t('section_statistics'),
          }),
          grid,
        ],
      }),
    );
  }

  protected override update(_changes: Changes): void {
    const stats = this.vm.getStatistics();
    CELLS.forEach((cell, index) => {
      const refs = this.cells[index];
      if (!refs) return;
      const value = cell.value(stats);
      setText(refs.value, value);
      setAttr(refs.group, 'aria-label', `${refs.label}: ${value}`);
    });
  }
}
