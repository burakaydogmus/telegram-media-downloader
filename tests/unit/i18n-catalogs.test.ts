import { describe, it, expect } from 'vitest';
import { downloadEn } from '../../src/shared/i18n/catalogs/download.js';
import { uiEn } from '../../src/shared/i18n/catalogs/ui.js';
import { crawlEn } from '../../src/shared/i18n/catalogs/crawl.js';
import { healthEn } from '../../src/shared/i18n/catalogs/health.js';
import { settingsEn } from '../../src/shared/i18n/catalogs/settings.js';

describe('i18n area catalogs', () => {
  it('never define the same key twice (later spreads would silently win)', () => {
    const areas = { downloadEn, uiEn, crawlEn, healthEn, settingsEn };
    const owners = new Map<string, string[]>();
    for (const [area, catalog] of Object.entries(areas)) {
      for (const key of Object.keys(catalog)) {
        owners.set(key, [...(owners.get(key) ?? []), area]);
      }
    }
    const duplicates = [...owners].filter(([, list]) => list.length > 1);
    expect(duplicates).toEqual([]);
  });
});
