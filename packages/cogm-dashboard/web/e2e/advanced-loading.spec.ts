// The Advanced ▾ menu's Radix code is its own chunk (AdvancedMenuImpl). Until it has arrived a
// stand-in button is on screen: a click or Enter on it opens the menu as soon as the chunk does,
// and the focus is not lost when the real button replaces it.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok } from './support';

/** Loads the page with the menu chunk held back until the returned function is called. */
async function loadHoldingChunk(page: Page): Promise<() => void> {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  await fakeTools(page, () => ok({}));
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/AdvancedMenuImpl-*.js', async route => {
    await gate;
    await route.continue();
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.locator('#btn-advanced')).toBeVisible();
  return release;
}

test('a click before the chunk arrives opens the menu when it does', async ({ page }) => {
  const release = await loadHoldingChunk(page);
  await page.locator('#btn-advanced').click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  release();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.locator('#btn-advanced')).toHaveAttribute('aria-expanded', 'true');
});

test('Enter before the chunk arrives opens it with the first entry focused', async ({ page }) => {
  const release = await loadHoldingChunk(page);
  await page.locator('#btn-advanced').press('Enter');
  release();
  await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeFocused();
});

test('the focus stays on the button when the real one replaces the stand-in', async ({ page }) => {
  const release = await loadHoldingChunk(page);
  const button = page.locator('#btn-advanced');
  await button.focus();
  await button.evaluate(el => ((window as unknown as { standIn: Element }).standIn = el));
  release();
  // Wait until the stand-in has been replaced by another element.
  await expect
    .poll(() =>
      page.evaluate(
        () =>
          document.getElementById('btn-advanced') !==
          (window as unknown as { standIn: Element }).standIn
      )
    )
    .toBe(true);
  await expect(page.locator('#btn-advanced')).toBeFocused();
});
