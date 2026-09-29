import { describe, it, expect } from 'vitest';
import { reconcileKeyed, setAttr, setText } from '../../src/ui/components/dom-diff.js';

interface Row {
  readonly id: string;
  readonly label: string;
}

function run(container: HTMLElement, nodes: Map<string, HTMLElement>, rows: Row[]) {
  let created = 0;
  reconcileKeyed(
    container,
    rows,
    (r) => r.id,
    nodes,
    () => {
      created += 1;
      const el = document.createElement('button');
      return el;
    },
    (el, r) => {
      el.dataset.id = r.id;
      setText(el, r.label);
    },
  );
  return created;
}

describe('reconcileKeyed', () => {
  it('reuses, reorders, inserts and removes nodes by key', () => {
    const container = document.createElement('div');
    const nodes = new Map<string, HTMLElement>();
    expect(
      run(container, nodes, [
        { id: 'a', label: 'A' },
        { id: 'b', label: 'B' },
        { id: 'c', label: 'C' },
      ]),
    ).toBe(3);
    const [a, b] = [nodes.get('a'), nodes.get('b')];

    expect(
      run(container, nodes, [
        { id: 'c', label: 'C' },
        { id: 'd', label: 'D' },
        { id: 'a', label: 'A2' },
      ]),
    ).toBe(1);
    expect([...container.children].map((c) => c.textContent)).toEqual(['C', 'D', 'A2']);
    expect(nodes.get('a')).toBe(a);
    expect(b?.isConnected).toBe(false);
    expect(nodes.has('b')).toBe(false);
  });

  it('keeps focus on a node that had to move', () => {
    const container = document.createElement('div');
    document.body.appendChild(container);
    const nodes = new Map<string, HTMLElement>();
    run(container, nodes, [
      { id: 'a', label: 'A' },
      { id: 'b', label: 'B' },
    ]);
    nodes.get('a')!.focus();
    run(container, nodes, [
      { id: 'b', label: 'B' },
      { id: 'a', label: 'A' },
    ]);
    expect(document.activeElement).toBe(nodes.get('a'));
  });
});

describe('setAttr', () => {
  it('sets, skips identical values and removes', () => {
    const el = document.createElement('div');
    setAttr(el, 'aria-selected', 'true');
    expect(el.getAttribute('aria-selected')).toBe('true');
    setAttr(el, 'aria-selected', null);
    expect(el.hasAttribute('aria-selected')).toBe(false);
  });
});
