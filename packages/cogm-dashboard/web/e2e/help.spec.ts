// Help on the React dashboard: the GM guides from the real /api/help route (dist/help.json, made
// by the build), the "?" that opens a pane's own heading, and the error path.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fromMenu } from './support';

const helpPane = (page: Page): Locator => page.locator('#pane-help');

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await page.goto(`/next/?token=${GM_TOKEN}`);
});

test('GM guides opens the guide index from the server', async ({ page }) => {
  const request = page.waitForRequest(req => req.url().endsWith('/api/help/README'));
  await fromMenu(page, 'btn-guides');
  expect((await request).headers()['x-cogm-token']).toBe(GM_TOKEN);

  const pane = page.getByRole('dialog', { name: 'GM guides' });
  await expect(pane).toBeVisible();
  await expect(pane).toHaveClass(/help-pane/);
  await expect(pane.locator('.help-body h1, .help-body h2').first()).toBeVisible();

  await page.getByRole('button', { name: 'Close help' }).click();
  await expect(pane).toBeHidden();
});

test('the "?" on a pane opens its heading in the guide', async ({ page }) => {
  await fromMenu(page, 'btn-show-diag');
  await page
    .getByRole('dialog', { name: 'Module Diagnostics' })
    .getByRole('button', { name: 'Help for this panel' })
    .click();

  await expect(page.getByRole('dialog', { name: 'The dashboard' })).toBeVisible();
  const heading = helpPane(page).locator('[id="module-diagnostics"]');
  await expect(heading).toBeInViewport();
  // Help sits over the pane that opened it; both stay open.
  await expect(page.getByRole('dialog', { name: 'Module Diagnostics' })).toBeVisible();
});

test('a guide that cannot load says why, and the next open asks again', async ({ page }) => {
  let calls = 0;
  await page.route('**/api/help/**', route => {
    calls += 1;
    return route.fulfill({
      status: 404,
      json: { error: 'The help is built with npm run build (dist/help.json).' },
    });
  });
  await fromMenu(page, 'btn-guides');
  await expect(
    helpPane(page).getByText(
      "Couldn't load the help: The help is built with npm run build (dist/help.json)."
    )
  ).toBeVisible();
  await expect(helpPane(page).getByRole('heading', { level: 2 })).toHaveText('Help');

  await page.getByRole('button', { name: 'Close help' }).click();
  await fromMenu(page, 'btn-guides');
  await expect.poll(() => calls).toBe(2);
});
