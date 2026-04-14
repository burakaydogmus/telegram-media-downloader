import { BaseComponent } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import type { DownloadTask, DownloadState } from '../../shared/types/index.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { PANEL_STYLES } from '../styles/panel.styles.js';
import type { TranslationKey } from '../../shared/i18n/index.js';

const STATE_LABELS: Readonly<Record<DownloadState, TranslationKey>> = {
  queued: 'queue_state_queued',
  running: 'queue_state_running',
  completed: 'queue_state_completed',
  failed: 'queue_state_failed',
  cancelled: 'queue_state_cancelled',
};

export class QueueSection extends BaseComponent {
  constructor() {
    super(TAGS.queue);
    this.adoptStyles(PANEL_STYLES);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['queue'];
  }

  protected override render(): void {
    const { t } = this.vm.i18n;
    const snapshot = this.vm.getQueueSnapshot();

    const controls = createElement('div', {
      className: 'row row--between',
      children: [
        createElement('div', {
          className: 'muted',
          text: t('queue_progress', {
            done: snapshot.completed,
            total: snapshot.total,
          }),
        }),
        createElement('div', {
          className: 'row',
          children: [
            createElement('button', {
              className: 'btn',
              text: t('queue_start'),
              attrs: { type: 'button' },
              onClick: () => this.vm.startQueue(),
            }),
            createElement('button', {
              className: 'btn btn--danger',
              text: t('queue_cancel_all'),
              attrs: { type: 'button' },
              onClick: () => this.vm.cancelAllDownloads(),
            }),
          ],
        }),
      ],
    });

    const list = createElement('div', {
      className: 'queue-list',
      attrs: { role: 'list' },
    });

    if (snapshot.tasks.length === 0) {
      list.appendChild(
        createElement('div', { className: 'empty', text: t('queue_empty') }),
      );
    } else {
      for (const task of snapshot.tasks) list.appendChild(this.renderTask(task));
    }

    const overall = createElement('div', {
      className: 'progress overall-progress',
      attrs: {
        role: 'progressbar',
        'aria-valuemin': '0',
        'aria-valuemax': '100',
        'aria-valuenow': String(Math.round(snapshot.overallProgress * 100)),
      },
      children: [
        createElement('div', {
          className: 'progress__bar',
          attrs: { style: `width:${Math.round(snapshot.overallProgress * 100)}%` },
        }),
      ],
    });

    const section = createElement('section', {
      className: 'section',
      attrs: { 'aria-label': t('section_queue') },
      children: [
        createElement('h2', { className: 'section__title', text: t('section_queue') }),
        controls,
        createElement('div', { attrs: { style: 'height:8px' } }),
        list,
        overall,
      ],
    });

    this.mount(section);
  }

  private renderTask(task: DownloadTask): HTMLElement {
    const { t } = this.vm.i18n;
    const name = task.item.fileName ?? `${task.item.type}-${task.item.id}`;

    const stateLabel = createElement('span', {
      className: `queue-item__state state--${task.state}`,
      text: t(STATE_LABELS[task.state]),
    });

    const top = createElement('div', {
      className: 'queue-item__top',
      children: [
        createElement('span', { className: 'queue-item__name', text: name, title: name }),
        stateLabel,
      ],
    });

    const bar = createElement('div', {
      className: 'progress',
      children: [
        createElement('div', {
          className: 'progress__bar',
          attrs: { style: `width:${Math.round(task.progress * 100)}%` },
        }),
      ],
    });

    const actions = createElement('div', {
      className: 'row',
      attrs: { style: 'margin-top:4px' },
    });
    if (task.state === 'failed' || task.state === 'cancelled') {
      actions.appendChild(
        createElement('button', {
          className: 'icon-btn',
          attrs: {
            type: 'button',
            'aria-label': t('queue_retry'),
            title: t('queue_retry'),
          },
          children: [icon('retry', 14)],
          onClick: () => this.vm.retryTask(task.id),
        }),
      );
    }
    if (task.state === 'queued' || task.state === 'running') {
      actions.appendChild(
        createElement('button', {
          className: 'icon-btn',
          attrs: {
            type: 'button',
            'aria-label': t('queue_cancel'),
            title: t('queue_cancel'),
          },
          children: [icon('cancel', 14)],
          onClick: () => this.vm.cancelTask(task.id),
        }),
      );
    }
    if (task.error !== undefined) {
      actions.appendChild(
        createElement('span', { className: 'muted', text: task.error }),
      );
    }

    return createElement('div', {
      className: 'queue-item',
      attrs: { role: 'listitem' },
      children: [top, bar, actions],
    });
  }
}
