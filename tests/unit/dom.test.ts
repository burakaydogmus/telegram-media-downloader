import { describe, it, expect, vi } from 'vitest';
import {
  createElement,
  clearChildren,
  sanitizeText,
  query,
  queryAll,
  closestMatch,
} from '../../src/shared/utils/dom.js';

describe('dom utils', () => {
  it('creates elements with text, class, attrs, dataset and children', () => {
    const child = createElement('span', { text: 'child' });
    const el = createElement('div', {
      className: 'box',
      id: 'main',
      title: 'tip',
      text: 'hello',
      attrs: { role: 'group', 'aria-label': 'x' },
      dataset: { foo: 'bar' },
      children: [child],
    });
    expect(el.className).toBe('box');
    expect(el.id).toBe('main');
    expect(el.getAttribute('role')).toBe('group');
    expect(el.dataset.foo).toBe('bar');
    expect(el.querySelector('span')?.textContent).toBe('child');
  });

  it('attaches click handlers', () => {
    const onClick = vi.fn();
    const btn = createElement('button', { text: 'go', onClick });
    btn.click();
    expect(onClick).toHaveBeenCalledOnce();
  });

  it('clears children', () => {
    const el = createElement('div', {
      children: [createElement('span'), createElement('b')],
    });
    clearChildren(el);
    expect(el.childNodes.length).toBe(0);
  });

  it('sanitizes control characters', () => {
    expect(sanitizeText('  a\u0000b  ')).toBe('ab');
  });

  it('queries single and multiple elements', () => {
    const root = createElement('div', {
      children: [
        createElement('p', { className: 'x' }),
        createElement('p', { className: 'x' }),
      ],
    });
    expect(query(root, '.x')).not.toBeNull();
    expect(queryAll(root, '.x')).toHaveLength(2);
  });

  it('finds closest ancestor', () => {
    const inner = createElement('span');
    const outer = createElement('div', { className: 'wrap', children: [inner] });
    document.body.appendChild(outer);
    expect(closestMatch(inner, '.wrap')).toBe(outer);
  });
});
