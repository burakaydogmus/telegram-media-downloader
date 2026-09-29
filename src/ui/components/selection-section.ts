import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { setText } from './dom-diff.js';

export class SelectionSection extends BaseComponent {
  private status: HTMLElement | null = null;
  private downloadBtn: HTMLButtonElement | null = null;

  constructor() {
    super(TAGS.selection);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['selection', 'media'];
  }

  protected override build(): void {
    const { t } = this.vm.i18n;

    this.status = createElement('div', { attrs: { 'aria-live': 'polite' } });

    const button = (text: string, onClick: () => void): HTMLButtonElement =>
      createElement('button', {
        className: 'btn',
        text,
        attrs: { type: 'button' },
        onClick,
      });

    this.downloadBtn = createElement('button', {
      className: 'btn btn--primary',
      attrs: { type: 'button' },
      children: [
        icon('download', 16),
        document.createTextNode(' ' + t('selection_download')),
      ],
      onClick: () => this.vm.downloadSelected(),
    });

    this.mount(
      createElement('section', {
        className: 'section',
        attrs: { 'aria-label': t('section_selection') },
        children: [
          createElement('h2', {
            className: 'section__title',
            text: t('section_selection'),
          }),
          this.status,
          createElement('div', {
            className: 'row gap-top',
            children: [
              button(t('selection_select_all'), () => this.vm.selectAllVisible()),
              button(t('selection_clear'), () => this.vm.clearSelection()),
            ],
          }),
          createElement('div', {
            className: 'row gap-top',
            children: [this.downloadBtn],
          }),
          createElement('div', {
            className: 'row gap-top',
            children: [
              button(t('report_export_csv'), () => this.vm.exportReport('csv')),
              button(t('report_export_json'), () => this.vm.exportReport('json')),
            ],
          }),
        ],
      }),
    );
  }

  protected override update(_changes: Changes): void {
    const { t } = this.vm.i18n;
    const count = this.vm.getSelectedIds().length;
    if (this.status) {
      setText(
        this.status,
        count > 0 ? t('selection_count', { count }) : t('selection_none'),
      );
      this.status.classList.toggle('muted', count === 0);
    }
    if (this.downloadBtn) this.downloadBtn.disabled = count === 0;
  }
}
