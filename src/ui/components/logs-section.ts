import { BaseComponent } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement, formatTime } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { PANEL_STYLES } from '../styles/panel.styles.js';

export class LogsSection extends BaseComponent {
  constructor() {
    super(TAGS.logs);
    this.adoptStyles(PANEL_STYLES);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['logs'];
  }

  protected override render(): void {
    const { t } = this.vm.i18n;
    // Show the most recent entries first, capped for readability.
    const entries = [...this.vm.getLogs()].slice(-50).reverse();

    const list = createElement('div', { className: 'log-list', attrs: { role: 'log' } });
    if (entries.length === 0) {
      list.appendChild(
        createElement('div', { className: 'empty', text: t('logs_empty') }),
      );
    } else {
      for (const entry of entries) {
        list.appendChild(
          createElement('div', {
            className: `log-line log-line--${entry.level}`,
            text: `${formatTime(entry.timestamp)} [${entry.scope}] ${entry.message}`,
          }),
        );
      }
    }

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

    const section = createElement('section', {
      className: 'section',
      attrs: { 'aria-label': t('section_logs') },
      children: [header, list],
    });

    this.mount(section);
  }
}
