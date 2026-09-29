export interface ShortcutTarget {
  isPanelVisible(): boolean;
  selectAllVisible(): void;
  hasSelection(): boolean;
  clearSelection(): void;
}

function isTypingTarget(event: KeyboardEvent): boolean {
  // `event.target` is retargeted to the panel host for events coming out of
  // its shadow root; the real origin is the first entry of the path.
  const origin = event.composedPath()[0];
  const target = origin instanceof HTMLElement ? origin : null;
  return (
    target?.tagName === 'INPUT' ||
    target?.tagName === 'TEXTAREA' ||
    target?.isContentEditable === true
  );
}

/** Ctrl/Cmd+A selects visible media, Escape clears the selection. */
export function registerKeyboardShortcuts(
  target: ShortcutTarget,
  win: Window = window,
): () => void {
  const onKeyDown = (event: KeyboardEvent): void => {
    if (!target.isPanelVisible() || isTypingTarget(event)) return;

    if ((event.ctrlKey || event.metaKey) && event.key.toLowerCase() === 'a') {
      event.preventDefault();
      target.selectAllVisible();
    } else if (event.key === 'Escape' && target.hasSelection()) {
      // Only consume Escape when it clears our selection: Telegram closes the
      // open chat on Escape, which must not happen as a side effect.
      event.preventDefault();
      event.stopPropagation();
      target.clearSelection();
    }
  };
  win.addEventListener('keydown', onKeyDown, true);
  return () => win.removeEventListener('keydown', onKeyDown, true);
}
