// The Handouts drawer on the React dashboard: the queue and the seen log (list-revealed-pages,
// list-scenes and /api/player/names, faked here), the next entry, the empty and failed states,
// Remove (no GM Actions needed), Reveal next through the confirm window (the destructive tick,
// Confirm with both flags, Cancel, Escape with a toast up, Show it now), Undo, and the stream's
// handouts-seen reloading the open drawer, the reload after every reveal attempt and where focus
// goes when the confirm window closes.
import { expect, test, type Locator, type Page, type Route } from '@playwright/test';

import {
  GM_TOKEN,
  fakeCommonRoutes,
  fakeStream,
  fakeTools,
  ok,
  toast,
  type ToolCall,
} from './support';

// The seen ticks show the time in the browser's zone.
test.use({ timezoneId: 'UTC' });

const PLAYERS = [
  { userId: 'u1', name: 'Anna' },
  { userId: 'u2', name: 'Bo' },
];

const SCENES = [
  { id: 's1', name: 'Barovia', active: true },
  { id: 's2', name: 'Vallaki', active: false },
];

const page_ = (n: number): string => `JournalEntry.j1.JournalEntryPage.p${n}`;

const QUEUE = [
  // For another known scene: not next while Barovia is active.
  {
    entryId: 'e1',
    uuid: page_(1),
    title: 'Letter from Kolyan',
    exists: true,
    sceneId: 's2',
    players: ['u1'],
    addedAt: '2026-10-01T10:00:00Z',
  },
  // For the active scene: next.
  {
    entryId: 'e2',
    uuid: page_(2),
    title: 'Map of Barovia',
    exists: true,
    sceneId: 's1',
    addedAt: '2026-10-01T11:00:00Z',
  },
  {
    entryId: 'e3',
    uuid: page_(3),
    title: null,
    exists: false,
    sceneId: null,
    addedAt: '2026-10-01T12:00:00Z',
  },
  {
    entryId: 'e4',
    uuid: page_(4),
    title: 'Old note',
    exists: true,
    sceneId: 's9',
    players: [],
    addedAt: '2026-10-01T13:00:00Z',
  },
];

const PAGES = [
  // A Tarokka reveal: not a handout, so not listed.
  {
    pageId: 'p5',
    uuid: page_(5),
    title: 'The Tome of Strahd',
    exists: true,
    observable: true,
    feature: 'tarokka',
    revealedAt: '2026-10-09T18:00:00Z',
    seenBy: [],
  },
  {
    pageId: 'p6',
    uuid: page_(6),
    title: 'Invitation',
    exists: true,
    observable: true,
    feature: 'handouts',
    revealedAt: '2026-10-09T18:30:00Z',
    seenBy: [{ userId: 'u1', name: 'Anna', at: '2026-10-09T19:05:00Z' }],
  },
  // A copy, deleted since, for Bo and a player the names route does not know.
  {
    pageId: 'p7',
    uuid: page_(7),
    title: 'Copied page',
    exists: false,
    observable: false,
    feature: 'player-view',
    copiedFrom: page_(8),
    players: ['u2', 'u3'],
    revealedAt: '2026-10-09T18:40:00Z',
    seenBy: [{ userId: 'u3', name: 'u3', at: '2026-10-09T20:15:00Z' }],
  },
];

const VIEW = { pages: PAGES, queue: QUEUE };

const REVEAL_PLAN = {
  planId: 'rp1',
  feature: 'handouts',
  risk: 'destructive',
  summary: 'Reveal "Map of Barovia" to every player',
  diff: [{ text: 'Map of Barovia: visible to every player' }, { text: 'Taken off the queue' }],
  requires: { confirm: true, confirmDestructive: true },
  pageUuid: page_(2),
};
const APPLIED = { changeId: 'ch9', summary: 'Revealed "Map of Barovia" to every player' };
const UNDONE = { changeId: 'ch9', summary: 'Undid: Revealed "Map of Barovia" to every player' };

type ToolAnswer = { status?: number; json: unknown };
type Answer = (call: ToolCall) => ToolAnswer;

/** The bridge: the drawer's reads, the reveal plan, the unqueue, the apply and the undo. */
const bridge: Answer = call => {
  if (call.name === 'list-revealed-pages') return ok(VIEW);
  if (call.name === 'list-scenes') return ok(SCENES);
  if (call.name === 'plan-page-reveal') {
    return call.args['action'] === 'unqueue'
      ? ok({
          queued: false,
          pageUuid: call.args['pageUuid'],
          note: 'Took "Letter from Kolyan" off the queue.',
        })
      : ok(REVEAL_PLAN);
  }
  if (call.name === 'apply-planned-change') return ok(APPLIED);
  if (call.name === 'undo-change') return ok(UNDONE);
  return ok({});
};

const names = (calls: ToolCall[]): string[] => calls.map(c => c.name);
const loads = (calls: ToolCall[]): number =>
  calls.filter(c => c.name === 'list-revealed-pages').length;

const gmActions = (on: boolean): { event: string; data: unknown }[] => [
  { event: 'settings', data: { gmActionsEnabled: on } },
];

async function openHandouts(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-handouts').click();
  const drawer = page.getByRole('dialog', { name: '📜 Handouts' });
  await expect(drawer).toBeVisible();
  return drawer;
}

const queueRows = (drawer: Locator): Locator => drawer.locator('#handouts-queue .preflight-item');
const revealedRows = (drawer: Locator): Locator =>
  drawer.locator('#handouts-revealed .preflight-item');

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await page.route('**/api/player/names', route => route.fulfill({ json: PLAYERS }));
});

test('loads the queue and the seen log on open, with the next page marked', async ({ page }) => {
  await fakeStream(page, []);
  const namesAsked = page.waitForRequest(req => req.url().endsWith('/api/player/names'));
  const calls = await fakeTools(page, bridge);
  const drawer = await openHandouts(page);
  expect((await namesAsked).headers()['x-cogm-token']).toBe(GM_TOKEN);

  await expect(drawer.locator('.drawer-sub')).toHaveText(
    'GM only. Queue pages, reveal the next in one click.'
  );
  const rows = queueRows(drawer);
  await expect(rows.locator('.pf-label')).toHaveText([
    'Letter from Kolyan',
    'Map of Barovia',
    'Untitled (page deleted)',
    'Old note',
  ]);
  await expect(rows.locator('.pf-text > .pf-detail')).toHaveText([
    'Vallaki · for Anna',
    'Barovia · for every player',
    'any scene · for every player',
    'another scene · for every player',
  ]);
  await expect(rows.nth(1)).toHaveClass('preflight-item pf-info');
  await expect(drawer.locator('#handouts-queue .pf-info')).toHaveCount(1);
  await expect(drawer.locator('#handouts-next')).toHaveText('Reveal next: Map of Barovia');
  await expect(drawer.locator('#handouts-next')).toBeEnabled();
  await expect(drawer.locator('#handouts-show-now')).not.toBeChecked();

  // The Tarokka reveal is left out; the copy shows though its feature is not handouts.
  const revealed = revealedRows(drawer);
  await expect(revealed.locator('.pf-label')).toHaveText(['Invitation', '(page deleted)']);
  await expect(revealed.locator('.pf-text > .pf-detail')).toHaveText([
    'for every player',
    'for Bo, u3 · not visible in Foundry',
  ]);
  const ticks = revealed.nth(0).locator('.seen-tick');
  await expect(ticks).toHaveText(['✓ Anna', '· Bo']);
  await expect(ticks.nth(0)).toHaveClass('seen-tick seen');
  await expect(ticks.nth(0)).toHaveAttribute('title', 'Opened 19:05');
  await expect(ticks.nth(1)).toHaveClass('seen-tick');
  await expect(ticks.nth(1)).toHaveAttribute('title', 'Not opened yet');
  await expect(revealed.nth(1).locator('.seen-tick')).toHaveText(['· Bo', '✓ u3']);
  await expect(revealed.nth(1).locator('.seen-tick').nth(1)).toHaveAttribute(
    'title',
    'Opened 20:15'
  );

  // Titles and names only: the drawer never reads a page's text.
  expect([...names(calls)].sort()).toEqual(['list-revealed-pages', 'list-scenes']);
  expect(calls.every(c => Object.keys(c.args).length === 0)).toBe(true);
});

test('shows the empty states, and a failed load says why and keeps the last rows', async ({
  page,
}) => {
  await fakeStream(page, []);
  let view: unknown = {
    pages: [{ ...PAGES[1], seenBy: [] }],
    queue: [],
  };
  let fail = false;
  await page.unroute('**/api/player/names');
  await page.route('**/api/player/names', route => route.fulfill({ json: [] }));
  await fakeTools(page, call => {
    if (call.name !== 'list-revealed-pages') return bridge(call);
    return fail ? { status: 502, json: { ok: false, error: 'Bridge not connected' } } : ok(view);
  });
  const drawer = await openHandouts(page);

  await expect(drawer.locator('#handouts-queue .empty')).toHaveText(
    'Nothing queued. Queue pages during prep, then reveal each in one click.'
  );
  await expect(drawer.locator('#handouts-next')).toHaveText('Reveal next');
  await expect(drawer.locator('#handouts-next')).toBeDisabled();
  await expect(revealedRows(drawer).locator('.seen-row')).toHaveText('No players known yet.');

  view = { pages: [PAGES[0]], queue: [] };
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('#handouts-revealed .empty')).toHaveText('No handout revealed yet.');

  view = VIEW;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('#handouts-next')).toHaveText('Reveal next: Map of Barovia');

  fail = true;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('#handouts-queue')).toHaveText(
    "Couldn't load the handouts: Bridge not connected"
  );
  await expect(revealedRows(drawer).locator('.pf-label')).toHaveText([
    'Invitation',
    '(page deleted)',
  ]);
});

test('a first load that fails says why; scenes and names that fail are left out', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  let failView = true;
  const calls = await fakeTools(page, call => {
    if (call.name === 'list-scenes') return { status: 422, json: { ok: false, error: 'No' } };
    if (call.name === 'list-revealed-pages' && failView) {
      return { status: 502, json: { ok: false, error: 'Bridge not connected' } };
    }
    return bridge(call);
  });
  await page.unroute('**/api/player/names');
  await page.route('**/api/player/names', route =>
    route.fulfill({ status: 500, json: { error: 'Nope' } })
  );
  const drawer = await openHandouts(page);

  await expect(drawer.locator('#handouts-queue')).toHaveText(
    "Couldn't load the handouts: Bridge not connected"
  );
  await expect(drawer.locator('#handouts-revealed .preflight-item')).toHaveCount(0);
  await expect(drawer.locator('#handouts-next')).toBeDisabled();

  // Without scenes every queued scene is "another scene" and the oldest entry is next; without
  // names the ticks show user ids.
  failView = false;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(queueRows(drawer).locator('.pf-text > .pf-detail')).toHaveText([
    'another scene · for u1',
    'another scene · for every player',
    'any scene · for every player',
    'another scene · for every player',
  ]);
  await expect(queueRows(drawer).nth(0)).toHaveClass('preflight-item pf-info');
  await expect(drawer.locator('#handouts-next')).toHaveText('Reveal next: Letter from Kolyan');
  await expect(revealedRows(drawer).nth(1).locator('.seen-tick')).toHaveText(['· u2', '✓ u3']);

  // With no active scene known, Reveal next asks for any scene.
  await drawer.locator('#handouts-next').click();
  await page
    .getByRole('dialog', { name: 'Destructive action' })
    .getByRole('button', { name: 'Cancel' })
    .click();
  expect(calls.find(c => c.name === 'plan-page-reveal')?.args).toEqual({ action: 'reveal-next' });
});

test('Remove takes a page off the queue with GM Actions off; Reveal next stays gated', async ({
  page,
}) => {
  await fakeStream(page, gmActions(false));
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({ json: { switches: { switches: [] }, gmActionsEnabled: false } })
  );
  let unqueueFails = false;
  const calls = await fakeTools(page, call =>
    call.name === 'plan-page-reveal' && unqueueFails
      ? { status: 422, json: { ok: false, error: 'That page is not queued' } }
      : bridge(call)
  );
  const drawer = await openHandouts(page);
  await expect(queueRows(drawer)).toHaveCount(4);

  await queueRows(drawer).nth(0).getByRole('button', { name: 'Remove' }).click();
  await expect(toast(page, '✓ Took "Letter from Kolyan" off the queue.')).toBeVisible();
  expect(calls.find(c => c.name === 'plan-page-reveal')).toEqual({
    name: 'plan-page-reveal',
    args: { action: 'unqueue', pageUuid: page_(1) },
  });
  await expect.poll(() => loads(calls)).toBe(2);

  unqueueFails = true;
  await queueRows(drawer).nth(3).getByRole('button', { name: 'Remove' }).click();
  await expect(toast(page, '✗ plan-page-reveal: That page is not queued')).toBeVisible();
  await expect.poll(() => loads(calls)).toBe(3);
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeHidden();

  // A reveal does change Foundry: with GM Actions off nothing is planned.
  const before = calls.length;
  await drawer.locator('#handouts-next').click();
  await expect(
    toast(page, 'GM Actions are off. Ready for session in Pre-flight turns them on.')
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeVisible();
  expect(names(calls.slice(before)).filter(n => n === 'plan-page-reveal')).toEqual([]);
});

test('Reveal next asks first; the tick unlocks Confirm, which applies with both flags', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openHandouts(page);
  await expect(drawer.locator('#handouts-next')).toBeEnabled();

  await drawer.locator('#handouts-next').click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.modal-summary')).toHaveText(
    'Reveal "Map of Barovia" to every player'
  );
  await expect(confirm.locator('.change-diff li')).toHaveText([
    'Map of Barovia: visible to every player',
    'Taken off the queue',
  ]);
  // The modal window hides the drawer from the accessibility tree, so by id: one reveal at a time.
  await expect(page.locator('#handouts-next')).toBeDisabled();
  expect(calls.filter(c => c.name === 'plan-page-reveal').map(c => c.args)).toEqual([
    { action: 'reveal-next', sceneId: 's1' },
  ]);
  expect(names(calls)).not.toContain('get-planned-change');

  const run = confirm.getByRole('button', { name: 'Run destructive action' });
  await expect(run).toBeDisabled();
  await confirm
    .getByRole('checkbox', {
      name: 'I understand this changes the live game and may be hard to undo.',
    })
    .check();
  await expect(run).toBeEnabled();
  await confirm
    .getByRole('checkbox', {
      name: 'I understand this changes the live game and may be hard to undo.',
    })
    .uncheck();
  await expect(run).toBeDisabled();
  await confirm.getByRole('checkbox').check();
  const loaded = loads(calls);
  await run.click();

  await expect(confirm).toBeHidden();
  await expect(toast(page, '✓ Applied: Revealed "Map of Barovia" to every player')).toBeVisible();
  // Focus waits in the drawer while the button is disabled, then goes back to it.
  await expect(page.locator('#handouts-next')).toBeFocused();
  expect(calls.find(c => c.name === 'apply-planned-change')).toEqual({
    name: 'apply-planned-change',
    args: { planId: 'rp1' },
    confirm: true,
    confirmDestructive: true,
  });
  // The apply reloads the drawer once (the reload after the attempt joins it), and so does Undo.
  expect(loads(calls)).toBe(loaded + 1);
  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(toast(page, '✓ Undid: Revealed "Map of Barovia" to every player')).toBeVisible();
  expect(calls.find(c => c.name === 'undo-change')).toEqual({
    name: 'undo-change',
    args: { changeId: 'ch9' },
    confirm: true,
    confirmDestructive: true,
  });
  await expect.poll(() => loads(calls)).toBe(loaded + 2);
});

test('Show it now goes with one reveal; Cancel applies nothing and unticks it', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openHandouts(page);
  const showNow = drawer.getByRole('checkbox', { name: 'Show it now' });

  await showNow.check();
  await expect(queueRows(drawer)).toHaveCount(4);
  const loaded = loads(calls);
  await drawer.locator('#handouts-next').click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  await expect(showNow).not.toBeChecked();
  await expect(drawer.locator('#handouts-next')).toBeEnabled();
  // A cancelled reveal reloads the queue too, and focus goes back to the button.
  await expect(drawer.locator('#handouts-next')).toBeFocused();
  expect(loads(calls)).toBe(loaded + 1);
  expect(calls.filter(c => c.name === 'plan-page-reveal').map(c => c.args)).toEqual([
    { action: 'reveal-next', sceneId: 's1', showNow: true },
  ]);
  expect(names(calls)).not.toContain('apply-planned-change');

  // The next reveal starts unticked, and the window's own tick starts unticked again.
  await drawer.locator('#handouts-next').click();
  await expect(confirm.getByRole('checkbox')).not.toBeChecked();
  await expect(confirm.getByRole('button', { name: 'Run destructive action' })).toBeDisabled();
  expect(calls.filter(c => c.name === 'plan-page-reveal').map(c => c.args)[1]).toEqual({
    action: 'reveal-next',
    sceneId: 's1',
  });
  // A click outside the window cancels it too.
  await page.mouse.click(5, 5);
  await expect(confirm).toBeHidden();
  await expect(drawer).toBeVisible();
  expect(names(calls)).not.toContain('apply-planned-change');
});

test('Escape closes the confirm window, not the toast or the drawer', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, call =>
    call.name === 'plan-page-reveal'
      ? ok({ ...REVEAL_PLAN, providerNote: 'The page is in a compendium.' })
      : bridge(call)
  );
  const drawer = await openHandouts(page);

  await drawer.locator('#handouts-next').click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(confirm).toBeVisible();
  await expect(toast(page, 'The page is in a compendium.')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(toast(page, 'The page is in a compendium.')).toBeVisible();
  await expect(drawer).toBeVisible();

  // Without a toast up, Escape still closes the window first.
  await expect(page.locator('.toast-stack .toast')).toHaveCount(0, { timeout: 8000 });
  await drawer.locator('#handouts-next').click();
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(drawer).toBeVisible();
  expect(names(calls)).not.toContain('apply-planned-change');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
});

test('a plan answer without its lines is read again before the window opens', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, call => {
    if (call.name === 'plan-page-reveal') return ok({ planId: 'rp1', risk: 'destructive' });
    if (call.name === 'get-planned-change') return ok(REVEAL_PLAN);
    return bridge(call);
  });
  const drawer = await openHandouts(page);

  await drawer.locator('#handouts-next').click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(confirm.locator('.change-diff li')).toHaveText([
    'Map of Barovia: visible to every player',
    'Taken off the queue',
  ]);
  expect(calls.find(c => c.name === 'get-planned-change')?.args).toEqual({ planId: 'rp1' });
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Run destructive action' }).click();
  await expect(toast(page, '✓ Applied: Revealed "Map of Barovia" to every player')).toBeVisible();
});

test('a handouts-seen event reloads the open drawer', async ({ page }) => {
  // The stream answers only when released, so its event lands after the drawer loaded.
  let release!: () => void;
  const released = new Promise<void>(resolve => {
    release = resolve;
  });
  await page.route('**/api/stream**', async (route: Route): Promise<void> => {
    await released;
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: 'retry: 600000\n\nevent: handouts-seen\ndata: {}\n\n',
    });
  });
  let view: unknown = { pages: [{ ...PAGES[1], seenBy: [] }], queue: [] };
  const calls = await fakeTools(page, call =>
    call.name === 'list-revealed-pages' ? ok(view) : bridge(call)
  );
  const drawer = await openHandouts(page);
  const ticks = revealedRows(drawer).locator('.seen-tick');
  await expect(ticks).toHaveText(['· Anna', '· Bo']);

  view = { pages: [PAGES[1]], queue: [] };
  release();
  await expect(ticks).toHaveText(['✓ Anna', '· Bo']);
  expect(loads(calls)).toBe(2);
});

test('a failed reveal reloads the queue; with nothing left, focus stays in the drawer', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  let view: unknown = VIEW;
  let planFails = true;
  const calls = await fakeTools(page, call => {
    if (call.name === 'list-revealed-pages') return ok(view);
    if (call.name === 'plan-page-reveal' && planFails) {
      return { status: 422, json: { ok: false, error: 'Nothing queued for this scene' } };
    }
    return bridge(call);
  });
  const drawer = await openHandouts(page);
  await expect(queueRows(drawer)).toHaveCount(4);

  // Someone else revealed the page meanwhile: the plan fails and the reload shows the queue now.
  view = { pages: PAGES, queue: [QUEUE[0]] };
  await drawer.locator('#handouts-next').click();
  await expect(toast(page, '✗ plan-page-reveal: Nothing queued for this scene')).toBeVisible();
  await expect(queueRows(drawer).locator('.pf-label')).toHaveText(['Letter from Kolyan']);
  await expect(drawer.locator('#handouts-next')).toHaveText('Reveal next');
  await expect(drawer.locator('#handouts-next')).toBeDisabled();
  await expect(drawer).toBeFocused();
  expect(loads(calls)).toBe(2);

  // The last page goes: Reveal next stays disabled, so focus stays on the drawer, not the page.
  view = VIEW;
  planFails = false;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('#handouts-next')).toBeEnabled();
  await drawer.locator('#handouts-next').click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await confirm.getByRole('checkbox').check();
  view = { pages: PAGES, queue: [] };
  await confirm.getByRole('button', { name: 'Run destructive action' }).click();
  await expect(toast(page, '✓ Applied: Revealed "Map of Barovia" to every player')).toBeVisible();
  await expect(queueRows(drawer)).toHaveCount(0);
  await expect(drawer.locator('#handouts-next')).toBeDisabled();
  await expect(drawer).toBeFocused();
});
