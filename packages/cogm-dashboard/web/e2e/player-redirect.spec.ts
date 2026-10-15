// A player who opens the GM page lands on the read-only player view (lib/role.ts for the new
// dashboard, the same check in public/app.js for the old page at the root). The test server runs
// with a GM token and no player token, so any other token is a player to the real server: no
// faked /api/state here.
import { expect, test } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes } from './support';

const PLAYER_TOKEN = 'e2e-player-token';

const PAGES = [
  ['the new dashboard', '/next/'],
  ['the old page at the root', '/'],
] as const;

for (const [name, path] of PAGES) {
  test(`a player on ${name} lands on the player view, token copied to its key`, async ({
    page,
  }) => {
    await fakeCommonRoutes(page);
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

  test(`the GM stays on ${name}`, async ({ page }) => {
    await fakeCommonRoutes(page);
    const state = page.waitForResponse('**/api/state');
    await page.goto(`${path}?token=${GM_TOKEN}`);
    expect(((await (await state).json()) as { role: string }).role).toBe('gm');

    // The redirect would follow the answer at once; give it a moment to have happened.
    await page.waitForTimeout(400);
    expect(new URL(page.url()).pathname).toBe(path);
    expect(await page.evaluate(() => localStorage.getItem('cogm_token'))).toBe(GM_TOKEN);
  });
}
