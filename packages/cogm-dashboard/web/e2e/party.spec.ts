// The Party drawer on the React dashboard: the get-party read (POST /api/tool, faked here), the
// member rows and sections, the group picker, the empty and failed states, the four one-click
// changes (plan-party-change, then apply-planned-change) with the Undo toast, the refusals (GM
// Actions off or not heard yet, a failed plan, a 403 at apply, a plan that needs a confirm), an
// apply that times out or whose answer got lost, the gate seeded from Pre-flight's read, and
// Escape with a toast up.
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

const IREENA = {
  actorId: 'a1',
  uuid: 'Actor.a1',
  name: 'Ireena',
  type: 'character',
  level: 3,
  hp: { value: 5, max: 20, temp: 3 },
  ac: 15,
  passivePerception: 13,
  exhaustion: 2,
  hitDice: { value: 2, max: 3 },
  deathSaves: null,
  conditions: ['Poisoned'],
  inspiration: true,
  tokens: [{ tokenId: 't1', name: 'Ireena', hidden: true, inCombat: false }],
};

const ISMARK = {
  actorId: 'a2',
  uuid: 'Actor.a2',
  name: 'Ismark',
  type: 'character',
  level: 3,
  hp: { value: 0, max: 30, temp: 0 },
  ac: null,
  passivePerception: null,
  exhaustion: 0,
  hitDice: null,
  deathSaves: { success: 1, failure: 2 },
  conditions: [],
  inspiration: false,
  tokens: [],
};

const GROUP = {
  actorId: 'g1',
  uuid: 'Actor.g1',
  name: 'The Party',
  primary: true,
  level: 3,
  pace: { value: 'normal', label: 'Normal', slowed: false },
  members: [IREENA, ISMARK],
  restCards: { short: { type: 'request' } },
};

const STATE = {
  groups: [GROUP],
  paceOptions: [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
  ],
  scene: { sceneId: 's1', name: 'Barovia' },
  encounter: { combatId: 'c1', uuid: 'Combat.c1', round: 2, started: true },
  warnings: ['One actor could not be read.'],
};

const PLAN = { planId: 'p1', risk: 'write', targets: [] };
const APPLIED = { changeId: 'ch1', summary: 'Travel pace set to Fast' };
const UNDONE = { changeId: 'ch1', summary: 'Undid: Travel pace set to Fast' };

type ToolAnswer = { status?: number; json: unknown };
type Answer = (call: ToolCall) => ToolAnswer;

/** The bridge for the write tests: the party, a write plan, the apply and the undo. */
const bridge: Answer = call => {
  if (call.name === 'get-party') return ok(STATE);
  if (call.name === 'plan-party-change') return ok(PLAN);
  if (call.name === 'apply-planned-change') return ok(APPLIED);
  if (call.name === 'undo-change') return ok(UNDONE);
  return ok({});
};

const names = (calls: ToolCall[]): string[] => calls.map(c => c.name);

async function openParty(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-party').click();
  const drawer = page.getByRole('dialog', { name: '🛡 Party' });
  await expect(drawer).toBeVisible();
  return drawer;
}

/** Pre-flight's own routes, for the tests where a refusal opens it. */
async function fakePreflight(page: Page): Promise<void> {
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({ json: { switches: { switches: [] }, gmActionsEnabled: false } })
  );
}

const gmActions = (on: boolean): { event: string; data: unknown }[] => [
  { event: 'settings', data: { gmActionsEnabled: on } },
];

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
});

test('loads the party on open and shows each member and section', async ({ page }) => {
  await fakeStream(page, []);
  const calls = await fakeTools(page, () => ok(STATE));
  const drawer = await openParty(page);

  await expect(drawer.locator('.drawer-sub')).toHaveText('GM only. The Party, level 3, 2 members.');
  expect(calls).toEqual([{ name: 'get-party', args: {} }]);
  await expect(drawer.locator('#party-warnings .pf-warn')).toHaveText(
    'One actor could not be read.'
  );
  await expect(drawer.locator('#party-group')).toHaveCount(0);

  const rows = drawer.getByRole('list', { name: 'Members' }).locator('.party-member');
  await expect(rows.locator('.pf-label')).toHaveText(['Ireena ★', 'Ismark']);
  await expect(rows.nth(0).locator('.party-inspiration')).toHaveAttribute('title', 'Inspiration');
  await expect(rows.nth(0).locator('.pf-detail')).toHaveText([
    'Level 3 · AC 15 · Passive Perception 13 · Hit dice 2/3',
    'On Barovia, hidden',
  ]);
  await expect(rows.nth(0).locator('.condition-chip')).toHaveText(['Exhaustion 2', 'Poisoned']);
  await expect(rows.nth(0).locator('.hp-text')).toHaveText('5/20 +3');
  await expect(rows.nth(0).locator('.hp-fill')).toHaveClass('hp-fill low');
  await expect(rows.nth(0).locator('.hp-fill')).toHaveAttribute('style', 'width: 25%;');
  await expect(rows.nth(1).locator('.pf-detail')).toHaveText(['Level 3', 'No token on Barovia']);
  await expect(rows.nth(1).locator('.death-saves')).toHaveText('Death saves: 1 saved, 2 failed');
  await expect(rows.nth(1).locator('.hp-text')).toHaveText('0/30');

  const pace = drawer.locator('#party-pace');
  await expect(pace.locator('p')).toHaveText('Now: Normal');
  await expect(pace.getByRole('button', { name: 'Normal' })).toBeDisabled();
  await expect(pace.getByRole('button', { name: 'Fast' })).toBeEnabled();

  const combat = drawer.locator('#party-combat');
  await expect(combat.locator('p').first()).toHaveText('Encounter on Barovia, round 2.');
  await expect(combat.getByRole('button', { name: 'Add 1 to the encounter' })).toBeEnabled();
  await expect(combat.getByRole('button', { name: 'Place the party here' })).toBeEnabled();

  const rest = drawer.locator('#party-rest');
  await expect(rest.getByRole('button', { name: 'Short rest request' })).toBeEnabled();
  await expect(rest.getByRole('button', { name: 'Long rest request' })).toBeDisabled();
});

test('the combat and pace lines follow the encounter, the tokens and a slowed member', async ({
  page,
}) => {
  await fakeStream(page, []);
  let state: unknown = { ...STATE, encounter: null };
  await fakeTools(page, () => ok(state));
  const drawer = await openParty(page);
  const combat = drawer.locator('#party-combat');

  await expect(combat.locator('p').first()).toHaveText(
    'No encounter. The button starts one on Barovia.'
  );
  await expect(combat.getByRole('button', { name: 'Start an encounter with 1' })).toBeEnabled();

  const allIn = { ...IREENA, tokens: [{ ...IREENA.tokens[0], inCombat: true }] };
  state = {
    ...STATE,
    encounter: { ...STATE.encounter, started: false },
    groups: [
      {
        ...GROUP,
        pace: { value: 'normal', label: 'Slow', slowed: true },
        members: [allIn, ISMARK],
      },
    ],
  };
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(combat.locator('p').first()).toHaveText(
    'Encounter on Barovia, round 2 (not started).'
  );
  await expect(combat.getByRole('button', { name: 'Everyone is in the encounter' })).toBeDisabled();
  await expect(drawer.locator('.party-member').first().locator('.pf-detail').last()).toHaveText(
    'On Barovia, hidden, in the encounter'
  );
  await expect(drawer.locator('#party-pace p')).toHaveText(
    'Now: Slow. A slowed member holds the party to slow pace.'
  );
  await expect(drawer.locator('#party-pace').getByRole('button', { name: 'Normal' })).toBeEnabled();

  state = { ...STATE, groups: [{ ...GROUP, members: [ISMARK], pace: null }] };
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(combat.getByRole('button', { name: 'No party tokens on Barovia' })).toBeDisabled();
  await expect(drawer.locator('#party-pace')).toHaveText('This group has no travel pace.');

  // Without a scene the bridge reads no tokens, and the rows say nothing about them.
  state = { ...STATE, scene: null, groups: [{ ...GROUP, members: [ISMARK] }] };
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(combat).toHaveText('No active scene.');
  await expect(drawer.locator('.party-member .pf-detail')).toHaveText(['Level 3']);
});

test('the group picker shows with two groups and switches without a load', async ({ page }) => {
  await fakeStream(page, []);
  const other = { ...GROUP, actorId: 'g2', name: 'Scouts', primary: false, members: [ISMARK] };
  const calls = await fakeTools(page, () => ok({ ...STATE, groups: [GROUP, other] }));
  const drawer = await openParty(page);

  const picker = drawer.getByRole('combobox', { name: 'Party group' });
  await expect(picker.locator('option')).toHaveText(['The Party (primary)', 'Scouts']);
  await picker.selectOption('g2');
  await expect(drawer.locator('.drawer-sub')).toHaveText(
    'GM only. Scouts, level 3, 1 member. Not the primary party.'
  );
  await expect(drawer.locator('.party-member .pf-label')).toHaveText('Ismark');
  expect(names(calls)).toEqual(['get-party']);
});

test('shows the empty states', async ({ page }) => {
  await fakeStream(page, []);
  let state: unknown = { ...STATE, groups: [], warnings: [] };
  await fakeTools(page, () => ok(state));
  const drawer = await openParty(page);

  await expect(drawer.locator('.drawer-sub')).toHaveText('GM only. No party yet.');
  await expect(drawer.locator('#party-members .empty')).toHaveText(
    'No party yet. In Foundry, create an Actor of type Group, drag the characters onto it, then right-click it in the Actors tab and set it as the primary party.'
  );
  await expect(drawer.locator('#party-actions')).toHaveCount(0);

  state = { ...STATE, groups: [{ ...GROUP, members: [] }] };
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.locator('#party-members .empty')).toHaveText(
    'The group has no members. Drag characters onto it in Foundry.'
  );
  await expect(drawer.locator('.drawer-sub')).toHaveText('GM only. The Party, level 3, 0 members.');
  await expect(drawer.locator('#party-actions')).toBeVisible();
});

test('a failed load says why and a refresh recovers', async ({ page }) => {
  await fakeStream(page, []);
  let fail = true;
  await fakeTools(page, () =>
    fail ? { status: 502, json: { ok: false, error: 'Bridge not connected' } } : ok(STATE)
  );
  const drawer = await openParty(page);

  await expect(drawer.locator('.drawer-sub')).toHaveText('GM only. The party did not load.');
  await expect(drawer.locator('#party-members .empty')).toHaveText(
    "Couldn't load the party: Bridge not connected"
  );
  await expect(drawer.locator('#party-actions')).toHaveCount(0);

  fail = false;
  await drawer.getByRole('button', { name: '↻ Refresh' }).click();
  await expect(drawer.getByRole('list', { name: 'Members' })).toBeVisible();
});

test('a pace click plans, applies in one click, reloads, and Undo reverts it', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openParty(page);
  await expect(drawer.getByRole('list', { name: 'Members' })).toBeVisible();

  await drawer.locator('#party-pace').getByRole('button', { name: 'Fast' }).click();
  await expect(toast(page, '✓ Applied: Travel pace set to Fast')).toBeVisible();
  expect(calls.slice(1, 3)).toEqual([
    { name: 'plan-party-change', args: { action: 'pace', pace: 'fast', groupId: 'g1' } },
    { name: 'apply-planned-change', args: { planId: 'p1' }, confirm: true },
  ]);
  await expect.poll(() => names(calls)[3]).toBe('get-party');

  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(toast(page, '✓ Undid: Travel pace set to Fast')).toBeVisible();
  await expect
    .poll(() => calls.slice(4))
    .toEqual([
      { name: 'undo-change', args: { changeId: 'ch1' }, confirm: true, confirmDestructive: true },
      { name: 'get-party', args: {} },
    ]);
});

test('each action sends its own plan, and a double click sends once', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openParty(page);
  const plans = (): unknown[] => calls.filter(c => c.name === 'plan-party-change').map(c => c.args);

  await drawer.getByRole('button', { name: 'Add 1 to the encounter' }).dblclick();
  await expect.poll(plans).toEqual([{ action: 'add-to-combat', groupId: 'g1' }]);
  await expect(drawer.getByRole('button', { name: 'Place the party here' })).toBeEnabled();
  await drawer.getByRole('button', { name: 'Place the party here' }).click();
  await expect(drawer.getByRole('button', { name: 'Short rest request' })).toBeEnabled();
  await drawer.getByRole('button', { name: 'Short rest request' }).click();
  await expect.poll(plans).toEqual([
    { action: 'add-to-combat', groupId: 'g1' },
    { action: 'place', groupId: 'g1' },
    { action: 'rest-request', rest: 'short', groupId: 'g1' },
  ]);
});

test('with GM Actions off nothing is planned and Pre-flight opens', async ({ page }) => {
  await fakeStream(page, gmActions(false));
  await fakePreflight(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openParty(page);

  await drawer.getByRole('button', { name: 'Short rest request' }).click();
  await expect(
    toast(page, 'GM Actions are off. Ready for session in Pre-flight turns them on.')
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeVisible();
  // Pre-flight's Ready block reads get-play-session; nothing was planned or applied.
  expect(names(calls).filter(n => n !== 'get-play-session')).toEqual(['get-party']);
});

test('before the stream says GM Actions are on, a click plans nothing', async ({ page }) => {
  await fakeStream(page, []);
  await fakePreflight(page);
  const calls = await fakeTools(page, bridge);
  const drawer = await openParty(page);

  await drawer.locator('#party-pace').getByRole('button', { name: 'Fast' }).click();
  await expect(
    toast(page, 'GM Actions are off. Ready for session in Pre-flight turns them on.')
  ).toBeVisible();
  expect(names(calls).filter(n => n !== 'get-play-session')).toEqual(['get-party']);
});

test('an applied change without a changeId shows no Undo', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  await fakeTools(page, call =>
    call.name === 'apply-planned-change' ? ok({ summary: 'Travel pace set to Fast' }) : bridge(call)
  );
  const drawer = await openParty(page);

  await drawer.locator('#party-pace').getByRole('button', { name: 'Fast' }).click();
  await expect(toast(page, '✓ Applied: Travel pace set to Fast')).toBeVisible();
  await expect(page.locator('.toast-stack .toast-action')).toHaveCount(0);
});

test('an apply that times out says it may have applied and reloads the party', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, call =>
    call.name === 'apply-planned-change'
      ? { status: 502, json: { ok: false, kind: 'timeout', error: 'Timed out' } }
      : bridge(call)
  );
  const drawer = await openParty(page);

  await drawer.locator('#party-pace').getByRole('button', { name: 'Fast' }).click();
  await expect(
    toast(
      page,
      '✗ apply-planned-change timed out. It may have applied; check Recent Changes on the full dashboard.'
    )
  ).toBeVisible();
  await expect
    .poll(() => names(calls))
    .toEqual(['get-party', 'plan-party-change', 'apply-planned-change', 'get-party']);
  await expect(page.locator('.toast-stack .toast-action')).toHaveCount(0);
});

test('an apply whose answer got lost says it may have applied; a tool error does not', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  // Registered last, so it answers first: each apply fails in its own way.
  const fails = [
    // The bridge link dropped after the send.
    (route: Route) =>
      route.fulfill({
        status: 502,
        json: { ok: false, kind: 'channel', error: 'The bridge link closed.' },
      }),
    // A proxy gave up waiting (Cloudflare 524), with its own HTML page.
    (route: Route) =>
      route.fulfill({ status: 524, contentType: 'text/html', body: '<html>A timeout</html>' }),
    // The network failed.
    (route: Route) => route.abort('connectionreset'),
    // A 200 that still says ok: false is the tool's own no.
    (route: Route) =>
      route.fulfill({ json: { ok: false, kind: 'tool', error: 'Nothing to change' } }),
  ];
  await page.route('**/api/tool', route => {
    const call = route.request().postDataJSON() as ToolCall;
    if (call.name !== 'apply-planned-change') return route.fallback();
    calls.push(call);
    return fails.shift()!(route);
  });
  const drawer = await openParty(page);
  const fast = drawer.locator('#party-pace').getByRole('button', { name: 'Fast' });
  const hint = 'It may have applied; check Recent Changes on the full dashboard.';

  await fast.click();
  await expect(
    toast(page, `✗ apply-planned-change: The bridge link closed. ${hint}`)
  ).toBeVisible();
  await expect(fast).toBeEnabled();
  await fast.click();
  await expect(toast(page, `✗ apply-planned-change: HTTP 524. ${hint}`)).toBeVisible();
  await expect(fast).toBeEnabled();
  await fast.click();
  await expect(toast(page, `✗ apply-planned-change: Failed to fetch. ${hint}`)).toBeVisible();
  await expect(fast).toBeEnabled();
  await fast.click();
  await expect(
    page
      .locator('.toast-stack')
      .getByText('✗ apply-planned-change: Nothing to change', { exact: true })
  ).toBeVisible();
  // Each failure past the gate reloads the party, in case it landed.
  await expect.poll(() => names(calls).filter(n => n === 'get-party').length).toBe(5);
});

test('Pre-flight reading GM Actions on opens the gate before the stream says so', async ({
  page,
}) => {
  await fakeStream(page, []);
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({ json: { switches: { switches: [] }, gmActionsEnabled: true, error: null } })
  );
  const calls = await fakeTools(page, bridge);
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-preflight').click();
  const preflight = page.getByRole('dialog', { name: '✈ Pre-flight' });
  await expect(preflight.locator('#ready-switches')).toHaveText('✓ GM Actions');
  await page.keyboard.press('Escape');
  await expect(preflight).toBeHidden();

  await page.locator('#btn-party').click();
  const drawer = page.getByRole('dialog', { name: '🛡 Party' });
  await drawer.locator('#party-pace').getByRole('button', { name: 'Fast' }).click();
  await expect(toast(page, '✓ Applied: Travel pace set to Fast')).toBeVisible();
  expect(names(calls)).toContain('apply-planned-change');
});

test('the stream saying GM Actions are off wins over the Pre-flight read', async ({ page }) => {
  await fakeStream(page, gmActions(false));
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({ json: { switches: { switches: [] }, gmActionsEnabled: true, error: null } })
  );
  const calls = await fakeTools(page, bridge);
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await page.locator('#btn-preflight').click();
  const preflight = page.getByRole('dialog', { name: '✈ Pre-flight' });
  await expect(preflight.locator('#ready-switches')).toHaveText('○ GM Actions');
  await page.keyboard.press('Escape');

  await page.locator('#btn-party').click();
  const drawer = page.getByRole('dialog', { name: '🛡 Party' });
  await drawer.locator('#party-pace').getByRole('button', { name: 'Fast' }).click();
  await expect(
    toast(page, 'GM Actions are off. Ready for session in Pre-flight turns them on.')
  ).toBeVisible();
  expect(names(calls)).not.toContain('plan-party-change');
});

test('Escape after a change closes the drawer and keeps the Undo toast', async ({ page }) => {
  await fakeStream(page, gmActions(true));
  const calls = await fakeTools(page, bridge);
  const drawer = await openParty(page);

  await drawer.locator('#party-pace').getByRole('button', { name: 'Fast' }).click();
  await expect(toast(page, '✓ Applied: Travel pace set to Fast')).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
  await expect(toast(page, '✓ Applied: Travel pace set to Fast')).toBeVisible();

  await page.locator('.toast-stack .toast-undo .toast-action').click();
  await expect(toast(page, '✓ Undid: Travel pace set to Fast')).toBeVisible();
  expect(calls.filter(c => c.name === 'undo-change')).toHaveLength(1);
});

test('a failed plan, a refused apply and a plan that needs a confirm all say so', async ({
  page,
}) => {
  await fakeStream(page, gmActions(true));
  await fakePreflight(page);
  let answer: Answer = call =>
    call.name === 'plan-party-change'
      ? { status: 422, json: { ok: false, error: 'The "party" feature is switched off' } }
      : bridge(call);
  const calls = await fakeTools(page, call => answer(call));
  const drawer = await openParty(page);
  const fast = drawer.locator('#party-pace').getByRole('button', { name: 'Fast' });

  await fast.click();
  await expect(
    toast(page, '✗ plan-party-change: The "party" feature is switched off')
  ).toBeVisible();
  expect(names(calls)).toEqual(['get-party', 'plan-party-change']);

  // The server refuses with 403 when GM Actions went off after the page last heard.
  answer = (call): ToolAnswer =>
    call.name === 'apply-planned-change'
      ? { status: 403, json: { code: 'gm-actions-disabled', error: 'GM Actions are off.' } }
      : bridge(call);
  await expect(fast).toBeEnabled();
  await fast.click();
  await expect(
    toast(page, 'GM Actions are off. Ready for session in Pre-flight turns them on.')
  ).toBeVisible();
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeVisible();
  await page.keyboard.press('Escape');
  await expect(page.getByRole('dialog', { name: '✈ Pre-flight' })).toBeHidden();

  answer = (call): ToolAnswer =>
    call.name === 'plan-party-change' ? ok({ ...PLAN, risk: 'destructive' }) : bridge(call);
  const before = calls.length;
  await expect(fast).toBeEnabled();
  await fast.click();
  await expect(
    toast(
      page,
      'This change needs a confirm step this page does not have yet. Use the full dashboard.'
    )
  ).toBeVisible();
  expect(names(calls.slice(before))).toEqual(['plan-party-change']);
});

test('Open shows the actor in Foundry; Escape closes the drawer', async ({ page }) => {
  await fakeStream(page, []);
  let openFails = false;
  const calls = await fakeTools(page, call => {
    if (call.name !== 'open-in-foundry') return ok(STATE);
    return openFails
      ? { status: 422, json: { ok: false, error: 'No such actor' } }
      : ok({ opened: true });
  });
  const drawer = await openParty(page);
  const rows = drawer.locator('.party-member');

  await rows.nth(1).getByRole('button', { name: 'Open' }).click();
  await expect(toast(page, 'Opened in Foundry')).toBeVisible();
  expect(calls.at(-1)).toEqual({ name: 'open-in-foundry', args: { uuid: 'Actor.a2' } });
  await expect(page.locator('.toast-stack .toast')).toHaveCount(0, { timeout: 8000 });

  openFails = true;
  await rows.nth(0).getByRole('button', { name: 'Open' }).click();
  await expect(toast(page, '✗ open-in-foundry: No such actor')).toBeVisible();

  // The toast is the top Radix layer, but Escape goes to the drawer and the toast stays.
  await page.keyboard.press('Escape');
  await expect(drawer).toBeHidden();
  await expect(toast(page, '✗ open-in-foundry: No such actor')).toBeVisible();
  await expect(page.locator('#btn-party')).toHaveAttribute('aria-expanded', 'false');
  await expect(page.locator('.drawer-backdrop')).toHaveCount(0);
});
