/**
 * Translation keys owned by the "crawl" area. Add keys to `crawlEn` and the same
 * keys to `crawlTr` (the type enforces parity). Merged into the main catalog.
 */
export const crawlEn = {} as const;

export const crawlTr: Readonly<Record<keyof typeof crawlEn, string>> = {};
