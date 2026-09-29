import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement, formatTime } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { setHidden, setText } from './dom-diff.js';

const MAX_VISIBLE_LOGS = 50;

export class LogsSection extends BaseComponent {
  private list: HTMLElement | null = null;
  private empty: HTMLElement | null = null;

  constructor() {
    super(TAGS.logs);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['logs'];
  }

  protected override build(): void {
    const { t } = this.vm.i18n;
    this.list = createElement('div', { className: 'log-list', attrs: { role: 'log' } });
    this.empty = createElement('div', { className: 'empty', text: t('logs_empty') });

    const header = createElement('div', {
      className: 'row row--between',
      children: [
        createElement('h2', { className: 'section__title', text: t('section_logs') }),
        createElement('button', {
          className: 'icon-btn',
          attrs: {
            type: 'button',
            'aria-label': t('logs_clear'),
            title: t('logs_clear'),
          },
          children: [icon('trash', 16)],
          onClick: () => this.vm.clearLogs(),
        }),
      ],
    });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_logs') },
        children: [header, this.empty, this.list],
      }),
    );
  }

  protected override update(_changes: Changes): void {
    const list = this.list;
    if (!list || !this.empty) return;
    // Most recent first; existing line nodes are reused and patched in place.
    const entries = this.vm.getLogs().slice(-MAX_VISIBLE_LOGS).reverse();
    setHidden(this.empty, entries.length > 0);
    setHidden(list, entries.length === 0);

    entries.forEach((entry, index) => {
      let line = list.children[index] as HTMLElement | undefined;
      if (!line) {
        line = createElement('div');
        list.appendChild(line);
      }
      const className = `log-line log-line--${entry.level}`;
      if (line.className !== className) line.className = className;
      setText(line, `${formatTime(entry.timestamp)} [${entry.scope}] ${entry.message}`);
    });
    while (list.children.length > entries.length) list.lastElementChild?.remove();
  }
}
