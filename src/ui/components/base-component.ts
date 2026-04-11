import type { PanelViewModel, PanelEvent } from './panel-view-model.js';
export abstract class BaseComponent {
  readonly host: HTMLElement;
  protected readonly root: ShadowRoot;
  private viewModelRef: PanelViewModel | null = null;
  private unsubscribe: (() => void) | null = null;

  protected constructor(tagName: string) {
    this.host = document.createElement(tagName);
    this.root = this.host.attachShadow({ mode: 'open' });
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

  protected abstract render(): void;

  connect(): void {
    this.onConnect();
    this.render();
    this.unsubscribe = this.vm.subscribe((event) => {
      if (this.observedChannels.includes(event)) this.render();
    });
  }

  disconnect(): void {
    this.unsubscribe?.();
    this.unsubscribe = null;
    this.onDisconnect();
  }

  protected onConnect(): void {}

  protected onDisconnect(): void {}

  protected adoptStyles(css: string): void {
    try {
      const sheet = new CSSStyleSheet();
      sheet.replaceSync(css);
      this.root.adoptedStyleSheets = [sheet];
    } catch {
      const style = document.createElement('style');
      style.textContent = css;
      this.root.appendChild(style);
    }
  }
  protected mount(...nodes: readonly Node[]): void {
    for (const child of [...this.root.childNodes]) {
      if (child.nodeName !== 'STYLE') this.root.removeChild(child);
    }
    for (const node of nodes) this.root.appendChild(node);
  }
}
