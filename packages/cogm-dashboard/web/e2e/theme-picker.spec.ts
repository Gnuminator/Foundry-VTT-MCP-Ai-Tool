// The theme picker in the header: the world's theme on load, a pick saved through set-theme on POST
// /api/control (the page changes look when the answer comes), another page's change arriving as the
// stream's `theme` event, and a refused save that puts the picker back.
import { expect, test } from '@playwright/test';

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
