/**
 * Live smoke test against the real Telegram Web K. SKIPPED unless TGMD_LIVE=1.
 *
 * Never automates login: it reuses a Chromium profile in which a TEST account
 * is already logged in to web.telegram.org.
 *
 *   1. npm run build
 *   2. One-time profile setup: launch Chromium with that profile dir, e.g.
 *        npx playwright open --user-data-dir=/path/to/tgmd-profile https://web.telegram.org/k/
 *      and log in manually with the test account; then close it.
 *   3. TGMD_LIVE=1 TGMD_PROFILE_DIR=/path/to/tgmd-profile TGMD_CHAT='#-100123…' \
 *        npx playwright test tests/e2e/live-smoke.spec.ts
 *      (PWHEAD=1 to watch.) TGMD_CHAT is the chat's URL hash, with or without
 *      `#`, for a chat that shows at least one photo/video/document on open.
 *
 * Exclude it from fixture runs with `--grep-invert live`.
 */
import { test, expect, type BrowserContext } from '@playwright/test';
import { launchWithExtension, getContentState } from './helpers/extension.js';
import { PANEL_ROOT_ID } from '../../src/shared/constants/index.js';

const LIVE = process.env.TGMD_LIVE === '1';
const PROFILE_DIR = process.env.TGMD_PROFILE_DIR ?? '';
const CHAT = process.env.TGMD_CHAT ?? '';

test.describe('live smoke: web.telegram.org/k', () => {
  test.skip(!LIVE, 'Set TGMD_LIVE=1 (plus TGMD_PROFILE_DIR and TGMD_CHAT) to run.');

  let context: BrowserContext;

  test.beforeAll(async () => {
    if (!PROFILE_DIR || !CHAT) {
      throw new Error('TGMD_PROFILE_DIR and TGMD_CHAT are required when TGMD_LIVE=1.');
    }
    context = await launchWithExtension({ userDataDir: PROFILE_DIR });
  });

  test.afterAll(async () => {
    await context?.close();
  });

  test('live: panel mounts, selectors are healthy and media is detected', async () => {
    test.setTimeout(120_000);
    const page = await context.newPage();
    const hash = CHAT.startsWith('#') ? CHAT : `#${CHAT}`;
    await page.goto(`https://web.telegram.org/k/${hash}`);

    await expect(page.locator(`#${PANEL_ROOT_ID}`)).toBeAttached({ timeout: 45_000 });

    await expect
      .poll(async () => (await getContentState(context)).data?.totalMedia ?? 0, {
        timeout: 45_000,
        intervals: [1_000, 2_000, 5_000],
      })
      .toBeGreaterThanOrEqual(1);

    const { data } = await getContentState(context);
    expect(data?.detected).toBe(true);
    expect(data?.client).toBe('webk');
    expect(
      data?.health,
      'GET_STATE must include the selector health report',
    ).toBeDefined();
    const failed = data?.health?.checks.filter((c) => c.critical && !c.matched) ?? [];
    expect(failed, 'failed critical selector checks').toEqual([]);
    expect(data?.health?.ok).toBe(true);
    await page.close();
  });
});
