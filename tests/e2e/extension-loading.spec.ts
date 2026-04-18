import { test, expect, type BrowserContext } from '@playwright/test';
import {
  launchWithExtension,
  getServiceWorker,
  extensionIdFromWorker,
} from './helpers/extension.js';

let context: BrowserContext;

test.beforeAll(async () => {
  context = await launchWithExtension();
});

test.afterAll(async () => {
  await context.close();
});

test('extension service worker registers', async () => {
  const worker = await getServiceWorker(context);
  expect(worker.url()).toContain('service-worker.js');
});

test('popup page renders with localized title and actions', async () => {
  const worker = await getServiceWorker(context);
  const id = extensionIdFromWorker(worker);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/popup/popup.html`);

  await expect(page.locator('.popup__title')).toHaveText(/Media Downloader/);
  await expect(page.locator('#toggle')).toBeVisible();
  await expect(page.locator('#rescan')).toBeVisible();
  await expect(page.locator('#options')).toBeVisible();
  await page.close();
});

test('options page persists settings across reloads', async () => {
  const worker = await getServiceWorker(context);
  const id = extensionIdFromWorker(worker);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/options/options.html`);

  await page.selectOption('#theme', 'dark');
  await page.fill('#maxConcurrentDownloads', '5');
  await page.click('button[type="submit"]');
  await expect(page.locator('#saved')).toBeVisible();

  await page.reload();
  await expect(page.locator('#theme')).toHaveValue('dark');
  await expect(page.locator('#maxConcurrentDownloads')).toHaveValue('5');
  await page.close();
});
