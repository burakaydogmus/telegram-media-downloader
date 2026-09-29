import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import type { MediaType, DateRange, FilterScope } from '../../shared/types/index.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement } from '../../shared/utils/index.js';
import type { TranslationKey } from '../../shared/i18n/index.js';
import { setAttr } from './dom-diff.js';

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

const SCOPE_FILTERS: ReadonlyArray<{ scope: FilterScope; key: TranslationKey }> = [
  { scope: 'all', key: 'filter_scope_all' },
  { scope: 'currentChat', key: 'filter_scope_current' },
];

export class FiltersSection extends BaseComponent {
  private typeChips = new Map<MediaType, HTMLButtonElement>();
  private dateChips = new Map<DateRange, HTMLButtonElement>();
  private scopeChips = new Map<FilterScope, HTMLButtonElement>();
  private hideDownloaded: HTMLInputElement | null = null;

  constructor() {
    super(TAGS.filters);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['filters'];
  }

  protected override build(): void {
    const { t } = this.vm.i18n;

    const chip = (text: string, onClick: () => void): HTMLButtonElement =>
      createElement('button', {
        className: 'chip',
        text,
        attrs: { type: 'button', 'aria-pressed': 'false' },
        onClick,
      });
    const group = (label: string, chips: readonly HTMLElement[]): HTMLElement =>
      createElement('div', {
        className: 'chips',
        attrs: { role: 'group', 'aria-label': label },
        children: chips,
      });

    this.typeChips = new Map(
      TYPE_FILTERS.map(({ type, key }) => [
        type,
        chip(t(key), () => this.vm.toggleType(type)),
      ]),
    );
    this.dateChips = new Map(
      DATE_FILTERS.map(({ range, key }) => [
        range,
        chip(t(key), () => this.vm.setDateRange(range)),
      ]),
    );
    this.scopeChips = new Map(
      SCOPE_FILTERS.map(({ scope, key }) => [
        scope,
        chip(t(key), () => this.vm.setScope(scope)),
      ]),
    );

    const checkbox = createElement('input', { attrs: { type: 'checkbox' } });
    checkbox.addEventListener('change', () =>
      this.vm.setHideDownloaded(checkbox.checked),
    );
    this.hideDownloaded = checkbox;

    const toolbar = createElement('div', {
      className: 'row row--between gap-top',
      children: [
        createElement('label', {
          className: 'toggle',
          children: [
            checkbox,
            createElement('span', { text: t('filter_hide_downloaded') }),
          ],
        }),
        createElement('button', {
          className: 'btn btn--small',
          text: t('filter_reset'),
          attrs: { type: 'button' },
          onClick: () => this.vm.resetFilters(),
        }),
      ],
    });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_filters') },
        children: [
          createElement('h2', {
            className: 'section__title',
            text: t('section_filters'),
          }),
          group(t('filter_types_label'), [...this.typeChips.values()]),
          createElement('div', { className: 'gap-top' }),
          group(t('filter_date_label'), [...this.dateChips.values()]),
          createElement('div', { className: 'gap-top' }),
          group(t('filter_scope_label'), [...this.scopeChips.values()]),
          toolbar,
        ],
      }),
    );
  }

  protected override update(_changes: Changes): void {
    const filters = this.vm.getFilters();
    const activeTypes = new Set(filters.types);
    for (const [type, el] of this.typeChips) {
      setAttr(el, 'aria-pressed', String(activeTypes.has(type)));
    }
    for (const [range, el] of this.dateChips) {
      setAttr(el, 'aria-pressed', String(filters.dateRange === range));
    }
    for (const [scope, el] of this.scopeChips) {
      setAttr(el, 'aria-pressed', String(filters.scope === scope));
    }
    if (this.hideDownloaded && this.hideDownloaded.checked !== filters.hideDownloaded) {
      this.hideDownloaded.checked = filters.hideDownloaded;
    }
  }
}
