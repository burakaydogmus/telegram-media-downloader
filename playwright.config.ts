import { defineConfig } from '@playwright/test';
import { resolve, dirname } from 'node:path';
import { fileURLToPath } from 'node:url';

const __dirname = dirname(fileURLToPath(import.meta.url));

/**
 * Playwright configuration for end-to-end tests.
 *
 * The extension E2E suite loads the built extension into a persistent Chromium
 * context (the only way to test MV3 extensions) and exercises high-level flows:
 * extension loading, Telegram detection against a mocked Telegram DOM fixture,
 * and download-queue operations.
 *
 * Run `npm run build` before `npm run test:e2e` so `dist/` exists.
 */
export default defineConfig({
  testDir: resolve(__dirname, 'tests/e2e'),
  fullyParallel: false,
  forbidOnly: !!process.env.CI,
  retries: process.env.CI ? 2 : 0,
  workers: 1,
  reporter: [['list'], ['html', { open: 'never' }]],
  timeout: 30_000,
  expect: { timeout: 5_000 },
  use: {
    trace: 'on-first-retry',
    screenshot: 'only-on-failure',
  },
});
