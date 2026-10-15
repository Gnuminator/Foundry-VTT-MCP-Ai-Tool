// A player who opens the GM page lands on the read-only player view (lib/role.ts for the new
// dashboard, the same check in public/app.js for the old page at the root). The test server runs
// with a GM token and no player token: a visitor without a token is a player to the real server
// (as a Cloudflare Access player is), and any other token is unknown to it (a GM's stale link).
// Only the deployment that asks for a player token is faked, on /api/state.
import { expect, test } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes } from './support';

const PLAYER_TOKEN = 'e2e-player-token';

const PAGES = [
  ['the new dashboard', '/next/'],
  ['the old page at the root', '/'],
] as const;

/** Waits for the page's /api/state answer, then long enough for a redirect to have happened. */
async function settled(page: import('@playwright/test').Page, path: string): Promise<unknown> {
  const state = page.waitForResponse('**/api/state');
  await page.goto(path);
  const body: unknown = await (await state).json();
  await page.waitForTimeout(400);
  return body;
}

for (const [name, path] of PAGES) {
  test(`a player without a token on ${name} lands on the player view`, async ({ page }) => {
    await fakeCommonRoutes(page);
    await page.goto(path);

    await expect(page).toHaveURL(/\/player$/);
  });

  test(`a player token on ${name} goes along to the player view`, async ({ page }) => {
    await fakeCommonRoutes(page);
    // A deployment that asks for a player token: the server knows this one as a player's.
    await page.route('**/api/state', route => route.fulfill({ json: { role: 'player' } }));
    await page.goto(`${path}?token=${PLAYER_TOKEN}`);

    await expect(page).toHaveURL(/\/player$/);
    const keys = await page.evaluate(() => ({
      gm: localStorage.getItem('cogm_token'),
      player: localStorage.getItem('cogm_player_token'),
    }));
    // Kept on the GM key too, so the next visit sends the player on again.
    expect(keys).toEqual({ gm: PLAYER_TOKEN, player: PLAYER_TOKEN });
  });

  test(`a turned-away visitor with only a player token on ${name} lands on the player view`, async ({
    page,
  }) => {
    await fakeCommonRoutes(page);
    // A deployment that asks for a player token turns a visitor without one away here.
    await page.route('**/api/state', route =>
      route.fulfill({ status: 401, json: { error: 'Unauthorized' } })
    );
    await page.addInitScript(
      token => localStorage.setItem('cogm_player_token', token),
      PLAYER_TOKEN
    );
    await page.goto(path);

    await expect(page).toHaveURL(/\/player$/);
  });

  test(`a stale GM token on ${name} stays on the GM page`, async ({ page }) => {
    await fakeCommonRoutes(page);
    const body = (await settled(page, `${path}?token=stale-gm-token`)) as Record<string, unknown>;

    expect(body).toMatchObject({ role: 'player', unknownToken: true });
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await page.evaluate(() => localStorage.getItem('cogm_player_token'))).toBeNull();
  });

  test(`the GM stays on ${name}`, async ({ page }) => {
    await fakeCommonRoutes(page);
    const body = (await settled(page, `${path}?token=${GM_TOKEN}`)) as Record<string, unknown>;

    expect(body.role).toBe('gm');
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await page.evaluate(() => localStorage.getItem('cogm_token'))).toBe(GM_TOKEN);
  });
}
