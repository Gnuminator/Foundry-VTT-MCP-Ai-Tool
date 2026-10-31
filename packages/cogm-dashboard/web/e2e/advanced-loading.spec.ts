// The Advanced ▾ menu's Radix code is its own chunk (AdvancedMenuImpl). Until it has arrived a
// stand-in button is on screen: a click or Enter on it opens the menu as soon as the chunk does,
// focus on the stand-in moves to the real button, focus elsewhere stays where it is, and a chunk
// that fails to load leaves the page working.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok } from './support';

interface HeldChunk {
  release: () => void;
  /** How many times the page asked for the chunk: 0 means the route pattern matches nothing. */
  hits: () => number;
}

/** Loads the page with the menu chunk held back until `release()` (or failing, with `abort`). */
async function loadHoldingChunk(page: Page, abort = false): Promise<HeldChunk> {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  await fakeTools(page, () => ok({}));
  let release: () => void = () => undefined;
  const gate = new Promise<void>(resolve => {
    release = resolve;
  });
  let hits = 0;
  await page.route('**/AdvancedMenuImpl-*.js', async route => {
    hits += 1;
    if (abort) {
      await route.abort();
      return;
    }
    await gate;
    await route.continue();
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.locator('#btn-advanced')).toBeVisible();
  return { release, hits: () => hits };
}

test('a click before the chunk arrives opens the menu when it does', async ({ page }) => {
  const chunk = await loadHoldingChunk(page);
  await page.locator('#btn-advanced').click();
  await expect(page.getByRole('menu')).toHaveCount(0);
  await expect.poll(chunk.hits).toBeGreaterThan(0);
  chunk.release();
  await expect(page.getByRole('menu')).toBeVisible();
  await expect(page.locator('#btn-advanced')).toHaveAttribute('aria-expanded', 'true');
});

test('Enter before the chunk arrives opens it with the first entry focused', async ({ page }) => {
  const chunk = await loadHoldingChunk(page);
  await page.locator('#btn-advanced').press('Enter');
  await expect.poll(chunk.hits).toBeGreaterThan(0);
  chunk.release();
  await expect(page.getByRole('menu').getByRole('menuitem').first()).toBeFocused();
});

test('focus on the stand-in moves to the real button when it replaces it', async ({ page }) => {
  const chunk = await loadHoldingChunk(page);
  const button = page.locator('#btn-advanced');
  await button.focus();
  await button.evaluate(el => el.setAttribute('data-stand-in', 'yes'));
  await expect.poll(chunk.hits).toBeGreaterThan(0);
  chunk.release();
  // The real button is another element: the marker is gone, and it has the focus.
  await expect(button).not.toHaveAttribute('data-stand-in', 'yes');
  await expect(button).toBeFocused();
  await expect(page.getByRole('menu')).toHaveCount(0);
});

test('focus elsewhere stays there when the real button replaces the stand-in', async ({ page }) => {
  const chunk = await loadHoldingChunk(page);
  const button = page.locator('#btn-advanced');
  await button.focus();
  // Start the download by focusing the stand-in, then move on to another control.
  await expect.poll(chunk.hits).toBeGreaterThan(0);
  const other = page
    .locator('#btn-guides, #btn-preflight, .topbar button:not(#btn-advanced)')
    .first();
  await other.focus();
  await expect(other).toBeFocused();
  chunk.release();
  await expect(page.locator('#btn-advanced')).toHaveAttribute('aria-haspopup', 'menu');
  await expect(other).toBeFocused();
});

test('a chunk that fails to load leaves the page working', async ({ page }) => {
  const chunk = await loadHoldingChunk(page, true);
  await page.locator('#btn-advanced').click();
  await expect.poll(chunk.hits).toBeGreaterThan(0);
  await expect(page.locator('#btn-advanced')).toBeVisible();
  await expect(page.locator('#moments')).toBeVisible();
});
