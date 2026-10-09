// The Tool runner on the React dashboard: the catalog by category (GET /api/tools, faked here),
// the search, a read, form checks, a plan typed by hand through the GM Actions gate and the
// confirm window (Cancel, Confirm, Undo), a destructive plan, a write that is not a plan, a failed
// plan, an apply the bridge refuses, Pick… lists naming a prefilled value, the Escape order, where
// focus goes, Enter never applying a change, and "+ Queue a page" in the Handouts drawer.
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

const PAGE_UUID = 'JournalEntry.j1.JournalEntryPage.p1';

const TOOLS = [
  {
    name: 'apply-planned-change',
    description: 'Apply a plan.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', 'x-foundry-ref': { kind: 'plan', value: 'id' } },
        // As the real schema has them: the confirm window answers both, the form never shows them.
        confirm: { type: 'boolean' },
        confirmDestructive: { type: 'boolean' },
      },
      required: ['planId', 'confirm'],
    },
    mutates: 'write',
  },
  {
    name: 'create-quest-journal',
    description: 'Make a quest journal.',
    inputSchema: {
      type: 'object',
      properties: {
        title: { type: 'string', description: 'The quest title.' },
        sceneId: { type: 'string', 'x-foundry-ref': { kind: 'scene', value: 'id' } },
      },
      required: ['title'],
    },
    mutates: 'write',
  },
  {
    name: 'get-world-info',
    description: 'The world, its system and its modules.',
    inputSchema: { type: 'object', properties: {} },
    mutates: 'read',
  },
  {
    name: 'measure-distance',
    description: 'How far apart two tokens are.',
    inputSchema: {
      type: 'object',
      properties: {
        squares: { type: 'integer', description: 'Grid squares.' },
        verbose: { type: 'boolean' },
        exact: { type: 'boolean', default: true },
        options: { type: 'object' },
      },
      required: ['squares'],
    },
    mutates: 'read',
  },
  {
    name: 'plan-actor-change',
    description: 'Plan damage, healing or a condition for tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['damage', 'heal'] },
        targets: {
          type: 'array',
          items: { type: 'string' },
          'x-foundry-ref': { kind: 'token', value: 'name' },
        },
        amount: { type: 'number' },
      },
      required: ['action', 'targets'],
    },
    mutates: 'read',
  },
  {
    name: 'plan-page-reveal',
    description: 'Plan revealing a journal page to players.',
    inputSchema: {
      type: 'object',
      properties: {
        pageUuid: { type: 'string', 'x-foundry-ref': { kind: 'journal-page', value: 'uuid' } },
        action: { type: 'string', enum: ['reveal', 'hide', 'queue', 'unqueue', 'reveal-next'] },
        players: {
          type: 'array',
          items: { type: 'string' },
          'x-foundry-ref': { kind: 'user', value: 'id', filter: { role: 'player' } },
        },
        sceneId: { type: 'string', 'x-foundry-ref': { kind: 'scene', value: 'id' } },
        setOwnership: { type: 'boolean' },
      },
    },
    mutates: 'read',
  },
  {
    name: 'search-compendium',
    description: 'Search the compendiums.',
    inputSchema: {
      type: 'object',
      properties: {
        entry: { type: 'string', 'x-foundry-ref': { kind: 'compendium-entry', value: 'uuid' } },
      },
    },
    mutates: 'read',
  },
  {
    name: 'undo-change',
    description: 'Undo a recorded change.',
    inputSchema: {
      type: 'object',
      properties: { changeId: { type: 'string' }, confirm: { type: 'boolean' } },
      required: ['changeId', 'confirm'],
    },
    mutates: 'destructive',
  },
];

const SCENES = [
  { id: 's1', name: 'Barovia', active: true },
  { id: 's2', name: 'Vallaki', active: false },
];

const CHOICES: Record<string, unknown[]> = {
  scene: SCENES.map(s => ({ id: s.id, name: s.name })),
  'journal-page': [
    { id: 'p1', uuid: PAGE_UUID, name: 'Letter from Kolyan', group: 'Handouts' },
    { id: 'p2', uuid: 'JournalEntry.j1.JournalEntryPage.p2', name: 'Map', group: 'Handouts' },
  ],
  user: [
    { id: 'u1', name: 'Anna' },
    { id: 'u2', name: 'Bo' },
  ],
  token: [
    { id: 't1', name: 'Wolf', detail: 'hostile' },
    { id: 't2', name: 'Wolf', detail: 'hostile', hidden: true },
    { id: 't3', name: 'Ireena', detail: 'friendly' },
  ],
  plan: [{ id: 'pl7', name: 'Rename Ireena' }],
};

const WRITE_PLAN = {
  planId: 'p1',
  risk: 'write',
  summary: 'Damage: 5 to Wolf',
  targets: [{ line: 'Wolf: 5 damage' }],
};
const REVEAL_PLAN = {
  planId: 'rp1',
  risk: 'destructive',
  summary: 'Reveal "Letter from Kolyan" to every player',
  diff: [{ text: 'Letter from Kolyan: visible to every player' }],
};
const APPLIED = { changeId: 'ch1', summary: 'Damage: 5 to Wolf' };

type ToolAnswer = { status?: number; json: unknown };

/** The bridge: the pickers' lists, the plans, the apply and the undo. */
const bridge = (call: ToolCall): ToolAnswer => {
  const a = call.args;
  if (call.name === 'list-ref-choices') {
    const kind = a['kind'] as string;
    if (kind === 'compendium-entry') {
      const q = a['query'] as string;
      return ok({
        kind,
        choices: [{ id: 'c1', uuid: 'Compendium.x.c1', name: `Sword of ${q}` }],
        truncated: false,
      });
    }
    return ok({ kind, choices: CHOICES[kind] ?? [], truncated: false });
  }
  if (call.name === 'get-world-info') return ok({ title: 'Curse of Strahd', system: 'dnd5e' });
  if (call.name === 'measure-distance') return ok({ feet: 10 });
  if (call.name === 'plan-actor-change') return ok(WRITE_PLAN);
  if (call.name === 'plan-page-reveal') {
    if (a['action'] === 'queue') return ok({ queued: true, note: 'Queued "Letter from Kolyan".' });
    return ok(REVEAL_PLAN);
  }
  if (call.name === 'get-planned-change') {
    return ok({
      planId: 'pl7',
      risk: 'write',
      summary: 'Rename Ireena',
      diff: [{ text: 'a → b' }],
    });
  }
  if (call.name === 'apply-planned-change') return ok(APPLIED);
  if (call.name === 'undo-change') return ok({ changeId: 'ch1', summary: 'Undid: Damage' });
  if (call.name === 'create-quest-journal') return ok({ summary: 'Made "Find Ireena"' });
  return ok({});
};

const gmActions = (on: boolean): { event: string; data: unknown }[] => [
  { event: 'settings', data: { gmActionsEnabled: on } },
];

const named = (calls: ToolCall[], name: string): ToolCall[] => calls.filter(c => c.name === name);

async function fakeCatalog(page: Page, gmActionsEnabled = true): Promise<void> {
  await page.route('**/api/tools', (route: Route) =>
    route.fulfill({ json: { tools: TOOLS, gmActionsEnabled } })
  );
}

async function openTools(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-tools').click();
  const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
  await expect(drawer).toBeVisible();
  return drawer;
}

async function openTool(drawer: Locator, name: string): Promise<void> {
  await drawer.locator(`[data-tool="${name}"]`).click();
  await expect(drawer.locator('#tool-detail-name')).toHaveText(name);
}

const field = (drawer: Locator, key: string): Locator => drawer.locator(`#tool-field-${key}`);
const confirmWindow = (page: Page, name = 'Confirm action'): Locator =>
  page.getByRole('dialog', { name });

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
  await page.route('**/api/player/names', route =>
    route.fulfill({
      json: [
        { userId: 'u1', name: 'Anna' },
        { userId: 'u2', name: 'Bo' },
      ],
    })
  );
});

test('lists the catalog by category with tags, and the search narrows it', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await expect(drawer.locator('.drawer-sub')).toHaveText('Run any Foundry bridge tool');
  await expect(drawer.locator('#gm-gate')).toBeHidden();

  await expect(drawer.locator('.tool-cat')).toHaveText([
    'Guarded changes',
    'Journals & Quests',
    'World & Info',
    'Actors',
    'Compendium',
  ]);
  // A tool no rule matches lands in World & Info, after the ones before it.
  await expect(
    drawer.getByRole('group', { name: 'World & Info' }).locator('.tool-item-name')
  ).toHaveText(['get-world-info', 'measure-distance', 'plan-page-reveal']);
  const guarded = drawer.getByRole('group', { name: 'Guarded changes' });
  await expect(guarded.locator('.tool-item-name')).toHaveText([
    'apply-planned-change',
    'undo-change',
  ]);
  await expect(guarded.locator('.tool-kind')).toHaveText(['write', 'destructive']);
  // A plan is a read to the gate, but its apply changes the game: tagged plan.
  await expect(drawer.locator('[data-tool="plan-page-reveal"] .tool-kind')).toHaveText('plan');
  await expect(drawer.locator('[data-tool="get-world-info"] .tool-kind')).toHaveText('read');

  // Name or description, any case.
  await drawer.locator('#tool-search').fill('JOURNAL PAGE');
  await expect(drawer.locator('.tool-item-name')).toHaveText(['plan-page-reveal']);
  await drawer.locator('#tool-search').fill('zzz');
  await expect(drawer.locator('#tool-list')).toHaveText('No tools match that search.');
});

test('a catalog that fails to load says why', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await page.route('**/api/tools', route =>
    route.fulfill({ status: 502, json: { error: 'Bridge not connected' } })
  );
  const drawer = await openTools(page);
  await expect(drawer.locator('#tool-list')).toHaveText(
    "Couldn't load tools: Bridge not connected"
  );
});

test('a read runs at once with GM Actions off and shows its result', async ({ page }) => {
  await fakeStream(page, gmActions(false));
  await fakeCatalog(page, false);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await expect(drawer.locator('#gm-gate')).toContainText('GM Actions are off');

  await openTool(drawer, 'get-world-info');
  await expect(drawer.locator('#tool-form')).toContainText('This tool takes no parameters.');
  await expect(drawer.locator('#tool-run')).toHaveText('Run');
  await drawer.locator('#tool-run').click();
  await expect(drawer.locator('#tool-result')).toHaveClass('tool-result ok');
  await expect(drawer.locator('#tool-result strong')).toHaveText('Result');
  await expect(drawer.locator('#tool-result pre')).toHaveText(
    JSON.stringify({ title: 'Curse of Strahd', system: 'dnd5e' }, null, 2)
  );
  expect(named(calls, 'get-world-info')).toEqual([{ name: 'get-world-info', args: {} }]);
  await expect(confirmWindow(page)).toBeHidden();

  // ‹ All tools goes back with focus on the tool; the form and its result are kept.
  await drawer.locator('#tool-back').click();
  await expect(drawer.locator('[data-tool="get-world-info"]')).toBeFocused();
  await openTool(drawer, 'get-world-info');
  await expect(drawer.locator('#tool-result')).toBeHidden();
});

test('the form checks required fields, numbers and JSON before it sends', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'measure-distance');
  // The schema default ticks the box; focus starts in the form.
  await expect(field(drawer, 'exact')).toBeChecked();
  await expect(field(drawer, 'squares')).toBeFocused();

  await drawer.locator('#tool-run').click();
  await expect(drawer.locator('#tool-form-error')).toHaveText('Required: squares');
  await expect(field(drawer, 'squares')).toHaveAttribute('aria-invalid', 'true');
  await expect(field(drawer, 'squares')).toBeFocused();

  await field(drawer, 'squares').fill('2.5');
  await field(drawer, 'options').fill('{ nope');
  await drawer.locator('#tool-run').click();
  await expect(drawer.locator('#tool-form-error')).toHaveText(
    '"squares" must be a whole number. "options" must be valid JSON.'
  );
  // A number field takes any text (a phone keypad still opens): text that is not a number is
  // named, never dropped as empty, as a browser number field would.
  await expect(field(drawer, 'squares')).toHaveAttribute('inputmode', 'numeric');
  await field(drawer, 'squares').fill('ten');
  await field(drawer, 'options').fill('');
  await drawer.locator('#tool-run').click();
  await expect(drawer.locator('#tool-form-error')).toHaveText('"squares" must be a number.');
  expect(named(calls, 'measure-distance')).toEqual([]);

  // An unticked optional box is left out; one that defaults to on is sent as off.
  await field(drawer, 'squares').fill('3');
  await field(drawer, 'options').fill('{ "diagonal": true }');
  await field(drawer, 'exact').uncheck();
  await drawer.locator('#tool-run').click();
  await expect(drawer.locator('#tool-result pre')).toHaveText(
    JSON.stringify({ feet: 10 }, null, 2)
  );
  await expect(drawer.locator('#tool-form-error')).toHaveText('');
  expect(named(calls, 'measure-distance').map(c => c.args)).toEqual([
    { squares: 3, exact: false, options: { diagonal: true } },
  ]);
});

test('with GM Actions off a plan is not even planned; Enable GM Actions turns them on', async ({
  page,
}) => {
  await fakeStream(page, gmActions(false));
  await fakeCatalog(page, false);
  const posted: unknown[] = [];
  await page.route('**/api/control', route => {
    posted.push(route.request().postDataJSON());
    return route.fulfill({ json: { gmActionsEnabled: true } });
  });
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await field(drawer, 'action').selectOption('damage');
  await field(drawer, 'targets').fill('Wolf');
  await drawer.locator('#tool-run').click();

  await expect(
    toast(page, 'GM Actions are off. Enable GM Actions at the top of the Tool Runner.')
  ).toBeVisible();
  // The gate bar in this drawer, not Pre-flight.
  await expect(drawer.locator('#gm-gate-enable')).toBeFocused();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeHidden();
  expect(named(calls, 'plan-actor-change')).toEqual([]);
  await expect(drawer.locator('#tool-result')).toBeHidden();

  await drawer.locator('#gm-gate-enable').click();
  await expect(toast(page, '✓ GM Actions are on')).toBeVisible();
  await expect(drawer.locator('#gm-gate')).toBeHidden();
  expect(posted).toEqual([{ action: 'set-gm-actions', value: true }]);
  // The draft is still there.
  await expect(field(drawer, 'targets')).toHaveValue('Wolf');
});

test('a plan typed by hand always asks: Cancel, then Confirm, the result and Undo', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await expect(drawer.locator('#tool-run')).toHaveText('Run…');
  await field(drawer, 'action').selectOption('damage');
  await field(drawer, 'amount').fill('5');

  // A name picker: same names are flagged, hidden tokens marked, several can be ticked.
  await drawer.locator('#tool-field-targets-pick').click();
  const menu = drawer.locator('#tool-field-targets-menu');
  await expect(menu.locator('.ref-item')).toHaveCount(3);
  await expect(menu.locator('.ref-warn')).toHaveText(['same name ×2', 'same name ×2']);
  await expect(menu.locator('.ref-flag')).toHaveText(['hidden']);
  await menu.locator('.ref-search').fill('iree');
  await expect(menu.locator('.ref-name')).toHaveText(['Ireena']);
  await menu.locator('.ref-item').click();
  await menu.locator('.ref-search').fill('');
  await menu.locator('.ref-item').first().click();
  await expect(field(drawer, 'targets')).toHaveValue('Ireena\nWolf');
  await expect(drawer.locator('#tool-field-targets-hint')).toHaveText('2 selected');
  // A click outside closes the list.
  await drawer.locator('#tool-detail-desc').click();
  await expect(menu).toBeHidden();

  await drawer.locator('#tool-run').click();
  const confirm = confirmWindow(page);
  await expect(confirm.locator('.modal-summary')).toHaveText('Damage: 5 to Wolf');
  await expect(confirm.locator('.change-diff li')).toHaveText(['Wolf: 5 damage']);
  await confirm.getByRole('button', { name: 'Cancel' }).click();
  await expect(confirm).toBeHidden();
  // Nothing applied, no result, the form as it was, focus back on Run.
  expect(named(calls, 'apply-planned-change')).toEqual([]);
  await expect(drawer.locator('#tool-result')).toBeHidden();
  await expect(drawer.locator('#tool-run')).toBeFocused();
  await expect(field(drawer, 'targets')).toHaveValue('Ireena\nWolf');

  await drawer.locator('#tool-run').click();
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(toast(page, '✓ Applied: Damage: 5 to Wolf')).toBeVisible();
  expect(named(calls, 'plan-actor-change').map(c => c.args)).toEqual([
    { action: 'damage', targets: ['Ireena', 'Wolf'], amount: 5 },
    { action: 'damage', targets: ['Ireena', 'Wolf'], amount: 5 },
  ]);
  expect(named(calls, 'apply-planned-change')).toEqual([
    { name: 'apply-planned-change', args: { planId: 'p1' }, confirm: true },
  ]);
  await expect(drawer.locator('#tool-result pre')).toHaveText(JSON.stringify(APPLIED, null, 2));
  await expect(drawer.locator('#tool-run')).toBeFocused();

  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(toast(page, '✓ Undid: Damage')).toBeVisible();
  expect(named(calls, 'undo-change')).toEqual([
    { name: 'undo-change', args: { changeId: 'ch1' }, confirm: true, confirmDestructive: true },
  ]);
});

test('an Undo GM Actions refuse after the drawer closed opens the Tool runner again', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  const calls = await fakeTools(page, call =>
    call.name === 'undo-change'
      ? { status: 403, json: { code: 'gm-actions-disabled', error: 'GM Actions are off.' } }
      : bridge(call)
  );
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await field(drawer, 'action').selectOption('damage');
  await field(drawer, 'targets').fill('Wolf');
  await drawer.locator('#tool-run').click();
  await confirmWindow(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(toast(page, '✓ Applied: Damage: 5 to Wolf')).toBeVisible();

  await drawer.getByRole('button', { name: 'Close' }).click();
  await expect(drawer).toBeHidden();
  await page.locator('.toast-stack .toast-undo .toast-action').click();
  // The Tool runner's own gate text, and its drawer, not Pre-flight.
  await expect(
    toast(page, 'GM Actions are off. Enable GM Actions at the top of the Tool Runner.')
  ).toBeVisible();
  await expect(drawer).toBeVisible();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeHidden();
  // The page takes the server's word: the gate bar shows, and has the focus.
  await expect(drawer.locator('#gm-gate-enable')).toBeFocused();
  expect(named(calls, 'undo-change')).toHaveLength(1);
});

test('an Undo GM Actions refuse with the drawer open under another brings it to the top', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  await fakeTools(page, call =>
    call.name === 'undo-change'
      ? { status: 403, json: { code: 'gm-actions-disabled', error: 'GM Actions are off.' } }
      : bridge(call)
  );
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await field(drawer, 'action').selectOption('damage');
  await field(drawer, 'targets').fill('Wolf');
  await drawer.locator('#tool-run').click();
  await confirmWindow(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(toast(page, '✓ Applied: Damage: 5 to Wolf')).toBeVisible();

  // The backdrop covers the header; from the keyboard a second drawer opens beside the first.
  await page.locator('#btn-party').press('Enter');
  const party = page.getByRole('dialog', { name: '🛡 Party' });
  await expect(party).toHaveClass(/drawer-top/);
  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(drawer).toHaveClass(/drawer-top/);
  await expect(party).not.toHaveClass(/drawer-top/);
  await expect(drawer.locator('#gm-gate-enable')).toBeFocused();
  // Escape follows the top: the Tool runner closes first, then Party.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(party).toHaveClass(/drawer-top/);
  await page.keyboard.press('Escape');
  await expect(party).toBeHidden();
});

test('Enter in a field never applies a change without the confirm window', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await field(drawer, 'action').selectOption('damage');
  await field(drawer, 'targets').fill('Wolf');
  await field(drawer, 'amount').fill('5');
  await field(drawer, 'amount').press('Enter');

  const confirm = confirmWindow(page);
  await expect(confirm).toBeVisible();
  // A second Enter lands on Cancel, the window's first button.
  await page.keyboard.press('Enter');
  await expect(confirm).toBeHidden();
  expect(named(calls, 'plan-actor-change')).toHaveLength(1);
  expect(named(calls, 'apply-planned-change')).toEqual([]);
  // Focus goes back to the field Enter was pressed in.
  await expect(field(drawer, 'amount')).toBeFocused();

  // Enter in a Pick… filter box picks nothing and sends nothing.
  await drawer.locator('#tool-field-targets-pick').click();
  await drawer.locator('#tool-field-targets-menu .ref-search').press('Enter');
  await expect(confirm).toBeHidden();
  expect(named(calls, 'plan-actor-change')).toHaveLength(1);
});

test('a destructive plan waits for the tick and applies with both flags', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-page-reveal');
  await field(drawer, 'action').selectOption('reveal');
  await drawer.locator('#tool-field-pageUuid-pick').click();
  const menu = drawer.locator('#tool-field-pageUuid-menu');
  await expect(menu.locator('.ref-group')).toHaveText(['Handouts']);
  await menu.getByRole('option', { name: /Letter from Kolyan/ }).click();
  await expect(menu).toBeHidden();
  await expect(field(drawer, 'pageUuid')).toHaveValue(PAGE_UUID);
  await expect(field(drawer, 'pageUuid')).toBeFocused();
  await expect(drawer.locator('#tool-field-pageUuid-hint')).toHaveText('Letter from Kolyan');
  // Players by id, named in the hint.
  await drawer.locator('#tool-field-players-pick').click();
  await drawer.locator('#tool-field-players-menu').getByRole('option', { name: /Bo/ }).click();
  await expect(drawer.locator('#tool-field-players-hint')).toHaveText('Bo');
  expect(named(calls, 'list-ref-choices').find(c => c.args['kind'] === 'user')?.args).toEqual({
    kind: 'user',
    filter: { role: 'player' },
    limit: 200,
  });

  await drawer.locator('#tool-run').click();
  const confirm = confirmWindow(page, 'Destructive action');
  await expect(confirm.locator('.change-diff li')).toHaveText([
    'Letter from Kolyan: visible to every player',
  ]);
  const run = confirm.getByRole('button', { name: 'Run destructive action' });
  await expect(run).toBeDisabled();
  await confirm.getByRole('checkbox').check();
  await run.click();
  await expect(toast(page, '✓ Applied: Damage: 5 to Wolf')).toBeVisible();
  expect(named(calls, 'plan-page-reveal').map(c => c.args)).toEqual([
    { pageUuid: PAGE_UUID, action: 'reveal', players: ['u2'] },
  ]);
  expect(named(calls, 'apply-planned-change')).toEqual([
    {
      name: 'apply-planned-change',
      args: { planId: 'rp1' },
      confirm: true,
      confirmDestructive: true,
    },
  ]);
});

test('a write that is not a plan asks with its args, names shown with their ids', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'create-quest-journal');
  await field(drawer, 'title').fill('Find Ireena');
  await drawer.locator('#tool-field-sceneId-pick').click();
  await drawer
    .locator('#tool-field-sceneId-menu')
    .getByRole('option', { name: /Vallaki/ })
    .click();
  await drawer.locator('#tool-run').click();

  const confirm = confirmWindow(page);
  await expect(confirm.locator('.modal-summary')).toHaveText(
    'Run create-quest-journal against the live game?'
  );
  await expect(confirm.locator('.change-diff li')).toHaveText([
    'title: Find Ireena',
    'sceneId: Vallaki (s2)',
  ]);
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(toast(page, '✓ create-quest-journal')).toBeVisible();
  expect(named(calls, 'create-quest-journal')).toEqual([
    {
      name: 'create-quest-journal',
      args: { title: 'Find Ireena', sceneId: 's2' },
      confirm: true,
    },
  ]);

  // apply-planned-change by hand shows the plan it applies, as the old page does.
  await drawer.locator('#tool-back').click();
  await openTool(drawer, 'apply-planned-change');
  await drawer.locator('#tool-field-planId-pick').click();
  await drawer
    .locator('#tool-field-planId-menu')
    .getByRole('option', { name: /Rename/ })
    .click();
  await expect(drawer.locator('#tool-field-planId-hint')).toHaveText('Rename Ireena');
  await drawer.locator('#tool-run').click();
  await expect(confirm.locator('.modal-summary')).toHaveText('Rename Ireena');
  await expect(confirm.locator('.change-diff li')).toHaveText(['a → b']);
  await confirm.getByRole('button', { name: 'Confirm' }).click();
  await expect(toast(page, '✓ Applied: Damage: 5 to Wolf')).toBeVisible();
  expect(named(calls, 'apply-planned-change')).toEqual([
    { name: 'apply-planned-change', args: { planId: 'pl7' }, confirm: true },
  ]);

  // undo-change by hand is destructive: the tick first.
  await drawer.locator('#tool-back').click();
  await openTool(drawer, 'undo-change');
  await field(drawer, 'changeId').fill('ch1');
  await expect(drawer.locator('.field[data-key="confirm"]')).toHaveCount(0);
  await drawer.locator('#tool-run').click();
  const destructive = confirmWindow(page, 'Destructive action');
  await expect(destructive.locator('.change-diff li')).toHaveText(['changeId: ch1']);
  await expect(destructive.getByRole('button', { name: 'Run destructive action' })).toBeDisabled();
  await destructive.getByRole('checkbox').check();
  await destructive.getByRole('button', { name: 'Run destructive action' }).click();
  await expect(toast(page, '✓ Undid: Damage')).toBeVisible();
  expect(named(calls, 'undo-change')).toEqual([
    { name: 'undo-change', args: { changeId: 'ch1' }, confirm: true, confirmDestructive: true },
  ]);
});

test('a failed plan and a refused apply show the error under the form', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  let applyRefused = false;
  const calls = await fakeTools(page, call => {
    if (call.name === 'plan-actor-change' && !applyRefused) {
      return { status: 422, json: { ok: false, kind: 'tool', error: 'No token named Wolf' } };
    }
    if (call.name === 'apply-planned-change') {
      return {
        status: 422,
        json: { ok: false, kind: 'tool', error: 'The Combat feature is off in Foundry.' },
      };
    }
    return bridge(call);
  });
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await field(drawer, 'action').selectOption('heal');
  await field(drawer, 'targets').fill('Wolf');
  await drawer.locator('#tool-run').click();
  await expect(toast(page, '✗ plan-actor-change: No token named Wolf')).toBeVisible();
  await expect(drawer.locator('#tool-result')).toHaveClass('tool-result err');
  await expect(drawer.locator('#tool-result strong')).toHaveText('Error');
  await expect(drawer.locator('#tool-result pre')).toHaveText('No token named Wolf');
  await expect(confirmWindow(page)).toBeHidden();

  // The bridge refuses the apply (a feature switch off): a clear no, no "may have applied" hint.
  applyRefused = true;
  await drawer.locator('#tool-run').click();
  await confirmWindow(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(
    toast(page, '✗ apply-planned-change: The Combat feature is off in Foundry.')
  ).toBeVisible();
  await expect(drawer.locator('#tool-result pre')).toHaveText(
    'The Combat feature is off in Foundry.'
  );
  expect(named(calls, 'apply-planned-change')).toHaveLength(1);
});

test('an apply that timed out says it may have applied', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  await fakeTools(page, call =>
    call.name === 'apply-planned-change'
      ? { status: 502, json: { ok: false, kind: 'timeout', error: 'Timed out' } }
      : bridge(call)
  );
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await field(drawer, 'action').selectOption('damage');
  await field(drawer, 'targets').fill('Wolf');
  await drawer.locator('#tool-run').click();
  await confirmWindow(page).getByRole('button', { name: 'Confirm' }).click();
  await expect(drawer.locator('#tool-result pre')).toHaveText(
    'Timed out. It may have applied; check Recent Changes on the full dashboard.'
  );
});

test('Escape closes an open Pick… list, then the confirm window, then the drawer', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'plan-actor-change');
  await field(drawer, 'action').selectOption('damage');
  await field(drawer, 'targets').fill('Wolf');

  await drawer.locator('#tool-field-targets-pick').click();
  await expect(drawer.locator('#tool-field-targets-menu .ref-search')).toBeFocused();
  await page.keyboard.press('Escape');
  await expect(drawer.locator('#tool-field-targets-menu')).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('#tool-field-targets-pick')).toBeFocused();

  await drawer.locator('#tool-run').click();
  const confirm = confirmWindow(page);
  await expect(confirm).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(confirm).toBeHidden();
  await expect(drawer).toBeVisible();
  await expect(drawer.locator('#tool-run')).toBeFocused();

  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  // The form survives closing the drawer.
  await page.locator('#btn-tools').click();
  await expect(drawer.locator('#tool-detail-name')).toHaveText('plan-actor-change');
  await expect(field(drawer, 'targets')).toHaveValue('Wolf');
});

test('a compendium picker waits for two letters', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeCatalog(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openTools(page);
  await openTool(drawer, 'search-compendium');
  await drawer.locator('#tool-field-entry-pick').click();
  const menu = drawer.locator('#tool-field-entry-menu');
  await expect(menu.locator('.ref-note')).toHaveText('Type at least 2 letters to search.');
  await menu.locator('.ref-search').fill('a');
  await expect(menu.locator('.ref-empty')).toHaveText('Type at least 2 letters.');
  await menu.locator('.ref-search').fill('ash');
  await expect(menu.locator('.ref-name')).toHaveText(['Sword of ash']);
  expect(named(calls, 'list-ref-choices').map(c => c.args)).toEqual([
    { kind: 'compendium-entry', query: 'ash', limit: 200 },
  ]);
});

test('+ Queue a page opens the Tool runner filled in, names shown, and queues on Run', async ({
  page,
}) => {
  // Queueing changes nothing in Foundry: it works with GM Actions off, as Remove does.
  await fakeStream(page, gmActions(false));
  await fakeCatalog(page, false);
  const calls = await fakeTools(page, call => {
    if (call.name === 'list-revealed-pages') return ok({ pages: [], queue: [] });
    if (call.name === 'list-scenes') return ok(SCENES);
    return bridge(call);
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-handouts').click();
  const handouts = page.getByRole('dialog', { name: '📜 Handouts' });
  await expect(handouts.locator('#handouts-queue')).toContainText('Nothing queued');
  await handouts.locator('#handouts-add').click();

  const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
  await expect(drawer.locator('#tool-detail-name')).toHaveText('plan-page-reveal');
  await expect(handouts).toBeHidden();
  await expect(field(drawer, 'action')).toHaveValue('queue');
  await expect(field(drawer, 'sceneId')).toHaveValue('s1');
  // The prefilled scene id is named, not left as a bare id.
  await expect(drawer.locator('#tool-field-sceneId-hint')).toHaveText('Barovia');
  await expect(field(drawer, 'pageUuid')).toBeFocused();
  // It only fills the form in: nothing ran.
  expect(named(calls, 'plan-page-reveal')).toEqual([]);

  await drawer.locator('#tool-field-pageUuid-pick').click();
  await drawer
    .locator('#tool-field-pageUuid-menu')
    .getByRole('option', { name: /Letter from Kolyan/ })
    .click();
  await drawer.locator('#tool-run').click();
  await expect(toast(page, '✓ Queued "Letter from Kolyan".')).toBeVisible();
  expect(named(calls, 'plan-page-reveal')).toEqual([
    {
      name: 'plan-page-reveal',
      args: { pageUuid: PAGE_UUID, action: 'queue', sceneId: 's1' },
    },
  ]);
  await expect(drawer.locator('#tool-result')).toHaveClass('tool-result ok');
  await expect(confirmWindow(page)).toBeHidden();

  // A second click fills the form in fresh.
  await field(drawer, 'action').selectOption('hide');
  await drawer.getByRole('button', { name: 'Close' }).click();
  await page.locator('#btn-handouts').click();
  await handouts.locator('#handouts-add').click();
  await expect(field(drawer, 'action')).toHaveValue('queue');
  await expect(field(drawer, 'pageUuid')).toHaveValue('');
});

test('a request for a tool the catalog lacks says so and shows the list', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await page.route('**/api/tools', route =>
    route.fulfill({ json: { tools: TOOLS.filter(t => t.name !== 'plan-page-reveal') } })
  );
  await fakeTools(page, call => {
    if (call.name === 'list-revealed-pages') return ok({ pages: [], queue: [] });
    if (call.name === 'list-scenes') return ok(SCENES);
    return bridge(call);
  });
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-handouts').click();
  await page.locator('#handouts-add').click();
  await expect(toast(page, 'Tool "plan-page-reveal" isn\'t in the catalog.')).toBeVisible();
  const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
  await expect(drawer.locator('#tool-list')).toBeVisible();
  await expect(drawer.locator('#tool-detail')).toHaveCount(0);
});
