import { describe, it, expect } from 'vitest';
import { themeVariables } from '../../src/ui/styles/theme.js';
import { ThemeManager } from '../../src/ui/styles/theme-manager.js';

describe('theme', () => {
  it('returns variable blocks per theme', () => {
    expect(themeVariables('light')).toContain('--tgmd-bg');
    expect(themeVariables('dark')).toContain('#17212b');
    expect(themeVariables('auto')).toContain('var(--surface-color');
  });

  it('ThemeManager applies custom properties to host', () => {
    const host = document.createElement('div');
    const manager = new ThemeManager(host);
    manager.apply('dark');
    expect(host.style.getPropertyValue('--tgmd-bg').trim()).toBe('#17212b');
    expect(host.style.getPropertyValue('--tgmd-accent').length).toBeGreaterThan(0);
  });

  it('switching theme overwrites variables', () => {
    const host = document.createElement('div');
    const manager = new ThemeManager(host);
    manager.apply('light');
    expect(host.style.getPropertyValue('--tgmd-bg').trim()).toBe('#ffffff');
    manager.apply('dark');
    expect(host.style.getPropertyValue('--tgmd-bg').trim()).toBe('#17212b');
  });
});
