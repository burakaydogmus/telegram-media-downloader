import { describe, it, expect, vi } from 'vitest';
import { Container } from '../../src/shared/di/container.js';

type Services = {
  counter: { value: number };
  random: { id: number };
  config: { name: string };
};

describe('Container', () => {
  it('resolves and memoises singletons', () => {
    const factory = vi.fn(() => ({ value: 1 }));
    const c = new Container<Services>();
    c.registerSingleton('counter', factory);
    const a = c.resolve('counter');
    const b = c.resolve('counter');
    expect(a).toBe(b);
    expect(factory).toHaveBeenCalledOnce();
  });

  it('creates new instances for transients', () => {
    let n = 0;
    const c = new Container<Services>();
    c.registerTransient('random', () => ({ id: (n += 1) }));
    expect(c.resolve('random').id).not.toBe(c.resolve('random').id);
  });

  it('registers values directly', () => {
    const c = new Container<Services>();
    c.registerValue('config', { name: 'x' });
    expect(c.resolve('config').name).toBe('x');
  });

  it('supports dependencies between services', () => {
    const c = new Container<Services>();
    c.registerValue('config', { name: 'dep' });
    c.registerSingleton('counter', (container) => ({
      value: container.resolve('config').name.length,
    }));
    expect(c.resolve('counter').value).toBe(3);
  });

  it('throws for unknown tokens', () => {
    const c = new Container<Services>();
    expect(() => c.resolve('counter')).toThrow(/No registration/);
  });

  it('reports registration presence', () => {
    const c = new Container<Services>();
    expect(c.has('counter')).toBe(false);
    c.registerValue('counter', { value: 0 });
    expect(c.has('counter')).toBe(true);
  });
});
