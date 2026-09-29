const FALLBACK_NAME = 'file';
const MAX_SEGMENT_LENGTH = 120;
const MAX_PATH_LENGTH = 240;
const WINDOWS_RESERVED = /^(con|prn|aux|nul|com[0-9]|lpt[0-9])(\..*)?$/i;
const EXTENSION = /\.([a-z0-9]{1,8})$/i;

/** Marker the content script embeds in `<a download>` names: `tgmd-<token>__name`. */
export const TOKEN_PATTERN = /tgmd-([A-Za-z0-9_-]+?)__/;

const MIME_EXTENSIONS: Readonly<Record<string, string>> = {
  'image/jpeg': 'jpg',
  'image/jpg': 'jpg',
  'image/png': 'png',
  'image/webp': 'webp',
  'image/gif': 'gif',
  'image/heic': 'heic',
  'video/mp4': 'mp4',
  'video/webm': 'webm',
  'video/quicktime': 'mov',
  'audio/mpeg': 'mp3',
  'audio/mp4': 'm4a',
  'audio/ogg': 'ogg',
  'audio/wav': 'wav',
  'application/pdf': 'pdf',
  'application/zip': 'zip',
  'application/x-tgsticker': 'tgs',
};

function sanitizeSegment(segment: string): string {
  let cleaned = segment
    // eslint-disable-next-line no-control-regex
    .replace(/[<>:"|?*\u0000-\u001f\u007f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .replace(/^\.+/, '')
    .replace(/[. ]+$/, '');
  if (WINDOWS_RESERVED.test(cleaned)) cleaned = `_${cleaned}`;
  if (cleaned.length > MAX_SEGMENT_LENGTH) {
    const ext = EXTENSION.exec(cleaned)?.[0] ?? '';
    cleaned = cleaned.slice(0, MAX_SEGMENT_LENGTH - ext.length).trimEnd() + ext;
  }
  return cleaned;
}

/**
 * Turns an arbitrary string into a relative path chrome.downloads accepts:
 * no absolute paths, no `.`/`..` segments, no Windows-reserved characters or
 * device names, no trailing dots/spaces. Never returns an empty string.
 */
export function sanitizeRelativePath(input: string, fallback = FALLBACK_NAME): string {
  const segments = input
    .replace(/\\/g, '/')
    .split('/')
    .filter((s) => s !== '.' && s !== '..')
    .map(sanitizeSegment)
    .filter((s) => s.length > 0);

  while (segments.length > 1 && segments.join('/').length > MAX_PATH_LENGTH) {
    segments.shift();
  }
  const joined = segments.join('/');
  return joined.length > 0 ? joined : fallback;
}

export function baseName(path: string): string {
  const parts = path.split(/[\\/]/);
  return parts[parts.length - 1] ?? '';
}

export function extensionOf(path: string): string | undefined {
  return EXTENSION.exec(baseName(path))?.[1]?.toLowerCase();
}

export function extensionForMime(mime: string | undefined): string | undefined {
  if (!mime) return undefined;
  return MIME_EXTENSIONS[mime.split(';')[0]?.trim().toLowerCase() ?? ''];
}

export function extractToken(fileName: string): string | undefined {
  return TOKEN_PATTERN.exec(baseName(fileName))?.[1];
}

export function stripToken(fileName: string): string {
  return fileName.replace(TOKEN_PATTERN, '');
}

/**
 * Final target for a matched download: the sanitized relative path, plus the
 * extension of the browser-suggested name (or the MIME type) when missing.
 */
export function resolveTargetPath(
  relativePath: string,
  suggestedName: string,
  mime?: string,
): string {
  const target = sanitizeRelativePath(relativePath);
  if (extensionOf(target)) return target;
  const ext = extensionOf(stripToken(suggestedName)) ?? extensionForMime(mime);
  return ext ? `${target}.${ext}` : target;
}
