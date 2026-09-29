export function formatBytes(bytes: number, fractionDigits = 1): string {
  if (!Number.isFinite(bytes) || bytes <= 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'] as const;
  const exponent = Math.min(
    Math.floor(Math.log(bytes) / Math.log(1024)),
    units.length - 1,
  );
  const value = bytes / 1024 ** exponent;
  const unit = units[exponent] ?? 'B';
  return `${value.toFixed(exponent === 0 ? 0 : fractionDigits)} ${unit}`;
}

const SIZE_FACTORS: Readonly<Record<string, number>> = {
  B: 1,
  BYTES: 1,
  KB: 1024,
  MB: 1024 ** 2,
  GB: 1024 ** 3,
  TB: 1024 ** 4,
};

// Space-grouped thousands ("1 024") first, then any run of digits/separators.
const SIZE_PATTERN =
  /(\d{1,3}(?:[ \u00a0\u202f']\d{3})+(?:[.,]\d+)?|\d[\d.,]*)\s*(bytes|B|KB|MB|GB|TB)(?![a-z])/i;

/** Parses "1,234.5", "1.234,5", "1,5", "1 024" into a number. */
export function parseLocaleNumber(raw: string): number | undefined {
  let text = raw.replace(/[ \u00a0\u202f']/g, '').replace(/[.,]+$/, '');
  const lastDot = text.lastIndexOf('.');
  const lastComma = text.lastIndexOf(',');
  if (lastDot !== -1 && lastComma !== -1) {
    const decimal = lastDot > lastComma ? '.' : ',';
    const group = decimal === '.' ? ',' : '.';
    text = text.split(group).join('').replace(decimal, '.');
  } else if (lastComma !== -1) {
    const groups = text.split(',');
    const thousands =
      groups.length > 2 || (groups.length === 2 && groups[1]?.length === 3);
    text = thousands ? groups.join('') : text.replace(',', '.');
  } else if (lastDot !== -1 && text.indexOf('.') !== lastDot) {
    text = text.split('.').join('');
  }
  if (!/^\d+(?:\.\d+)?$/.test(text)) return undefined;
  const value = Number.parseFloat(text);
  return Number.isFinite(value) ? value : undefined;
}

/** Parses the first size in a label ("12.3 MB / 45 MB" → 12.3 MB) into bytes. */
export function parseSizeLabel(label: string): number | undefined {
  const match = SIZE_PATTERN.exec(label.trim());
  if (!match) return undefined;
  const rawNumber = match[1];
  const rawUnit = match[2];
  if (rawNumber === undefined || rawUnit === undefined) return undefined;
  const value = parseLocaleNumber(rawNumber);
  if (value === undefined) return undefined;
  const factor = SIZE_FACTORS[rawUnit.toUpperCase()] ?? 1;
  return Math.round(value * factor);
}

export function formatIsoDate(timestamp: number): string {
  return new Date(timestamp).toISOString().slice(0, 10);
}

export function formatTime(timestamp: number): string {
  return new Date(timestamp).toLocaleTimeString();
}

export function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

const RESERVED_NAMES = /^(con|prn|aux|nul|com[1-9]|lpt[1-9])$/i;
const EXTENSION = /\.([A-Za-z0-9]{1,10})$/;

/** Truncates by code points so surrogate pairs are never split. */
export function truncateCodePoints(value: string, max: number): string {
  const points = Array.from(value);
  return points.length <= max ? value : points.slice(0, Math.max(0, max)).join('');
}

function cleanSegment(value: string): string {
  return (
    value
      // Intentionally strips path separators and C0 control characters.
      // eslint-disable-next-line no-control-regex
      .replace(/[\\/:*?"<>|\u0000-\u001f\u007f]/g, '_')
      .replace(/\s+/g, ' ')
      .trim()
      .replace(/^\.+/, '')
      .replace(/[. ]+$/, '')
  );
}

/**
 * Makes one path component safe on every OS: no separators/control chars, no
 * leading dots (hidden files, `..`), no trailing dots/spaces, no Windows
 * reserved device names, at most `maxLength` code points — trimming the base
 * name, never the extension.
 */
export function sanitizePathSegment(
  name: string,
  maxLength = 180,
  fallback = 'file',
): string {
  const cleaned = cleanSegment(name);
  if (cleaned.length === 0) return fallback;

  const extMatch = EXTENSION.exec(cleaned);
  let ext = extMatch ? `.${extMatch[1] ?? ''}` : '';
  let base = cleaned.slice(0, cleaned.length - ext.length);
  if (cleanSegment(base).length === 0) {
    base = cleaned;
    ext = '';
  }
  const stem = /^[^.]*/.exec(base)?.[0] ?? '';
  // Windows treats "AUX", "aux.txt" and "aux.tar.gz" alike: suffix the stem.
  if (RESERVED_NAMES.test(stem.trim())) base = `${stem}_${base.slice(stem.length)}`;

  const room = Math.max(1, maxLength - Array.from(ext).length);
  base = cleanSegment(truncateCodePoints(base, room));
  return `${base.length > 0 ? base : fallback}${ext}`;
}

export function sanitizeFileName(name: string, fallback = 'file'): string {
  return sanitizePathSegment(name, 180, fallback);
}
