import { BaseComponent } from './base-component.js';
import type { PanelEvent, PanelViewModel } from './panel-view-model.js';
import type { PanelState } from '../../shared/types/index.js';
import { TAGS, DEFAULT_PANEL_STATE } from '../../shared/constants/index.js';
import { createElement, clamp, debounce } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { PANEL_STYLES, PANEL_HOST_STYLES } from '../styles/panel.styles.js';
import { StatisticsSection } from './statistics-section.js';
import { SearchSection } from './search-section.js';
import { FiltersSection } from './filters-section.js';
import { SelectionSection } from './selection-section.js';
import { QueueSection } from './queue-section.js';
import { LogsSection } from './logs-section.js';

export class PanelComponent extends BaseComponent {
  private state: PanelState = { ...DEFAULT_PANEL_STATE };
  private persist: (state: PanelState) => void = () => {};
  private panelEl: HTMLElement | null = null;
  private sections: BaseComponent[] = [];
  private dragging = false;
  private dragOffset = { x: 0, y: 0 };

  private readonly persistDebounced = debounce((s: PanelState) => this.persist(s), 250);
  private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e);

  constructor() {
    super(TAGS.panel);
    // Host positioning rules come last so they win over the shared component
    // `:host { display: block }` rule.
    this.adoptStyles(`${PANEL_STYLES}\n${PANEL_HOST_STYLES}`);
  }

  configure(initial: PanelState, persist: (state: PanelState) => void): void {
    this.state = { ...initial };
    this.persist = persist;
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    // The shell never needs a full rebuild; sections update themselves.
    return [];
  }

  protected override onDisconnect(): void {
    for (const section of this.sections) section.disconnect();
    this.sections = [];
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
  }

  toggleVisible(): void {
    this.state.visible = !this.state.visible;
    this.applyState();
    this.persist({ ...this.state });
  }

  get isVisible(): boolean {
    return this.state.visible;
  }

  protected override render(): void {
    const vm = this.vm;

    // Tear down any previously connected sections before rebuilding.
    for (const section of this.sections) section.disconnect();
    this.sections = [];

    const panel = createElement('div', {
      className: 'panel',
      attrs: { role: 'dialog', 'aria-label': vm.i18n.t('panel_title') },
    });
    this.panelEl = panel;

    panel.appendChild(this.renderHeader(vm));

    const body = createElement('div', {
      className: 'panel__body',
      attrs: { part: 'body' },
    });
    for (const section of this.createSections(vm)) {
      this.sections.push(section);
      section.viewModel = vm;
      body.appendChild(section.host);
      section.connect();
    }
    panel.appendChild(body);

    this.mount(panel);
    this.applyState();
  }

  private renderHeader(vm: PanelViewModel): HTMLElement {
    const { t } = vm.i18n;

    const logo = createElement('span', { className: 'panel__logo' });
    logo.appendChild(icon('logo', 18));

    const title = createElement('div', {
      className: 'panel__title',
      children: [logo, createElement('span', { text: t('panel_title') })],
    });

    const rescanBtn = createElement('button', {
      className: 'icon-btn',
      attrs: { type: 'button', 'aria-label': t('scan_button'), title: t('scan_button') },
      children: [icon('refresh', 16)],
      onClick: () => vm.rescan(),
    });

    const collapseBtn = createElement('button', {
      className: 'icon-btn',
      attrs: {
        type: 'button',
        'aria-label': this.state.collapsed ? t('panel_expand') : t('panel_collapse'),
        title: this.state.collapsed ? t('panel_expand') : t('panel_collapse'),
      },
      children: [icon(this.state.collapsed ? 'expand' : 'collapse', 16)],
      onClick: () => this.toggleCollapsed(),
    });

    const closeBtn = createElement('button', {
      className: 'icon-btn',
      attrs: { type: 'button', 'aria-label': t('panel_close'), title: t('panel_close') },
      children: [icon('close', 16)],
      onClick: () => this.toggleVisible(),
    });

    const header = createElement('div', {
      className: 'panel__header',
      attrs: { part: 'header', title: t('panel_drag') },
      children: [title, rescanBtn, collapseBtn, closeBtn],
    });

    header.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    return header;
  }

  private createSections(vm: PanelViewModel): readonly BaseComponent[] {
    const sections: BaseComponent[] = [
      new StatisticsSection(),
      new SearchSection(),
      new FiltersSection(),
      new SelectionSection(),
      new QueueSection(),
      new LogsSection(),
    ];
    for (const section of sections) section.viewModel = vm;
    return sections;
  }

  private toggleCollapsed(): void {
    this.state.collapsed = !this.state.collapsed;
    this.render();
    this.persist({ ...this.state });
  }

  private applyState(): void {
    if (!this.panelEl) return;
    const maxX = Math.max(0, window.innerWidth - 360);
    const maxY = Math.max(0, window.innerHeight - 120);
    this.state.x = clamp(this.state.x, 0, maxX);
    this.state.y = clamp(this.state.y, 0, maxY);

    this.host.style.transform = `translate(${this.state.x}px, ${this.state.y}px)`;
    this.panelEl.classList.toggle('collapsed', this.state.collapsed);
    this.host.style.display = this.state.visible ? 'block' : 'none';
  }

  private handlePointerDown(event: PointerEvent): void {
    // Ignore drags initiated on interactive header controls.
    if ((event.target as Element).closest('.icon-btn')) return;
    this.dragging = true;
    this.dragOffset = {
      x: event.clientX - this.state.x,
      y: event.clientY - this.state.y,
    };
    window.addEventListener('pointermove', this.onPointerMove);
    window.addEventListener('pointerup', this.onPointerUp);
    event.preventDefault();
  }

  private handlePointerMove(event: PointerEvent): void {
    if (!this.dragging) return;
    this.state.x = event.clientX - this.dragOffset.x;
    this.state.y = event.clientY - this.dragOffset.y;
    this.applyState();
  }

  private handlePointerUp(_event: PointerEvent): void {
    if (!this.dragging) return;
    this.dragging = false;
    window.removeEventListener('pointermove', this.onPointerMove);
    window.removeEventListener('pointerup', this.onPointerUp);
    this.persistDebounced({ ...this.state });
  }
}
