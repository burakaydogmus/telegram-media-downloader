import { describe, it, expect } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import {
  readSettingsForm,
  populateSettingsForm,
  NUMBER_LIMITS,
} from '../../src/options/settings-form.js';
import {
  isSafeTemplate,
  normalizeTemplate,
  renderTemplatePreview,
  SAMPLE_ITEM,
  TEMPLATE_TOKENS,
} from '../../src/options/file-name-template.js';
import { updateTemplatePreview } from '../../src/options/template-preview.js';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/index.js';
import { CATALOGS, I18n } from '../../src/shared/i18n/index.js';
import type { Settings } from '../../src/shared/types/index.js';

const OPTIONS_HTML = readFileSync(
  resolve(__dirname, '../../src/options/options.html'),
  'utf-8',
);
const { t } = new I18n('en');

function mountOptions(): void {
  const body = /<body>([\s\S]*)<\/body>/.exec(OPTIONS_HTML)?.[1] ?? '';
  document.body.innerHTML = body.replace(/<script[\s\S]*?<\/script>/g, '');
}

function field(id: string): HTMLInputElement {
  return document.getElementById(id) as HTMLInputElement;
}

const CUSTOM: Settings = {
  autoScan: false,
  theme: 'dark',
  language: 'tr',
  logLevel: 'debug',
  maxConcurrentDownloads: 5,
  maxRetries: 0,
  downloadDelayMs: 0,
  downloadJitterMs: 1500,
  fileNameTemplate: '{chat}/{type}/{msgId}_{index}.{ext}',
  preferNativeDownload: false,
  largeFileThresholdMb: 4096,
  skipDownloaded: false,
};

describe('options form', () => {
  it('has an input for every setting and only known i18n keys', () => {
    mountOptions();
    for (const key of Object.keys(DEFAULT_SETTINGS)) {
      expect(document.getElementById(key), key).not.toBeNull();
    }
    for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
      const key = el.dataset.i18n ?? '';
      expect(CATALOGS.en, key).toHaveProperty(key);
      expect(CATALOGS.tr, key).toHaveProperty(key);
    }
  });

  it('keeps number input bounds in sync with validation limits', () => {
    mountOptions();
    for (const [id, { min, max }] of Object.entries(NUMBER_LIMITS)) {
      expect(field(id).min).toBe(String(min));
      expect(field(id).max).toBe(String(max));
    }
  });

  it('round-trips every field', () => {
    mountOptions();
    populateSettingsForm(document, CUSTOM);
    expect(readSettingsForm(document)).toEqual(CUSTOM);
    populateSettingsForm(document, DEFAULT_SETTINGS);
    expect(readSettingsForm(document)).toEqual(DEFAULT_SETTINGS);
  });

  it('clamps out-of-range numbers and defaults unparsable ones', () => {
    mountOptions();
    populateSettingsForm(document, DEFAULT_SETTINGS);
    field('downloadDelayMs').value = '999999';
    field('downloadJitterMs').value = '-5';
    field('largeFileThresholdMb').value = '0';
    field('maxConcurrentDownloads').value = '';
    field('maxRetries').value = 'abc';
    const settings = readSettingsForm(document);
    expect(settings.downloadDelayMs).toBe(60_000);
    expect(settings.downloadJitterMs).toBe(0);
    expect(settings.largeFileThresholdMb).toBe(1);
    expect(settings.maxConcurrentDownloads).toBe(DEFAULT_SETTINGS.maxConcurrentDownloads);
    expect(settings.maxRetries).toBe(DEFAULT_SETTINGS.maxRetries);
  });

  it('coerces unknown select values and unsafe templates to defaults', () => {
    mountOptions();
    populateSettingsForm(document, DEFAULT_SETTINGS);
    const theme = document.getElementById('theme') as HTMLSelectElement;
    const extra = document.createElement('option');
    extra.value = 'neon';
    theme.appendChild(extra);
    theme.value = 'neon';
    field('fileNameTemplate').value = '../../etc/{name}';
    const settings = readSettingsForm(document);
    expect(settings.theme).toBe(DEFAULT_SETTINGS.theme);
    expect(settings.fileNameTemplate).toBe(DEFAULT_SETTINGS.fileNameTemplate);
  });
});

describe('file name template', () => {
  it('accepts relative templates and rejects absolute or traversing ones', () => {
    expect(isSafeTemplate(DEFAULT_SETTINGS.fileNameTemplate)).toBe(true);
    expect(isSafeTemplate('{chat}/{name}')).toBe(true);
    expect(isSafeTemplate('a..b/{name}')).toBe(true);
    for (const bad of [
      '',
      '   ',
      '/abs/{name}',
      '\\share\\x',
      'C:\\x',
      'c:{name}',
      'a/../b',
      '..',
      'a\\..\\b',
      'a/ .. /b',
    ]) {
      expect(isSafeTemplate(bad), bad).toBe(false);
    }
    expect(normalizeTemplate('  {chat}/{name} ')).toBe('{chat}/{name}');
    expect(normalizeTemplate('/tmp/{name}')).toBe(DEFAULT_SETTINGS.fileNameTemplate);
  });

  it('renders every token for the sample item', () => {
    const rendered = renderTemplatePreview(
      TEMPLATE_TOKENS.map((tok) => `{${tok}}`).join('_'),
    );
    expect(rendered).toMatch(
      /^Holiday Photos_-1001234567890_\d{4}-\d{2}-\d{2}_\d{2}-\d{2}-\d{2}_4521_0_photo_IMG_0042\.jpg_jpg\.jpg$/,
    );
  });

  it('builds sub-folders, sanitises segments and appends a missing extension', () => {
    expect(renderTemplatePreview('{chat}/{type}/{msgId}')).toBe(
      'Holiday Photos/photo/4521.jpg',
    );
    expect(renderTemplatePreview('{chat}/{msgId}.{ext}')).toBe('Holiday Photos/4521.jpg');
    expect(
      renderTemplatePreview('{chat}/{name}', { ...SAMPLE_ITEM, chat: 'a:b*c?' }),
    ).toBe('a_b_c_/IMG_0042.jpg');
    expect(renderTemplatePreview('{unknown}/{name}')).toBe('{unknown}/IMG_0042.jpg');
    expect(renderTemplatePreview('../x')).toMatch(/^Telegram\/Holiday Photos\//);
  });

  it('updates the live preview and validation state', () => {
    mountOptions();
    const input = field('fileNameTemplate');
    const preview = document.getElementById('templatePreview');
    const invalid = document.getElementById('templateInvalid');

    input.value = '{chat}/{msgId}';
    updateTemplatePreview(document, t);
    expect(preview?.textContent).toBe('Holiday Photos/4521.jpg');
    expect(invalid?.hidden).toBe(true);
    expect(input.getAttribute('aria-invalid')).toBe('false');

    input.value = '/root/{name}';
    updateTemplatePreview(document, t);
    expect(invalid?.hidden).toBe(false);
    expect(invalid?.textContent).toBe(t('options_template_invalid'));
    expect(input.getAttribute('aria-invalid')).toBe('true');
    expect(preview?.textContent).toMatch(/^Telegram\//);
  });

  it('ignores a document without the template fields', () => {
    document.body.innerHTML = '<p></p>';
    expect(() => updateTemplatePreview(document, t)).not.toThrow();
  });
});
