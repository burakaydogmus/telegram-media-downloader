import { DEFAULT_SETTINGS } from '../shared/constants/index.js';
import type { Settings } from '../shared/types/index.js';
import { THEMES, LANGUAGES, LOG_LEVELS } from '../shared/types/index.js';
import { clamp } from '../shared/utils/index.js';
import { normalizeTemplate } from './file-name-template.js';

type NumericSetting = {
  [K in keyof Settings]: Settings[K] extends number ? K : never;
}[keyof Settings];

export const NUMBER_LIMITS: Readonly<
  Record<NumericSetting, { readonly min: number; readonly max: number }>
> = {
  maxConcurrentDownloads: { min: 1, max: 10 },
  maxRetries: { min: 0, max: 10 },
  downloadDelayMs: { min: 0, max: 60_000 },
  downloadJitterMs: { min: 0, max: 60_000 },
  largeFileThresholdMb: { min: 1, max: 4096 },
};

/** Reads and validates every field; invalid input falls back to the default. */
export function readSettingsForm(doc: Document = document): Settings {
  const num = (id: NumericSetting): number => {
    const { min, max } = NUMBER_LIMITS[id];
    return clamp(parseIntOr(input(doc, id).value, DEFAULT_SETTINGS[id]), min, max);
  };
  return {
    autoScan: input(doc, 'autoScan').checked,
    theme: coerce(select(doc, 'theme').value, THEMES, DEFAULT_SETTINGS.theme),
    language: coerce(select(doc, 'language').value, LANGUAGES, DEFAULT_SETTINGS.language),
    logLevel: coerce(
      select(doc, 'logLevel').value,
      LOG_LEVELS,
      DEFAULT_SETTINGS.logLevel,
    ),
    maxConcurrentDownloads: num('maxConcurrentDownloads'),
    maxRetries: num('maxRetries'),
    downloadDelayMs: num('downloadDelayMs'),
    downloadJitterMs: num('downloadJitterMs'),
    fileNameTemplate: normalizeTemplate(input(doc, 'fileNameTemplate').value),
    preferNativeDownload: input(doc, 'preferNativeDownload').checked,
    largeFileThresholdMb: num('largeFileThresholdMb'),
    skipDownloaded: input(doc, 'skipDownloaded').checked,
  };
}

export function populateSettingsForm(doc: Document, settings: Settings): void {
  input(doc, 'autoScan').checked = settings.autoScan;
  select(doc, 'theme').value = settings.theme;
  select(doc, 'language').value = settings.language;
  select(doc, 'logLevel').value = settings.logLevel;
  for (const id of Object.keys(NUMBER_LIMITS) as NumericSetting[]) {
    input(doc, id).value = String(settings[id]);
  }
  input(doc, 'fileNameTemplate').value = settings.fileNameTemplate;
  input(doc, 'preferNativeDownload').checked = settings.preferNativeDownload;
  input(doc, 'skipDownloaded').checked = settings.skipDownloaded;
}

function coerce<T extends string>(value: string, allowed: readonly T[], fallback: T): T {
  return (allowed as readonly string[]).includes(value) ? (value as T) : fallback;
}

function parseIntOr(value: string, fallback: number): number {
  const parsed = Number.parseInt(value, 10);
  return Number.isFinite(parsed) ? parsed : fallback;
}

function byId(doc: Document, id: string): HTMLElement {
  const el = doc.getElementById(id);
  if (!el) throw new Error(`Missing element #${id}`);
  return el;
}
function input(doc: Document, id: string): HTMLInputElement {
  return byId(doc, id) as HTMLInputElement;
}
function select(doc: Document, id: string): HTMLSelectElement {
  return byId(doc, id) as HTMLSelectElement;
}
