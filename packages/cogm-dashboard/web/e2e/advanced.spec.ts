// The Advanced ▾ menu on the React dashboard: its entries, how it opens and closes, where the
// focus goes, and opening a drawer from it with the keyboard while another drawer is open.
import { expect, test } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok } from './support';

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  await fakeTools(page, () => ok({}));
  await page.goto(`/next/?token=${GM_TOKEN}`);
});

test('the menu lists the panels and tools in the old page order', async ({ page }) => {
  const button = page.locator('#btn-advanced');
  await expect(button).toHaveAttribute('aria-expanded', 'false');
  await button.click();
  const menu = page.getByRole('menu');
  await expect(button).toHaveAttribute('aria-expanded', 'true');
  await expect(menu.getByRole('menuitem')).toHaveText([
    '📖 GM guides',
    '📋 Prep',
    '🛡 Party',
    '📜 Handouts',
    '🃏 Tarokka',
    '🛠 Tools',
    '🩺 Module diagnostics',
    '🔗 Player links',
  ]);
  await expect(menu.locator('.menu-label')).toHaveText(['Panels', 'Tools']);
  // The page's own header keeps Pre-flight (with its status) outside the menu.
  await expect(page.locator('header #btn-preflight')).toBeVisible();

  // Escape closes the menu and gives the focus back to its button.
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(button).toBeFocused();

  // So does a click outside it.
  await button.click();
  await expect(menu).toBeVisible();
  await page.locator('.link-banner').click();
  await expect(menu).toBeHidden();
});

test('an entry opens its drawer, which keeps the focus', async ({ page }) => {
  await page.locator('#btn-advanced').press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu.getByRole('menuitem').first()).toBeFocused();
  // Arrow down to Tarokka, one entry at a time.
  for (const name of ['📋 Prep', '🛡 Party', '📜 Handouts', '🃏 Tarokka']) {
    await page.keyboard.press('ArrowDown');
    await expect(menu.getByRole('menuitem', { name })).toBeFocused();
  }
  await page.keyboard.press('Enter');
  await expect(menu).toBeHidden();
  const tarokka = page.getByRole('dialog', { name: '🃏 Tarokka' });
  await expect(tarokka).toBeVisible();
  await expect(page.locator('#btn-advanced')).not.toBeFocused();
  await expect.poll(() => tarokka.evaluate(el => el.contains(document.activeElement))).toBe(true);
});

test('with a drawer open, the keyboard opens another on top; Escape closes the menu first', async ({
  page,
}) => {
  await page.locator('#btn-advanced').click();
  await page.locator('#advanced-menu #btn-party').click();
  const party = page.getByRole('dialog', { name: '🛡 Party' });
  await expect(party).toHaveClass(/drawer-top/);

  // The backdrop covers the header; the keyboard still reaches the menu.
  await page.locator('#btn-advanced').press('Enter');
  const menu = page.getByRole('menu');
  await expect(menu).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(menu).toBeHidden();
  await expect(party).toBeVisible();
  // Radix hands the focus back to the menu button a moment after the menu closes.
  await expect(page.locator('#btn-advanced')).toBeFocused();

  await page.locator('#btn-advanced').press('Enter');
  await expect(menu).toBeVisible();
  await menu.getByRole('menuitem', { name: '📜 Handouts' }).press('Enter');
  const handouts = page.getByRole('dialog', { name: '📜 Handouts' });
  await expect(handouts).toHaveClass(/drawer-top/);
  await expect(party).not.toHaveClass(/drawer-top/);

  // Party again from the menu: already open, it comes to the top instead of closing.
  await page.locator('#btn-advanced').press('Enter');
  await menu.getByRole('menuitem', { name: '🛡 Party' }).press('Enter');
  await expect(party).toHaveClass(/drawer-top/);
  await expect(handouts).not.toHaveClass(/drawer-top/);
  await page.keyboard.press('Escape');
  await expect(party).toBeHidden();
  await expect(handouts).toHaveClass(/drawer-top/);
});

test('Module diagnostics toggles from the menu; shut, the focus goes back to the menu button', async ({
  page,
}) => {
  await page.locator('#btn-advanced').click();
  await page.locator('#advanced-menu #btn-show-diag').click();
  const pane = page.getByRole('dialog', { name: 'Module Diagnostics' });
  await expect(pane).toBeVisible();
  await page.locator('#btn-advanced').click();
  await page.locator('#advanced-menu #btn-show-diag').click();
  await expect(pane).toBeHidden();
  await expect(page.locator('#btn-advanced')).toBeFocused();
});
