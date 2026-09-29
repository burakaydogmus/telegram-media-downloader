function isPlainObject(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

/**
 * Overlays a stored (possibly outdated or partial) object onto `defaults`.
 * Only keys known to `defaults` survive; missing/`undefined` fields, and fields
 * whose stored shape differs from the default's (array vs. object vs. primitive
 * kind), fall back to the default. Nested plain objects are merged recursively.
 * Value ranges are not validated here.
 */
export function mergeDefaults<T extends object>(defaults: T, stored: unknown): T {
  const base = defaults as Record<string, unknown>;
  const result: Record<string, unknown> = { ...base };
  if (!isPlainObject(stored)) return result as T;

  for (const key of Object.keys(base)) {
    const fallback = base[key];
    const value = stored[key];
    if (value === undefined) continue;
    if (Array.isArray(fallback)) {
      if (Array.isArray(value)) result[key] = [...(value as unknown[])];
    } else if (isPlainObject(fallback)) {
      if (isPlainObject(value)) result[key] = mergeDefaults(fallback, value);
    } else if (fallback === null || typeof fallback === typeof value) {
      result[key] = value;
    }
  }
  return result as T;
}
