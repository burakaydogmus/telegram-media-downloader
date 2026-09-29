import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement, debounce } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { setText } from './dom-diff.js';

export class SearchSection extends BaseComponent {
  private input: HTMLInputElement | null = null;
  private resultsNode: HTMLElement | null = null;

  private readonly emitQuery = debounce((value: string) => {
    this.vm.setQuery(value);
  }, 150);

  constructor() {
    super(TAGS.search);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['media', 'filters'];
  }

  protected override onDisconnect(): void {
    this.emitQuery.cancel();
  }

  protected override build(): void {
    const { t } = this.vm.i18n;

    const input = createElement('input', {
      className: 'input',
      attrs: {
        type: 'search',
        placeholder: t('search_placeholder'),
        'aria-label': t('search_placeholder'),
      },
    });
    input.value = this.vm.getFilters().query;
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
        this.emitQuery.cancel();
        input.value = '';
        this.vm.setQuery('');
      },
    });

    this.resultsNode = createElement('div', {
      className: 'muted',
      attrs: { 'aria-live': 'polite' },
    });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_search') },
        children: [
          createElement('h2', { className: 'section__title', text: t('section_search') }),
          createElement('div', { className: 'field', children: [input, clearBtn] }),
          this.resultsNode,
        ],
      }),
    );
  }

  protected override update(_changes: Changes): void {
    if (this.resultsNode) {
      setText(
        this.resultsNode,
        this.vm.i18n.t('search_results', { count: this.vm.getVisibleItems().length }),
      );
    }
    // Sync programmatic resets, but never overwrite what the user is typing.
    const input = this.input;
    if (input && this.root.activeElement !== input) {
      const query = this.vm.getFilters().query;
      if (input.value !== query) input.value = query;
    }
  }
}
