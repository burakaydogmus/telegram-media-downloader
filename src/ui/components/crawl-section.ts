import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import type { CrawlStatus } from '../../shared/types/index.js';
import { createElement } from '../../shared/utils/index.js';
import type { TranslationKey } from '../../shared/i18n/index.js';
import { setHidden, setText } from './dom-diff.js';
import { UI_TAGS } from './tags.js';

const STATUS_LABELS: Readonly<Record<CrawlStatus, TranslationKey>> = {
  idle: 'crawl_status_idle',
  running: 'crawl_status_running',
  paused: 'crawl_status_paused',
  done: 'crawl_status_done',
  error: 'crawl_status_error',
};

/** Local midnight of a `YYYY-MM-DD` date-input value, or undefined. */
export function parseDateInput(value: string): number | undefined {
  const match = /^(\d{4})-(\d{2})-(\d{2})$/.exec(value);
  if (!match) return undefined;
  const time = new Date(
    Number(match[1]),
    Number(match[2]) - 1,
    Number(match[3]),
  ).getTime();
  return Number.isFinite(time) ? time : undefined;
}

export class CrawlSection extends BaseComponent {
  private until: HTMLInputElement | null = null;
  private buttons: {
    readonly start: HTMLButtonElement;
    readonly pause: HTMLButtonElement;
    readonly resume: HTMLButtonElement;
    readonly stop: HTMLButtonElement;
  } | null = null;
  private status: HTMLElement | null = null;
  private details: HTMLElement | null = null;
  private error: HTMLElement | null = null;

  constructor() {
    super(UI_TAGS.crawl);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['crawl'];
  }

  protected override build(): void {
    const { t } = this.vm.i18n;
    const button = (
      text: string,
      className: string,
      onClick: () => void,
    ): HTMLButtonElement =>
      createElement('button', { className, text, attrs: { type: 'button' }, onClick });

    const until = createElement('input', {
      className: 'input input--date',
      id: 'crawl-until',
      attrs: { type: 'date' },
    });
    this.until = until;

    this.buttons = {
      start: button(t('crawl_start'), 'btn btn--primary', () => {
        const untilTimestamp = parseDateInput(until.value);
        if (untilTimestamp === undefined) this.vm.startCrawl();
        else this.vm.startCrawl({ untilTimestamp });
      }),
      pause: button(t('crawl_pause'), 'btn', () => this.vm.pauseCrawl()),
      resume: button(t('crawl_resume'), 'btn', () => this.vm.resumeCrawl()),
      stop: button(t('crawl_stop'), 'btn btn--danger', () => this.vm.stopCrawl()),
    };

    this.status = createElement('div', { attrs: { role: 'status' } });
    this.details = createElement('div', { className: 'muted' });
    this.error = createElement('div', {
      className: 'error-text',
      attrs: { role: 'alert' },
    });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_crawl') },
        children: [
          createElement('h2', { className: 'section__title', text: t('section_crawl') }),
          createElement('div', {
            className: 'field',
            children: [
              createElement('label', {
                className: 'muted',
                text: t('crawl_until'),
                attrs: { for: 'crawl-until' },
              }),
              until,
            ],
          }),
          createElement('div', {
            className: 'row gap-top',
            children: Object.values(this.buttons),
          }),
          createElement('div', {
            className: 'gap-top',
            children: [this.status, this.details, this.error],
          }),
        ],
      }),
    );
  }

  protected override update(_changes: Changes): void {
    const { t } = this.vm.i18n;
    const state = this.vm.getCrawlState();
    const active = state.status === 'running' || state.status === 'paused';

    const buttons = this.buttons;
    if (buttons) {
      const focused = this.root.activeElement;
      setHidden(buttons.start, active);
      setHidden(buttons.pause, state.status !== 'running');
      setHidden(buttons.resume, state.status !== 'paused');
      setHidden(buttons.stop, !active);
      // Keep keyboard focus inside the section when the focused button hides.
      if (focused instanceof HTMLButtonElement && focused.hidden) {
        Object.values(buttons)
          .find((b) => !b.hidden)
          ?.focus();
      }
    }
    if (this.until) this.until.disabled = active;

    if (this.status) setText(this.status, t(STATUS_LABELS[state.status]));
    if (this.details) {
      const parts =
        state.status === 'idle'
          ? []
          : [t('crawl_progress', { steps: state.steps, found: state.foundItems })];
      if (state.oldestTimestamp !== undefined) {
        parts.push(
          t('crawl_oldest', {
            date: new Date(state.oldestTimestamp).toLocaleDateString(),
          }),
        );
      }
      setText(this.details, parts.join(' · '));
    }
    if (this.error) {
      setText(this.error, state.error ?? '');
      setHidden(this.error, state.error === undefined);
    }
  }
}
