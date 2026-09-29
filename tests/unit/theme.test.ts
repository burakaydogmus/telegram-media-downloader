import { describe, it, expect } from 'vitest';
import { themeVariables } from '../../src/ui/styles/theme.js';
import { ThemeManager } from '../../src/ui/styles/theme-manager.js';
import { adoptSharedStyles, sharedStyleSheet } from '../../src/ui/styles/shared-sheet.js';

describe('shared stylesheet', () => {
  it('creates each constructable sheet once and reuses it', () => {
    const a = sharedStyleSheet(':host { color: red; }');
    const b = sharedStyleSheet(':host { color: red; }');
    expect(a).toBeInstanceOf(CSSStyleSheet);
    expect(a).toBe(b);
    expect(sharedStyleSheet(':host { color: blue; }')).not.toBe(a);
  });

  it('falls back to <style> elements when adoption is unsupported', () => {
    const host = document.createElement('div');
    const root = host.attachShadow({ mode: 'open' });
    Object.defineProperty(root, 'adoptedStyleSheets', {
      get: () => [],
      set: () => {
        throw new Error('unsupported');
      },
    });
    adoptSharedStyles(root, ['.a { color: red; }', '.b { color: blue; }']);
    const styles = root.querySelectorAll('style');
    expect(styles).toHaveLength(2);
    expect(styles[0]?.textContent).toContain('.a');
  });
});

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
