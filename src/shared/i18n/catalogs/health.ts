/**
 * Translation keys owned by the "health" area. Add keys to `healthEn` and the same
 * keys to `healthTr` (the type enforces parity). Merged into the main catalog.
 */
export const healthEn = {} as const;

export const healthTr: Readonly<Record<keyof typeof healthEn, string>> = {};
