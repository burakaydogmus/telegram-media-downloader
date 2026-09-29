import { I18n } from '../shared/i18n/index.js';
import type { TranslationKey } from '../shared/i18n/index.js';
import { Logger } from '../shared/logger/index.js';
import {
  StorageService,
  createDefaultStorageDriver,
} from '../features/local-storage/index.js';
import { DEFAULT_SETTINGS } from '../shared/constants/index.js';
import type { Settings, Theme, Language, LogLevel } from '../shared/types/index.js';
import { THEMES, LANGUAGES, LOG_LEVELS } from '../shared/types/index.js';
import { clamp } from '../shared/utils/index.js';

const logger = new Logger('warn', 'options');
const storage = new StorageService(createDefaultStorageDriver(), logger);

async function init(): Promise<void> {
  const settings = await storage.getSettings();
  const i18n = new I18n(settings.language);
  applyTranslations(i18n);
  populate(settings);
  wire(i18n);
}

function applyTranslations(i18n: I18n): void {
  for (const el of document.querySelectorAll<HTMLElement>('[data-i18n]')) {
    const key = el.dataset.i18n as TranslationKey | undefined;
    if (key) el.textContent = i18n.t(key);
  }
  document.documentElement.lang = i18n.language;
}

function populate(settings: Settings): void {
  checkbox('autoScan').checked = settings.autoScan;
  select('theme').value = settings.theme;
  select('language').value = settings.language;
  select('logLevel').value = settings.logLevel;
  number('maxConcurrentDownloads').value = String(settings.maxConcurrentDownloads);
  number('maxRetries').value = String(settings.maxRetries);
}

function wire(i18n: I18n): void {
  const form = document.getElementById('settings-form') as HTMLFormElement;
  form.addEventListener('submit', (event) => {
    event.preventDefault();
    void save(i18n);
  });

  byId('reset').addEventListener('click', () => {
    populate(DEFAULT_SETTINGS);
    void save(i18n);
  });
}

async function save(i18n: I18n): Promise<void> {
  const settings = readForm();
  await storage.saveSettings(settings);

  // Reflect a possible language change immediately.
  i18n.setLanguage(settings.language);
  applyTranslations(i18n);

  const saved = byId('saved');
  saved.textContent = i18n.t('options_saved');
  saved.hidden = false;
  setTimeout(() => {
    saved.hidden = true;
  }, 2000);
}

function readForm(): Settings {
  const theme = coerce(select('theme').value, THEMES, DEFAULT_SETTINGS.theme) as Theme;
  const language = coerce(
    select('language').value,
    LANGUAGES,
    DEFAULT_SETTINGS.language,
  ) as Language;
  const logLevel = coerce(
    select('logLevel').value,
    LOG_LEVELS,
    DEFAULT_SETTINGS.logLevel,
  ) as LogLevel;

  return {
    ...DEFAULT_SETTINGS,
    autoScan: checkbox('autoScan').checked,
    theme,
    language,
    logLevel,
    maxConcurrentDownloads: clamp(
      parseIntOr(number('maxConcurrentDownloads').value, 3),
      1,
      10,
    ),
    maxRetries: clamp(parseIntOr(number('maxRetries').value, 3), 0, 10),
  };
}

function coerce<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseIntOr(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function byId(id: string): HTMLElement {
  const el = document.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
function checkbox(id: string): HTMLInputElement {
  return byId(id) as HTMLInputElement;
}
function number(id: string): HTMLInputElement {
  return byId(id) as HTMLInputElement;
}
function select(id: string): HTMLSelectElement {
  return byId(id) as HTMLSelectElement;
}

void init();
