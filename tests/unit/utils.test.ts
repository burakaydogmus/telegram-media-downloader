import { describe, it, expect, vi } from 'vitest';
import { fuzzyScore, fuzzyMatch } from '../../src/shared/utils/fuzzy.js';
import {
  formatBytes,
  parseSizeLabel,
  formatIsoDate,
  clamp,
  sanitizeFileName,
} from '../../src/shared/utils/format.js';
import { hashString, randomId } from '../../src/shared/utils/id.js';
import { TypedEmitter } from '../../src/shared/utils/events.js';
import {
  debounce,
  delay,
  retry,
  abortableDelay,
  isAbortError,
  nextFrame,
} from '../../src/shared/utils/async.js';

describe('fuzzy', () => {
  it('scores exact matches highest', () => {
    expect(fuzzyScore('abc', 'abc')).toBe(1);
  });
  it('scores substring matches below exact', () => {
    const score = fuzzyScore('bc', 'abcd');
    expect(score).toBeGreaterThan(0.7);
    expect(score).toBeLessThan(1);
  });
  it('handles empty query', () => {
    expect(fuzzyScore('', 'anything')).toBe(1);
  });
  it('returns 0 for no match', () => {
    expect(fuzzyScore('xyz', 'abc')).toBe(0);
  });
  it('fuzzyMatch respects threshold', () => {
    expect(fuzzyMatch('abc', 'abc')).toBe(true);
    expect(fuzzyMatch('zzz', 'abc')).toBe(false);
  });
});

describe('format', () => {
  it('formats bytes', () => {
    expect(formatBytes(0)).toBe('0 B');
    expect(formatBytes(1024)).toBe('1.0 KB');
    expect(formatBytes(1024 * 1024)).toBe('1.0 MB');
  });
  it('parses size labels', () => {
    expect(parseSizeLabel('2.4 MB')).toBe(Math.round(2.4 * 1024 ** 2));
    expect(parseSizeLabel('garbage')).toBeUndefined();
  });
  it('formats ISO date', () => {
    expect(formatIsoDate(Date.parse('2026-06-19T10:00:00Z'))).toBe('2026-06-19');
  });
  it('clamps', () => {
    expect(clamp(5, 0, 10)).toBe(5);
    expect(clamp(-1, 0, 10)).toBe(0);
    expect(clamp(99, 0, 10)).toBe(10);
  });
  it('sanitizes file names', () => {
    expect(sanitizeFileName('a/b:c*?.txt')).toBe('a_b_c__.txt');
    expect(sanitizeFileName('')).toBe('file');
  });
});

describe('id', () => {
  it('hashes deterministically', () => {
    expect(hashString('abc')).toBe(hashString('abc'));
    expect(hashString('abc')).not.toBe(hashString('abd'));
  });
  it('generates prefixed random ids', () => {
    expect(randomId('dl')).toMatch(/^dl_/);
    expect(randomId('dl')).not.toBe(randomId('dl'));
  });
});

describe('TypedEmitter', () => {
  it('emits to listeners and supports off', () => {
    const emitter = new TypedEmitter<{ ping: number }>();
    const listener = vi.fn();
    const unsub = emitter.on('ping', listener);
    emitter.emit('ping', 1);
    unsub();
    emitter.emit('ping', 2);
    expect(listener).toHaveBeenCalledOnce();
    expect(listener).toHaveBeenCalledWith(1);
  });
  it('removeAll clears listeners', () => {
    const emitter = new TypedEmitter<{ ping: number }>();
    const listener = vi.fn();
    emitter.on('ping', listener);
    emitter.removeAll('ping');
    emitter.emit('ping', 1);
    expect(listener).not.toHaveBeenCalled();
  });
});

describe('async', () => {
  it('debounce collapses calls', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 10);
    debounced();
    debounced();
    await delay(30);
    expect(fn).toHaveBeenCalledOnce();
  });
  it('debounce can be cancelled', async () => {
    const fn = vi.fn();
    const debounced = debounce(fn, 10);
    debounced();
    debounced.cancel();
    await delay(30);
    expect(fn).not.toHaveBeenCalled();
  });
  it('retry succeeds after failures', async () => {
    let calls = 0;
    const result = await retry(
      async () => {
        calls += 1;
        if (calls < 2) throw new Error('x');
        return 'ok';
      },
      { retries: 3, baseDelayMs: 1 },
    );
    expect(result).toBe('ok');
    expect(calls).toBe(2);
  });
  it('retry rethrows after exhausting attempts', async () => {
    await expect(
      retry(
        async () => {
          throw new Error('always');
        },
        { retries: 1, baseDelayMs: 1 },
      ),
    ).rejects.toThrow('always');
  });
  it('abortableDelay resolves after the delay', async () => {
    await expect(abortableDelay(1)).resolves.toBeUndefined();
  });
  it('abortableDelay rejects on abort', async () => {
    const controller = new AbortController();
    const pending = abortableDelay(10_000, controller.signal);
    controller.abort();
    await expect(pending).rejects.toSatisfy(isAbortError);
    const aborted = new AbortController();
    aborted.abort();
    await expect(abortableDelay(1, aborted.signal)).rejects.toSatisfy(isAbortError);
  });
  it('nextFrame resolves with or without rAF', async () => {
    await expect(nextFrame(null, 1)).resolves.toBeUndefined();
    await expect(nextFrame(window)).resolves.toBeUndefined();
  });
});
