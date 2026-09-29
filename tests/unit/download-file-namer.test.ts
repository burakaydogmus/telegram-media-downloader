import { describe, it, expect } from 'vitest';
import {
  buildRelativePath,
  inferExtension,
  extensionFromMime,
  fileNameOf,
} from '../../src/features/download/file-namer.js';
import { DEFAULT_SETTINGS } from '../../src/shared/constants/index.js';
import type { MediaItem } from '../../src/shared/types/index.js';

const TS = new Date(2026, 0, 5, 7, 8, 9).getTime();

type Overrides = { [K in keyof MediaItem]?: MediaItem[K] | undefined };

function item(overrides: Overrides = {}): MediaItem {
  const merged: Record<string, unknown> = {
    id: 'm1',
    type: 'photo',
    messageId: '42',
    albumIndex: 1,
    peerId: '-100123',
    chatTitle: 'My Chat',
    timestamp: TS,
    ...overrides,
  };
  return Object.fromEntries(
    Object.entries(merged).filter(([, v]) => v !== undefined),
  ) as unknown as MediaItem;
}

describe('buildRelativePath', () => {
  it.each<[string, Overrides, string]>([
    [
      DEFAULT_SETTINGS.fileNameTemplate,
      { fileName: 'cat.png' },
      'Telegram/My Chat/2026-01-05_42_1_cat.png',
    ],
    ['{chat}/{name}', { chatTitle: 'A/B\\C', fileName: 'x.pdf' }, 'A_B_C/x.pdf'],
    ['{peer}/{type}/{msgId}', {}, '-100123/photo/42.jpg'],
    ['{date}_{time}', {}, '2026-01-05_07-08-09.jpg'],
    ['{name}.{ext}', { fileName: 'report.final.PDF' }, 'report.final.pdf'],
    ['{name}', { fileName: undefined, type: 'video' }, 'video_42.mp4'],
    ['{name}', { fileName: 'song', mimeType: 'audio/mpeg', type: 'audio' }, 'song.mp3'],
    ['{name}', { fileName: undefined, mimeType: 'image/webp' }, 'photo_42.webp'],
    ['../{chat}/../{name}', { fileName: 'a.jpg' }, 'My Chat/a.jpg'],
    ['{chat}/{name}', { chatTitle: '..', fileName: 'a.jpg' }, 'a.jpg'],
    ['{chat}/{name}', { chatTitle: '  ', fileName: 'a.jpg' }, '-100123/a.jpg'],
    ['CON/{name}', { fileName: 'nul.txt' }, 'CON_/nul_.txt'],
    ['{chat}//{name}', { chatTitle: 'Chat. ', fileName: '.env' }, 'Chat/photo_42.env'],
    ['{unknown}/{name}', { fileName: 'a.jpg' }, '{unknown}/a.jpg'],
    ['', { fileName: 'a.jpg' }, 'Telegram/My Chat/2026-01-05_42_1_a.jpg'],
    [
      'Ünï/{chat}/{name}',
      { chatTitle: 'Чат 😀', fileName: 'фото.jpg' },
      'Ünï/Чат 😀/фото.jpg',
    ],
  ])('%s with %j', (template, overrides, expected) => {
    expect(buildRelativePath(template, item(overrides))).toBe(expected);
  });

  it('uses `now` when the item has no timestamp', () => {
    const now = new Date(2025, 11, 31, 23, 59, 58).getTime();
    expect(buildRelativePath('{date}_{time}', item({ timestamp: undefined }), now)).toBe(
      '2025-12-31_23-59-58.jpg',
    );
  });

  it('bounds long names but keeps the extension', () => {
    const path = buildRelativePath(
      '{chat}/{name}',
      item({ chatTitle: 'c'.repeat(300), fileName: `${'n'.repeat(400)}.mkv` }),
    );
    const [dir, file] = path.split('/');
    expect(dir!.length).toBeLessThanOrEqual(60);
    expect(file!.endsWith('.mkv')).toBe(true);
    expect(path.length).toBeLessThanOrEqual(200);
  });

  it('bounds deep templates', () => {
    const template = Array.from({ length: 12 }, (_, i) => `${'d'.repeat(50)}${i}`).join(
      '/',
    );
    const path = buildRelativePath(`${template}/{name}`, item({ fileName: 'x.zip' }));
    expect(path.split('/').length).toBeLessThanOrEqual(7);
    expect(path.length).toBeLessThanOrEqual(200);
    expect(path.endsWith('x.zip')).toBe(true);
  });

  it('never yields empty segments or dot segments', () => {
    const path = buildRelativePath('/./{chat}/ /{name}/', item({ fileName: 'a.jpg' }));
    for (const segment of path.split('/')) {
      expect(segment.length).toBeGreaterThan(0);
      expect(segment.startsWith('.')).toBe(false);
    }
  });
});

describe('inferExtension', () => {
  it.each<[Partial<MediaItem>, string]>([
    [{ fileName: 'a.MP3', type: 'audio' }, 'mp3'],
    [{ mimeType: 'video/quicktime; codecs=x', type: 'video' }, 'mov'],
    [{ type: 'gif' }, 'mp4'],
    [{ type: 'document' }, 'bin'],
    [{ fileName: 'noext', type: 'document', mimeType: 'application/pdf' }, 'pdf'],
  ])('%j → %s', (overrides, expected) => {
    expect(inferExtension({ id: 'x', type: 'photo', ...overrides })).toBe(expected);
  });

  it('extensionFromMime handles unknowns', () => {
    expect(extensionFromMime(undefined)).toBeUndefined();
    expect(extensionFromMime('application/x-unknown')).toBeUndefined();
  });

  it('fileNameOf returns the last segment', () => {
    expect(fileNameOf('a/b/c.txt')).toBe('c.txt');
    expect(fileNameOf('c.txt')).toBe('c.txt');
  });
});
