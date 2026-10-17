// The GM Actions master switch in the header: its state from the stream's `settings` event, a click
// through toggle-gm-actions on POST /api/control, and a refusal that leaves it as it was.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, holdPlaySession, toast } from './support';

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await holdPlaySession(page);
});

/** Answers POST /api/control like the server: it flips the switch and says what it is now. */
async function fakeControl(page: Page, { fails = false } = {}): Promise<unknown[]> {
  const bodies: unknown[] = [];
  let on = false;
  await page.route('**/api/control', route => {
    bodies.push(route.request().postDataJSON());
    if (fails) return route.fulfill({ status: 500, json: { error: 'server is away' } });
    on = !on;
    return route.fulfill({ json: { gmActionsEnabled: on } });
  });
  return bodies;
}

test('the button follows the stream and starts off before the first settings event', async ({
  page,
}) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: true } }]);
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText('⚔ GM Actions: on');
  await expect(button).toHaveClass(/\bon\b/);
  await expect(button).toHaveAttribute('aria-pressed', 'true');
});

test('a click asks the server to toggle and shows its answer, both ways', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  const bodies = await fakeControl(page);
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText('⚔ GM Actions: off');
  await button.click();
  await expect(button).toHaveText('⚔ GM Actions: on');
  await expect(button).toHaveClass(/\bon\b/);
  await button.click();
  await expect(button).toHaveText('⚔ GM Actions: off');
  await expect(button).not.toHaveClass(/\bon\b/);
  expect(bodies).toEqual([{ action: 'toggle-gm-actions' }, { action: 'toggle-gm-actions' }]);
});

test('a refused click toasts the reason and leaves the switch as it was', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  await fakeControl(page, { fails: true });
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText('⚔ GM Actions: off');
  await button.click();
  await expect(toast(page, '✗ GM Actions: server is away')).toBeVisible();
  await expect(button).toHaveText('⚔ GM Actions: off');
  await expect(button).toBeEnabled();
});
