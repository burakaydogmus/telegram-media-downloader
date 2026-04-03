export function hashString(input: string): string {
  let hash = 0x811c9dc5;
  for (let i = 0; i < input.length; i += 1) {
    hash ^= input.charCodeAt(i);
    // 32-bit FNV prime multiplication via shifts to stay in integer range.
    hash = Math.imul(hash, 0x01000193);
  }
  // Convert to an unsigned 32-bit hex string.
  return (hash >>> 0).toString(16).padStart(8, '0');
}

export function randomId(prefix = 'id'): string {
  const cryptoObj = globalThis.crypto;
  if (cryptoObj && typeof cryptoObj.randomUUID === 'function') {
    return `${prefix}_${cryptoObj.randomUUID()}`;
  }
  return `${prefix}_${Date.now().toString(36)}_${Math.random().toString(36).slice(2, 10)}`;
}
