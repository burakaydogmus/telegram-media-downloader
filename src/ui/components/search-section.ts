import { BaseComponent } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement, debounce } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { PANEL_STYLES } from '../styles/panel.styles.js';

export class SearchSection extends BaseComponent {
  private input: HTMLInputElement | null = null;
  private resultsNode: HTMLElement | null = null;
  private countUnsub: (() => void) | null = null;

  private readonly emitQuery = debounce((value: string) => {
    this.vm.setQuery(value);
  }, 150);

  constructor() {
    super(TAGS.search);
    this.adoptStyles(PANEL_STYLES);
  }

  // No auto re-render channels: this component manages its own fine-grained
  // updates to avoid clobbering the focused input.
  protected override get observedChannels(): readonly PanelEvent[] {
    return [];
  }

  protected override onConnect(): void {
    this.countUnsub = this.vm.subscribe((event) => {
      if (event === 'media' || event === 'filters') this.updateCount();
    });
  }

  protected override onDisconnect(): void {
    this.countUnsub?.();
    this.countUnsub = null;
  }

  protected override render(): void {
    const { t } = this.vm.i18n;
    const filters = this.vm.getFilters();

    const input = createElement('input', {
      className: 'input',
      attrs: {
        type: 'search',
        placeholder: t('search_placeholder'),
        'aria-label': t('search_placeholder'),
      },
    });
    input.value = filters.query;
    input.addEventListener('input', () => this.emitQuery(input.value));
    this.input = input;

    const clearBtn = createElement('button', {
      className: 'icon-btn',
      attrs: {
        type: 'button',
        'aria-label': t('search_clear'),
        title: t('search_clear'),
      },
      children: [icon('close', 16)],
      onClick: () => {
        input.value = '';
        this.vm.setQuery('');
      },
    });

    const results = createElement('div', {
      className: 'muted',
      attrs: { 'aria-live': 'polite' },
      text: t('search_results', { count: this.vm.getVisibleItems().length }),
    });
    this.resultsNode = results;

    const section = createElement('section', {
      className: 'section',
      attrs: { 'aria-label': t('section_search') },
      children: [
        createElement('h2', { className: 'section__title', text: t('section_search') }),
        createElement('div', { className: 'field', children: [input, clearBtn] }),
        results,
      ],
    });

    this.mount(section);
  }

  private updateCount(): void {
    if (!this.resultsNode) return;
    this.resultsNode.textContent = this.vm.i18n.t('search_results', {
      count: this.vm.getVisibleItems().length,
    });
    // Keep the input in sync when the query was reset programmatically.
    if (this.input && this.input.value !== this.vm.getFilters().query) {
      this.input.value = this.vm.getFilters().query;
    }
  }
}
