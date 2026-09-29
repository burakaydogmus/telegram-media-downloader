/** Schedule `callback` for the next animation frame. Returns a cancel function. */
export function requestFrame(callback: () => void): () => void {
  const raf = globalThis.requestAnimationFrame as
    | typeof requestAnimationFrame
    | undefined;
  if (typeof raf === 'function') {
    const handle = raf(() => callback());
    return () => globalThis.cancelAnimationFrame?.(handle);
  }
  const timer = setTimeout(callback, 16);
  return () => clearTimeout(timer);
}
