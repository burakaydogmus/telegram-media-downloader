/**
 * Translation keys owned by the "settings" area. Add keys to `settingsEn` and the same
 * keys to `settingsTr` (the type enforces parity). Merged into the main catalog.
 */
export const settingsEn = {} as const;

export const settingsTr: Readonly<Record<keyof typeof settingsEn, string>> = {};
