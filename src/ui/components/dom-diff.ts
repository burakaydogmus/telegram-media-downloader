/** Minimal in-place DOM patch helpers (no innerHTML, no full rebuilds). */

export function setText(node: Node, text: string): void {
  if (node.textContent !== text) node.textContent = text;
}

export function setAttr(el: Element, name: string, value: string | null): void {
  if (value === null) {
    if (el.hasAttribute(name)) el.removeAttribute(name);
  } else if (el.getAttribute(name) !== value) {
    el.setAttribute(name, value);
  }
}

export function setHidden(el: HTMLElement, hidden: boolean): void {
  if (el.hidden !== hidden) el.hidden = hidden;
}

export function setStyle(el: HTMLElement, prop: string, value: string): void {
  if (el.style.getPropertyValue(prop) !== value) el.style.setProperty(prop, value);
}

function activeElementOf(node: Node): Element | null {
  const root = node.getRootNode() as Document | ShadowRoot;
  return 'activeElement' in root ? root.activeElement : null;
}

/**
 * Keyed list reconciliation: reuses the node registered for each key in
 * `nodes`, creates missing ones, removes stale ones and only moves nodes that
 * are out of order. `container` must hold nothing but the keyed nodes.
 * Focus and scroll position of the container are preserved.
 */
export function reconcileKeyed<T, N extends HTMLElement>(
  container: HTMLElement,
  items: readonly T[],
  keyOf: (item: T) => string,
  nodes: Map<string, N>,
  create: (item: T) => N,
  update: (node: N, item: T) => void,
): void {
  const focused = activeElementOf(container);
  const scrollTop = container.scrollTop;

  const nextKeys = new Set<string>();
  for (const item of items) nextKeys.add(keyOf(item));
  for (const [key, node] of nodes) {
    if (!nextKeys.has(key)) {
      node.remove();
      nodes.delete(key);
    }
  }

  let cursor: ChildNode | null = container.firstChild;
  for (const item of items) {
    const key = keyOf(item);
    let node = nodes.get(key);
    if (!node) {
      node = create(item);
      nodes.set(key, node);
    }
    update(node, item);
    if (node === cursor) {
      cursor = cursor.nextSibling;
    } else {
      container.insertBefore(node, cursor);
    }
  }

  if (container.scrollTop !== scrollTop) container.scrollTop = scrollTop;
  if (
    focused instanceof HTMLElement &&
    focused.isConnected &&
    container.contains(focused) &&
    activeElementOf(container) !== focused
  ) {
    focused.focus({ preventScroll: true });
  }
}
