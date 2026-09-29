import { describe, it, expect, vi, afterEach } from 'vitest';
import {
  registerKeyboardShortcuts,
  type ShortcutTarget,
} from '../../src/content/keyboard-shortcuts.js';

function target(
  selected = 0,
): ShortcutTarget & { [K in keyof ShortcutTarget]: ReturnType<typeof vi.fn> } {
  return {
    isPanelVisible: vi.fn(() => true),
    selectAllVisible: vi.fn(),
    hasSelection: vi.fn(() => selected > 0),
    clearSelection: vi.fn(),
  };
}

function press(from: EventTarget, init: KeyboardEventInit): KeyboardEvent {
  const event = new KeyboardEvent('keydown', {
    bubbles: true,
    composed: true,
    cancelable: true,
    ...init,
  });
  from.dispatchEvent(event);
  return event;
}

describe('registerKeyboardShortcuts', () => {
  let dispose: (() => void) | undefined;
  afterEach(() => {
    dispose?.();
    document.body.textContent = '';
  });

  it('Ctrl+A in the panel search box (inside shadow DOM) does not select media', () => {
    const t = target();
    dispose = registerKeyboardShortcuts(t);
    const host = document.createElement('div');
    document.body.appendChild(host);
    const input = document.createElement('input');
    host.attachShadow({ mode: 'open' }).appendChild(input);

    const event = press(input, { key: 'a', ctrlKey: true });
    expect(t.selectAllVisible).not.toHaveBeenCalled();
    expect(event.defaultPrevented).toBe(false);
  });

  it('Ctrl+A elsewhere selects all visible media', () => {
    const t = target();
    dispose = registerKeyboardShortcuts(t);
    const event = press(document.body, { key: 'a', metaKey: true });
    expect(t.selectAllVisible).toHaveBeenCalledOnce();
    expect(event.defaultPrevented).toBe(true);
  });

  it('Escape clears the selection and does not reach Telegram', () => {
    const t = target(2);
    dispose = registerKeyboardShortcuts(t);
    const telegram = vi.fn();
    document.body.addEventListener('keydown', telegram);
    press(document.body, { key: 'Escape' });
    expect(t.clearSelection).toHaveBeenCalledOnce();
    expect(telegram).not.toHaveBeenCalled();
    document.body.removeEventListener('keydown', telegram);
  });

  it('Escape without a selection is left to Telegram', () => {
    const t = target(0);
    dispose = registerKeyboardShortcuts(t);
    const telegram = vi.fn();
    document.body.addEventListener('keydown', telegram);
    press(document.body, { key: 'Escape' });
    expect(t.clearSelection).not.toHaveBeenCalled();
    expect(telegram).toHaveBeenCalledOnce();
    document.body.removeEventListener('keydown', telegram);
  });

  it('does nothing while the panel is hidden', () => {
    const t = target(1);
    t.isPanelVisible.mockReturnValue(false);
    dispose = registerKeyboardShortcuts(t);
    press(document.body, { key: 'a', ctrlKey: true });
    press(document.body, { key: 'Escape' });
    expect(t.selectAllVisible).not.toHaveBeenCalled();
    expect(t.clearSelection).not.toHaveBeenCalled();
  });
});
