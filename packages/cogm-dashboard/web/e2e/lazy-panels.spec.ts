// The panels that load from their own chunk (LazyPanel.tsx): a drawer opened before its chunk
// arrived shows a loading drawer instead of a bare backdrop, and a chunk that fails to load
// closes the drawer again with a toast. The chunk request is held or refused in the browser.
import { expect, test, type Page, type Route } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, fromMenu, ok, toast } from './support';

/** The Tool runner's chunk (Vite names it Tools-<hash>.js). */
const TOOLS_CHUNK = '**/assets/Tools-*.js';

async function fakeWorld(page: Page): Promise<void> {
  await page.route('**/api/tools', route => route.fulfill({ json: { tools: [] } }));
  await fakeTools(page, () => ok({}));
}

test('a drawer opened before its chunk arrived shows a loading drawer, then the panel', async ({
  page,
}) => {
  await fakeWorld(page);
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => (release = resolve));
  await page.route(TOOLS_CHUNK, async (route: Route) => {
    await held;
    await route.fallback();
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await fromMenu(page, 'btn-tools');

  const loading = page.locator('#tools-drawer');
  await expect(loading).toBeVisible();
  await expect(loading).toContainText('Tool Runner');
  await expect(loading.locator('[data-ui-state="loading"]')).toBeVisible();
  await expect(page.locator('.drawer-backdrop')).toBeVisible();

  release();
  const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
  await expect(drawer.locator('#tool-list')).toBeVisible();
  await expect(drawer.locator('[data-ui-state="loading"]')).toHaveCount(0);
  await expect(page.locator('#tools-drawer')).toHaveCount(1);
});

test('a chunk that fails to load tells the GM and closes the drawer and its backdrop', async ({
  page,
}) => {
  await fakeWorld(page);
  await page.route(TOOLS_CHUNK, route => route.abort('failed'));
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await fromMenu(page, 'btn-tools');

  await expect(
    toast(page, '✗ Could not load part of the page. Reload the page to try again.')
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: '🛠 Tool Runner' })).toHaveCount(0);
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});

test('a later click after a failed chunk shows the error in the loading drawer, no second toast', async ({
  page,
}) => {
  await fakeWorld(page);
  await page.route(TOOLS_CHUNK, route => route.abort('failed'));
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await fromMenu(page, 'btn-tools');
  await expect(
    toast(page, '✗ Could not load part of the page. Reload the page to try again.')
  ).toBeVisible();
  await expect(page.locator('#tools-drawer')).toHaveCount(0);

  await fromMenu(page, 'btn-tools');
  const failed = page.locator('#tools-drawer');
  await expect(failed).toBeVisible();
  await expect(failed.locator('[data-ui-state="error"]')).toContainText('Reload the page');
  await expect(
    toast(page, '✗ Could not load part of the page. Reload the page to try again.')
  ).toHaveCount(1);

  await page.keyboard.press('Escape');
  await expect(page.locator('#tools-drawer')).toHaveCount(0);
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});

test('Escape closes the loading drawer while the chunk is still on its way', async ({ page }) => {
  await fakeWorld(page);
  await page.route(TOOLS_CHUNK, () => new Promise<void>(() => undefined));
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await fromMenu(page, 'btn-tools');
  await expect(page.locator('#tools-drawer [data-ui-state="loading"]')).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(page.locator('#tools-drawer')).toHaveCount(0);
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});

test('a docked loading panel with the focus hands it to the real panel', async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await fakeTools(
    page,
    call => {
      if (call.name === 'get-play-session') {
        return ok({
          success: true,
          worldId: 'w',
          startedAt: null,
          lastEventAt: null,
          open: false,
          endedAt: null,
        });
      }
      if (call.name === 'get-prep-digest') {
        return ok({
          action: 'summary',
          computedAt: 0,
          lastSession: null,
          preflight: { fail: 0, warn: 0, items: [] },
          warnings: [],
        });
      }
      return ok({});
    },
    { playSession: true }
  );
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => (release = resolve));
  await page.route('**/assets/Prep-*.js', async (route: Route) => {
    await held;
    await route.fallback();
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);

  const shell = page.locator('#prep-drawer');
  await expect(shell.locator('[data-ui-state="loading"]')).toBeVisible();
  await shell.focus();
  await expect(shell).toBeFocused();

  release();
  await expect(page.locator('#prep-drawer [data-ui-state="loading"]')).toHaveCount(0);
  await expect(page.locator('#prep-drawer')).toBeFocused();
});
