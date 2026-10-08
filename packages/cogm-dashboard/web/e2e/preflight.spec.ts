// The Pre-flight drawer on the React dashboard: the tool's checks (/api/preflight, faked here
// except in the last test), the summary and header verdict, the findings, the hand checklist in
// localStorage, the quiet run when Foundry comes back, and how the drawer closes.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream } from './support';

const CHECKS = [
  {
    id: 'versions',
    label: 'Versions match',
    status: 'ok',
    detail: 'Bridge 0.21.0, module 0.21.0.',
  },
  { id: 'scene', label: 'Starting scene', status: 'fail', detail: 'No scene is active.' },
  { id: 'ready', label: 'Ready for session', status: 'warn', detail: 'Some switches are off.' },
  { id: 'odd', label: 'A new check', status: 'later', detail: 'Status this page does not know.' },
];

const SCAN = {
  settings: [{ setting: 'core.worldTitle', masked: 'shown', reason: 'names Ravenloft' }],
  names: [{ kind: 'Actor', name: 'Strahd', terms: ['Strahd', 'vampire'] }],
  modules: [{ title: 'Spoiler Module', reason: 'shows hidden tokens' }],
};

async function fakePreflight(page: Page, body: unknown, status = 200): Promise<() => number> {
  let calls = 0;
  await page.route('**/api/preflight', route => {
    calls += 1;
    return route.fulfill({ status, json: body });
  });
  return () => calls;
}

const header = (page: Page): Locator => page.locator('#btn-preflight');

async function openPreflight(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await header(page).click();
  const drawer = page.getByRole('dialog', { name: '✈ Pre-flight' });
  await expect(drawer).toBeVisible();
  return drawer;
}

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
});

test('runs the checks on open and shows the verdict', async ({ page }) => {
  await fakeStream(page, []);
  await fakePreflight(page, { ready: false, checks: CHECKS, scan: SCAN });
  const drawer = await openPreflight(page);

  await expect(drawer.getByRole('status')).toHaveText('Not ready: 1 to fix, 1 to look at.');
  await expect(drawer.getByRole('status')).toHaveClass(/pf-fail/);
  await expect(drawer.locator('.drawer-sub')).toHaveText(/^GM only\. Last run \d\d:\d\d\.$/);

  const items = drawer.getByRole('list', { name: 'Checked by the tool' }).getByRole('listitem');
  await expect(items.locator('.pf-label')).toHaveText([
    'Versions match',
    'Starting scene',
    'Ready for session',
    'A new check',
  ]);
  await expect(items.locator('.pf-icon')).toHaveText(['✓', '✗', '!', '?']);
  await expect(items.nth(1)).toHaveClass(/pf-fail/);
  await expect(items.nth(3)).toHaveClass(/pf-unknown/);
  await expect(items.nth(1).locator('.pf-detail')).toHaveText('No scene is active.');

  await expect(header(page)).toHaveText('✈ Pre-flight: 1 to fix');
  await expect(header(page)).toHaveClass(/preflight-bad/);
  await expect(page.locator('#version-banner')).toHaveCount(0);
});

test('all clear says so, in the drawer and on the header button', async ({ page }) => {
  await fakeStream(page, []);
  await fakePreflight(page, { ready: true, checks: [CHECKS[0]], scan: null });
  const drawer = await openPreflight(page);
  await expect(drawer.getByRole('status')).toHaveText('Ready for the session.');
  await expect(drawer.getByRole('status')).toHaveClass(/pf-ok/);
  await expect(header(page)).toHaveText('✈ Pre-flight: ready');
  await expect(drawer.locator('.preflight-findings')).toHaveCount(0);
});

test('the findings fold away and stay open across a new run', async ({ page }) => {
  await fakeStream(page, []);
  const calls = await fakePreflight(page, { ready: false, checks: CHECKS, scan: SCAN });
  const drawer = await openPreflight(page);

  const findings = drawer.locator('details.preflight-findings');
  await findings.getByText('3 finding(s)').click();
  await expect(findings.getByRole('listitem')).toHaveText([
    'core.worldTitle shown: names Ravenloft',
    'Actor "Strahd" names Strahd, vampire',
    'Spoiler Module: shows hidden tokens',
  ]);
  await expect(findings.locator('code')).toHaveText('core.worldTitle');

  await drawer.getByRole('button', { name: '↻ Run checks' }).click();
  await expect.poll(calls).toBe(2);
  await expect(findings).toHaveAttribute('open', '');
});

test('a failed run shows the server message', async ({ page }) => {
  await fakeStream(page, []);
  await fakePreflight(page, { error: 'The bridge is not connected.' }, 500);
  const drawer = await openPreflight(page);
  await expect(
    drawer.getByText("Couldn't run the checks: The bridge is not connected.")
  ).toBeVisible();
  await expect(drawer.locator('.drawer-sub')).toHaveText('GM only. The checks did not run.');
  await expect(header(page)).toHaveText('✈ Pre-flight');
});

test('the versions check failing raises the page banner', async ({ page }) => {
  await fakeStream(page, []);
  const versions = { ...CHECKS[0], status: 'fail', detail: 'The module is 0.20.0; update it.' };
  await fakePreflight(page, { ready: false, checks: [versions], scan: null });
  await openPreflight(page);
  await expect(page.getByRole('alert')).toHaveText('The module is 0.20.0; update it.');
});

test('the hand checklist stays ticked in this browser until Clear ticks', async ({ page }) => {
  await fakeStream(page, []);
  await fakePreflight(page, { ready: true, checks: [], scan: null });
  let drawer = await openPreflight(page);

  const manual = drawer.getByRole('list', { name: 'Check by hand' }).getByRole('checkbox');
  await expect(manual).toHaveCount(8);
  await drawer.getByLabel('Tokens the players should not know about yet are hidden.').check();
  await drawer.getByLabel("Read last session's note in Obsidian.").check();

  // The old page reads the same key, so ticks carry over between the two.
  const stored = await page.evaluate(() => localStorage.getItem('cogm_preflight_ticks'));
  expect(Object.keys(JSON.parse(stored ?? '{}') as object).sort()).toEqual([
    'hidden-tokens',
    'last-note',
  ]);

  drawer = await openPreflight(page);
  await expect(
    drawer.getByLabel('Tokens the players should not know about yet are hidden.')
  ).toBeChecked();
  await drawer.getByRole('button', { name: 'Clear ticks' }).click();
  for (const box of await manual.all()) await expect(box).not.toBeChecked();
  expect(await page.evaluate(() => localStorage.getItem('cogm_preflight_ticks'))).toBe('{}');
});

test('runs quietly when Foundry becomes reachable, before the drawer opens', async ({ page }) => {
  const status = {
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  };
  await fakeStream(page, [{ event: 'status', data: status }]);
  const calls = await fakePreflight(page, { ready: false, checks: CHECKS, scan: null });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(header(page)).toHaveText('✈ Pre-flight: 1 to fix');
  expect(calls()).toBe(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('the drawer closes with ✕, Escape, the backdrop and its header button', async ({ page }) => {
  await fakeStream(page, []);
  await fakePreflight(page, { ready: true, checks: [], scan: null });
  const drawer = await openPreflight(page);

  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();

  await header(page).click();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();

  await header(page).click();
  await page.locator('.drawer-backdrop').click({ position: { x: 20, y: 400 } });
  await expect(drawer).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);

  await header(page).click();
  await expect(drawer).toBeVisible();
  // The backdrop covers the header while a drawer is open, as on the old page.
  await expect(page.locator('.drawer-backdrop')).toBeVisible();
});

test('the real route answers with the bridge down', async ({ page }) => {
  // Nothing faked but the stream: the dashboard's own /api/preflight with no bridge.
  await fakeStream(page, []);
  const drawer = await openPreflight(page);
  await expect(drawer.locator('.pf-detail').first()).toContainText('The bridge did not answer');
});
