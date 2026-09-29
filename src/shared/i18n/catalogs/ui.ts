/**
 * Translation keys owned by the "ui" area. Add keys to `uiEn` and the same
 * keys to `uiTr` (the type enforces parity). Merged into the main catalog.
 */
export const uiEn = {} as const;

export const uiTr: Readonly<Record<keyof typeof uiEn, string>> = {};
