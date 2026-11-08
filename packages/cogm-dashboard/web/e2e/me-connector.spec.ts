// The "Your Claude connector" card on /me (public/me.js): a failed load shows the error with
// Try again, the error opens the details so it is announced, and a later "not set up" answer
// takes the card away again. Everything is faked in the browser; made-up values only.
import { expect, test, type Page } from '@playwright/test';

import { fakeCommonRoutes } from './support';

async function openMe(
  page: Page,
  connector: (n: number) => { status: number; body: unknown }
): Promise<void> {
  await fakeCommonRoutes(page);
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cogm_me_key', 'e2e-me-key');
    } catch {
      // Storage refused: the page shows its first-visit state.
    }
  });
  await page.route('**/api/me', route =>
    route.fulfill({
      json: {
        userId: 'u1',
        userName: 'Mara',
        sheets: [],
        rollRequests: [],
        theme: 'neutral',
        privateRolls: [],
      },
    })
  );
  await page.route('**/api/player/stream*', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body: '' })
  );
  let calls = 0;
  await page.route('**/api/me/connector', route => {
    const { status, body } = connector(calls++);
    return route.fulfill({ status, json: body });
  });
  await page.goto('/me');
}

test('a failed connector load opens the error; a later "not set up" answer hides the card', async ({
  page,
}) => {
  await openMe(page, n =>
    n === 0 ? { status: 503, body: { error: 'down' } } : { status: 200, body: { enabled: false } }
  );
  const card = page.locator('#me-connector');
  await expect(card).toBeVisible();
  await expect(page.locator('#mc-error')).toBeVisible();
  await expect(card).toHaveJSProperty('open', true);

  await page.locator('#mc-retry').click();
  await expect(card).toBeHidden();
  await expect(page.locator('#mc-error')).toBeHidden();
});
