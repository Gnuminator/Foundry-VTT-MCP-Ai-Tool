// The Before / During / After views on the React dashboard: the moment from the play session
// (get-play-session, faked here), the tab pin and when it clears, the panels docked in each
// moment, docked panels outside the Escape order and without a close button, the header and menu
// buttons on a docked panel, the focus after a moment change, and the one-column narrow screen.
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  GM_TOKEN,
  fakeCommonRoutes,
  fakeStream,
  fakeTools,
  fromMenu,
  ok,
  type ToolCall,
} from './support';

const HOUR = 60 * 60 * 1000;
const NOW = new Date(2026, 9, 10, 20, 0).getTime();

interface Session {
  open: boolean;
  endedAt: string | null;
}

/** The bridge as the views need it; `session()` answers get-play-session at each poll. */
async function fakeBridge(page: Page, session: () => Session): Promise<ToolCall[]> {
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({
      json: {
        switches: { switches: [], ready: null, changed: [], failed: [] },
        gmActionsEnabled: false,
        error: null,
      },
    })
  );
  await page.route('**/api/player/names', route => route.fulfill({ json: [] }));
  return fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'get-play-session':
          return ok({
            success: true,
            worldId: 'w',
            startedAt: null,
            lastEventAt: null,
            ...session(),
          });
        case 'get-prep-digest':
          return ok({
            action: 'summary',
            computedAt: NOW,
            lastSession: null,
            preflight: { fail: 0, warn: 0, items: [] },
            warnings: [],
          });
        case 'get-party':
          return ok({ groups: [], paceOptions: [], scene: null, encounter: null, warnings: [] });
        case 'list-revealed-pages':
          return ok({ pages: [], queue: [] });
        case 'list-scenes':
          return ok([]);
        case 'mark-play-session':
          return ok({ success: true });
        default:
          return ok({});
      }
    },
    { playSession: true }
  );
}

const closed = (endedAgo: number | null = null): Session => ({
  open: false,
  endedAt: endedAgo === null ? null : new Date(NOW - endedAgo).toISOString(),
});
const OPEN: Session = { open: true, endedAt: null };

const count = (calls: ToolCall[], name: string): number =>
  calls.filter(c => c.name === name).length;

const tab = (page: Page, name: string): Locator => page.getByRole('tab', { name });
const view = (page: Page, moment: string): Locator => page.locator(`#moment-${moment}`);
const docked = (page: Page, name: string): Locator => page.getByRole('region', { name });

async function load(page: Page): Promise<void> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
}

/** The next poll of get-play-session (each minute). */
async function nextPoll(page: Page, calls: ToolCall[]): Promise<void> {
  const before = count(calls, 'get-play-session');
  await page.clock.fastForward(61_000);
  await expect.poll(() => count(calls, 'get-play-session')).toBe(before + 1);
}

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
  await page.clock.install({ time: NOW });
});

test('no session: Before, with Pre-flight and Prep in the page', async ({ page }) => {
  const calls = await fakeBridge(page, () => closed());
  await load(page);

  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'During')).toHaveAttribute('aria-selected', 'false');
  await expect(view(page, 'before')).toBeVisible();
  await expect(view(page, 'during')).toBeHidden();
  await expect(view(page, 'after')).toBeHidden();

  const preflight = view(page, 'before').getByRole('region', { name: '✈ Pre-flight' });
  const prep = view(page, 'before').getByRole('region', { name: '📋 Prep' });
  await expect(preflight).toBeVisible();
  await expect(prep).toBeVisible();
  await expect(preflight.locator('#ready-block')).toBeVisible();
  // In the page: no dialog, no backdrop, no close button.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(preflight.getByRole('button', { name: 'Close' })).toHaveCount(0);
  await expect(prep.getByRole('button', { name: 'Close' })).toHaveCount(0);
  // A panel not in React yet points to the full dashboard.
  const features = view(page, 'before').getByRole('region', { name: 'Features' });
  await expect(features).toContainText('Not in the new dashboard yet.');
  await expect(features.getByRole('link', { name: 'full dashboard' })).toHaveAttribute('href', '/');
  await expect.poll(() => count(calls, 'get-prep-digest')).toBe(1);
  // A later poll as the sync point: a late get-party call would have landed by then.
  await nextPoll(page, calls);
  expect(count(calls, 'get-prep-digest')).toBe(1);
  expect(count(calls, 'get-party')).toBe(0);
});

test('an open session: During, with Party and Handouts in the page', async ({ page }) => {
  const calls = await fakeBridge(page, () => OPEN);
  await load(page);

  await expect(tab(page, 'During')).toHaveAttribute('aria-selected', 'true');
  const during = view(page, 'during');
  await expect(during).toBeVisible();
  await expect(during.getByRole('region', { name: '🛡 Party' })).toBeVisible();
  await expect(during.getByRole('region', { name: '📜 Handouts' })).toBeVisible();
  await expect(during.getByRole('region', { name: 'Live Feed' })).toBeVisible();
  await expect(during.getByRole('region', { name: 'Recent Changes' })).toBeVisible();
  await expect(page.locator('#preflight-drawer')).toHaveCount(0);
  await expect(page.locator('#prep-drawer')).toHaveCount(0);
  await expect(page.locator('#handouts-close')).toHaveCount(0);
  // Before never showed: its panels did not load.
  await expect.poll(() => count(calls, 'get-party')).toBe(1);
  await nextPoll(page, calls);
  expect(count(calls, 'get-prep-digest')).toBe(0);
  expect(count(calls, 'get-party')).toBe(1);
});

test('a session that ended in the last 12 hours: After; an older one: Before', async ({ page }) => {
  let session = closed(2 * HOUR);
  await fakeBridge(page, () => session);
  await load(page);
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');
  const after = view(page, 'after');
  await expect(after.getByRole('region', { name: '📋 Prep' })).toBeVisible();
  await expect(after.getByRole('region', { name: '📜 Handouts' })).toBeVisible();
  await expect(after.getByRole('region', { name: 'Recent Changes' })).toBeVisible();
  await expect(
    after.getByRole('region', { name: "Tonight's stats and session notes" })
  ).toBeVisible();

  session = closed(13 * HOUR);
  await load(page);
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
});

test('After turns into Before when the 12 hours pass, at the next poll', async ({ page }) => {
  const endedAt = new Date(NOW - 11 * HOUR - 59 * 60_000).toISOString();
  const calls = await fakeBridge(page, () => ({ open: false, endedAt }));
  await load(page);
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');
  await nextPoll(page, calls);
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
});

test('with the bridge down After still turns into Before when the 12 hours pass', async ({
  page,
}) => {
  const endedAt = new Date(NOW - 11 * HOUR - 59 * 60_000).toISOString();
  await fakeBridge(page, () => ({ open: false, endedAt }));
  await load(page);
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');

  // From here every poll fails; the window is measured at the failed poll too.
  let failedPolls = 0;
  await page.route('**/api/tool', route => {
    const call = route.request().postDataJSON() as ToolCall;
    if (call.name !== 'get-play-session') return route.fallback();
    failedPolls += 1;
    return route.fulfill({
      status: 502,
      json: { ok: false, kind: 'bridge', error: 'Bridge gone' },
    });
  });
  await page.clock.fastForward(61_000);
  // The jump can cover two poll ticks; at least one must have failed.
  await expect.poll(() => failedPolls).toBeGreaterThanOrEqual(1);
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
});

test('outside the Veil theme the selected tab keeps its ring and glow', async ({ page }) => {
  await fakeCommonRoutes(page, 'neutral');
  await fakeBridge(page, () => closed());
  await load(page);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neutral');
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
  await expect(tab(page, 'Before')).not.toHaveCSS('box-shadow', 'none');
  await expect(tab(page, 'During')).toHaveCSS('box-shadow', 'none');
});

test('a failed session read shows Before', async ({ page }) => {
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  const calls = await fakeTools(
    page,
    call =>
      call.name === 'get-play-session'
        ? { status: 502, json: { ok: false, kind: 'bridge', error: 'Bridge gone' } }
        : ok({}),
    { playSession: true }
  );
  await load(page);
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
  await expect(view(page, 'before')).toBeVisible();
  // Ready for session mounts with Pre-flight and shares the failed read: no second try.
  await expect(docked(page, '✈ Pre-flight').locator('#ready-block')).toBeVisible();
  await expect.poll(() => count(calls, 'get-play-session')).toBe(1);
  // The next poll is the sync point: the first read plus that poll, and no extra from Ready.
  await nextPoll(page, calls);
  expect(count(calls, 'get-play-session')).toBe(2);
});

test('a tab pins the moment until the session starts or ends', async ({ page }) => {
  let session = closed();
  const calls = await fakeBridge(page, () => session);
  await load(page);
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');

  await tab(page, 'After').click();
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');
  await expect(view(page, 'after')).toBeVisible();
  await expect(view(page, 'before')).toBeHidden();
  // A poll with the same answer keeps the pick.
  await nextPoll(page, calls);
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');

  // The session starts: the pick clears and During follows.
  session = OPEN;
  await nextPoll(page, calls);
  await expect(tab(page, 'During')).toHaveAttribute('aria-selected', 'true');

  await tab(page, 'Before').click();
  await nextPoll(page, calls);
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
  // The session ends: the pick clears and After follows.
  session = closed(0);
  await nextPoll(page, calls);
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');
});

test('Start the session log moves the page to During', async ({ page }) => {
  let session = closed();
  const calls = await fakeBridge(page, () => session);
  await load(page);
  const ready = docked(page, '✈ Pre-flight').locator('#ready-block');
  await expect(ready.locator('#btn-ready-log')).toBeVisible();
  session = OPEN;
  await ready.locator('#btn-ready-log').click();
  await expect(tab(page, 'During')).toHaveAttribute('aria-selected', 'true');
  expect(count(calls, 'mark-play-session')).toBe(1);
  // Pre-flight left the page with the focus in it; the focus is on the During tab now.
  await expect(tab(page, 'During')).toBeFocused();
});

test('the tabs are a tablist: arrow keys, Home and End move and pick', async ({ page }) => {
  await fakeBridge(page, () => closed());
  await load(page);
  await expect(page.getByRole('tablist', { name: 'Moment of the evening' })).toBeVisible();
  await expect(tab(page, 'Before')).toHaveAttribute('tabindex', '0');
  await expect(tab(page, 'During')).toHaveAttribute('tabindex', '-1');
  await expect(view(page, 'before')).toHaveAttribute('role', 'tabpanel');
  await expect(tab(page, 'Before')).toHaveAttribute('aria-controls', 'moment-before');

  await tab(page, 'Before').focus();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'During')).toBeFocused();
  await expect(tab(page, 'During')).toHaveAttribute('aria-selected', 'true');
  await expect(view(page, 'during')).toBeVisible();
  await page.keyboard.press('End');
  await expect(tab(page, 'After')).toBeFocused();
  await expect(view(page, 'after')).toBeVisible();
  await page.keyboard.press('ArrowRight');
  await expect(tab(page, 'Before')).toBeFocused();
  await page.keyboard.press('ArrowLeft');
  await expect(tab(page, 'After')).toBeFocused();
  await page.keyboard.press('Home');
  await expect(tab(page, 'Before')).toHaveAttribute('aria-selected', 'true');
});

test('Escape never closes a docked panel; a drawer over the page closes', async ({ page }) => {
  await fakeBridge(page, () => closed());
  await load(page);
  const prep = docked(page, '📋 Prep');
  await expect(prep).toBeVisible();
  await prep.getByRole('button', { name: '↻ Refresh' }).focus();
  await page.keyboard.press('Escape');
  await expect(prep).toBeVisible();

  // Party is not docked in Before: it opens over the page, with the backdrop.
  await fromMenu(page, 'btn-party');
  const party = page.getByRole('dialog', { name: '🛡 Party' });
  await expect(party).toBeVisible();
  await expect(page.locator('.drawer-backdrop')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(party).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await page.keyboard.press('Escape');
  await expect(prep).toBeVisible();
  await expect(docked(page, '✈ Pre-flight')).toBeVisible();
});

test('the header and menu buttons show a docked panel instead of opening a copy', async ({
  page,
}) => {
  const calls = await fakeBridge(page, () => closed());
  await load(page);
  await expect(docked(page, '📋 Prep')).toBeVisible();
  await expect.poll(() => count(calls, 'get-prep-digest')).toBe(1);

  await page.locator('#btn-preflight').click();
  await expect(page.locator('#preflight-drawer')).toBeFocused();
  await expect(page.locator('#preflight-drawer')).toHaveCount(1);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#btn-preflight')).toHaveAttribute('aria-expanded', 'true');
  // A second click does not close it: it stays in the page.
  await page.locator('#btn-preflight').click();
  await expect(docked(page, '✈ Pre-flight')).toBeVisible();

  await fromMenu(page, 'btn-prep');
  await expect(page.locator('#prep-drawer')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  // Showing it does not load it again; its Refresh does.
  await nextPoll(page, calls);
  expect(count(calls, 'get-prep-digest')).toBe(1);
  // Prep's "Open Pre-flight" shows the one beside it.
  await docked(page, '📋 Prep').getByRole('button', { name: 'Open Pre-flight' }).click();
  await expect(page.locator('#preflight-drawer')).toBeFocused();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(docked(page, '📋 Prep')).toBeVisible();

  // In During, Pre-flight is not docked, and nothing above left it open: the header button
  // opens it over the page.
  await tab(page, 'During').click();
  await expect(page.locator('#preflight-drawer')).toHaveCount(0);
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await page.locator('#btn-preflight').click();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeVisible();
});

test('a panel docked in both moments keeps its data; one coming back loads again', async ({
  page,
}) => {
  const calls = await fakeBridge(page, () => closed());
  await load(page);
  await expect(docked(page, '📋 Prep')).toBeVisible();
  await expect.poll(() => count(calls, 'get-prep-digest')).toBe(1);

  // Prep is docked in Before and After: it moves, it does not reload.
  await tab(page, 'After').click();
  await expect(view(page, 'after').getByRole('region', { name: '📋 Prep' })).toBeVisible();
  await expect(view(page, 'before').locator('#prep-drawer')).toHaveCount(0);
  await nextPoll(page, calls);
  expect(count(calls, 'get-prep-digest')).toBe(1);

  // Not in During; back in Before it loads, as when its drawer opens.
  await tab(page, 'During').click();
  await expect(page.locator('#prep-drawer')).toHaveCount(0);
  await tab(page, 'Before').click();
  await expect(docked(page, '📋 Prep')).toBeVisible();
  await expect.poll(() => count(calls, 'get-prep-digest')).toBe(2);
});

test('the GM Actions gate shows the docked Pre-flight, closing the drawers over it', async ({
  page,
}) => {
  await page.unrouteAll();
  await fakeCommonRoutes(page);
  await fakeStream(page, [{ event: 'settings', data: { gmActionsEnabled: false } }]);
  const calls = await fakeBridge(page, () => closed());
  // A party that can ask for a rest (registered last, so it answers get-party first).
  await page.route('**/api/tool', route => {
    const call = route.request().postDataJSON() as ToolCall;
    if (call.name !== 'get-party') return route.fallback();
    return route.fulfill(
      ok({
        groups: [
          {
            actorId: 'g1',
            name: 'The Party',
            primary: true,
            level: 3,
            pace: null,
            members: [],
            restCards: { short: {}, long: {} },
          },
        ],
        paceOptions: [],
        scene: null,
        encounter: null,
        warnings: [],
      })
    );
  });
  await load(page);
  await fromMenu(page, 'btn-party');
  const party = page.getByRole('dialog', { name: '🛡 Party' });
  await party.getByRole('button', { name: 'Short rest request' }).click();

  await expect(party).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(page.locator('#preflight-drawer')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toHaveCount(0);
  expect(count(calls, 'plan-party-change')).toBe(0);
});

test('a drawer open over the page docks when its moment comes, and does not float again', async ({
  page,
}) => {
  let session = closed();
  const calls = await fakeBridge(page, () => session);
  await load(page);
  await fromMenu(page, 'btn-party');
  await expect(page.getByRole('dialog', { name: '🛡 Party' })).toBeVisible();

  session = OPEN;
  await nextPoll(page, calls);
  await expect(tab(page, 'During')).toHaveAttribute('aria-selected', 'true');
  await expect(view(page, 'during').getByRole('region', { name: '🛡 Party' })).toBeVisible();
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);

  session = closed(0);
  await nextPoll(page, calls);
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');
  await expect(page.locator('#party-drawer')).toHaveCount(0);
});

test('the focus stays on a panel that moves with the moment', async ({ page }) => {
  let session = OPEN;
  const calls = await fakeBridge(page, () => session);
  await load(page);
  const add = view(page, 'during').locator('#handouts-add');
  await add.focus();

  // Handouts is docked in During and After: the same button keeps the focus.
  session = closed(0);
  await nextPoll(page, calls);
  await expect(tab(page, 'After')).toHaveAttribute('aria-selected', 'true');
  await expect(view(page, 'after').locator('#handouts-add')).toBeFocused();
});

test('a narrow screen shows one column, with no sideways scroll', async ({ page }) => {
  await page.setViewportSize({ width: 375, height: 800 });
  let session = closed();
  await fakeBridge(page, () => session);
  await load(page);
  const preflight = await docked(page, '✈ Pre-flight').boundingBox();
  const prep = await docked(page, '📋 Prep').boundingBox();
  expect(prep!.x).toBe(preflight!.x);
  expect(prep!.y).toBeGreaterThan(preflight!.y);

  session = OPEN;
  await load(page);
  const feed = await page.getByRole('region', { name: 'Live Feed' }).boundingBox();
  const party = await docked(page, '🛡 Party').boundingBox();
  expect(party!.x).toBe(feed!.x);
  expect(party!.y).toBeGreaterThan(feed!.y);
  const sideways = await page.evaluate(
    () => document.documentElement.scrollWidth - document.documentElement.clientWidth
  );
  expect(sideways).toBeLessThanOrEqual(0);
});
