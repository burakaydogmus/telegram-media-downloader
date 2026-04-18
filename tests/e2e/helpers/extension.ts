import { resolve, dirname, join } from 'node:path';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
export const DIST_PATH = resolve(ROOT, 'dist');
export const FIXTURE_HTML = readFileSync(
  resolve(__dirname, '../fixtures/telegram-webk.html'),
  'utf-8',
);

export async function launchWithExtension(): Promise<BrowserContext> {
  const headed = process.env.PWHEAD === '1';
  const userDataDir = mkdtempSync(join(tmpdir(), 'tgmd-e2e-'));
  return chromium.launchPersistentContext(userDataDir, {
    headless: false,
    args: [
      ...(headed ? [] : ['--headless=new']),
      `--disable-extensions-except=${DIST_PATH}`,
      `--load-extension=${DIST_PATH}`,
      '--no-first-run',
      '--no-default-browser-check',
    ],
  });
}

export async function getServiceWorker(context: BrowserContext): Promise<Worker> {
  const existing = context.serviceWorkers();
  if (existing[0]) return existing[0];
  return context.waitForEvent('serviceworker', { timeout: 20_000 });
}

export function extensionIdFromWorker(worker: Worker): string {
  const match = /chrome-extension:\/\/([a-z]+)\//.exec(worker.url());
  if (!match?.[1]) throw new Error(`Could not parse extension id from ${worker.url()}`);
  return match[1];
}

export async function routeTelegram(context: BrowserContext): Promise<void> {
  await context.route('https://web.telegram.org/**', async (route) => {
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: FIXTURE_HTML,
    });
  });
}
