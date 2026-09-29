import { resolve, dirname, join } from 'node:path';
import { readFileSync, mkdtempSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { fileURLToPath } from 'node:url';
import { chromium, type BrowserContext, type Worker } from '@playwright/test';
import type { ContentState, MessageResponse } from '../../../src/shared/types/index.js';

const __dirname = dirname(fileURLToPath(import.meta.url));
const ROOT = resolve(__dirname, '../../..');
export const DIST_PATH = resolve(ROOT, 'dist');

function readFixture(name: string): string {
  return readFileSync(resolve(__dirname, '../fixtures', name), 'utf-8');
}

export const FIXTURE_HTML = readFixture('telegram-webk.html');
export const FIXTURE_WEBA_HTML = readFixture('telegram-weba.html');

export interface LaunchOptions {
  /** Reuse a profile (e.g. a pre-logged-in one); defaults to a fresh temp dir. */
  readonly userDataDir?: string;
}

export async function launchWithExtension(
  options: LaunchOptions = {},
): Promise<BrowserContext> {
  const headed = process.env.PWHEAD === '1';
  const userDataDir = options.userDataDir ?? mkdtempSync(join(tmpdir(), 'tgmd-e2e-'));
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

/** Serves the Web A fixture under `/a/…` and the Web K fixture everywhere else. */
export async function routeTelegram(context: BrowserContext): Promise<void> {
  await context.route('https://web.telegram.org/**', async (route) => {
    const path = new URL(route.request().url()).pathname;
    await route.fulfill({
      status: 200,
      contentType: 'text/html; charset=utf-8',
      body: path.startsWith('/a') ? FIXTURE_WEBA_HTML : FIXTURE_HTML,
    });
  });
}

/**
 * Asks the content script in the first Telegram tab for its `GET_STATE`,
 * from an extension page (which has `chrome.tabs`).
 */
export async function getContentState(
  context: BrowserContext,
): Promise<MessageResponse<ContentState>> {
  const id = extensionIdFromWorker(await getServiceWorker(context));
  const page = await context.newPage();
  try {
    await page.goto(`chrome-extension://${id}/src/options/options.html`);
    return await page.evaluate(async () => {
      const [tab] = await chrome.tabs.query({ url: 'https://web.telegram.org/*' });
      if (tab?.id === undefined) return { ok: false, error: 'No Telegram tab' };
      try {
        return (await chrome.tabs.sendMessage(tab.id, { type: 'GET_STATE' })) as {
          ok: boolean;
          data?: ContentState;
          error?: string;
        };
      } catch (error) {
        return { ok: false, error: String(error) };
      }
    });
  } finally {
    await page.close();
  }
}
