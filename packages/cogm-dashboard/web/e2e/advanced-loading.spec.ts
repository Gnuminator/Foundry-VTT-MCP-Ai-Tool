// The Advanced ▾ menu's Radix code is its own chunk (AdvancedMenuImpl). Until it has arrived a
// stand-in button is on screen: a click or Enter on it opens the menu as soon as the chunk does,
// the focus is not lost when the real button replaces it, and a chunk that fails to load leaves
// the stand-in and the rest of the page working.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok } from './support';

interface HeldChunk {
  release: () => void;
  /** How many times the page asked for the chunk: 0 means the route pattern matches nothing. */
  hits: () => number;
}

/**
 * Loads the page with the menu chunk held back until `release()` (or, with `abort`, failing the
 * request).
 */
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

test('the focus stays on the button when the real one replaces the stand-in', async ({ page }) => {
  // The chunk is asked for after a 3 s timer; allow for it.
  test.setTimeout(45_000);
  const chunk = await loadHoldingChunk(page);
  const button = page.locator('#btn-advanced');
  await button.focus();
  await button.evaluate(el => ((window as unknown as { standIn: Element }).standIn = el));
  await expect.poll(chunk.hits, { timeout: 10_000 }).toBeGreaterThan(0);
  chunk.release();
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

test('a chunk that fails to load leaves the stand-in and the page working', async ({ page }) => {
  const chunk = await loadHoldingChunk(page, true);
  await page.locator('#btn-advanced').click();
  await expect.poll(chunk.hits).toBeGreaterThan(0);
  // The page did not blank: the header, its other buttons and the stand-in are all there.
  await expect(page.locator('#btn-advanced')).toBeVisible();
  await expect(page.locator('#btn-preflight')).toBeVisible();
  await expect(page.getByRole('heading', { name: 'Foundry AI Tool' })).toBeVisible();
  await expect(page.getByRole('menu')).toHaveCount(0);
});
