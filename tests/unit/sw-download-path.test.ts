import { describe, it, expect } from 'vitest';
import {
  sanitizeRelativePath,
  resolveTargetPath,
  extractToken,
  stripToken,
  extensionForMime,
} from '../../src/background/download-path.js';

describe('sanitizeRelativePath', () => {
  it.each([
    ['Telegram/Chat/photo.jpg', 'Telegram/Chat/photo.jpg'],
    ['/etc/passwd', 'etc/passwd'],
    ['C:\\Users\\me\\file.jpg', 'C_/Users/me/file.jpg'],
    ['../../secret.txt', 'secret.txt'],
    ['a/./b/../c.png', 'a/b/c.png'],
    ['Telegram//Chat///x.mp4', 'Telegram/Chat/x.mp4'],
    ['Chat: "Best" <of>?|*/pic.jpg', 'Chat_ _Best_ _of____/pic.jpg'],
    ['folder. /name. ', 'folder/name'],
    ['.hidden/.env', 'hidden/env'],
    ['CON/aux.txt', '_CON/_aux.txt'],
    ['com1', '_com1'],
    ['tab\there\u0001/x', 'tab_here_/x'],
    ['', 'file'],
    ['../..', 'file'],
    ['   ', 'file'],
  ])('%j -> %j', (input, expected) => {
    expect(sanitizeRelativePath(input)).toBe(expected);
  });

  it('truncates long segments but keeps the extension', () => {
    const out = sanitizeRelativePath(`${'a'.repeat(300)}.jpeg`);
    expect(out.length).toBe(120);
    expect(out.endsWith('.jpeg')).toBe(true);
  });

  it('drops leading folders when the whole path is too long', () => {
    const seg = 'b'.repeat(100);
    const out = sanitizeRelativePath(`${seg}/${seg}/${seg}/name.jpg`);
    expect(out.length).toBeLessThanOrEqual(240);
    expect(out.endsWith('/name.jpg')).toBe(true);
  });

  it('uses the provided fallback', () => {
    expect(sanitizeRelativePath('..', 'x')).toBe('x');
  });
});

describe('resolveTargetPath', () => {
  it('keeps an explicit extension', () => {
    expect(resolveTargetPath('T/c/a.png', 'photo.jpg', 'image/jpeg')).toBe('T/c/a.png');
  });

  it('borrows the extension of the suggested name', () => {
    expect(resolveTargetPath('T/c/a', 'tgmd-k1__video.MP4')).toBe('T/c/a.mp4');
  });

  it('falls back to the mime type', () => {
    expect(resolveTargetPath('T/c/a', 'download', 'image/webp; q=1')).toBe('T/c/a.webp');
  });

  it('leaves the name bare when nothing is known', () => {
    expect(resolveTargetPath('T/c/a', 'download', 'application/x-unknown')).toBe('T/c/a');
    expect(extensionForMime(undefined)).toBeUndefined();
  });
});

describe('token helpers', () => {
  it('extracts and strips the tgmd token', () => {
    expect(extractToken('tgmd-ab12-Z_x__photo.jpg')).toBe('ab12-Z_x');
    expect(extractToken('dir/tgmd-q9__a.jpg')).toBe('q9');
    expect(extractToken('photo.jpg')).toBeUndefined();
    expect(stripToken('tgmd-q9__a.jpg')).toBe('a.jpg');
  });
});
