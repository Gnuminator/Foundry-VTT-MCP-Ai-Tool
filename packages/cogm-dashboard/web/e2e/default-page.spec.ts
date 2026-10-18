// The React dashboard is the page at / (D-126): the old page is at /legacy/, the old /next/ name
// redirects, a saved link with ?token= still signs in, and the plan link of the Obsidian plugin
// (/?plan=<planId>) opens the plan's confirm window once GM Actions are on.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok, toast } from './support';

const gmActions = (on: boolean): { event: string; data: unknown }[] => [
  { event: 'settings', data: { gmActionsEnabled: on } },
];

async function fakeBridge(page: Page): ReturnType<typeof fakeTools> {
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({
      json: { switches: { switches: [] }, gmActionsEnabled: true, error: null },
    })
  );
  return fakeTools(page, call => {
    if (call.name === 'get-planned-change') {
      return ok({
        planId: 'plan-abc-1',
        risk: 'write',
        summary: 'Reveal "Letter from the harbormaster"',
        diff: [{ text: 'Reveal the page to every player' }],
      });
    }
    if (call.name === 'apply-planned-change') return ok({ summary: 'Revealed the letter' });
    return ok({});
  });
}

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
});

test('/ is the React dashboard', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeBridge(page);
  await page.goto(`/?token=${GM_TOKEN}`);
  await expect(page.getByRole('tablist', { name: 'Moment of the evening' })).toBeVisible();
  // The header button and the banner's link.
  const links = await page.getByRole('link', { name: 'Old dashboard' }).all();
  expect(links.length).toBeGreaterThan(0);
  for (const link of links) {
    await expect(link).toHaveAttribute('href', '/legacy/');
  }
  await expect(
    page.locator('header .controls').getByRole('link', { name: 'Old dashboard' })
  ).toHaveCount(1);
  // The preview wording is gone.
  await expect(page.getByText('New dashboard (preview)')).toHaveCount(0);
  await expect(page.getByText('still being built')).toHaveCount(0);
});

test('/legacy/ is the old page, and the old name /next/ goes to /', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeBridge(page);
  await page.goto(`/legacy/?token=${GM_TOKEN}`);
  await expect(page.locator('#moments')).toBeVisible();
  await expect(page.locator('#btn-session')).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/legacy/');

  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.getByRole('tablist', { name: 'Moment of the evening' })).toBeVisible();
  expect(new URL(page.url()).pathname).toBe('/');
});

test('the plan link asks for the plan once GM Actions are on, and drops the address', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeBridge(page);
  await page.goto(`/?token=${GM_TOKEN}&plan=plan-abc-1`);
  // A write plan opens the confirm window with what it changes.
  const dialog = page.getByRole('dialog', { name: 'Confirm action' });
  await expect(dialog.getByText('Reveal "Letter from the harbormaster"')).toBeVisible();
  await expect(dialog.getByText('Reveal the page to every player')).toBeVisible();
  expect(calls.filter(c => c.name === 'apply-planned-change')).toHaveLength(0);
  await dialog.getByRole('button', { name: 'Confirm' }).click();
  await expect(toast(page, '✓ Applied: Revealed the letter')).toBeVisible();
  expect(calls.find(c => c.name === 'apply-planned-change')).toMatchObject({
    args: { planId: 'plan-abc-1' },
    confirm: true,
  });
  expect(new URL(page.url()).search).toBe('');
});

test('the plan link waits, and says so once, while GM Actions are off', async ({ page }) => {
  await fakeStream(page, gmActions(false));
  const calls = await fakeBridge(page);
  await page.goto(`/?token=${GM_TOKEN}&plan=plan-abc-1`);
  await expect(
    toast(page, 'A plan from Obsidian is waiting: turn on GM Actions to review it.')
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: 'Confirm action' })).toHaveCount(0);
  expect(calls.filter(c => c.name === 'apply-planned-change')).toHaveLength(0);
});

test('a plan link that is not a plan id is ignored', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeBridge(page);
  await page.goto(`/?token=${GM_TOKEN}&plan=../../etc`);
  await expect(page.getByRole('tablist', { name: 'Moment of the evening' })).toBeVisible();
  await page.waitForTimeout(300);
  expect(
    calls.filter(c => c.name === 'get-planned-change' || c.name === 'apply-planned-change')
  ).toHaveLength(0);
});
