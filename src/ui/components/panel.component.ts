import { BaseComponent, type Changes } from './base-component.js';
import type { PanelEvent, PanelViewModel } from './panel-view-model.js';
import type { PanelState, SelectorHealthReport } from '../../shared/types/index.js';
import { TAGS, DEFAULT_PANEL_STATE } from '../../shared/constants/index.js';
import { createElement, clamp, debounce } from '../../shared/utils/index.js';
import { icon } from '../icons/svg-icons.js';
import { PANEL_HOST_STYLES } from '../styles/panel.styles.js';
import { setAttr, setHidden, setText } from './dom-diff.js';
import { StatisticsSection } from './statistics-section.js';
import { SearchSection } from './search-section.js';
import { FiltersSection } from './filters-section.js';
import { MediaGridSection } from './media-grid-section.js';
import { SelectionSection } from './selection-section.js';
import { CrawlSection } from './crawl-section.js';
import { QueueSection } from './queue-section.js';
import { LogsSection } from './logs-section.js';

const PANEL_WIDTH = 340;
/** Minimum part of the panel (header) that must stay reachable on screen. */
const MIN_VISIBLE_HEIGHT = 120;
const RESIZE_DEBOUNCE_MS = 120;

interface HealthRefs {
  readonly el: HTMLElement;
  readonly failed: HTMLElement;
}

export class PanelComponent extends BaseComponent {
  private state: PanelState = { ...DEFAULT_PANEL_STATE };
  private persist: (state: PanelState) => void = () => {};
  private panelEl: HTMLElement | null = null;
  private header: HTMLElement | null = null;
  private collapseBtn: HTMLButtonElement | null = null;
  private health: HealthRefs | null = null;
  private dismissedHealth: string | null = null;
  private sections: BaseComponent[] = [];
  private dragPointerId: number | null = null;
  private dragOffset = { x: 0, y: 0 };

  private readonly persistDebounced = debounce((s: PanelState) => this.persist(s), 250);
  private readonly onResize = debounce(() => this.reclamp(), RESIZE_DEBOUNCE_MS);
  private readonly onPointerMove = (e: PointerEvent): void => this.handlePointerMove(e);
  private readonly onPointerUp = (e: PointerEvent): void => this.handlePointerUp(e);

  constructor() {
    // Host positioning rules come last so they win over the shared component
    // `:host { display: block }` rule.
    super(TAGS.panel, [PANEL_HOST_STYLES]);
  }

  configure(initial: PanelState, persist: (state: PanelState) => void): void {
    this.state = { ...initial };
    this.persist = persist;
  }

  protected override get observedChannels(): readonly PanelEvent[] {
    // Sections update themselves; the shell only reacts to health reports.
    return ['health'];
  }

  protected override onConnect(): void {
    window.addEventListener('resize', this.onResize);
  }

  protected override onDisconnect(): void {
    this.disconnectSections();
    window.removeEventListener('resize', this.onResize);
    this.onResize.cancel();
    this.endDrag();
  }

  toggleVisible(): void {
    this.state.visible = !this.state.visible;
    this.applyState();
    this.persist({ ...this.state });
  }

  get isVisible(): boolean {
    return this.state.visible;
  }

  protected override build(): void {
    const vm = this.vm;
    this.disconnectSections();

    const panel = createElement('div', {
      className: 'panel',
      attrs: { role: 'dialog', 'aria-label': vm.i18n.t('panel_title') },
    });
    this.panelEl = panel;

    panel.appendChild(this.buildHeader(vm));
    panel.appendChild(this.buildHealthBanner(vm));

    const body = createElement('div', {
      className: 'panel__body',
      attrs: { part: 'body' },
    });
    for (const section of this.createSections()) {
      this.sections.push(section);
      section.viewModel = vm;
      body.appendChild(section.host);
      section.connect();
    }
    panel.appendChild(body);

    this.mount(panel);
    this.applyState();
  }

  protected override update(_changes: Changes): void {
    this.updateHealth(this.vm.getHealth());
  }

  private disconnectSections(): void {
    for (const section of this.sections) section.disconnect();
    this.sections = [];
  }

  private buildHeader(vm: PanelViewModel): HTMLElement {
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

    this.collapseBtn = createElement('button', {
      className: 'icon-btn',
      attrs: { type: 'button' },
      onClick: () => this.toggleCollapsed(),
    });
    this.updateCollapseButton();

    const closeBtn = createElement('button', {
      className: 'icon-btn',
      attrs: { type: 'button', 'aria-label': t('panel_close'), title: t('panel_close') },
      children: [icon('close', 16)],
      onClick: () => this.toggleVisible(),
    });

    const header = createElement('div', {
      className: 'panel__header',
      attrs: { part: 'header', title: t('panel_drag') },
      children: [title, rescanBtn, this.collapseBtn, closeBtn],
    });
    header.addEventListener('pointerdown', (e) => this.handlePointerDown(e));
    this.header = header;
    return header;
  }

  private buildHealthBanner(vm: PanelViewModel): HTMLElement {
    const { t } = vm.i18n;
    const failed = createElement('div', { className: 'health__checks' });
    const el = createElement('div', {
      className: 'health',
      attrs: { role: 'alert' },
      children: [
        createElement('span', {
          className: 'health__icon',
          children: [icon('warning', 16)],
        }),
        createElement('div', {
          className: 'health__text',
          children: [
            createElement('strong', { text: t('health_title') }),
            createElement('div', { text: t('health_body') }),
            failed,
          ],
        }),
        createElement('button', {
          className: 'icon-btn',
          attrs: {
            type: 'button',
            'aria-label': t('health_dismiss'),
            title: t('health_dismiss'),
          },
          children: [icon('close', 14)],
          onClick: () => {
            this.dismissedHealth = failedSignature(vm.getHealth());
            setHidden(el, true);
          },
        }),
      ],
    });
    el.hidden = true;
    this.health = { el, failed };
    return el;
  }

  private updateHealth(report: SelectorHealthReport | null): void {
    const health = this.health;
    if (!health) return;
    if (report?.ok) this.dismissedHealth = null;
    const signature = failedSignature(report);
    // A dismissed warning only comes back when a different set of checks fails.
    const show = report !== null && !report.ok && signature !== this.dismissedHealth;
    setHidden(health.el, !show);
    if (!show) return;
    setText(health.failed, this.vm.i18n.t('health_failed', { checks: signature }));
  }

  private createSections(): readonly BaseComponent[] {
    return [
      new StatisticsSection(),
      new SearchSection(),
      new FiltersSection(),
      new MediaGridSection(),
      new SelectionSection(),
      new CrawlSection(),
      new QueueSection(),
      new LogsSection(),
    ];
  }

  protected override onLanguageChange(): void {
    // Sections rebuild themselves; the shell only needs a fresh header/banner.
    const panel = this.panelEl;
    if (!panel || !this.header || !this.health) {
      this.rebuild();
      return;
    }
    const vm = this.vm;
    this.endDrag();
    setAttr(panel, 'aria-label', vm.i18n.t('panel_title'));
    const oldHeader = this.header;
    const oldHealth = this.health.el;
    oldHeader.replaceWith(this.buildHeader(vm));
    oldHealth.replaceWith(this.buildHealthBanner(vm));
    this.update(null);
  }

  private updateCollapseButton(): void {
    const btn = this.collapseBtn;
    if (!btn) return;
    const { t } = this.vm.i18n;
    const label = this.state.collapsed ? t('panel_expand') : t('panel_collapse');
    setAttr(btn, 'aria-label', label);
    setAttr(btn, 'title', label);
    setAttr(btn, 'aria-expanded', String(!this.state.collapsed));
    btn.replaceChildren(icon(this.state.collapsed ? 'expand' : 'collapse', 16));
  }

  private toggleCollapsed(): void {
    this.state.collapsed = !this.state.collapsed;
    this.updateCollapseButton();
    this.applyState();
    this.persist({ ...this.state });
  }

  private reclamp(): void {
    const before = { x: this.state.x, y: this.state.y };
    this.applyState();
    if (before.x !== this.state.x || before.y !== this.state.y) {
      this.persistDebounced({ ...this.state });
    }
  }

  private applyState(): void {
    if (!this.panelEl) return;
    this.panelEl.classList.toggle('collapsed', this.state.collapsed);
    this.host.style.display = this.state.visible ? 'block' : 'none';

    const rect = this.panelEl.getBoundingClientRect();
    const width = rect.width || PANEL_WIDTH;
    const visibleHeight = Math.min(rect.height || MIN_VISIBLE_HEIGHT, MIN_VISIBLE_HEIGHT);
    this.state.x = clamp(this.state.x, 0, Math.max(0, window.innerWidth - width));
    this.state.y = clamp(
      this.state.y,
      0,
      Math.max(0, window.innerHeight - visibleHeight),
    );
    this.host.style.transform = `translate(${this.state.x}px, ${this.state.y}px)`;
  }

  private handlePointerDown(event: PointerEvent): void {
    // Ignore drags initiated on interactive header controls.
    if (event.button !== 0 || (event.target as Element).closest('button')) return;
    const header = this.header;
    if (!header) return;
    this.dragPointerId = event.pointerId;
    this.dragOffset = {
      x: event.clientX - this.state.x,
      y: event.clientY - this.state.y,
    };
    try {
      header.setPointerCapture(event.pointerId);
    } catch {
      // Synthetic or already-released pointers cannot be captured.
    }
    header.addEventListener('pointermove', this.onPointerMove);
    header.addEventListener('pointerup', this.onPointerUp);
    header.addEventListener('pointercancel', this.onPointerUp);
    event.preventDefault();
  }

  private handlePointerMove(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.state.x = event.clientX - this.dragOffset.x;
    this.state.y = event.clientY - this.dragOffset.y;
    this.applyState();
  }

  private handlePointerUp(event: PointerEvent): void {
    if (event.pointerId !== this.dragPointerId) return;
    this.endDrag();
    this.persistDebounced({ ...this.state });
  }

  private endDrag(): void {
    const header = this.header;
    if (header && this.dragPointerId !== null) {
      try {
        if (header.hasPointerCapture(this.dragPointerId)) {
          header.releasePointerCapture(this.dragPointerId);
        }
      } catch {
        // ignore: capture already gone
      }
    }
    this.dragPointerId = null;
    header?.removeEventListener('pointermove', this.onPointerMove);
    header?.removeEventListener('pointerup', this.onPointerUp);
    header?.removeEventListener('pointercancel', this.onPointerUp);
  }
}

function failedSignature(report: SelectorHealthReport | null): string {
  if (!report) return '';
  const failed = report.checks.filter((c) => !c.matched);
  const critical = failed.filter((c) => c.critical);
  return (critical.length > 0 ? critical : failed).map((c) => c.name).join(', ');
}
