// Player links (I-096) on the React dashboard: list, make, copy, replace, remove, and the error
// paths, against a fake of the /api/player-links routes (me-route.ts) in the browser.
import { expect, test, type Locator, type Page, type Request } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, toast } from './support';

interface FakePlayer {
  userId: string;
  name: string;
  link: string | null;
  createdAt: number | null;
}

/** An in-memory /api/player-links; records every request it answers. */
async function fakePlayerLinks(
  page: Page,
  players: FakePlayer[],
  options: { failList?: string; failWrite?: string } = {}
): Promise<Request[]> {
  const seen: Request[] = [];
  let nextKey = 1;
  await page.route('**/api/player-links**', async route => {
    const req = route.request();
    seen.push(req);
    const userId = decodeURIComponent(new URL(req.url()).pathname.split('/')[3] ?? '');
    if (req.method() === 'GET') {
      if (options.failList) {
        await route.fulfill({ status: 502, json: { error: options.failList } });
        return;
      }
      await route.fulfill({ json: { players } });
      return;
    }
    if (options.failWrite) {
      await route.fulfill({ status: 400, json: { error: options.failWrite } });
      return;
    }
    const player = players.find(p => p.userId === userId);
    if (!player) {
      await route.fulfill({ status: 400, json: { error: 'Not a player of this world.' } });
      return;
    }
    if (req.method() === 'POST') {
      player.link = `/me?k=key${nextKey++}`;
      player.createdAt = Date.UTC(2026, 9, 8);
      await route.fulfill({ json: { userId, link: player.link, createdAt: player.createdAt } });
    } else {
      const removed = player.link !== null;
      player.link = null;
      player.createdAt = null;
      await route.fulfill({ json: { removed } });
    }
  });
  return seen;
}

const twoPlayers = (): FakePlayer[] => [
  {
    userId: 'aaaaaaaaaaaaaaaa',
    name: 'Ireena',
    link: '/me?k=old',
    createdAt: Date.UTC(2026, 9, 1),
  },
  { userId: 'bbbbbbbbbbbbbbbb', name: 'Ismark', link: null, createdAt: null },
];

async function openLinks(page: Page): Promise<void> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.getByRole('button', { name: '🔗 Player links' }).click();
  await expect(page.getByRole('dialog', { name: 'Player links' })).toBeVisible();
}

const row = (page: Page, name: string): Locator =>
  page
    .getByRole('dialog', { name: 'Player links' })
    .getByRole('listitem')
    .filter({ hasText: name });

test.beforeEach(async ({ page, context }) => {
  await context.grantPermissions(['clipboard-read', 'clipboard-write']);
  await fakeCommonRoutes(page);
});

test('the page loads on /next/ with the old look and keeps the token out of the address bar', async ({
  page,
}) => {
  const styles = page.waitForResponse(res => res.url().endsWith('/styles.css'));
  await page.goto(`/next/?token=${GM_TOKEN}`);
  expect((await styles).status()).toBe(200);
  await expect(page.getByRole('heading', { level: 1 })).toHaveText('Foundry AI Tool');
  await expect(page).toHaveURL(/\/next\/$/);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'veil');
  // The topbar is styled by the old styles.css (a flex row), not left as plain blocks.
  await expect(page.locator('header.topbar')).toHaveCSS('display', 'flex');
});

test('lists the players with their link state, sending the GM token', async ({ page }) => {
  const seen = await fakePlayerLinks(page, twoPlayers());
  await openLinks(page);

  await expect(row(page, 'Ireena')).toContainText('link made');
  await expect(row(page, 'Ireena').getByRole('button')).toHaveText([
    'Copy link',
    'New link',
    'Remove',
  ]);
  await expect(row(page, 'Ismark')).toContainText('no link');
  await expect(row(page, 'Ismark').getByRole('button')).toHaveText(['Make link']);
  expect(seen[0]?.headers()['x-cogm-token']).toBe(GM_TOKEN);
});

test('Make link makes one, copies it and updates the row', async ({ page }) => {
  const seen = await fakePlayerLinks(page, twoPlayers());
  await openLinks(page);

  await row(page, 'Ismark').getByRole('button', { name: 'Make link' }).click();
  await expect(toast(page, '✓ Link copied. Send it to that player only.')).toBeVisible();
  await expect(row(page, 'Ismark').getByRole('button', { name: 'Copy link' })).toBeVisible();
  const post = seen.find(r => r.method() === 'POST');
  expect(post?.url()).toContain('/api/player-links/bbbbbbbbbbbbbbbb');
  expect(post?.headers()['x-cogm-token']).toBe(GM_TOKEN);
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(
    /^http:\/\/127\.0\.0\.1:\d+\/me\?k=key1$/
  );
});

test('Copy link and New link copy the full address', async ({ page }) => {
  await fakePlayerLinks(page, twoPlayers());
  await openLinks(page);

  await row(page, 'Ireena').getByRole('button', { name: 'Copy link' }).click();
  await expect(toast(page, '✓ Link copied. Send it to that player only.')).toBeVisible();
  expect(await page.evaluate(() => navigator.clipboard.readText())).toMatch(/\/me\?k=old$/);

  await row(page, 'Ireena').getByRole('button', { name: 'New link' }).click();
  await expect
    .poll(() => page.evaluate(() => navigator.clipboard.readText()))
    .toMatch(/\/me\?k=key1$/);
});

test('Remove turns the link off', async ({ page }) => {
  const seen = await fakePlayerLinks(page, twoPlayers());
  await openLinks(page);

  await row(page, 'Ireena').getByRole('button', { name: 'Remove' }).click();
  await expect(toast(page, '✓ Link removed. It no longer opens anything.')).toBeVisible();
  await expect(row(page, 'Ireena')).toContainText('no link');
  expect(seen.some(r => r.method() === 'DELETE' && r.url().endsWith('/aaaaaaaaaaaaaaaa'))).toBe(
    true
  );
});

test('a world without players says so', async ({ page }) => {
  await fakePlayerLinks(page, []);
  await openLinks(page);
  await expect(page.getByText('No players yet.', { exact: false })).toBeVisible();
});

test('a failed list shows the server message', async ({ page }) => {
  await fakePlayerLinks(page, [], { failList: 'The bridge is not connected.' });
  await openLinks(page);
  await expect(
    page.getByText('Could not load the player links: The bridge is not connected.')
  ).toBeVisible();
});

test('a failed write shows an error toast', async ({ page }) => {
  await fakePlayerLinks(page, twoPlayers(), { failWrite: 'Not a player of this world.' });
  await openLinks(page);
  await row(page, 'Ismark').getByRole('button', { name: 'Make link' }).click();
  await expect(toast(page, '✗ Not a player of this world.')).toBeVisible();
});

test('the panel closes with ✕, with Escape and with its header button', async ({ page }) => {
  await fakePlayerLinks(page, twoPlayers());
  const dialog = page.getByRole('dialog', { name: 'Player links' });

  await openLinks(page);
  await page.getByRole('button', { name: 'Close player links' }).click();
  await expect(dialog).toBeHidden();

  await openLinks(page);
  await page.keyboard.press('Escape');
  await expect(dialog).toBeHidden();

  await openLinks(page);
  await page.getByRole('button', { name: '🔗 Player links' }).click();
  await expect(dialog).toBeHidden();
});
