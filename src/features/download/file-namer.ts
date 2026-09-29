import type { MediaItem, MediaType } from '../../shared/types/index.js';
import { DEFAULT_SETTINGS } from '../../shared/constants/index.js';
import { sanitizePathSegment, truncateCodePoints } from '../../shared/utils/index.js';

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'image/avif': 'avif',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'video/x-matroska': 'mkv',
  'audio/mpeg': 'mp3',
  'audio/mp3': 'mp3',
  'audio/ogg': 'ogg',
  'audio/opus': 'opus',
  'audio/mp4': 'm4a',
  'audio/x-m4a': 'm4a',
  'audio/aac': 'aac',
  'audio/flac': 'flac',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-rar-compressed': 'rar',
  'application/x-7z-compressed': '7z',
  'application/x-tgsticker': 'tgs',
  'text/plain': 'txt',
};

const TYPE_EXTENSIONS: Readonly<Record<MediaType, string>> = {
  photo: 'jpg',
  video: 'mp4',
  gif: 'mp4',
  audio: 'mp3',
  document: 'bin',
};

const FILE_EXT = /\.([A-Za-z0-9]{1,10})$/;
const MAX_DIR_SEGMENT = 60;
const MAX_FILE_SEGMENT = 150;
const MAX_DEPTH = 6;
const MAX_TOTAL = 200;
const MIN_BASE = 16;

export function extensionFromMime(mimeType: string | undefined): string | undefined {
  if (!mimeType) return undefined;
  return MIME_EXTENSIONS[mimeType.split(';')[0]?.trim().toLowerCase() ?? ''];
}

/** Extension (without dot, lower-case) from file name, MIME type or media type. */
export function inferExtension(item: MediaItem): string {
  const fromName = item.fileName ? FILE_EXT.exec(item.fileName.trim())?.[1] : undefined;
  return (
    fromName?.toLowerCase() ??
    extensionFromMime(item.mimeType) ??
    TYPE_EXTENSIONS[item.type]
  );
}

function baseName(item: MediaItem): string {
  const name = item.fileName?.trim();
  if (name) {
    const stripped = name.replace(FILE_EXT, '');
    if (stripped.length > 0) return stripped;
  }
  return `${item.type}_${item.messageId ?? item.id}`;
}

const pad = (value: number): string => String(value).padStart(2, '0');

function tokenValues(item: MediaItem, now: number): Record<string, string> {
  const when = new Date(item.timestamp ?? now);
  return {
    chat: item.chatTitle?.trim() || item.peerId || 'chat',
    peer: item.peerId || 'unknown',
    date: `${when.getFullYear()}-${pad(when.getMonth() + 1)}-${pad(when.getDate())}`,
    time: `${pad(when.getHours())}-${pad(when.getMinutes())}-${pad(when.getSeconds())}`,
    msgId: item.messageId || '0',
    index: String(item.albumIndex ?? 0),
    type: item.type,
    name: baseName(item),
    ext: inferExtension(item),
  };
}

/**
 * Expands a `Settings.fileNameTemplate` into a safe relative path using `/`.
 * Token values can never introduce sub-folders (a `/` in a chat title stays in
 * one segment). When the template has no `{ext}`, the inferred extension is
 * appended to the file name. Every segment is sanitized (see
 * `sanitizePathSegment`) and the whole path is bounded while keeping the
 * extension.
 */
export function buildRelativePath(
  template: string,
  item: MediaItem,
  now: number = Date.now(),
): string {
  const source =
    template.trim().length > 0 ? template : DEFAULT_SETTINGS.fileNameTemplate;
  const values = tokenValues(item, now);
  const expanded = source.replace(/\{(\w+)\}/g, (match, key: string) => {
    const value = values[key];
    return value === undefined ? match : value.replace(/[\\/]/g, '_');
  });

  const rawSegments = expanded.split(/[\\/]+/);
  let file = rawSegments.pop() ?? '';
  if (!/\{ext\}/.test(source) || !FILE_EXT.test(file)) {
    file = `${file.replace(/\.+$/, '')}.${values.ext ?? 'bin'}`;
  }

  const dirs = rawSegments
    .map((segment) => sanitizePathSegment(segment, MAX_DIR_SEGMENT, ''))
    .filter((segment) => segment.length > 0);
  if (dirs.length > MAX_DEPTH) dirs.splice(MAX_DEPTH - 1, dirs.length - MAX_DEPTH + 1);

  let fileName = sanitizePathSegment(
    file,
    MAX_FILE_SEGMENT,
    `${item.type}.${values.ext}`,
  );
  const dirLength = (): number =>
    dirs.reduce((sum, d) => sum + Array.from(d).length + 1, 0);

  const fileBudget = MAX_TOTAL - dirLength();
  if (Array.from(fileName).length > fileBudget) {
    fileName = sanitizePathSegment(fileName, Math.max(MIN_BASE, fileBudget), 'file');
  }
  while (dirs.length > 0 && dirLength() + Array.from(fileName).length > MAX_TOTAL) {
    const longest = dirs.reduce(
      (a, b, i) => (b.length > (dirs[a]?.length ?? 0) ? i : a),
      0,
    );
    const shorter = truncateCodePoints(dirs[longest] ?? '', 16).replace(/[. ]+$/, '');
    if (shorter === dirs[longest] || shorter.length === 0) dirs.splice(longest, 1);
    else dirs[longest] = shorter;
  }

  return [...dirs, fileName].join('/');
}

/** Last segment of a relative path. */
export function fileNameOf(relativePath: string): string {
  const parts = relativePath.split('/');
  return parts[parts.length - 1] ?? relativePath;
}
