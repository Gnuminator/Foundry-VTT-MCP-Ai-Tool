// The GM Actions line in the header (#btn-gm): its state from the
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

test('everything on reads "GM Actions on" and is lit', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: true } }]);
  await fakeSwitches(page, read(true, true));
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText('GM Actions on');
  await expect(button).toHaveClass(/\bon\b/);
  await expect(button).toHaveAttribute('data-gm-actions', 'on');
});

test('a switch that is off is named, and the list turns everything on', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  const posts = await fakeSwitches(page, read(false, false));
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText('GM Actions off: Turn on');
  await expect(button).toHaveAttribute('data-gm-actions', 'off');
  await expect(button).toHaveAttribute('title', /^GM Actions and Handouts are off./);
  await button.click();
  const switches = page.getByRole('list', { name: 'GM Actions switches' });
  await expect(switches.getByRole('listitem')).toHaveCount(4);
  await expect(switches.locator('[data-switch="handouts"]')).toHaveAttribute('data-on', 'false');
  await page.getByRole('button', { name: 'Turn on', exact: true }).click();
  await expect(button).toHaveText('GM Actions on');
  await expect(button).toHaveAttribute('data-gm-actions', 'on');
  expect(posts).toEqual([{ action: 'ready' }]);
});

test('GM Actions off alone is named too', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  await fakeSwitches(page, read(true, false));
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await expect(page.locator('#btn-gm')).toHaveText('GM Actions off: Turn on');
  await expect(page.locator('#btn-gm')).toHaveAttribute('title', /^GM Actions is off./);
  await expect(page.locator('#btn-gm')).toHaveAttribute('data-gm-actions', 'off');
});

test('switches that could not be read do not read "on"', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: true } }]);
  // What the route answers when the bridge is away: 200 with no switches and the reason.
  await page.route('**/api/session/switches', route =>
    route.fulfill({
      json: { switches: null, gmActionsEnabled: true, error: 'The bridge is away' },
    })
  );
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const button = page.locator('#btn-gm');
  await expect(button).toHaveText("GM Actions: can't read");
  await expect(button).not.toHaveClass(/\bon\b/);
  await expect(button).toHaveAttribute('data-gm-actions', 'on');
});

test('unreadable switches still say when GM Actions is off', async ({ page }) => {
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  await page.route('**/api/session/switches', route =>
    route.fulfill({ status: 502, json: { error: 'The bridge is away' } })
  );
  await page.goto(`/next/?token=${GM_TOKEN}`);

  await expect(page.locator('#btn-gm')).toHaveText('GM Actions off: Turn on');
  await expect(page.locator('#btn-gm')).toHaveAttribute('title', /^GM Actions is off./);
  await expect(page.locator('#btn-gm')).toHaveAttribute('data-gm-actions', 'off');
});
