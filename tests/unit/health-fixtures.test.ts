import { describe, it, expect, afterEach } from 'vitest';
import { readFileSync } from 'node:fs';
import { resolve } from 'node:path';
import { runSelectorHealth } from '../../src/content/selector-health.js';
import { MediaScanner } from '../../src/content/media-scanner.js';
import type { TelegramClient } from '../../src/shared/types/index.js';

function loadFixture(name: string): void {
  const html = readFileSync(resolve(__dirname, `../e2e/fixtures/${name}`), 'utf-8');
  const doc = new DOMParser().parseFromString(html, 'text/html');
  document.body.className = doc.body.className;
  document.body.replaceChildren(
    ...[...doc.body.childNodes].map((n) => document.importNode(n, true)),
  );
}

describe.each<[string, TelegramClient, number]>([
  ['telegram-webk.html', 'webk', 5],
  ['telegram-weba.html', 'weba', 5],
])('e2e fixture %s', (file, client, minMedia) => {
  afterEach(() => {
    window.location.hash = '';
    document.body.className = '';
  });

  it('passes the selector self-test with a chat open', () => {
    loadFixture(file);
    window.location.hash = '#-1001234567890';
    const report = runSelectorHealth(document, client);
    expect(report.checks.filter((c) => c.critical && !c.matched)).toEqual([]);
    expect(report.ok).toBe(true);
    expect(report.checks.find((c) => c.name === 'message')?.critical).toBe(true);
    for (const type of ['photo', 'video', 'document']) {
      expect(report.checks.find((c) => c.name === type)?.matched, type).toBe(true);
    }
  });

  it('exposes photos, an album, a video and a document to the scanner', () => {
    loadFixture(file);
    const { items } = new MediaScanner(client, document).scan();
    expect(items.length).toBeGreaterThanOrEqual(minMedia);
    const types = new Set(items.map((i) => i.type));
    expect(types).toContain('photo');
    expect(types).toContain('video');
    expect(types).toContain('document');
  });
});
