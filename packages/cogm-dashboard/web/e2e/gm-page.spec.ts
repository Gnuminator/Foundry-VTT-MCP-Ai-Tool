// The GM page (item gm-page-wrapper) at /gm: Foundry in one pane, the live strip in the other. A
// stand-in page plays Foundry (page.route on a made-up host): it posts the map pick up to its
// parent like the module does, or refuses to be framed. Nothing here needs a world.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, ok } from './support';

const FOUNDRY = 'http://foundry.test:30000';
const NL = String.fromCharCode(10);

const FIGHT = [
  ['b', 'Brannoc', true],
  ['g1', 'Goblin', false],
  ['g2', 'Goblin', false],
].map(([id, name, isPC], i) => ({
  id,
  name,
  initiative: 19 - i,
  isCurrentTurn: i === 0,
  hp: { value: 20, max: 20, temp: 0 },
  conditions: [],
  isPC,
  category: isPC ? 'pc' : 'enemy',
  defeated: false,
  deathSaves: null,
  tokenId: `tk-${id}`,
}));

async function setup(
  page: Page,
  info: { status?: number; json: unknown } = {
    json: { foundryUrl: FOUNDRY, foundryOrigin: FOUNDRY },
  }
): Promise<void> {
  await page.setViewportSize({ width: 1700, height: 900 });
  await fakeCommonRoutes(page);
  await fakeTools(page, () => ok({}), { playSession: true });
  await page.route('**/api/gm-page', route => route.fulfill(info));
  await page.route('**/api/stream**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: [
        'retry: 600000',
        '',
        'event: settings',
        `data: ${JSON.stringify({ gmActionsEnabled: true })}`,
        '',
        'event: combat',
        `data: ${JSON.stringify({
          combat: { active: true, round: 1, turn: 0, current: FIGHT[0], combatants: FIGHT },
        })}`,
        '',
        '',
      ].join(NL),
    })
  );
}

/** A Foundry stand-in that posts a pick to its parent now and whenever the parent says ready. */
async function fakeFoundry(page: Page, tokenIds: string[]): Promise<void> {
  await page.route(`${FOUNDRY}/**`, route =>
    route.fulfill({
      contentType: 'text/html',
      body:
        '<!doctype html><title>Foundry</title><body style="background:#222;color:#eee">Foundry' +
        `<script>const send=()=>parent.postMessage({type:'fmb-live-pick',tokenIds:${JSON.stringify(tokenIds)}},'*');` +
        "addEventListener('message',e=>{if(e.data&&e.data.type==='fmb-live-ready')send()});send();</script></body>",
    })
  );
}

const load = (page: Page): Promise<unknown> => page.goto(`/gm?token=${GM_TOKEN}`);
const goblin = (page: Page): ReturnType<Page['getByRole']> =>
  page.getByRole('button', { name: 'Goblin 1', exact: true });

test('shows Foundry in a frame and the strip beside it, and a map pick picks in the strip', async ({
  page,
}) => {
  await setup(page);
  await fakeFoundry(page, ['tk-g1']);
  await load(page);
  await expect(page.locator('iframe[title="Foundry"]')).toHaveAttribute('src', FOUNDRY);
  await expect(page.locator('#live-strip')).toBeVisible();
  await expect(goblin(page)).toHaveAttribute('aria-pressed', 'true');
  await expect(page.locator('#live-pick')).toContainText('Goblin 1');
});

test('a message that is not from the Foundry frame picks nothing', async ({ page }) => {
  await setup(page);
  await page.route(`${FOUNDRY}/**`, route =>
    route.fulfill({ contentType: 'text/html', body: 'Foundry' })
  );
  await load(page);
  await expect(page.locator('#live-strip')).toBeVisible();
  await page.evaluate(() =>
    window.postMessage({ type: 'fmb-live-pick', tokenIds: ['tk-g1'] }, '*')
  );
  await page.waitForTimeout(300);
  await expect(goblin(page)).toHaveAttribute('aria-pressed', 'false');
});

test('says plainly when Foundry refuses to be framed, with a way to open its own tab', async ({
  page,
}) => {
  await page.clock.install();
  await setup(page);
  await page.route(`${FOUNDRY}/**`, route =>
    route.fulfill({
      contentType: 'text/html',
      headers: { 'X-Frame-Options': 'DENY' },
      body: 'Foundry',
    })
  );
  await load(page);
  await expect(page.locator('#live-strip')).toBeVisible();
  const banner = page.getByText('Foundry is not showing here');
  await expect(banner).toHaveCount(0);
  await page.clock.fastForward(9000);
  await expect(banner).toBeVisible();
  await expect(page.getByRole('button', { name: 'Open Foundry in its own tab' })).toBeVisible();
  await page.getByRole('button', { name: 'Hide' }).click();
  await expect(banner).toHaveCount(0);
});

test('keeps the layout per browser: strip left, and a divider the keyboard can move', async ({
  page,
}) => {
  await setup(page);
  await fakeFoundry(page, []);
  await load(page);
  const divider = page.getByRole('separator', { name: 'Resize the live strip' });
  await expect(divider).toHaveAttribute('aria-valuenow', '420');
  await divider.focus();
  await page.keyboard.press('ArrowLeft');
  await expect(divider).toHaveAttribute('aria-valuenow', '436');
  await page.keyboard.press('Shift+ArrowRight');
  await expect(divider).toHaveAttribute('aria-valuenow', '372');
  await page.keyboard.press('Enter');
  await expect(divider).toHaveAttribute('aria-valuenow', '420');
  await page.keyboard.press('Home');
  await expect(divider).toHaveAttribute('aria-valuenow', '320');

  await page.getByRole('button', { name: 'Strip left' }).click();
  await page.reload();
  await expect(page.getByRole('button', { name: 'Strip left' })).toHaveAttribute(
    'aria-pressed',
    'true'
  );
  const strip = await page.locator('aside[aria-label="Live strip"]').boundingBox();
  const frame = await page.locator('iframe[title="Foundry"]').boundingBox();
  expect(strip!.x).toBeLessThan(frame!.x);
  expect(strip!.width).toBe(320);
});

test('Foundry alone leaves the strip out and offers its own window', async ({ page }) => {
  await setup(page);
  await fakeFoundry(page, []);
  await load(page);
  await page.getByRole('button', { name: 'Foundry alone' }).click();
  await expect(page.locator('#live-strip')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open the strip window' })).toBeVisible();
});

test('a narrow window shows the strip alone and loads no Foundry frame', async ({ page }) => {
  await setup(page);
  await page.setViewportSize({ width: 390, height: 800 });
  await load(page);
  await expect(page.locator('#live-strip')).toBeVisible();
  await expect(page.locator('iframe')).toHaveCount(0);
  await expect(page.getByRole('button', { name: 'Open Foundry in its own tab' })).toBeVisible();
});

test('is for the GM: a player is sent to the player view, and a missing address is said', async ({
  page,
}) => {
  await setup(page, {
    status: 403,
    json: { code: 'gm-required', error: 'GM access is required.' },
  });
  await load(page);
  await expect(page.getByRole('alert')).toContainText('This page is for the GM');
  await expect(page.getByRole('link', { name: 'Open the player view' })).toHaveAttribute(
    'href',
    '/player'
  );

  await setup(page, { json: { foundryUrl: null, foundryOrigin: null } });
  await load(page);
  await expect(page.getByRole('alert')).toContainText('Set the Foundry address first');
});
