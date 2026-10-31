// Recent Changes on the React dashboard: the AI list and, when the bridge has list-changes, the
// Everyone list (person filter, Redo), the reload on a gm-change event, and every Undo through the
// guarded paths: the AI tab's confirm window and undo-change, the Everyone tab's plan, undo window
// (just this, everything since, the rewind and its second question) and apply-planned-change, a
// reveal's plain undo-change (#330), and the refusals (GM Actions off, a failed plan, a failed
// list).
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

const SESSION = { success: true, worldId: 'w', open: true, endedAt: null };

const aiChange = (n: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  changeId: `chg-${n}`,
  summary: `Change ${n}`,
  feature: 'actor-change',
  target: 'Brenna',
  appliedAt: '2026-10-08T19:30:00.000Z',
  mode: 'apply',
  risk: 'write',
  canUndo: true,
  diff: [`Line ${n}a`, `Line ${n}b`],
  ...extra,
});

const AI_LIST = {
  changes: [
    aiChange(3, { summary: 'Revealed a page', risk: 'destructive', requestedBy: 'Danni' }),
    aiChange(2, { summary: 'Undo: Change 1', mode: 'undo', canUndo: false, diff: [] }),
    aiChange(1, { undoneBy: 'chg-2', canUndo: false }),
  ],
};

const human = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  kind: 'human',
  id,
  at: '2026-10-08T19:30:00.000Z',
  by: 'Brenna',
  summary: `Human ${id}`,
  lines: ['HP 13 to 7'],
  canUndo: true,
  undone: false,
  things: [{ uuid: 'Actor.a2', name: 'Brenna' }],
  ...extra,
});
const aiEntry = (id: string, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  ...human(id),
  kind: 'ai',
  by: 'AI Tool',
  summary: `AI ${id}`,
  ...extra,
});

const EVERYONE_LIST = {
  changes: [
    human('h1'),
    aiEntry('a2', { ownData: true, summary: 'Revealed a page' }),
    aiEntry('a1', { summary: 'Undone one', undone: true, undoneBy: 'a3', canUndo: false }),
    aiEntry('a3', {
      summary: 'Undo: Undone one',
      mode: 'undo',
      feature: 'change-undo',
      requestedBy: 'Danni',
      canUndo: true,
      covers: 1,
    }),
    human('h0', { by: 'Aldric', canUndo: false }),
  ],
  note: '',
};

const plan = (extra: Record<string, unknown> = {}): Record<string, unknown> => ({
  planId: 'plan-1',
  summary: 'Undo: Human h1',
  scope: 'just-this',
  risk: 'write',
  requires: { confirm: true, confirmDestructive: false },
  diff: [
    { kind: 'change', text: 'HP 7 back to 13' },
    { kind: 'note', text: 'Nothing else is touched' },
  ],
  later: [],
  ...extra,
});

interface Setup {
  /** Names of the tools the catalog lists; default has list-changes. */
  catalog?: string[];
  ai?: () => unknown;
  everyone?: () => unknown;
  /** The answer of plan-undo-changes for these arguments. */
  plan?: (args: Record<string, unknown>) => { status?: number; json: unknown };
  /** The answer of apply-planned-change (default: it applies). */
  apply?: () => { status?: number; json: unknown };
  stream?: { event: string; data: unknown }[];
}

const GM_ON = { event: 'settings', data: { gmActionsEnabled: true } };

/** The bridge for these tests: an open session, so Recent Changes is in the page. */
async function setup(page: Page, s: Setup = {}): Promise<ToolCall[]> {
  const catalog = s.catalog ?? ['list-recent-changes', 'list-changes', 'undo-change'];
  await page.route('**/api/tools', route =>
    route.fulfill({
      json: { tools: catalog.map(name => ({ name })), gmActionsEnabled: true },
    })
  );
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/session/switches', route =>
    route.fulfill({ json: { switches: { switches: [] }, gmActionsEnabled: true } })
  );
  await page.route('**/api/player/names', route => route.fulfill({ json: [] }));
  await fakeStream(page, s.stream ?? [GM_ON]);
  return fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'get-play-session':
          return ok(SESSION);
        case 'list-recent-changes':
          return ok((s.ai ?? ((): unknown => AI_LIST))());
        case 'list-changes':
          return ok((s.everyone ?? ((): unknown => EVERYONE_LIST))());
        case 'plan-undo-changes':
          return s.plan ? s.plan(call.args) : ok(plan());
        case 'apply-planned-change':
          return s.apply ? s.apply() : ok({ changeId: 'new-1', summary: 'Undid: sample' });
        case 'undo-change':
          return ok({ summary: 'Undid: sample' });
        default:
          return ok({});
      }
    },
    { playSession: true }
  );
}

const names = (calls: ToolCall[]): string[] => calls.map(c => c.name);
const callsOf = (calls: ToolCall[], name: string): ToolCall[] => calls.filter(c => c.name === name);

const card = (page: Page): Locator => page.locator('#pane-changes');
const undoWindow = (page: Page): Locator =>
  page.getByRole('dialog', { name: /Undo|Rewind|Are you sure/ });

async function load(page: Page): Promise<Locator> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(page.getByRole('region', { name: 'Recent Changes' })).toBeVisible();
  return card(page);
}

async function openEveryone(page: Page): Promise<Locator> {
  const c = await load(page);
  await c.getByRole('button', { name: 'Everyone' }).click();
  await expect(c.getByText('Human h1')).toBeVisible();
  return c;
}

test.beforeEach(async ({ page }) => {
  await fakeCommonRoutes(page);
});

test('loads the AI changes with their state, details and Undo where it can be', async ({
  page,
}) => {
  const calls = await setup(page);
  const c = await load(page);

  await expect(c.locator('#changes-meta')).toHaveText('3 shown');
  expect(callsOf(calls, 'list-recent-changes')).toEqual([
    { name: 'list-recent-changes', args: { limit: 20 } },
  ]);
  const rows = c.locator('.change-entry');
  await expect(rows).toHaveCount(3);
  await expect(rows.nth(0)).toHaveClass(/state-destructive/);
  await expect(rows.nth(1)).toHaveClass(/state-undo/);
  await expect(rows.nth(2)).toHaveClass(/state-undone/);
  await expect(rows.nth(0).locator('.change-meta')).toContainText('by Danni');
  await expect(rows.nth(0).locator('.change-state')).toHaveText('destructive');
  // Undo only on the rows that can be undone.
  await expect(rows.nth(0).getByRole('button', { name: /^Undo/ })).toBeVisible();
  await expect(rows.nth(1).getByRole('button', { name: /^Undo/ })).toHaveCount(0);
  await expect(rows.nth(2).getByRole('button', { name: /^Undo/ })).toHaveCount(0);
  // The lines sit under a fold; a row without any has no fold.
  await expect(rows.nth(0).locator('summary')).toHaveText('2 line(s)');
  await expect(rows.nth(0).getByText('Line 3a')).toBeHidden();
  await rows.nth(0).locator('summary').click();
  await expect(rows.nth(0).getByText('Line 3a')).toBeVisible();
  await expect(rows.nth(1).locator('summary')).toHaveCount(0);
});

test('an older bridge has no Everyone tab', async ({ page }) => {
  await setup(page, { catalog: ['list-recent-changes', 'undo-change'] });
  const c = await load(page);
  await expect(c.locator('.change-entry')).toHaveCount(3);
  await expect(c.getByRole('button', { name: 'Everyone' })).toHaveCount(0);
  await expect(c.locator('#changes-toolbar')).toHaveCount(0);
});

test('an empty list and a failed one say so; the failed one can try again', async ({ page }) => {
  let fail = true;
  const calls = await setup(page, { ai: () => ({ changes: [] }) });
  await page.route('**/api/tool', route => {
    const call = route.request().postDataJSON() as ToolCall;
    if (call.name === 'list-recent-changes' && fail) {
      return route.fulfill({ status: 500, json: { error: 'The bridge answered with an error.' } });
    }
    return route.fallback();
  });
  const c = await load(page);
  await expect(c).toContainText("Couldn't load changes: The bridge answered with an error.");
  await expect(c.locator('#changes-meta')).toHaveText('-');
  fail = false;
  await c.getByRole('button', { name: 'Try again' }).click();
  await expect(c).toContainText('No guarded changes yet.');
  await expect(c.locator('#changes-meta')).toHaveText('0 shown');
  expect(callsOf(calls, 'list-recent-changes').length).toBeGreaterThanOrEqual(1);
});

test('the Obsidian link opens the month of a change once the vault and the world are known', async ({
  page,
}) => {
  await setup(page, {
    stream: [
      { event: 'settings', data: { gmActionsEnabled: true, obsidian: { vault: 'Vault' } } },
      { event: 'world', data: { id: 'harbor', title: 'Harbor' } },
    ],
  });
  const c = await load(page);
  const link = c.getByRole('link', { name: "Open this month's change log in Obsidian" }).first();
  await expect(link).toHaveAttribute(
    'href',
    'obsidian://open?vault=Vault&file=Campaigns%2Fharbor%2FAI%20Tool%2FChanges%2F2026-10'
  );
});

test('a gm-change event from Foundry reloads the list once', async ({ page }) => {
  // The first load shows the list the page starts with; only a reload can show the new one. The
  // stream answers once that first load has been asked for: an event that came before the card
  // had a list to reload would (rightly) reload nothing, and the first load is fresh anyway.
  let loads = 0;
  let firstLoad: () => void = () => undefined;
  const firstLoadAsked = new Promise<void>(resolve => (firstLoad = resolve));
  const calls = await setup(page, {
    ai: () => {
      firstLoad();
      return ++loads === 1 ? AI_LIST : { changes: [aiChange(9, { summary: 'Moved a token' })] };
    },
  });
  const events = [
    GM_ON,
    {
      event: 'events',
      data: {
        events: [
          {
            id: 'e1',
            timestampMs: Date.now(),
            eventType: 'gm-change',
            description: 'Applied: moved a token',
          },
        ],
      },
    },
  ];
  await page.route('**/api/stream**', async route => {
    await firstLoadAsked;
    // Past the first answer, so the list is on screen when the event lands.
    await new Promise(resolve => setTimeout(resolve, 300));
    const lines = events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`);
    await route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: `retry: 600000\n\n${lines.join('')}`,
    });
  });
  const c = await load(page);
  // The reload is what shows the new list.
  await expect(c.getByText('Moved a token')).toBeVisible();
  // The first load and the one gm-change started; nothing more follows.
  await page.waitForTimeout(1000);
  expect(callsOf(calls, 'list-recent-changes')).toHaveLength(2);
});

test('the Everyone tab loads on its first open, filters by person and shows undone and redo', async ({
  page,
}) => {
  const calls = await setup(page);
  const c = await load(page);
  expect(callsOf(calls, 'list-changes')).toEqual([]);

  await c.getByRole('button', { name: 'Everyone' }).click();
  await expect(c.getByRole('button', { name: 'Everyone' })).toHaveAttribute('aria-pressed', 'true');
  await expect(c.getByText('Human h1')).toBeVisible();
  expect(callsOf(calls, 'list-changes')).toEqual([{ name: 'list-changes', args: { limit: 100 } }]);
  await expect(c.locator('#changes-meta')).toHaveText('5 shown');
  // An undo of an undo reads as a redo, and the undone change says who undid it.
  const undone = c.locator('.change-entry', { hasText: 'Undone one' }).first();
  await expect(undone).toHaveClass(/state-undone/);
  await expect(undone.locator('.change-badge')).toHaveText('Undone by Danni');
  await expect(undone.getByRole('button', { name: /^Redo/ })).toBeVisible();

  const person = c.getByLabel('Show changes by');
  await expect(person.locator('option')).toHaveText([
    'Everyone',
    'AI',
    'Aldric',
    'Brenna',
    'Danni',
  ]);
  await person.selectOption({ label: 'Brenna' });
  await expect(c.locator('.change-entry')).toHaveCount(1);
  await expect(c.locator('#changes-meta')).toHaveText('1 shown');
  await person.selectOption({ label: 'AI' });
  await expect(c.locator('.change-entry')).toHaveCount(2);
  await c.getByRole('button', { name: 'AI', exact: true }).click();
  await expect(c.getByText('Revealed a page')).toBeVisible();
});

test('the Everyone tab says why a list is empty', async ({ page }) => {
  await setup(page, {
    everyone: () => ({ changes: [], note: 'Older changes are not kept.' }),
  });
  const c = await load(page);
  await c.getByRole('button', { name: 'Everyone' }).click();
  await expect(c).toContainText('Older changes are not kept.');

  await page.unroute('**/api/tool');
  await fakeTools(
    page,
    call =>
      call.name === 'list-changes'
        ? ok({ changes: [], note: '' })
        : call.name === 'get-play-session'
          ? ok(SESSION)
          : ok(AI_LIST),
    { playSession: true }
  );
  await c.getByRole('button', { name: 'Reload recent changes' }).click();
  await expect(c).toContainText('No changes in the last 7 days.');
});

test.describe('Undo on the AI tab', () => {
  test('asks in the confirm window, waits for the tick, then undoes with both flags', async ({
    page,
  }) => {
    const calls = await setup(page);
    const c = await load(page);
    await c.getByRole('button', { name: 'Undo: Revealed a page' }).click();

    const dialog = page.getByRole('dialog', { name: 'Destructive action' });
    await expect(dialog.locator('.modal-summary')).toHaveText('Undo: Revealed a page');
    await expect(dialog.locator('.change-diff li')).toHaveText(['Line 3a', 'Line 3b']);
    const confirm = dialog.getByRole('button', { name: 'Run destructive action' });
    await expect(confirm).toBeDisabled();
    expect(callsOf(calls, 'undo-change')).toEqual([]);
    await dialog.getByRole('checkbox').check();
    await confirm.click();

    await expect(toast(page, '✓ Undid: sample')).toBeVisible();
    expect(callsOf(calls, 'undo-change')).toEqual([
      {
        name: 'undo-change',
        args: { changeId: 'chg-3' },
        confirm: true,
        confirmDestructive: true,
      },
    ]);
    // The list reloaded.
    await expect.poll(() => callsOf(calls, 'list-recent-changes').length).toBeGreaterThan(1);
  });

  test('Cancel changes nothing', async ({ page }) => {
    const calls = await setup(page);
    const c = await load(page);
    await c.getByRole('button', { name: 'Undo: Revealed a page' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(names(calls)).not.toContain('undo-change');
    // The focus is back on the Undo button that was clicked.
    await expect(c.getByRole('button', { name: 'Undo: Revealed a page' })).toBeFocused();
  });

  test('with GM Actions off it asks nothing and opens Pre-flight', async ({ page }) => {
    const calls = await setup(page, {
      stream: [{ event: 'settings', data: { gmActionsEnabled: false } }],
    });
    const c = await load(page);
    await c.getByRole('button', { name: 'Undo: Revealed a page' }).click();
    await expect(
      toast(page, 'GM Actions are off. Start session or the header Turn on button turns them on.')
    ).toBeVisible();
    // No confirm window; the gate opened Pre-flight, where Turn on for tonight turns GM Actions on.
    await expect(page.getByRole('dialog', { name: 'Destructive action' })).toHaveCount(0);
    await expect(page.getByRole('dialog', { name: /Pre-flight/ })).toBeVisible();
    expect(names(calls)).not.toContain('undo-change');
  });
});

test.describe('Undo on the Everyone tab', () => {
  test('plans, shows the lines and applies with the click on Undo as the confirmation', async ({
    page,
  }) => {
    const calls = await setup(page);
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();

    const dialog = undoWindow(page);
    await expect(dialog.getByRole('heading', { name: 'Undo this change?' })).toBeVisible();
    await expect(dialog.locator('.change-diff li')).toHaveText([
      'HP 7 back to 13',
      'Nothing else is touched',
    ]);
    await expect(dialog.locator('.undo-note')).toHaveText('Nothing else is touched');
    expect(callsOf(calls, 'plan-undo-changes')).toEqual([
      { name: 'plan-undo-changes', args: { id: 'h1', scope: 'just-this' } },
    ]);
    // Nothing is written before the GM presses Undo.
    expect(names(calls)).not.toContain('apply-planned-change');
    await dialog.getByRole('button', { name: 'Undo', exact: true }).click();

    await expect(page.getByRole('dialog')).toHaveCount(0);
    await expect(toast(page, '✓ Applied: Undid: sample')).toBeVisible();
    expect(callsOf(calls, 'apply-planned-change')).toEqual([
      { name: 'apply-planned-change', args: { planId: 'plan-1' }, confirm: true },
    ]);
    // The toast has its own Undo; the list reloaded.
    await expect(page.locator('.toast-stack').getByRole('button', { name: 'Undo' })).toBeVisible();
    await expect.poll(() => callsOf(calls, 'list-changes').length).toBeGreaterThan(1);
  });

  test('Cancel in the window applies nothing', async ({ page }) => {
    const calls = await setup(page);
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();
    await undoWindow(page).getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(names(calls)).not.toContain('apply-planned-change');
    await expect(c.getByRole('button', { name: 'Undo: Human h1' })).toBeFocused();
  });

  test('Escape closes the window and applies nothing', async ({ page }) => {
    const calls = await setup(page);
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();
    await expect(undoWindow(page)).toBeVisible();
    await page.keyboard.press('Escape');
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(names(calls)).not.toContain('apply-planned-change');
  });

  test('a change with later ones asks: everything since plans again with that scope', async ({
    page,
  }) => {
    const calls = await setup(page, {
      plan: args =>
        args['scope'] === 'everything-since'
          ? ok(plan({ planId: 'plan-2', scope: 'everything-since', summary: 'Undo 3 changes' }))
          : ok(
              plan({
                later: [
                  { id: 'x1', at: '2026-10-08T19:40:00.000Z', by: 'Brenna', summary: 'Later hit' },
                ],
              })
            ),
    });
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();

    const dialog = undoWindow(page);
    await expect(dialog.getByText('This is not the latest change to Brenna.')).toBeVisible();
    await expect(dialog.locator('.undo-later li')).toContainText(['Brenna: Later hit']);
    await dialog.getByRole('button', { name: 'Everything since' }).click();

    await expect(
      undoWindow(page).getByRole('heading', { name: 'Undo everything since?' })
    ).toBeVisible();
    expect(callsOf(calls, 'plan-undo-changes').map(c => c.args)).toEqual([
      { id: 'h1', scope: 'just-this' },
      { id: 'h1', scope: 'everything-since' },
    ]);
    await undoWindow(page).getByRole('button', { name: 'Undo', exact: true }).click();
    await expect.poll(() => callsOf(calls, 'apply-planned-change').length).toBe(1);
    expect(callsOf(calls, 'apply-planned-change')[0]?.args).toEqual({ planId: 'plan-2' });
  });

  test('"Just this" goes on with the plan it has, without asking the bridge again', async ({
    page,
  }) => {
    const calls = await setup(page, {
      plan: () => ok(plan({ later: [{ id: 'x1', at: '', by: 'Brenna', summary: 'Later hit' }] })),
    });
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();
    await undoWindow(page).getByRole('button', { name: 'Just this' }).click();
    await expect(
      undoWindow(page).getByRole('heading', { name: 'Undo this change?' })
    ).toBeVisible();
    expect(callsOf(calls, 'plan-undo-changes')).toHaveLength(1);
  });

  test('the rewind asks twice; the second window waits for the tick and applies with both flags', async ({
    page,
  }) => {
    const calls = await setup(page, {
      plan: args =>
        args['rewindTable'] === true
          ? ok(
              plan({
                planId: 'plan-rw',
                scope: 'world-since',
                summary: 'Rewind the table: 12 changes',
                risk: 'destructive',
                requires: { confirm: true, confirmDestructive: true },
                count: 12,
              })
            )
          : ok(plan()),
    });
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();

    await undoWindow(page).getByText('Advanced').click();
    await undoWindow(page).getByRole('button', { name: 'Rewind the whole table to here' }).click();
    await expect(
      undoWindow(page).getByRole('heading', { name: 'Rewind the whole table?' })
    ).toBeVisible();
    expect(callsOf(calls, 'plan-undo-changes').at(-1)?.args).toEqual({
      id: 'h1',
      scope: 'world-since',
      rewindTable: true,
    });
    await undoWindow(page).getByRole('button', { name: 'Continue' }).click();

    const sure = undoWindow(page);
    await expect(sure.getByRole('heading', { name: 'Are you sure?' })).toBeVisible();
    const apply = sure.getByRole('button', { name: 'Undo all 12 changes' });
    await expect(apply).toBeDisabled();
    expect(names(calls)).not.toContain('apply-planned-change');
    await sure.getByRole('checkbox').check();
    await apply.click();
    await expect.poll(() => callsOf(calls, 'apply-planned-change').length).toBe(1);
    expect(callsOf(calls, 'apply-planned-change')[0]).toEqual({
      name: 'apply-planned-change',
      args: { planId: 'plan-rw' },
      confirm: true,
      confirmDestructive: true,
    });
  });

  test('a reveal is undone with the plain undo-change after its own confirm, never planned', async ({
    page,
  }) => {
    const calls = await setup(page);
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Revealed a page' }).click();

    const dialog = page.getByRole('dialog', { name: 'Destructive action' });
    await expect(dialog.locator('.modal-summary')).toHaveText('Undo: Revealed a page');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Run destructive action' }).click();
    await expect.poll(() => callsOf(calls, 'undo-change').length).toBe(1);
    expect(callsOf(calls, 'undo-change')[0]).toEqual({
      name: 'undo-change',
      args: { changeId: 'a2' },
      confirm: true,
      confirmDestructive: true,
    });
    expect(names(calls)).not.toContain('plan-undo-changes');
  });

  test('Redo undoes the undo entry after a confirm', async ({ page }) => {
    const calls = await setup(page);
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Redo: Undone one' }).click();

    const dialog = page.getByRole('dialog', { name: 'Destructive action' });
    await expect(dialog.locator('.modal-summary')).toHaveText('Redo: Undone one');
    await dialog.getByRole('checkbox').check();
    await dialog.getByRole('button', { name: 'Run destructive action' }).click();
    await expect.poll(() => callsOf(calls, 'undo-change').length).toBe(1);
    expect(callsOf(calls, 'undo-change')[0]?.args).toEqual({ changeId: 'a3' });
  });

  test('a plan that fails shows the error and opens no window', async ({ page }) => {
    const calls = await setup(page, {
      plan: () => ({ status: 500, json: { error: 'Nothing to undo.' } }),
    });
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();
    await expect(toast(page, '✗ Nothing to undo.')).toBeVisible();
    await expect(page.getByRole('dialog')).toHaveCount(0);
    expect(names(calls)).not.toContain('apply-planned-change');
  });

  test('an apply that fails after the window shows the error, no Undo toast, and reloads the list', async ({
    page,
  }) => {
    const calls = await setup(page, {
      apply: () => ({ status: 422, json: { error: 'The plan has expired.' } }),
    });
    const c = await openEveryone(page);
    const before = callsOf(calls, 'list-changes').length;
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();
    await undoWindow(page).getByRole('button', { name: 'Undo', exact: true }).click();

    await expect(toast(page, '✗ The change: The plan has expired.')).toBeVisible();
    await expect(page.locator('.toast-stack').getByRole('button', { name: 'Undo' })).toHaveCount(0);
    await expect.poll(() => callsOf(calls, 'list-changes').length).toBeGreaterThan(before);
    expect(callsOf(calls, 'apply-planned-change')).toHaveLength(1);
  });

  test('a destructive plan waits for the tick in the first window and applies with both flags', async ({
    page,
  }) => {
    const calls = await setup(page, {
      plan: () =>
        ok(
          plan({
            planId: 'plan-d',
            risk: 'destructive',
            requires: { confirm: true, confirmDestructive: true },
          })
        ),
    });
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();

    const dialog = undoWindow(page);
    await expect(dialog.getByRole('heading', { name: 'Undo this change?' })).toBeVisible();
    const apply = dialog.getByRole('button', { name: 'Undo', exact: true });
    await expect(apply).toBeDisabled();
    expect(names(calls)).not.toContain('apply-planned-change');
    await dialog.getByRole('checkbox').check();
    await apply.click();
    await expect.poll(() => callsOf(calls, 'apply-planned-change').length).toBe(1);
    expect(callsOf(calls, 'apply-planned-change')[0]).toEqual({
      name: 'apply-planned-change',
      args: { planId: 'plan-d' },
      confirm: true,
      confirmDestructive: true,
    });
  });

  test('with GM Actions off nothing is planned', async ({ page }) => {
    const calls = await setup(page, {
      stream: [{ event: 'settings', data: { gmActionsEnabled: false } }],
    });
    const c = await openEveryone(page);
    await c.getByRole('button', { name: 'Undo: Human h1' }).click();
    await expect(
      toast(page, 'GM Actions are off. Start session or the header Turn on button turns them on.')
    ).toBeVisible();
    expect(names(calls)).not.toContain('plan-undo-changes');
  });
});

test('Recent Changes is a During fold card and sits in After as well', async ({ page }) => {
  await setup(page);
  const c = await load(page);
  await expect(c.locator('.change-entry').first()).toBeVisible();
  await c.getByRole('button', { name: 'Fold Recent Changes' }).click();
  await expect(c.locator('.change-entry').first()).toBeHidden();
  await c.getByRole('button', { name: 'Open Recent Changes' }).click();
  await expect(c.locator('.change-entry').first()).toBeVisible();
});

test('the Everyone tab picks up a change made in Foundry without a click or a reload', async ({
  page,
}) => {
  let moved = false;
  await setup(page, {
    everyone: () => ({
      changes: moved ? [human('h-moved', { summary: 'Moved Brenna' }), human('h1')] : [human('h1')],
      note: '',
    }),
  });
  const c = await load(page);
  await c.getByRole('button', { name: 'Everyone' }).click();
  await expect(c.getByText('Human h1')).toBeVisible();
  await expect(c.getByText('Moved Brenna')).toHaveCount(0);

  // A token moved in Foundry sends no gm-change: only the tab's own reading finds it.
  moved = true;
  await expect(c.getByText('Moved Brenna')).toBeVisible({ timeout: 10_000 });
});

test('a run of token moves is one row, other changes stay as they are', async ({ page }) => {
  const move = (id: string, by = 'Brenna'): Record<string, unknown> =>
    human(id, {
      by,
      summary: 'Ogre moved',
      lines: ['Ogre moved'],
      things: [{ uuid: 'Token.t1', name: 'Ogre' }],
    });
  await setup(page, {
    everyone: () => ({
      changes: [
        move('m1'),
        move('m2'),
        move('m3'),
        human('h1', { summary: 'Brenna HP 13 to 7' }),
        move('m4'),
        move('m5', 'Aldric'),
      ],
      note: '',
    }),
  });
  const c = await load(page);
  await c.getByRole('button', { name: 'Everyone' }).click();
  await expect(c.locator('.change-entry .change-summary')).toHaveText([
    'Ogre moved 3 times',
    'Brenna HP 13 to 7',
    'Ogre moved',
    'Ogre moved',
  ]);
});
