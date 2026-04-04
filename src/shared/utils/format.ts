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

export function parseSizeLabel(label: string): number | undefined {
  const match = /([\d.,]+)\s*(B|KB|MB|GB|TB)/i.exec(label.trim());
  if (!match) return undefined;
  const rawNumber = match[1];
  const rawUnit = match[2];
  if (rawNumber === undefined || rawUnit === undefined) return undefined;
  const value = Number.parseFloat(rawNumber.replace(',', '.'));
  if (!Number.isFinite(value)) return undefined;
  const factors: Record<string, number> = {
    B: 1,
    KB: 1024,
    MB: 1024 ** 2,
    GB: 1024 ** 3,
    TB: 1024 ** 4,
  };
  const factor = factors[rawUnit.toUpperCase()] ?? 1;
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

export function sanitizeFileName(name: string, fallback = 'file'): string {
  const cleaned = name
    // Intentionally strips path separators and C0 control characters.
    // eslint-disable-next-line no-control-regex
    .replace(/[\\/:*?"<>|\u0000-\u001f]/g, '_')
    .replace(/\s+/g, ' ')
    .trim()
    .slice(0, 180);
  return cleaned.length > 0 ? cleaned : fallback;
}
