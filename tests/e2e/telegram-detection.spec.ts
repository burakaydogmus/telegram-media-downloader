import { test, expect, type BrowserContext } from '@playwright/test';
import { launchWithExtension, routeTelegram } from './helpers/extension.js';
import { PANEL_ROOT_ID, TAGS } from '../../src/shared/constants/index.js';

let context: BrowserContext;

test.beforeAll(async () => {
  context = await launchWithExtension();
  await routeTelegram(context);
});

test.afterAll(async () => {
  await context.close();
});

test('content script detects Telegram and injects the panel', async () => {
  const page = await context.newPage();
  await page.goto('https://web.telegram.org/k/');

  const panel = page.locator(`#${PANEL_ROOT_ID}`);
  await expect(panel).toBeAttached({ timeout: 10_000 });
  await page.close();
});

test('panel discovers media and reflects statistics', async () => {
  const page = await context.newPage();
  await page.goto('https://web.telegram.org/k/');

  const panel = page.locator(`#${PANEL_ROOT_ID}`);
  await expect(panel).toBeAttached({ timeout: 10_000 });

  // Drill into the statistics section's shadow DOM to read the total.
  const total = await panel
    .locator(TAGS.statistics)
    .locator('.stat__value')
    .first()
    .textContent();
  expect(Number(total)).toBeGreaterThanOrEqual(3);
  await page.close();
});

test('queue operations: select all then download enqueues tasks', async () => {
  const page = await context.newPage();
  await page.goto('https://web.telegram.org/k/');

  const panel = page.locator(`#${PANEL_ROOT_ID}`);
  await expect(panel).toBeAttached({ timeout: 10_000 });

  // Select all visible media via the Selection section button.
  const selection = panel.locator(TAGS.selection);
  await selection.getByRole('button', { name: /select all visible/i }).click();

  // The selection count should update.
  await expect(selection.locator('[aria-live="polite"]')).toContainText(/selected/i);

  // Trigger a download and assert the queue receives tasks.
  await selection.getByRole('button', { name: /download selected/i }).click();

  const queue = panel.locator(TAGS.queue);
  await expect(queue.locator('.queue-item').first()).toBeVisible({ timeout: 10_000 });
  await page.close();
});
