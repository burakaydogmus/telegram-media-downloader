import type { PanelViewModel, PanelEvent } from './panel-view-model.js';
import { requestFrame } from './frame-scheduler.js';
import { adoptSharedStyles } from '../styles/shared-sheet.js';
import { PANEL_STYLES } from '../styles/panel.styles.js';

/** `local` marks component-internal invalidations (e.g. scrolling). */
export type UpdateReason = PanelEvent | 'local';

/** Channels that changed since the last update; `null` means "everything". */
export type Changes = ReadonlySet<UpdateReason> | null;

/**
 * Components build their DOM skeleton once (`build`) and afterwards patch it
 * in place (`update`). View-model events are coalesced so any number of
 * events within one animation frame produce a single update.
 */
export abstract class BaseComponent {
  readonly host: HTMLElement;
  protected readonly root: ShadowRoot;
  private viewModelRef: PanelViewModel | null = null;
  private unsubscribe: (() => void) | null = null;
  private unsubscribeLanguage: (() => void) | null = null;
  private pending: Set<UpdateReason> | null = null;
  private cancelFrame: (() => void) | null = null;

  protected constructor(tagName: string, extraStyles: readonly string[] = []) {
    this.host = document.createElement(tagName);
    this.root = this.host.attachShadow({ mode: 'open' });
    adoptSharedStyles(this.root, [PANEL_STYLES, ...extraStyles]);
  }

  set viewModel(vm: PanelViewModel) {
    this.viewModelRef = vm;
  }

  get shadowRoot(): ShadowRoot {
    return this.root;
  }

  protected get vm(): PanelViewModel {
    if (!this.viewModelRef) {
      throw new Error(`${this.host.tagName}: viewModel not injected`);
    }
    return this.viewModelRef;
  }

  protected abstract get observedChannels(): readonly PanelEvent[];

  /** Create the static DOM once and mount it. */
  protected abstract build(): void;

  /** Patch the existing DOM for the given changes. */
  protected abstract update(changes: Changes): void;

  connect(): void {
    this.onConnect();
    this.rebuild();
    this.unsubscribe = this.vm.subscribe((event) => {
      if (this.observedChannels.includes(event)) this.requestUpdate(event);
    });
    this.unsubscribeLanguage = this.vm.i18n.onChange(() => this.onLanguageChange());
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.unsubscribeLanguage?.();
    this.unsubscribeLanguage = null;
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.pending = null;
    this.onDisconnect();
  }

  /** Apply pending changes now instead of waiting for the next frame. */
  flush(): void {
    this.cancelFrame?.();
    this.cancelFrame = null;
    const changes = this.pending;
    this.pending = null;
    if (changes) this.update(changes);
  }

  protected requestUpdate(reason: UpdateReason): void {
    (this.pending ??= new Set()).add(reason);
    this.cancelFrame ??= requestFrame(() => {
      this.cancelFrame = null;
      this.flush();
    });
  }

  protected rebuild(): void {
    this.cancelFrame?.();
    this.cancelFrame = null;
    this.pending = null;
    this.build();
    this.update(null);
  }

  protected onLanguageChange(): void {
    this.rebuild();
  }

  protected onConnect(): void {}

  protected onDisconnect(): void {}

  protected mount(...nodes: readonly Node[]): void {
    for (const child of [...this.root.childNodes]) {
      if (child.nodeName !== 'STYLE') this.root.removeChild(child);
    }
    for (const node of nodes) this.root.appendChild(node);
  }
}
