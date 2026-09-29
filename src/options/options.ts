import { I18n } from '../shared/i18n/index.js';
import type { TranslationKey } from '../shared/i18n/index.js';
import { Logger } from '../shared/logger/index.js';
import {
  StorageService,
  createDefaultStorageDriver,
} from '../features/local-storage/index.js';
import { DEFAULT_SETTINGS } from '../shared/constants/index.js';
import { populateSettingsForm, readSettingsForm } from './settings-form.js';
import { updateTemplatePreview } from './template-preview.js';

const logger = new Logger('warn', 'options');
const storage = new StorageService(createDefaultStorageDriver(), logger);

async function init(): Promise<void> {
  const settings = await storage.getSettings();
  const i18n = new I18n(settings.language);
  applyTranslations(i18n);
  populateSettingsForm(document, settings);
  updateTemplatePreview(document, i18n.t);
  wire(i18n);
}

function applyTranslations(i18n: I18n): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as TranslationKey | undefined;
    if (key) el.textContent = i18n.t(key);
  }
  document.documentElement.lang = i18n.language;
}

function wire(i18n: I18n): void {
  const form = document.getElementById('settings-form') as HTMLFormElement;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(i18n);
  });

  byId('fileNameTemplate').addEventListener('input', () => {
    updateTemplatePreview(document, i18n.t);
  });

  byId('reset').addEventListener('click', () => {
    populateSettingsForm(document, DEFAULT_SETTINGS);
    updateTemplatePreview(document, i18n.t);
    void save(i18n);
  });
}

async function save(i18n: I18n): Promise<void> {
  const settings = readSettingsForm(document);
  await storage.saveSettings(settings);
  // Show the values actually stored (clamped / defaulted).
  populateSettingsForm(document, settings);

  // Reflect a possible language change immediately.
  i18n.setLanguage(settings.language);
  applyTranslations(i18n);
  updateTemplatePreview(document, i18n.t);

  const saved = byId('saved');
  saved.textContent = i18n.t('options_saved');
  saved.hidden = false;
  setTimeout(() => {
    saved.hidden = true;
  }, 2000);
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}

void init();
