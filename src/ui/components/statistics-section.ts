import { BaseComponent } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement, formatBytes } from '../../shared/utils/index.js';
import { PANEL_STYLES } from '../styles/panel.styles.js';

export class StatisticsSection extends BaseComponent {
  constructor() {
    super(TAGS.statistics);
    this.adoptStyles(PANEL_STYLES);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['media', 'selection'];
  }

  protected override render(): void {
    const { t } = this.vm.i18n;
    const stats = this.vm.getStatistics();

    const cells: ReadonlyArray<{ label: string; value: string }> = [
      { label: t('stat_total'), value: String(stats.total) },
      { label: t('stat_photos'), value: String(stats.byType.photo) },
      { label: t('stat_videos'), value: String(stats.byType.video) },
      { label: t('stat_gifs'), value: String(stats.byType.gif) },
      { label: t('stat_documents'), value: String(stats.byType.document) },
      { label: t('stat_audio'), value: String(stats.byType.audio) },
      { label: t('stat_size'), value: formatBytes(stats.totalBytes) },
      { label: t('stat_selected'), value: String(stats.selected) },
    ];

    const grid = createElement('div', { className: 'stats-grid' });
    for (const cell of cells) {
      grid.appendChild(
        createElement('div', {
          className: 'stat',
          attrs: { role: 'group', 'aria-label': `${cell.label}: ${cell.value}` },
          children: [
            createElement('div', { className: 'stat__value', text: cell.value }),
            createElement('div', { className: 'stat__label', text: cell.label }),
          ],
        }),
      );
    }

    const section = createElement('section', {
      className: 'section',
      attrs: { 'aria-label': t('section_statistics') },
      children: [
        createElement('h2', {
          className: 'section__title',
          text: t('section_statistics'),
        }),
        grid,
      ],
    });

    this.mount(section);
  }
}
