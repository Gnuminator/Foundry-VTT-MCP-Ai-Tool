// The Tarokka drawer on the React dashboard: the reading (get-tarokka-reading, faked here) with
// its empty and failed states, Show cards (hidden names never on the page), the Open buttons,
// Import, New reading and a link pick in one click with Undo, Reveal through the confirm window
// (the destructive tick, both flags, Cancel, Show it now), open forms kept across reloads, the
// GM Actions gate, the Obsidian link from the stream, and Escape.
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  GM_TOKEN,
  fakeCommonRoutes,
  fakeStream,
  fakeTools,
  ok,
  toast,
  type ToolCall,
} from './support';

// The subtitle shows the reading's time in the browser's locale and zone.
test.use({ locale: 'en-US', timezoneId: 'UTC' });

const REVEAL_PAGE = 'JournalEntry.tr.JournalEntryPage.r1';

const POSITIONS = [
  {
    position: 'tome',
    label: 'Tome',
    deck: 'common',
    cardId: 'swords-3',
    cardName: 'Three of Swords',
    gmNote: 'Hidden in the burgomaster cellar',
    links: { journalPageUuid: 'JournalEntry.j1.JournalEntryPage.p1' },
    linked: true,
    revealed: false,
    revealPageUuid: null,
  },
  {
    position: 'holySymbol',
    label: 'Holy symbol',
    deck: 'common',
    cardId: 'coins-7',
    cardName: 'Seven of Coins',
    gmNote: null,
    links: {},
    linked: false,
    revealed: true,
    revealPageUuid: REVEAL_PAGE,
  },
  {
    position: 'sunsword',
    label: 'Sunsword',
    deck: 'common',
    cardId: 'glyphs-2',
    cardName: 'Two of Glyphs',
    gmNote: null,
    links: { sceneUuid: 'Scene.s1', actorUuid: 'Actor.a1' },
    linked: true,
    revealed: true,
    revealPageUuid: null,
  },
  {
    position: 'ally',
    label: 'Ally',
    deck: 'high',
    cardId: 'high-mists',
    cardName: 'Mists',
    gmNote: 'Ezmerelda in the wagon',
    links: {},
    linked: false,
    revealed: false,
    revealPageUuid: null,
  },
  {
    position: 'strahdLocation',
    label: "Strahd's location",
    deck: 'high',
    cardId: 'high-raven',
    cardName: 'Raven',
    gmNote: null,
    links: {},
    linked: false,
    revealed: false,
    revealPageUuid: null,
  },
];

const READING = {
  available: true,
  reading: {
    readingId: 'r1',
    source: 'builtin-roll',
    readAt: '2026-10-09T18:00:00Z',
    providerVersion: null,
    positions: POSITIONS,
  },
  archivedReadings: 2,
  revealJournalUuid: null,
  note: 'Only the GM sees the vault.',
};
const EMPTY = { available: false, archivedReadings: 0, revealJournalUuid: null, note: '' };

/** Everything that names a card; none of it may be on the page while Show cards is off. */
const SECRETS = POSITIONS.flatMap(p => [p.cardName, p.cardId, ...(p.gmNote ? [p.gmNote] : [])]);

const CANDIDATES = [
  {
    uuid: 'JournalEntry.j2.JournalEntryPage.p9',
    documentName: 'JournalEntryPage',
    name: 'Cellar',
    parentName: 'Vallaki',
  },
  { uuid: 'JournalEntry.j3', documentName: 'JournalEntry', name: 'Vallaki notes' },
  { uuid: 'Scene.s7', documentName: 'Scene', name: 'Vallaki' },
  { uuid: 'Actor.a7', documentName: 'Actor', name: 'Vallakovich' },
];

const plan = (id: string, risk: string, summary: string): Record<string, unknown> => ({
  planId: id,
  risk,
  summary,
  diff: [{ text: summary }],
  requires: risk === 'write' ? { confirm: true } : { confirm: true, confirmDestructive: true },
});
const REVEAL_PLAN = {
  ...plan('rv1', 'destructive', 'Reveal Tome to the players'),
  diff: [{ text: 'New page "Card 1" in "Tarokka reading"' }, { text: 'Players: observer' }],
  pageUuid: REVEAL_PAGE,
};

type Answer = (call: ToolCall) => { status?: number; json: unknown };

/** The bridge: the reading, the search, the three plans, the apply and the undo. */
const bridge: Answer = call => {
  switch (call.name) {
    case 'get-tarokka-reading':
      return ok(READING);
    case 'suggest-tarokka-links':
      return ok({ query: call.args['query'], candidates: CANDIDATES });
    case 'plan-tarokka-import':
      return ok({
        ...plan('im1', 'write', `Store a new reading (${String(call.args['source'])})`),
        source: call.args['source'],
      });
    case 'plan-tarokka-links':
      return ok(plan('ln1', 'write', 'Link Tome'));
    case 'plan-tarokka-reveal':
      return ok(REVEAL_PLAN);
    case 'apply-planned-change': {
      const planId = String(call.args['planId']);
      const summary =
        planId === 'rv1' ? 'Revealed Tome' : planId === 'ln1' ? 'Linked Tome' : 'Stored a reading';
      return ok({
        changeId: `ch-${planId}`,
        summary,
        ...(planId === 'rv1' ? { shown: { ok: true, users: 4 } } : {}),
      });
    }
    case 'undo-change':
      return ok({ changeId: 'u1', summary: `Undid ${String(call.args['changeId'])}` });
    case 'open-in-foundry':
      return ok({ opened: true });
    default:
      return ok({});
  }
};

const names = (calls: ToolCall[]): string[] => calls.map(c => c.name);
const loads = (calls: ToolCall[]): number =>
  calls.filter(c => c.name === 'get-tarokka-reading').length;
const applies = (calls: ToolCall[]): number =>
  calls.filter(c => c.name === 'apply-planned-change').length;
const plans = (calls: ToolCall[]): ToolCall[] => calls.filter(c => c.name.startsWith('plan-'));

const gmActions = (on: boolean): { event: string; data: unknown }[] => [
  { event: 'settings', data: { gmActionsEnabled: on } },
];

async function openTarokka(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-tarokka').click();
  const drawer = page.getByRole('dialog', { name: '🃏 Tarokka' });
  await expect(drawer).toBeVisible();
  return drawer;
}

const pos = (drawer: Locator, position: string): Locator =>
  drawer.locator(`.tarokka-pos[data-position="${position}"]`);

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  // The GM Actions gate opens Pre-flight.
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({ json: { switches: { switches: [] }, gmActionsEnabled: false } })
  );
});

test('loads the reading on open with every card hidden, links and reveal states', async ({
  page,
}) => {
  await fakeStream(page, []);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTarokka(page);

  await expect(drawer.locator('.drawer-sub')).toHaveText(
    'GM only · builtin-roll · 10/9/2026, 6:00:00 PM · 2 archived'
  );
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);
  await expect(drawer.locator('.tarokka-label')).toHaveText([
    'Tome',
    'Holy symbol',
    'Sunsword',
    'Ally',
    "Strahd's location",
  ]);
  // Show cards is off: the same blurred placeholder everywhere, no name, id or note on the page.
  await expect(drawer.locator('#tarokka-show')).not.toBeChecked();
  const cards = drawer.locator('.tarokka-card');
  await expect(cards).toHaveText(Array(5).fill('Hidden card ·····'));
  for (let i = 0; i < 5; i++) {
    await expect(cards.nth(i)).toHaveClass('tarokka-card veiled');
    await expect(cards.nth(i)).toHaveAttribute('title', 'Tick “Show cards” to see it');
  }
  await expect(drawer.locator('.tarokka-note')).toHaveCount(0);
  const html = await page.content();
  for (const secret of SECRETS) expect(html).not.toContain(secret);

  const firstRow = (position: string): Locator =>
    pos(drawer, position).locator('.tarokka-row').first();
  await expect(firstRow('tome').getByRole('button')).toHaveText(['Open Journal']);
  await expect(firstRow('tome').locator('.tarokka-badge')).toHaveText('hidden from players');
  await expect(firstRow('holySymbol').locator('.tarokka-badge')).toHaveText([
    'not linked',
    'revealed',
  ]);
  await expect(firstRow('holySymbol').locator('.tarokka-badge.warn')).toHaveText('not linked');
  await expect(firstRow('holySymbol').getByRole('button')).toHaveText(['Open page']);
  await expect(firstRow('sunsword').getByRole('button')).toHaveText(['Open Scene', 'Open Actor']);
  await expect(firstRow('sunsword').locator('.tarokka-badge.revealed')).toHaveText('revealed');
  await expect(drawer.locator('.tarokka-form')).toHaveCount(0);
  expect(calls).toEqual([{ name: 'get-tarokka-reading', args: {} }]);

  // Open acts on the GM's own Foundry screen only: no change, no reload.
  await firstRow('holySymbol').getByRole('button', { name: 'Open page' }).click();
  await expect(toast(page, 'Opened in Foundry')).toBeVisible();
  await firstRow('sunsword').getByRole('button', { name: 'Open Actor' }).click();
  await expect.poll(() => calls.filter(c => c.name === 'open-in-foundry').length).toBe(2);
  expect(calls.filter(c => c.name === 'open-in-foundry').map(c => c.args)).toEqual([
    { uuid: REVEAL_PAGE },
    { uuid: 'Actor.a1' },
  ]);
  expect(loads(calls)).toBe(1);
});

test('Show cards shows names, ids and notes, and hides them again on untick and on close', async ({
  page,
}) => {
  await fakeStream(page, []);
  const calls = await fakeTools(page, call =>
    call.name === 'open-in-foundry'
      ? { status: 502, json: { ok: false, error: 'Bridge not connected' } }
      : bridge(call)
  );
  const drawer = await openTarokka(page);
  const show = drawer.getByRole('checkbox', { name: 'Show cards' });
  const cards = drawer.locator('.tarokka-card');
  await expect(cards).toHaveCount(5);

  await show.check();
  await expect(cards).toHaveText([
    'Three of Swords swords-3',
    'Seven of Coins coins-7',
    'Two of Glyphs glyphs-2',
    'Mists high-mists',
    'Raven high-raven',
  ]);
  await expect(drawer.locator('.tarokka-card.veiled')).toHaveCount(0);
  await expect(cards.first().locator('code')).toHaveText('swords-3');
  await expect(drawer.locator('.tarokka-note')).toHaveText([
    'Hidden in the burgomaster cellar',
    'Ezmerelda in the wagon',
  ]);
  // Only a re-render: the bridge is not asked again.
  expect(loads(calls)).toBe(1);

  await show.uncheck();
  await expect(drawer.locator('.tarokka-card.veiled')).toHaveCount(5);
  for (const secret of SECRETS) expect(await page.content()).not.toContain(secret);

  // Closing the drawer unticks it, so a reopened drawer starts hidden.
  await show.check();
  await expect(drawer.locator('.tarokka-note')).toHaveCount(2);
  await drawer.locator('#tarokka-close').click();
  await expect(drawer).toBeHidden();
  await page.locator('#btn-tarokka').click();
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);
  await expect(show).not.toBeChecked();
  await expect(drawer.locator('.tarokka-card.veiled')).toHaveCount(5);
  for (const secret of SECRETS) expect(await page.content()).not.toContain(secret);
  expect(loads(calls)).toBe(2);

  // A failed Open says why.
  await pos(drawer, 'tome').getByRole('button', { name: 'Open Journal' }).click();
  await expect(toast(page, '✗ open-in-foundry: Bridge not connected')).toBeVisible();
});

test('shows the empty state, and a failed load says why and keeps the last reading', async ({
  page,
}) => {
  await fakeStream(page, []);
  let view: unknown = EMPTY;
  let fail = true;
  await fakeTools(page, call => {
    if (call.name !== 'get-tarokka-reading') return bridge(call);
    return fail ? { status: 502, json: { ok: false, error: 'Bridge not connected' } } : ok(view);
  });
  const drawer = await openTarokka(page);
  const body = drawer.locator('#tarokka-body');
  const sub = drawer.locator('.drawer-sub');

  // A first load that fails: the reason, and the subtitle the old page shows before any load.
  await expect(body).toHaveText("Couldn't load the reading: Bridge not connected");
  await expect(sub).toHaveText('GM only. Stored in the bridge vault.');

  fail = false;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(body).toHaveText(
    'No reading in the vault. Import one from tarokka-reading or deal a new one.'
  );
  await expect(sub).toHaveText('GM only. No reading stored yet.');

  view = READING;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);

  fail = true;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(body.locator('> p.empty')).toHaveText(
    "Couldn't load the reading: Bridge not connected"
  );
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);
  await expect(sub).toHaveText('GM only · builtin-roll · 10/9/2026, 6:00:00 PM · 2 archived');
  // Show cards repaints the rows but never hides the error (the old page lost it here).
  await drawer.getByRole('checkbox', { name: 'Show cards' }).check();
  await expect(drawer.locator('.tarokka-card').first()).toHaveText('Three of Swords swords-3');
  await expect(body.locator('> p.empty')).toHaveText(
    "Couldn't load the reading: Bridge not connected"
  );
});

test('Import and New reading apply in one click, with Undo; both reload the reading', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);

  await drawer.getByRole('button', { name: 'Import from tarokka-reading' }).click();
  await expect(toast(page, '✓ Applied: Stored a reading')).toBeVisible();
  await expect(page.getByRole('dialog', { name: /action/ })).toHaveCount(0);
  expect(plans(calls)).toEqual([
    { name: 'plan-tarokka-import', args: { source: 'tarokka-reading' } },
  ]);
  expect(calls.find(c => c.name === 'apply-planned-change')).toEqual({
    name: 'apply-planned-change',
    args: { planId: 'im1' },
    confirm: true,
  });
  expect(names(calls)).not.toContain('get-planned-change');
  await expect.poll(() => loads(calls)).toBe(2);

  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(toast(page, '✓ Undid ch-im1')).toBeVisible();
  expect(calls.find(c => c.name === 'undo-change')).toEqual({
    name: 'undo-change',
    args: { changeId: 'ch-im1' },
    confirm: true,
    confirmDestructive: true,
  });
  await expect.poll(() => loads(calls)).toBe(3);

  await drawer.getByRole('button', { name: 'New reading (built-in roll)' }).click();
  await expect.poll(() => applies(calls)).toBe(2);
  expect(plans(calls)[1]).toEqual({
    name: 'plan-tarokka-import',
    args: { source: 'builtin-roll' },
  });
  await expect.poll(() => loads(calls)).toBe(4);
});

test('a failed import says why and still reloads; nothing is applied', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, call =>
    call.name === 'plan-tarokka-import'
      ? { status: 422, json: { ok: false, error: 'No tarokka-reading reading is available' } }
      : bridge(call)
  );
  const drawer = await openTarokka(page);
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);

  await drawer.getByRole('button', { name: 'Import from tarokka-reading' }).click();
  await expect(
    toast(page, '✗ plan-tarokka-import: No tarokka-reading reading is available')
  ).toBeVisible();
  await expect.poll(() => loads(calls)).toBe(2);
  expect(names(calls)).not.toContain('apply-planned-change');
  await expect(drawer.getByRole('button', { name: 'Import from tarokka-reading' })).toBeEnabled();
});

test('Link searches, picks in one click with Undo, and keeps an open form across reloads', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  let searchFails = false;
  const calls = await fakeTools(page, call =>
    call.name === 'suggest-tarokka-links' && searchFails
      ? { status: 502, json: { ok: false, error: 'Bridge not connected' } }
      : bridge(call)
  );
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  const linkButton = tome.getByRole('button', { name: 'Link…' });

  await linkButton.click();
  await expect(linkButton).toHaveAttribute('aria-expanded', 'true');
  const input = tome.getByPlaceholder('Search journals, pages, scenes, actors…');
  await expect(input).toBeFocused();

  // Too short: said here, the bridge is not asked.
  await input.fill(' V ');
  await tome.getByRole('button', { name: 'Search' }).click();
  await expect(tome.locator('.tarokka-candidates')).toHaveText('Type at least 2 characters.');
  expect(names(calls)).not.toContain('suggest-tarokka-links');

  // Enter searches too.
  await input.fill(' Vall ');
  await input.press('Enter');
  const rows = tome.locator('.tarokka-candidate');
  await expect(rows.locator('span')).toHaveText([
    'JournalEntryPage: Cellar (Vallaki)',
    'JournalEntry: Vallaki notes',
    'Scene: Vallaki',
    'Actor: Vallakovich',
  ]);
  expect(calls.find(c => c.name === 'suggest-tarokka-links')?.args).toEqual({
    query: 'Vall',
    limit: 20,
  });

  // A reload keeps the open form, what was typed and the results (the old page lost them).
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect.poll(() => loads(calls)).toBe(2);
  await expect(input).toHaveValue(' Vall ');
  await expect(rows).toHaveCount(4);

  // A whole journal goes under the journal page field, as on the old page.
  await rows.nth(1).getByRole('button', { name: 'Link' }).click();
  await expect(toast(page, '✓ Applied: Linked Tome')).toBeVisible();
  expect(plans(calls)).toEqual([
    { name: 'plan-tarokka-links', args: { position: 'tome', journalPageUuid: 'JournalEntry.j3' } },
  ]);
  expect(calls.find(c => c.name === 'apply-planned-change')).toEqual({
    name: 'apply-planned-change',
    args: { planId: 'ln1' },
    confirm: true,
  });
  // The reading reloads; the form and its results stay, so another match can be linked too.
  await expect.poll(() => loads(calls)).toBe(3);
  await expect(rows).toHaveCount(4);

  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(toast(page, '✓ Undid ch-ln1')).toBeVisible();
  await expect.poll(() => loads(calls)).toBe(4);

  // A scene and an actor go under their own fields, from one search at another position.
  const ally = pos(drawer, 'ally');
  await ally.getByRole('button', { name: 'Link…' }).click();
  await ally.getByPlaceholder('Search journals, pages, scenes, actors…').fill('Vall');
  await ally.getByRole('button', { name: 'Search' }).click();
  await ally.locator('.tarokka-candidate').nth(2).getByRole('button', { name: 'Link' }).click();
  await expect.poll(() => applies(calls)).toBe(2);
  await ally.locator('.tarokka-candidate').nth(3).getByRole('button', { name: 'Link' }).click();
  await expect.poll(() => applies(calls)).toBe(3);
  expect(plans(calls).slice(1)).toEqual([
    { name: 'plan-tarokka-links', args: { position: 'ally', sceneUuid: 'Scene.s7' } },
    { name: 'plan-tarokka-links', args: { position: 'ally', actorUuid: 'Actor.a7' } },
  ]);

  // A failed search says why in the list; no matches says so.
  const sun = pos(drawer, 'sunsword');
  await sun.getByRole('button', { name: 'Link…' }).click();
  await sun.getByPlaceholder('Search journals, pages, scenes, actors…').fill('Krezk');
  searchFails = true;
  await sun.getByRole('button', { name: 'Search' }).click();
  await expect(sun.locator('.tarokka-candidates')).toHaveText(
    "Couldn't search: Bridge not connected"
  );
  // Link… again closes the form.
  await sun.getByRole('button', { name: 'Link…' }).click();
  await expect(sun.locator('.tarokka-form')).toHaveCount(0);
});

test('a link search with no matches says so; a failed pick keeps the form', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  let found: unknown[] = [];
  const calls = await fakeTools(page, call => {
    if (call.name === 'suggest-tarokka-links') return ok({ candidates: found });
    if (call.name === 'plan-tarokka-links') {
      return { status: 422, json: { ok: false, error: 'No current reading' } };
    }
    return bridge(call);
  });
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Link…' }).click();
  const input = tome.getByPlaceholder('Search journals, pages, scenes, actors…');
  await input.fill('Nothing');
  await input.press('Enter');
  await expect(tome.locator('.tarokka-candidates')).toHaveText('No matches.');

  found = CANDIDATES;
  await input.press('Enter');
  await tome.locator('.tarokka-candidate').first().getByRole('button', { name: 'Link' }).click();
  await expect(toast(page, '✗ plan-tarokka-links: No current reading')).toBeVisible();
  await expect(tome.locator('.tarokka-candidate')).toHaveCount(4);
  await expect(input).toHaveValue('Nothing');
  expect(names(calls)).not.toContain('apply-planned-change');
});

test('Reveal asks first; Cancel keeps the draft, Confirm applies with both flags', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  const revealButton = tome.getByRole('button', { name: 'Reveal…', exact: true });

  await revealButton.click();
  const text = tome.getByPlaceholder('Exactly what the players may read');
  await expect(text).toBeFocused();
  const title = tome.getByPlaceholder('Page title (optional)');
  const showNow = tome.getByRole('checkbox', { name: 'Show it now' });
  const planButton = tome.getByRole('button', { name: 'Plan reveal…' });

  // No text: said at once, the bridge is not asked.
  await title.fill('An old book');
  await text.fill('   ');
  await planButton.click();
  await expect(toast(page, 'Write the text the players will read first.')).toBeVisible();
  expect(plans(calls)).toEqual([]);

  // Switching forms keeps the draft.
  await tome.getByRole('button', { name: 'Link…' }).click();
  await expect(text).toHaveCount(0);
  await revealButton.click();
  await expect(title).toHaveValue('An old book');

  await text.fill('  A heavy tome waits in the cellar.  ');
  await showNow.check();
  const loaded = loads(calls);
  await planButton.click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(confirm).toBeVisible();
  await expect(confirm.locator('.modal-summary')).toHaveText('Reveal Tome to the players');
  await expect(confirm.locator('.change-diff li')).toHaveText([
    'New page "Card 1" in "Tarokka reading"',
    'Players: observer',
  ]);
  expect(plans(calls)).toEqual([
    {
      name: 'plan-tarokka-reveal',
      args: {
        position: 'tome',
        text: 'A heavy tome waits in the cellar.',
        title: 'An old book',
        showNow: true,
      },
    },
  ]);
  const run = confirm.getByRole('button', { name: 'Run destructive action' });
  await expect(run).toBeDisabled();
  await confirm.getByRole('checkbox').check();
  await expect(run).toBeEnabled();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();

  // Cancel: nothing applied, Show it now unticked, the draft kept, and a reload.
  expect(names(calls)).not.toContain('apply-planned-change');
  await expect(showNow).not.toBeChecked();
  await expect(text).toHaveValue('  A heavy tome waits in the cellar.  ');
  await expect(title).toHaveValue('An old book');
  await expect.poll(() => loads(calls)).toBe(loaded + 1);
  await expect(planButton).toBeEnabled();

  // Again without a title or Show it now: neither is sent.
  await title.fill('');
  await planButton.click();
  await expect(confirm.getByRole('checkbox')).not.toBeChecked();
  expect(plans(calls)[1]?.args).toEqual({
    position: 'tome',
    text: 'A heavy tome waits in the cellar.',
  });
  await confirm.getByRole('checkbox').check();
  await run.click();
  await expect(confirm).toBeHidden();
  await expect(toast(page, '✓ Applied: Revealed Tome and shown to players')).toBeVisible();
  expect(calls.find(c => c.name === 'apply-planned-change')).toEqual({
    name: 'apply-planned-change',
    args: { planId: 'rv1' },
    confirm: true,
    confirmDestructive: true,
  });
  // The reading reloads once. The text is on the players' page now, so the form closes and the
  // draft goes: one more click must not plan it again as an update of that page.
  await expect.poll(() => loads(calls)).toBe(loaded + 2);
  await expect(tome.locator('.tarokka-form')).toHaveCount(0);

  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(toast(page, '✓ Undid ch-rv1')).toBeVisible();
  expect(calls.find(c => c.name === 'undo-change')).toEqual({
    name: 'undo-change',
    args: { changeId: 'ch-rv1' },
    confirm: true,
    confirmDestructive: true,
  });
  await expect.poll(() => loads(calls)).toBe(loaded + 3);

  // Reveal… opens an empty form.
  await revealButton.click();
  await expect(text).toHaveValue('');
  await expect(title).toHaveValue('');
  await expect(showNow).not.toBeChecked();
});

// Focus after a Cancel is the confirm window's own (#251: useGuardedChange records the clicked
// button and hands focus back once it is enabled again). After a reveal that went in, Plan reveal
// goes with its form, so the drawer moves focus to Reveal….
test('focus goes back to Plan reveal after a Cancel, and to Reveal… after a reveal', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  await tome.getByPlaceholder('Exactly what the players may read').fill('Text');
  const planButton = tome.getByRole('button', { name: 'Plan reveal…' });
  await planButton.click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(planButton).toBeFocused();

  await planButton.click();
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Run destructive action' }).click();
  await expect(toast(page, '✓ Applied: Revealed Tome and shown to players')).toBeVisible();
  await expect(tome.getByRole('button', { name: 'Reveal…', exact: true })).toBeFocused();
});

test('a popup that fails says so; the reveal still went in', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeTools(page, call =>
    call.name === 'apply-planned-change'
      ? ok({
          changeId: 'ch-rv1',
          summary: 'Revealed Tome',
          shown: { ok: false, error: 'No players' },
        })
      : bridge(call)
  );
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  await tome.getByPlaceholder('Exactly what the players may read').fill('Text');
  await tome.getByRole('checkbox', { name: 'Show it now' }).check();
  await tome.getByRole('button', { name: 'Plan reveal…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Run destructive action' }).click();
  await expect(toast(page, '✓ Applied: Revealed Tome')).toBeVisible();
  await expect(toast(page, 'Revealed, but the popup failed: No players')).toBeVisible();
});

test('an open form stays across a reload, but closes when its card changes', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  let view: unknown = READING;
  const calls = await fakeTools(page, call =>
    call.name === 'get-tarokka-reading' ? ok(view) : bridge(call)
  );
  const drawer = await openTarokka(page);
  await pos(drawer, 'tome').getByRole('button', { name: 'Reveal…', exact: true }).click();
  await pos(drawer, 'tome').getByPlaceholder('Exactly what the players may read').fill('Draft');
  await pos(drawer, 'ally').getByRole('button', { name: 'Reveal…', exact: true }).click();
  await pos(drawer, 'ally').getByPlaceholder('Exactly what the players may read').fill('Other');

  // A new reading deals another card at Tome only.
  view = {
    ...READING,
    reading: {
      ...READING.reading,
      positions: POSITIONS.map(p =>
        p.position === 'tome' ? { ...p, cardId: 'stars-9', cardName: 'Nine of Stars' } : p
      ),
    },
  };
  await drawer.getByRole('button', { name: 'New reading (built-in roll)' }).click();
  await expect(toast(page, '✓ Applied: Stored a reading')).toBeVisible();
  await expect.poll(() => loads(calls)).toBe(2);
  await expect(pos(drawer, 'tome').locator('.tarokka-form')).toHaveCount(0);
  await expect(
    pos(drawer, 'ally').getByPlaceholder('Exactly what the players may read')
  ).toHaveValue('Other');

  // No reading left: every form goes with it.
  view = EMPTY;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(0);
  view = READING;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);
  await expect(drawer.locator('.tarokka-form')).toHaveCount(0);
});

test('with GM Actions off nothing is planned; the gate opens Pre-flight', async ({ page }) => {
  await fakeStream(page, gmActions(false));
  const calls = await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  const gate = 'GM Actions are off. Ready for session in Pre-flight turns them on.';
  const preflight = page.getByRole('dialog', { name: '✈ Pre-flight' });

  await drawer.getByRole('button', { name: 'Import from tarokka-reading' }).click();
  await expect(toast(page, gate)).toBeVisible();
  await expect(preflight).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(preflight).toBeHidden();

  await drawer.getByRole('button', { name: 'New reading (built-in roll)' }).click();
  await expect(toast(page, gate)).toHaveCount(2);

  // Searching is a read and still works; the pick is gated.
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Link…' }).click();
  await tome.getByPlaceholder('Search journals, pages, scenes, actors…').fill('Vall');
  await tome.getByRole('button', { name: 'Search' }).click();
  await tome.locator('.tarokka-candidate').first().getByRole('button', { name: 'Link' }).click();
  await expect(toast(page, gate)).toHaveCount(3);
  await expect(tome.locator('.tarokka-candidate')).toHaveCount(4);

  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  await tome.getByPlaceholder('Exactly what the players may read').fill('Text');
  await tome.getByRole('button', { name: 'Plan reveal…' }).click();
  await expect(toast(page, gate)).toHaveCount(4);
  await expect(page.getByRole('dialog', { name: 'Destructive action' })).toHaveCount(0);

  expect(plans(calls)).toEqual([]);
  expect(names(calls)).not.toContain('apply-planned-change');
  expect(names(calls)).toContain('suggest-tarokka-links');
});

test('the Obsidian link shows once the stream sent the vault and the world', async ({ page }) => {
  await fakeStream(page, [
    { event: 'settings', data: { gmActionsEnabled: true, obsidian: { vault: 'My Vault' } } },
    { event: 'world', data: { id: 'curse-of-strahd', title: 'Curse of Strahd' } },
  ]);
  await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  const link = drawer.getByRole('link', { name: '📓 Obsidian' });
  await expect(link).toHaveAttribute(
    'href',
    'obsidian://open?vault=My%20Vault&file=Campaigns%2Fcurse-of-strahd%2FAI%20Tool%2FTarokka%2FCurrent%20reading'
  );
  await expect(link).toHaveAttribute('target', '_blank');
  await expect(link).toHaveAttribute('title', 'Open the current reading in Obsidian');
});

test('no Obsidian link without a vault or a world', async ({ page }) => {
  await fakeStream(page, [
    { event: 'settings', data: { gmActionsEnabled: true, obsidian: null } },
    { event: 'world', data: { id: 'curse-of-strahd' } },
  ]);
  await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  await expect(drawer.locator('.tarokka-pos')).toHaveCount(5);
  await expect(drawer.locator('#tarokka-obsidian')).toHaveCount(0);
});

test('Escape closes the confirm window first, then the drawer', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  await tome.getByPlaceholder('Exactly what the players may read').fill('Text');
  await tome.getByRole('button', { name: 'Plan reveal…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(confirm).toBeVisible();

  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(drawer).toBeVisible();
  expect(names(calls)).not.toContain('apply-planned-change');

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.locator('#btn-tarokka')).toHaveAttribute('aria-expanded', 'false');
});

/** Holds every call to one tool until release() is called, then answers it with result. */
async function holdTool(
  page: Page,
  calls: ToolCall[],
  name: string,
  result: unknown
): Promise<() => void> {
  let release: () => void = () => undefined;
  const held = new Promise<void>(resolve => (release = resolve));
  // Registered last, so it answers before fakeTools.
  await page.route('**/api/tool', async route => {
    const call = route.request().postDataJSON() as ToolCall;
    if (call.name !== name) return route.fallback();
    calls.push(call);
    await held;
    return route.fulfill({ json: { ok: true, result } });
  });
  return release;
}

test('one change at a time: a reveal waiting on its plan or its confirm holds every other change', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  // The reveal plan waits, as a slow Foundry snapshot would.
  const releasePlan = await holdTool(page, calls, 'plan-tarokka-reveal', REVEAL_PLAN);
  const drawer = await openTarokka(page);
  // By id: the drawer is hidden from the accessibility tree while the confirm window is open.
  const importButton = page.locator('#tarokka-import');
  const rollButton = page.locator('#tarokka-roll');
  const tome = pos(drawer, 'tome');
  const ally = pos(drawer, 'ally');
  await ally.getByRole('button', { name: 'Link…' }).click();
  await ally.getByPlaceholder('Search journals, pages, scenes, actors…').fill('Vall');
  await ally.getByRole('button', { name: 'Search' }).click();
  const allyLink = ally.locator('.tarokka-candidate').first().getByRole('button', { name: 'Link' });
  await expect(allyLink).toBeEnabled();
  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  await tome.getByPlaceholder('Exactly what the players may read').fill('Text');
  const planButton = tome.getByRole('button', { name: 'Plan reveal…' });

  await planButton.click();
  await expect.poll(() => plans(calls).length).toBe(1);
  // While the plan is out: no import, no new reading, no link, no second reveal.
  await expect(importButton).toBeDisabled();
  await expect(rollButton).toBeDisabled();
  await expect(allyLink).toBeDisabled();
  await expect(planButton).toBeDisabled();

  releasePlan();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(confirm).toBeVisible();
  // Still held while the confirm window is open.
  await expect(importButton).toBeDisabled();
  await expect(rollButton).toBeDisabled();
  await confirm.getByRole('button', { name: 'Cancel' }).click();

  // Free again once the reload after the Cancel is in.
  await expect(importButton).toBeEnabled();
  await expect(rollButton).toBeEnabled();
  await expect(allyLink).toBeEnabled();
  await expect(planButton).toBeEnabled();
  expect(plans(calls).map(c => c.name)).toEqual(['plan-tarokka-reveal']);
  expect(names(calls)).not.toContain('apply-planned-change');

  // The other way round: an import holds the position buttons until its reload is in.
  const releaseLoad = await holdTool(page, calls, 'get-tarokka-reading', READING);
  await importButton.click();
  await expect(toast(page, '✓ Applied: Stored a reading')).toBeVisible();
  await expect(planButton).toBeDisabled();
  await expect(allyLink).toBeDisabled();
  releaseLoad();
  await expect(planButton).toBeEnabled();
  await expect(allyLink).toBeEnabled();
});

test('an apply the bridge refuses says why, has no Undo, reloads and keeps the draft', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const refusal = 'The "tarokka" feature is switched off in the module settings';
  const calls = await fakeTools(page, call =>
    call.name === 'apply-planned-change'
      ? { status: 422, json: { ok: false, kind: 'tool', error: refusal } }
      : bridge(call)
  );
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  const text = tome.getByPlaceholder('Exactly what the players may read');
  await text.fill('Text');
  const planButton = tome.getByRole('button', { name: 'Plan reveal…' });
  const loaded = loads(calls);

  await planButton.click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Run destructive action' }).click();
  // A clear no: no "may have applied" hint, no Undo.
  await expect(toast(page, `✗ apply-planned-change: ${refusal}`)).toBeVisible();
  await expect(page.locator('.toast-stack .toast-undo')).toHaveCount(0);
  await expect.poll(() => loads(calls)).toBeGreaterThan(loaded);
  // The draft stays for another try, and every button is free again.
  await expect(text).toHaveValue('Text');
  await expect(planButton).toBeEnabled();
  const roll = drawer.getByRole('button', { name: 'New reading (built-in roll)' });
  await expect(roll).toBeEnabled();

  // A new reading refused the same way.
  await roll.click();
  await expect(toast(page, `✗ apply-planned-change: ${refusal}`)).toHaveCount(2);
  await expect(page.locator('.toast-stack .toast-undo')).toHaveCount(0);
  await expect(roll).toBeEnabled();
});

test('an apply that times out says it may have applied, reloads and keeps the draft', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, call =>
    call.name === 'apply-planned-change'
      ? { status: 502, json: { ok: false, kind: 'timeout', error: 'Timed out' } }
      : bridge(call)
  );
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  const text = tome.getByPlaceholder('Exactly what the players may read');
  await text.fill('Text');
  const loaded = loads(calls);
  await tome.getByRole('button', { name: 'Plan reveal…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await confirm.getByRole('checkbox').check();
  await confirm.getByRole('button', { name: 'Run destructive action' }).click();
  await expect(
    toast(
      page,
      '✗ apply-planned-change timed out. It may have applied; check Recent Changes on the full dashboard.'
    )
  ).toBeVisible();
  // The reload shows whether it went in; the form stays, as nothing says it did.
  await expect.poll(() => loads(calls)).toBeGreaterThan(loaded);
  await expect(text).toHaveValue('Text');
  await expect(tome.getByRole('button', { name: 'Plan reveal…' })).toBeEnabled();
});

test('Enter right after the confirm window opens applies nothing', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openTarokka(page);
  const tome = pos(drawer, 'tome');
  await tome.getByRole('button', { name: 'Reveal…', exact: true }).click();
  await tome.getByPlaceholder('Exactly what the players may read').fill('Text');
  await tome.getByRole('button', { name: 'Plan reveal…' }).click();
  const confirm = page.getByRole('dialog', { name: 'Destructive action' });
  await expect(confirm).toBeVisible();

  await page.keyboard.press('Enter');
  await page.keyboard.press('Enter');
  // Enter neither ticks the box nor runs the change.
  await expect(confirm).toBeVisible();
  await expect(confirm.getByRole('checkbox')).not.toBeChecked();
  await expect(confirm.getByRole('button', { name: 'Run destructive action' })).toBeDisabled();
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  expect(names(calls)).not.toContain('apply-planned-change');
});
