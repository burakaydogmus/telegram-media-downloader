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

test('popup explains when the active tab is not Telegram', async () => {
  const worker = await getServiceWorker(context);
  const id = extensionIdFromWorker(worker);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/popup/popup.html`);

  await expect(page.locator('#notice')).toBeVisible();
  await expect(page.locator('#notice-text')).toContainText(/web\.telegram\.org/);
  await expect(page.locator('#reload')).toBeHidden();
  await expect(page.locator('#health')).toBeHidden();
  await expect(page.locator('#toggle')).toBeDisabled();
  await page.close();
});

test('options page previews the template and persists the new settings', async () => {
  const worker = await getServiceWorker(context);
  const id = extensionIdFromWorker(worker);

  const page = await context.newPage();
  await page.goto(`chrome-extension://${id}/src/options/options.html`);

  await page.fill('#fileNameTemplate', '{chat}/{msgId}');
  await expect(page.locator('#templatePreview')).toHaveText('Holiday Photos/4521.jpg');
  await page.fill('#fileNameTemplate', '../{name}');
  await expect(page.locator('#templateInvalid')).toBeVisible();

  // Out-of-range numbers are blocked by native constraint validation.
  await page.fill('#downloadDelayMs', '1500');
  await page.fill('#largeFileThresholdMb', '512');
  await page.uncheck('#skipDownloaded');
  await page.click('button[type="submit"]');
  await expect(page.locator('#saved')).toBeVisible();

  await page.reload();
  await expect(page.locator('#downloadDelayMs')).toHaveValue('1500');
  await expect(page.locator('#largeFileThresholdMb')).toHaveValue('512');
  await expect(page.locator('#skipDownloaded')).not.toBeChecked();
  await expect(page.locator('#fileNameTemplate')).toHaveValue(
    'Telegram/{chat}/{date}_{msgId}_{index}_{name}',
  );
  await page.close();
});
