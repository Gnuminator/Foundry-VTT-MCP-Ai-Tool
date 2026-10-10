// The Radix set in web/src/ui (UI-04): the tooltip on an icon-only button. It opens on keyboard
// focus, Escape closes it without taking the focus away or closing the pane, and the button
// keeps its accessible name.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fromMenu } from './support';

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
  await page.goto(`/next/?token=${GM_TOKEN}`);
});

/** The open tooltips, or the one that says `text`. The focus moving takes a moment to close the old one. */
const tip = (page: Page, text?: string): Locator => {
  const all = page.locator('[data-radix-popper-content-wrapper]');
  return text === undefined ? all : all.filter({ hasText: text });
};

test('a tooltip shows on keyboard focus and Escape closes it without moving the focus', async ({
  page,
}) => {
  await fromMenu(page, 'btn-show-diag');
  const pane = page.getByRole('dialog', { name: 'Module Diagnostics' });
  await expect(pane).toBeVisible();
  const help = pane.getByRole('button', { name: 'Help for this panel' });

  // Opening the pane hands the focus to a button inside it; that is not a Tab stop, so no tip.
  await expect(tip(page)).toHaveCount(0);

  // Tab to the "?" from the keyboard.
  await help.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(help).toBeFocused();
  await expect(tip(page, 'What is this? Opens the guide')).toBeVisible();
  await expect(help).toHaveAttribute('aria-describedby', /.+/);
  // The accessible name did not change, and there is no native title next to the tooltip.
  await expect(help).toHaveAttribute('aria-label', 'Help for this panel');
  await expect(help).not.toHaveAttribute('title', /.*/);

  await page.keyboard.press('Escape');
  await expect(tip(page)).toHaveCount(0);
  await expect(help).toBeFocused();
  // The first Escape only closed the tooltip: the pane is still open.
  await expect(pane).toBeVisible();

  // The next Escape closes the pane, as before.
  await page.keyboard.press('Escape');
  await expect(pane).toBeHidden();
});

test('the close button of a pane has a tooltip and keeps its name', async ({ page }) => {
  await fromMenu(page, 'btn-show-diag');
  const pane = page.getByRole('dialog', { name: 'Module Diagnostics' });
  const close = pane.getByRole('button', { name: 'Close module diagnostics' });
  await close.focus();
  await page.keyboard.press('Shift+Tab');
  await page.keyboard.press('Tab');
  await expect(close).toBeFocused();
  await expect(tip(page, 'Close')).toBeVisible();
  await close.hover();
  await close.click();
  await expect(pane).toBeHidden();
});
