// Module diagnostics on the React dashboard: the errors the live stream brings (faked here), the
// counter, the empty state, the space note and the help "?".
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream } from './support';

const at = (minute: number): number => Date.UTC(2026, 9, 8, 19, minute);

const ERRORS = [
  {
    id: 'e1',
    timestampMs: at(1),
    level: 'error',
    message: 'Cannot read properties of undefined',
    stack: 'TypeError at module:dice-so-nice/main.js',
    module: 'module:dice-so-nice',
  },
  {
    id: 'w1',
    timestampMs: at(2),
    level: 'warn',
    message: 'Deprecated since v13',
    stack: null,
    module: 'system:dnd5e',
  },
  {
    id: 'e2',
    timestampMs: at(3),
    level: 'error',
    message: 'No stack to tell',
    stack: null,
    module: null,
  },
];

async function openDiagnostics(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.getByRole('button', { name: '🩺 Module diagnostics' }).click();
  const pane = page.getByRole('dialog', { name: 'Module Diagnostics' });
  await expect(pane).toBeVisible();
  return pane;
}

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
});

test('shows the streamed errors newest first, with the counter', async ({ page }) => {
  // The server replays its buffer oldest first, then sends new ones; the same id twice counts once.
  await fakeStream(page, [
    { event: 'errors', data: { errors: ERRORS.slice(0, 2), initial: true } },
    { event: 'errors', data: { errors: [ERRORS[1], ERRORS[2]], initial: false } },
  ]);
  const pane = await openDiagnostics(page);

  await expect(pane.locator('.pane-meta')).toHaveText('2 errors · 1 warns');
  const entries = pane.getByRole('listitem');
  await expect(entries).toHaveCount(3);
  await expect(entries.locator('.diag-msg')).toHaveText([
    'No stack to tell',
    'Deprecated since v13',
    'Cannot read properties of undefined',
  ]);
  await expect(entries.locator('.diag-module')).toHaveText(['unknown', 'dnd5e', 'dice-so-nice']);
  await expect(entries.locator('.diag-level')).toHaveText(['error', 'warn', 'error']);
  await expect(entries.nth(1)).toHaveClass(/lvl-warn/);
  await expect(entries.nth(2)).toHaveAttribute(
    'title',
    'Cannot read properties of undefined\n\nTypeError at module:dice-so-nice/main.js'
  );
});

test('says so when no module has failed', async ({ page }) => {
  await fakeStream(page, [{ event: 'errors', data: { errors: [], initial: true } }]);
  const pane = await openDiagnostics(page);
  await expect(pane.locator('.pane-meta')).toHaveText('0 issues');
  await expect(pane.getByText('No module errors captured.')).toBeVisible();
});

test('errors that arrive while the pane is closed are there when it opens', async ({ page }) => {
  await fakeStream(page, [{ event: 'errors', data: { errors: ERRORS, initial: true } }]);
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.getByRole('heading', { level: 1 })).toBeVisible();
  const pane = await openDiagnostics(page);
  await expect(pane.getByRole('listitem')).toHaveCount(3);
});

test('a space check that stopped running is noted', async ({ page }) => {
  await fakeStream(page, []);
  await page.unroute('**/api/space');
  await page.route('**/api/space', route =>
    route.fulfill({
      json: {
        available: true,
        level: 'ok',
        stale: true,
        checkedAt: '2026-10-08T12:00:00.000Z',
        host: 'pi',
        thresholdPercent: 90,
        disks: [],
      },
    })
  );
  const pane = await openDiagnostics(page);
  await expect(pane.locator('.diag-note')).toContainText(
    'The space check on pi has not run for over 3 hours (last check'
  );
});

test('the pane closes with ✕, Escape and its header button', async ({ page }) => {
  await fakeStream(page, []);
  const pane = await openDiagnostics(page);
  await page.getByRole('button', { name: 'Close module diagnostics' }).click();
  await expect(pane).toBeHidden();

  await page.getByRole('button', { name: '🩺 Module diagnostics' }).click();
  await page.keyboard.press('Escape');
  await expect(pane).toBeHidden();

  await page.getByRole('button', { name: '🩺 Module diagnostics' }).click();
  await expect(pane).toBeVisible();
  await page.getByRole('button', { name: '🩺 Module diagnostics' }).click();
  await expect(pane).toBeHidden();
});

test('the real stream sends the GM no errors when the bridge is down', async ({ page }) => {
  // Nothing faked: the dashboard's own /api/stream, with the GM token in the query.
  const stream = page.waitForRequest(req => req.url().includes('/api/stream'));
  const pane = await openDiagnostics(page);
  expect(new URL((await stream).url()).searchParams.get('token')).toBe(GM_TOKEN);
  await expect(pane.getByText('No module errors captured.')).toBeVisible();
});
