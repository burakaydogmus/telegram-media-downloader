export const LIGHT_THEME = `
  --tgmd-bg: #ffffff;
  --tgmd-bg-elevated: #f4f4f5;
  --tgmd-bg-hover: #ececef;
  --tgmd-fg: #0f0f10;
  --tgmd-fg-muted: #6b6b70;
  --tgmd-border: #e2e2e6;
  --tgmd-accent: #3390ec;
  --tgmd-accent-fg: #ffffff;
  --tgmd-success: #2ea043;
  --tgmd-warn: #d29922;
  --tgmd-danger: #e5484d;
  --tgmd-shadow: 0 8px 30px rgba(0, 0, 0, 0.18);
`;

export const DARK_THEME = `
  --tgmd-bg: #17212b;
  --tgmd-bg-elevated: #202b36;
  --tgmd-bg-hover: #2b3947;
  --tgmd-fg: #f5f5f5;
  --tgmd-fg-muted: #91a3b5;
  --tgmd-border: #2b3947;
  --tgmd-accent: #5ea8ee;
  --tgmd-accent-fg: #0f1419;
  --tgmd-success: #4cc26a;
  --tgmd-warn: #e3b341;
  --tgmd-danger: #ff6b6b;
  --tgmd-shadow: 0 8px 30px rgba(0, 0, 0, 0.5);
`;

export const AUTO_THEME = `
  --tgmd-bg: var(--surface-color, var(--background-color, #17212b));
  --tgmd-bg-elevated: var(--background-color-true, #202b36);
  --tgmd-bg-hover: var(--light-secondary-text-color, #2b3947);
  --tgmd-fg: var(--primary-text-color, #f5f5f5);
  --tgmd-fg-muted: var(--secondary-text-color, #91a3b5);
  --tgmd-border: var(--divider-color, #2b3947);
  --tgmd-accent: var(--primary-color, #3390ec);
  --tgmd-accent-fg: #ffffff;
  --tgmd-success: #2ea043;
  --tgmd-warn: #d29922;
  --tgmd-danger: #e5484d;
  --tgmd-shadow: 0 8px 30px rgba(0, 0, 0, 0.4);
`;

export type ThemeName = 'light' | 'dark' | 'auto';

export function themeVariables(theme: ThemeName): string {
  switch (theme) {
    case 'light':
      return LIGHT_THEME;
    case 'dark':
      return DARK_THEME;
    case 'auto':
    default:
      return AUTO_THEME;
  }
}
