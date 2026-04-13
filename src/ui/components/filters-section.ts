import { BaseComponent } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import type { MediaType, DateRange } from '../../shared/types/index.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement } from '../../shared/utils/index.js';
import { PANEL_STYLES } from '../styles/panel.styles.js';
import type { TranslationKey } from '../../shared/i18n/index.js';

const TYPE_FILTERS: ReadonlyArray<{ type: MediaType; key: TranslationKey }> = [
  { type: 'photo', key: 'filter_photos' },
  { type: 'video', key: 'filter_videos' },
  { type: 'gif', key: 'filter_gifs' },
  { type: 'document', key: 'filter_documents' },
  { type: 'audio', key: 'filter_audio' },
];

const DATE_FILTERS: ReadonlyArray<{ range: DateRange; key: TranslationKey }> = [
  { range: 'all', key: 'filter_all' },
  { range: 'today', key: 'filter_today' },
  { range: 'week', key: 'filter_week' },
  { range: 'month', key: 'filter_month' },
];

export class FiltersSection extends BaseComponent {
  constructor() {
    super(TAGS.filters);
    this.adoptStyles(PANEL_STYLES);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['filters'];
  }

  protected override render(): void {
    const { t } = this.vm.i18n;
    const filters = this.vm.getFilters();
    const activeTypes = new Set(filters.types);

    const typeChips = createElement('div', {
      className: 'chips',
      attrs: { role: 'group', 'aria-label': t('section_filters') },
    });
    for (const { type, key } of TYPE_FILTERS) {
      const pressed = activeTypes.has(type);
      typeChips.appendChild(
        createElement('button', {
          className: 'chip',
          text: t(key),
          attrs: { type: 'button', 'aria-pressed': String(pressed) },
          onClick: () => this.vm.toggleType(type),
        }),
      );
    }

    const dateChips = createElement('div', { className: 'chips' });
    for (const { range, key } of DATE_FILTERS) {
      const pressed = filters.dateRange === range;
      dateChips.appendChild(
        createElement('button', {
          className: 'chip',
          text: t(key),
          attrs: { type: 'button', 'aria-pressed': String(pressed) },
          onClick: () => this.vm.setDateRange(range),
        }),
      );
    }

    const section = createElement('section', {
      className: 'section',
      attrs: { 'aria-label': t('section_filters') },
      children: [
        createElement('h2', { className: 'section__title', text: t('section_filters') }),
        typeChips,
        createElement('div', { attrs: { style: 'height:6px' } }),
        dateChips,
      ],
    });

    this.mount(section);
  }
}
