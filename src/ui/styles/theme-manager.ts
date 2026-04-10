import type { Theme } from '../../shared/types/index.js';
import { themeVariables, type ThemeName } from './theme.js';

export class ThemeManager {
  constructor(private readonly host: HTMLElement) {}

  apply(theme: Theme): void {
    const name: ThemeName = theme;
    const vars = themeVariables(name);
    // Parse the `--name: value;` declarations and set them individually so we
    // never clobber unrelated inline styles (e.g. the drag transform).
    for (const declaration of vars.split(';')) {
      const [rawName, ...rest] = declaration.split(':');
      const propName = rawName?.trim();
      const value = rest.join(':').trim();
      if (propName && propName.startsWith('--') && value.length > 0) {
        this.host.style.setProperty(propName, value);
      }
    }
  }
}
