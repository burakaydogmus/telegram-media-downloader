import { DEFAULT_SETTINGS } from '../shared/constants/index.js';
import { MEDIA_TYPES, type MediaItem, type MediaType } from '../shared/types/index.js';
import { buildRelativePath } from '../features/download/file-namer.js';

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
 * Renders the preview with the same `buildRelativePath` the download pipeline
 * uses, so what the options page shows is exactly what gets saved.
 */
export function renderTemplatePreview(
  template: string,
  sample: TemplateSample = SAMPLE_ITEM,
): string {
  const item: MediaItem = {
    id: 'preview',
    type: coerceType(sample.type),
    fileName: sample.name,
    messageId: sample.msgId,
    albumIndex: sample.index,
    peerId: sample.peer,
    chatTitle: sample.chat,
    timestamp: sample.timestamp,
  };
  return buildRelativePath(normalizeTemplate(template), item, sample.timestamp);
}

function coerceType(type: string): MediaType {
  return (MEDIA_TYPES as readonly string[]).includes(type) ? (type as MediaType) : 'document';
}

