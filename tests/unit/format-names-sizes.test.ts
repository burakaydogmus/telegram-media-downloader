import { describe, it, expect } from 'vitest';
import {
  parseSizeLabel,
  parseLocaleNumber,
  sanitizeFileName,
  sanitizePathSegment,
  truncateCodePoints,
} from '../../src/shared/utils/format.js';

const KB = 1024;
const MB = 1024 ** 2;

describe('parseSizeLabel', () => {
  it.each([
    ['2.4 MB', Math.round(2.4 * MB)],
    ['1,234.5 MB', Math.round(1234.5 * MB)],
    ['1.234,5 MB', Math.round(1234.5 * MB)],
    ['1,5 MB', Math.round(1.5 * MB)],
    ['1,234 KB', 1234 * KB],
    ['1 024 KB', 1024 * KB],
    ['1\u00a0024 KB', 1024 * KB],
    ['1\u202f024,5 KB', Math.round(1024.5 * KB)],
    ['12.3 MB / 45 MB', Math.round(12.3 * MB)],
    ['512 B', 512],
    ['900 bytes', 900],
    ['3 kb', 3 * KB],
    ['0.5 GB', Math.round(0.5 * 1024 ** 3)],
    ['Video · 4.5 MB', Math.round(4.5 * MB)],
    ['garbage', undefined],
    ['MB', undefined],
    ['12 MBit', undefined],
  ])('%s', (label, expected) => {
    expect(parseSizeLabel(label)).toBe(expected);
  });

  it('parseLocaleNumber rejects junk', () => {
    expect(parseLocaleNumber('abc')).toBeUndefined();
    expect(parseLocaleNumber('1,2,3')).toBe(123);
  });
});

describe('sanitizeFileName / sanitizePathSegment', () => {
  it.each([
    ['a/b:c*?.txt', 'a_b_c__.txt'],
    ['', 'file'],
    ['   ', 'file'],
    ['..', 'file'],
    ['.hidden', 'hidden'],
    ['name. . ', 'name'],
    ['trailing.jpg. ', 'trailing.jpg'],
    ['CON', 'CON_'],
    ['con.txt', 'con_.txt'],
    ['aux.tar.gz', 'aux_.tar.gz'],
    ['LPT9.log', 'LPT9_.log'],
    ['COM10.txt', 'COM10.txt'],
    ['console.txt', 'console.txt'],
    ['tab\there\nnew.pdf', 'tab_here_new.pdf'],
    ['a   b.pdf', 'a b.pdf'],
    ['Ünïcödé 😀 файл.mp4', 'Ünïcödé 😀 файл.mp4'],
    ['.jpg', 'jpg'],
  ])('%j → %j', (input, expected) => {
    expect(sanitizeFileName(input)).toBe(expected);
  });

  it('keeps the extension when truncating long names', () => {
    const long = `${'a'.repeat(300)}.mp4`;
    const result = sanitizeFileName(long);
    expect(result.endsWith('.mp4')).toBe(true);
    expect(result.length).toBe(180);
  });

  it('never splits surrogate pairs when truncating', () => {
    const result = sanitizePathSegment(`${'😀'.repeat(20)}.png`, 10);
    expect(result).toBe(`${'😀'.repeat(6)}.png`);
    expect(truncateCodePoints('😀😀😀', 2)).toBe('😀😀');
  });

  it('uses the fallback for empty results', () => {
    expect(sanitizePathSegment('///', 50, '')).toBe('___');
    expect(sanitizePathSegment(' . ', 50, '')).toBe('');
  });
});
