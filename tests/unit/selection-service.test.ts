import { describe, it, expect, vi } from 'vitest';
import { SelectionService } from '../../src/features/selection/selection-service.js';

describe('SelectionService', () => {
  it('toggles selection', () => {
    const selection = new SelectionService();
    selection.toggle('a');
    expect(selection.has('a')).toBe(true);
    selection.toggle('a');
    expect(selection.has('a')).toBe(false);
  });

  it('single-selects with selectOnly', () => {
    const selection = new SelectionService();
    selection.add('a');
    selection.add('b');
    selection.selectOnly('c');
    expect(selection.values()).toEqual(['c']);
  });

  it('selects all visible', () => {
    const selection = new SelectionService();
    selection.selectAllVisible(['a', 'b', 'c']);
    expect(selection.size).toBe(3);
  });

  it('clears selection', () => {
    const selection = new SelectionService();
    selection.selectAllVisible(['a', 'b']);
    selection.clear();
    expect(selection.size).toBe(0);
  });

  it('add/remove are idempotent and notify only on change', () => {
    const selection = new SelectionService();
    const listener = vi.fn();
    selection.onChange(listener);
    selection.add('a');
    selection.add('a');
    selection.remove('a');
    selection.remove('a');
    expect(listener).toHaveBeenCalledTimes(2);
  });

  it('prunes stale ids', () => {
    const selection = new SelectionService();
    selection.selectAllVisible(['a', 'b', 'c']);
    selection.prune(new Set(['a']));
    expect(selection.values()).toEqual(['a']);
  });

  it('emits selected ids on change', () => {
    const selection = new SelectionService();
    const listener = vi.fn();
    selection.onChange(listener);
    selection.toggle('x');
    expect(listener).toHaveBeenCalledWith(['x']);
  });
});
