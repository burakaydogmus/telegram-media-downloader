/**
 * Constructable stylesheets are created once per CSS text at module level and
 * adopted by every shadow root, instead of parsing the same CSS per component.
 */
const sheets = new Map<string, CSSStyleSheet | null>();

export function sharedStyleSheet(css: string): CSSStyleSheet | null {
  if (sheets.has(css)) return sheets.get(css) ?? null;
  let sheet: CSSStyleSheet | null = null;
  try {
    sheet = new CSSStyleSheet();
    sheet.replaceSync(css);
  } catch {
    sheet = null;
  }
  sheets.set(css, sheet);
  return sheet;
}

/** Adopt the shared sheets, falling back to `<style>` elements when unsupported. */
export function adoptSharedStyles(root: ShadowRoot, cssTexts: readonly string[]): void {
  const constructed = cssTexts.map(sharedStyleSheet);
  const supported =
    'adoptedStyleSheets' in root &&
    constructed.every((sheet): sheet is CSSStyleSheet => sheet !== null);
  if (supported) {
    try {
      root.adoptedStyleSheets = constructed as CSSStyleSheet[];
      return;
    } catch {
      // fall through to <style> elements
    }
  }
  for (const css of cssTexts) {
    const style = document.createElement('style');
    style.textContent = css;
    root.appendChild(style);
  }
}
