// The live play line in the header (it replaced the GM Actions button, #btn-gm): its state from the
// stream's `settings` event and the module's switches (/api/session/switches), the list it opens,
// and the one Turn on that sets everything, the same call Start session makes.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, holdPlaySession } from './support';

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await holdPlaySession(page);
});

const list = (on: boolean): unknown[] => [
  { id: 'writes', name: 'Allow Write Operations', on: true },
  { id: 'handouts', name: 'AI Tool: Handouts (writes)', on },
  { id: 'live-play', name: 'AI Tool: Live play (writes)', on: true },
];

const read = (on: boolean, gmActionsEnabled: boolean): unknown => ({
  switches: { switches: list(on), ready: null, changed: [], failed: [] },
  gmActionsEnabled,
  error: null,
});

/** GET answers `first`; a POST turns everything on and answers like the server. */
async function fakeSwitches(page: Page, first: unknown): Promise<unknown[]> {
  const posts: unknown[] = [];
  let answer = first;
  await page.route('**/api/session/switches', (route, request) => {
    if (request.method() === 'GET') return route.fulfill({ json: answer });
    posts.push(request.postDataJSON());
    answer = read(true, true);
    return route.fulfill({
      json: {
        switches: { switches: list(true), ready: null, changed: ['handouts'], failed: [] },
        gmActionsEnabled: true,
        gmActionsChanged: true,
      },
    });
  });
  return posts;
}

test('everything on reads "Live play on: all set" and is lit', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: true } }]);
  await fakeSwitches(page, read(true, true));
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText('Live play on: all set');
  await expect(button).toHaveClass(/\bon\b/);
});

test('a switch that is off is named, and the list turns everything on', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  const posts = await fakeSwitches(page, read(false, false));
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText('GM Actions and Handouts are off: Turn on');
  await button.click();
  const switches = page.getByRole('list', { name: 'Live play switches' });
  await expect(switches.getByRole('listitem')).toHaveCount(4);
  await expect(switches.locator('[data-switch="handouts"]')).toHaveAttribute('data-on', 'false');
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(button).toHaveText('Live play on: all set');
  expect(posts).toEqual([{ action: 'ready' }]);
});

test('GM Actions off alone is named too', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  await fakeSwitches(page, read(true, false));
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await expect(page.locator('#btn-gm')).toHaveText('GM Actions is off: Turn on');
});
