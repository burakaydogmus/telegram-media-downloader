export interface ElementOptions {
  readonly className?: string;
  readonly text?: string;
  readonly title?: string;
  readonly id?: string;
  readonly attrs?: Readonly<Record<string, string>>;
  readonly dataset?: Readonly<Record<string, string>>;
  readonly children?: readonly Node[];
  readonly onClick?: (event: MouseEvent) => void;
}

export function createElement<K extends keyof HTMLElementTagNameMap>(
  tag: K,
  options: ElementOptions = {},
): HTMLElementTagNameMap[K] {
  const el = document.createElement(tag);
  if (options.className !== undefined) el.className = options.className;
  if (options.text !== undefined) el.textContent = options.text;
  if (options.title !== undefined) el.title = options.title;
  if (options.id !== undefined) el.id = options.id;

  if (options.attrs) {
    for (const [key, value] of Object.entries(options.attrs)) {
      el.setAttribute(key, value);
    }
  }
  if (options.dataset) {
    for (const [key, value] of Object.entries(options.dataset)) {
      el.dataset[key] = value;
    }
  }
  if (options.children) {
    for (const child of options.children) el.appendChild(child);
  }
  if (options.onClick) {
    el.addEventListener('click', options.onClick as EventListener);
  }
  return el;
}

export function clearChildren(node: Node): void {
  while (node.firstChild) node.removeChild(node.firstChild);
}

export function sanitizeText(input: string): string {
  // Intentionally strips C0 control characters for safe text display.
  // eslint-disable-next-line no-control-regex
  return input.replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f]/g, '').trim();
}

export function query<E extends Element = Element>(
  root: ParentNode,
  selector: string,
): E | null {
  return root.querySelector<E>(selector);
}

export function queryAll<E extends Element = Element>(
  root: ParentNode,
  selector: string,
): E[] {
  return Array.from(root.querySelectorAll<E>(selector));
}

export function closestMatch(el: Element, selector: string): Element | null {
  return el.closest(selector);
}
