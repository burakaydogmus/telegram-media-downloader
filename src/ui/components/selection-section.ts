import { BaseComponent } from './base-component.js';
import type { PanelEvent } from './panel-view-model.js';
import { TAGS } from '../../shared/constants/index.js';
import { createElement } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { PANEL_STYLES } from '../styles/panel.styles.js';

export class SelectionSection extends BaseComponent {
  constructor() {
    super(TAGS.selection);
    this.adoptStyles(PANEL_STYLES);
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    return ['selection', 'media'];
  }

  protected override render(): void {
    const { t } = this.vm.i18n;
    const selectedCount = this.vm.getSelectedIds().length;
    const hasSelection = selectedCount > 0;

    const status = createElement('div', {
      className: hasSelection ? '' : 'muted',
      attrs: { 'aria-live': 'polite' },
      text: hasSelection
        ? t('selection_count', { count: selectedCount })
        : t('selection_none'),
    });

    const selectAllBtn = createElement('button', {
      className: 'btn',
      text: t('selection_select_all'),
      attrs: { type: 'button' },
      onClick: () => this.vm.selectAllVisible(),
    });

    const clearBtn = createElement('button', {
      className: 'btn',
      text: t('selection_clear'),
      attrs: { type: 'button' },
      onClick: () => this.vm.clearSelection(),
    });

    const downloadBtn = createElement('button', {
      className: 'btn btn--primary',
      attrs: { type: 'button', ...(hasSelection ? {} : { disabled: 'true' }) },
      children: [
        icon('download', 16),
        document.createTextNode(' ' + t('selection_download')),
      ],
      onClick: () => this.vm.downloadSelected(),
    });

    const csvBtn = createElement('button', {
      className: 'btn',
      text: t('report_export_csv'),
      attrs: { type: 'button' },
      onClick: () => this.vm.exportReport('csv'),
    });

    const jsonBtn = createElement('button', {
      className: 'btn',
      text: t('report_export_json'),
      attrs: { type: 'button' },
      onClick: () => this.vm.exportReport('json'),
    });

    const section = createElement('section', {
      className: 'section',
      attrs: { 'aria-label': t('section_selection') },
      children: [
        createElement('h2', {
          className: 'section__title',
          text: t('section_selection'),
        }),
        status,
        createElement('div', { attrs: { style: 'height:8px' } }),
        createElement('div', { className: 'row', children: [selectAllBtn, clearBtn] }),
        createElement('div', { attrs: { style: 'height:6px' } }),
        createElement('div', { className: 'row', children: [downloadBtn] }),
        createElement('div', { attrs: { style: 'height:6px' } }),
        createElement('div', { className: 'row', children: [csvBtn, jsonBtn] }),
      ],
    });

    this.mount(section);
  }
}
