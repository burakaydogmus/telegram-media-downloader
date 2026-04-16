import { describe, it, expect, vi } from 'vitest';
import { I18n } from '../../src/shared/i18n/i18n.js';
import { CATALOGS } from '../../src/shared/i18n/catalog.js';

describe('I18n', () => {
  it('translates keys for the active language', () => {
    const i18n = new I18n('en');
    expect(i18n.t('panel_title')).toBe('Media Downloader');
  });

  it('interpolates parameters', () => {
    const i18n = new I18n('en');
    expect(i18n.t('search_results', { count: 5 })).toBe('5 result(s)');
  });

  it('switches language and notifies listeners', () => {
    const i18n = new I18n('en');
    const listener = vi.fn();
    i18n.onChange(listener);
    i18n.setLanguage('tr');
    expect(i18n.language).toBe('tr');
    expect(i18n.t('panel_title')).toBe('Medya İndirici');
    expect(listener).toHaveBeenCalledWith('tr');
  });

  it('falls back to English for missing keys gracefully', () => {
    const i18n = new I18n('tr');
    // Every key in the EN catalog must exist in TR.
    for (const key of Object.keys(CATALOGS.en)) {
      expect(CATALOGS.tr).toHaveProperty(key);
    }
    expect(i18n.t('options_save')).toBe('Kaydet');
  });

  it('does not re-notify when setting the same language', () => {
    const i18n = new I18n('en');
    const listener = vi.fn();
    i18n.onChange(listener);
    i18n.setLanguage('en');
    expect(listener).not.toHaveBeenCalled();
  });
});
