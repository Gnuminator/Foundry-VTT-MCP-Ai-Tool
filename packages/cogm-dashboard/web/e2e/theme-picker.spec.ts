// The theme picker in the header: the world's theme on load, a pick saved through set-theme on POST
// /api/control (the page changes look when the answer comes), another page's change arriving as the
// stream's `theme` event, and a refused save that puts the picker back.
import { expect, test, type Route } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, holdPlaySession, toast } from './support';

test.beforeEach(async ({ page }) => {
  await holdPlaySession(page);
});

test('the picker shows the world theme and a pick is saved, then applied', async ({ page }) => {
  await fakeCommonRoutes(page, 'neutral');
  await fakeStream(page, []);
  const bodies: unknown[] = [];
  await page.route('**/api/control', route => {
    bodies.push(route.request().postDataJSON());
    return route.fulfill({ json: { theme: 'veil', themes: ['neutral', 'veil'] } });
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const picker = page.locator('#select-theme');
  await expect(picker).toHaveValue('neutral');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neutral');
  await picker.selectOption('veil');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'veil');
  await expect(picker).toHaveValue('veil');
  expect(bodies).toEqual([{ action: 'set-theme', value: 'veil' }]);
});

test('a theme another page chose arrives on the stream and moves the picker', async ({ page }) => {
  await fakeCommonRoutes(page, 'neutral');
  await fakeStream(page, [
    { event: 'theme', data: { theme: 'veil', themes: ['neutral', 'veil'] } },
  ]);
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await expect(page.locator('#select-theme')).toHaveValue('veil');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'veil');
});

test('a slow /api/theme answer does not undo the theme the stream already brought', async ({
  page,
}) => {
  await page.route('**/api/usage', route => route.fulfill({ status: 204 }));
  await page.route('**/api/theme', async route => {
    await new Promise(done => setTimeout(done, 600));
    await route.fulfill({ json: { theme: 'neutral' } }).catch(() => undefined);
  });
  await fakeStream(page, [
    { event: 'theme', data: { theme: 'veil', themes: ['neutral', 'veil'] } },
  ]);
  const late = page.waitForResponse('**/api/theme');
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await expect(page.locator('#select-theme')).toHaveValue('veil');
  await late;
  // Let the old answer land and the page settle: the stream's theme still stands.
  await page.waitForTimeout(300);
  await expect(page.locator('#select-theme')).toHaveValue('veil');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'veil');
});

test('the picker is disabled while a save is on its way', async ({ page }) => {
  await fakeCommonRoutes(page, 'neutral');
  await fakeStream(page, []);
  let held: Route | null = null;
  await page.route('**/api/control', route => {
    held = route;
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const picker = page.locator('#select-theme');
  await picker.selectOption('veil');
  await expect(picker).toBeDisabled();
  await expect.poll(() => held !== null).toBe(true);
  await (held as Route | null)?.fulfill({ json: { theme: 'veil', themes: ['neutral', 'veil'] } });
  await expect(picker).toBeEnabled();
  await expect(picker).toHaveValue('veil');
});

test('a refused save toasts the reason and the picker goes back', async ({ page }) => {
  await fakeCommonRoutes(page, 'neutral');
  await fakeStream(page, []);
  await page.route('**/api/control', route =>
    route.fulfill({ status: 500, json: { error: 'Could not save the theme.' } })
  );
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const picker = page.locator('#select-theme');
  await expect(picker).toHaveValue('neutral');
  await picker.selectOption('veil');
  await expect(toast(page, '✗ Theme: Could not save the theme.')).toBeVisible();
  await expect(picker).toHaveValue('neutral');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neutral');
});

test('the keyboard focus is still on the picker once the save has settled', async ({ page }) => {
  await fakeCommonRoutes(page, 'neutral');
  await fakeStream(page, []);
  await page.route('**/api/control', route =>
    route.fulfill({ json: { theme: 'veil', themes: ['neutral', 'veil'] } })
  );
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const picker = page.locator('#select-theme');
  await expect(picker).toHaveValue('neutral');
  await picker.focus();
  await picker.selectOption('veil');
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'veil');
  await expect(picker).toBeEnabled();
  await expect(picker).toBeFocused();
});
