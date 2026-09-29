/**
 * Translation keys owned by the "download" area. Add keys to `downloadEn` and the same
 * keys to `downloadTr` (the type enforces parity). Merged into the main catalog.
 */
export const downloadEn = {} as const;

export const downloadTr: Readonly<Record<keyof typeof downloadEn, string>> = {};
