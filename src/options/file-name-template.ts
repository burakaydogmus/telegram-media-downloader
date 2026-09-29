import { DEFAULT_SETTINGS } from '../shared/constants/index.js';
import { sanitizeFileName } from '../shared/utils/index.js';

export const TEMPLATE_TOKENS = [
  'chat',
  'peer',
  'date',
  'time',
  'msgId',
  'index',
  'type',
  'name',
  'ext',
] as const;
export type TemplateToken = (typeof TEMPLATE_TOKENS)[number];

export interface TemplateSample {
  readonly chat: string;
  readonly peer: string;
  readonly timestamp: number;
  readonly msgId: string;
  readonly index: number;
  readonly type: string;
  /** Original file name, including its extension. */
  readonly name: string;
  readonly ext: string;
}

export const SAMPLE_ITEM: TemplateSample = {
  chat: 'Holiday Photos',
  peer: '-1001234567890',
  timestamp: Date.UTC(2026, 5, 19, 14, 30, 5),
  msgId: '4521',
  index: 0,
  type: 'photo',
  name: 'IMG_0042.jpg',
  ext: 'jpg',
};

/** Rejects empty, absolute (`/x`, `\x`, `C:`) and parent-traversing templates. */
export function isSafeTemplate(template: string): boolean {
  const value = template.trim();
  if (value.length === 0) return false;
  if (/^[\\/]/.test(value) || /^[a-zA-Z]:/.test(value)) return false;
  return !value.split(/[\\/]/).some((segment) => segment.trim() === '..');
}

export function normalizeTemplate(template: string): string {
  return isSafeTemplate(template) ? template.trim() : DEFAULT_SETTINGS.fileNameTemplate;
}

/**
 * Approximate rendering for the options preview; the download pipeline owns
 * the authoritative implementation. Appends `.ext` when the result lacks it.
 */
export function renderTemplatePreview(
  template: string,
  sample: TemplateSample = SAMPLE_ITEM,
): string {
  const values = tokenValues(sample);
  const segments = normalizeTemplate(template)
    .split(/[\\/]/)
    .map((segment) =>
      segment.replace(/\{(\w+)\}/g, (match, token: string) =>
        isToken(token) ? values[token] : match,
      ),
    )
    .map((segment) => sanitizeFileName(segment, '_'));
  const path = segments.join('/');
  const suffix = `.${sample.ext}`;
  return path.toLowerCase().endsWith(suffix.toLowerCase()) ? path : `${path}${suffix}`;
}

function tokenValues(sample: TemplateSample): Readonly<Record<TemplateToken, string>> {
  const date = new Date(sample.timestamp);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return {
    chat: sample.chat,
    peer: sample.peer,
    date: `${date.getFullYear()}-${pad(date.getMonth() + 1)}-${pad(date.getDate())}`,
    time: `${pad(date.getHours())}-${pad(date.getMinutes())}-${pad(date.getSeconds())}`,
    msgId: sample.msgId,
    index: String(sample.index),
    type: sample.type,
    name: sample.name,
    ext: sample.ext,
  };
}

function isToken(token: string): token is TemplateToken {
  return (TEMPLATE_TOKENS as readonly string[]).includes(token);
}
