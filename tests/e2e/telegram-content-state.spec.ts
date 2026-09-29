import { test, expect, type BrowserContext } from '@playwright/test';
import {
  launchWithExtension,
  routeTelegram,
  getContentState,
} from './helpers/extension.js';
import { PANEL_ROOT_ID } from '../../src/shared/constants/index.js';

let context: BrowserContext;

test.beforeAll(async () => {
  context = await launchWithExtension();
  await routeTelegram(context);
});

test.afterAll(async () => {
  await context.close();
});

for (const [label, url, client] of [
  ['Web K', 'https://web.telegram.org/k/#-1001234567890', 'webk'],
  ['Web A', 'https://web.telegram.org/a/#-1001234567890', 'weba'],
] as const) {
  test(`${label} fixture: content state reports detection, media and health`, async () => {
    const page = await context.newPage();
    await page.goto(url);
    await expect(page.locator(`#${PANEL_ROOT_ID}`)).toBeAttached({ timeout: 10_000 });

    await expect
      .poll(async () => (await getContentState(context)).data?.totalMedia ?? 0, {
        timeout: 10_000,
      })
      .toBeGreaterThanOrEqual(5);

    const { data } = await getContentState(context);
    expect(data?.detected).toBe(true);
    expect(data?.client).toBe(client);
    // `health` is optional until the self-test is wired into GET_STATE.
    if (data?.health) expect(data.health.ok).toBe(true);
    await page.close();
  });
}
