// The live strip (item live-strip-component) at /?strip=1: one combat row with numbered duplicate
// names, the always-present pick bar with Damage / Heal and condition chips, Next turn and End
// combat in the header (End combat as one plain confirm), and no sideways scroll at 1440 or 400
// wide. The bridge and the stream are faked; nothing here needs a world.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, ok, type ToolCall } from './support';

interface Raw {
  id: string;
  name: string;
  initiative: number;
  isCurrentTurn: boolean;
  hp: { value: number; max: number; temp: number };
  conditions: string[];
  isPC: boolean;
  category: string;
  defeated: boolean;
  deathSaves: null;
  tokenId: string;
}

const who = (id: string, name: string, over: Partial<Raw> = {}): Raw => ({
  id,
  name,
  initiative: 10,
  isCurrentTurn: false,
  hp: { value: 20, max: 20, temp: 0 },
  conditions: [],
  isPC: false,
  category: 'enemy',
  defeated: false,
  deathSaves: null,
  tokenId: `tk-${id}`,
  ...over,
});

const FIGHT = [
  who('b', 'Brannoc', { initiative: 19, isCurrentTurn: true, isPC: true, category: 'pc' }),
  who('g1', 'Goblin', { initiative: 12 }),
  who('g2', 'Goblin', { initiative: 11, hp: { value: 0, max: 7, temp: 0 }, defeated: true }),
];

const NL = String.fromCharCode(10);
const sse = (events: { event: string; data: unknown }[]): string =>
  `retry: 600000${NL}${NL}${events
    .map(e => `event: ${e.event}${NL}data: ${JSON.stringify(e.data)}${NL}${NL}`)
    .join('')}`;

async function setup(
  page: Page,
  combatants: Raw[] | null,
  opts: { changes?: unknown[]; gmActions?: boolean } = {}
): Promise<ToolCall[]> {
  await fakeCommonRoutes(page);
  const calls = await fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'list-scenes':
          return ok([{ id: 's1', name: 'Field', active: true }]);
        case 'list-revealed-pages':
          return ok({ pages: [], queue: [] });
        case 'list-recent-changes':
          return ok({ changes: opts.changes ?? [] });
        case 'plan-actor-change':
          return ok({ planId: 'plan-hit', summary: 'Damage', risk: 'write' });
        case 'plan-combat-change':
          return ok({ planId: 'plan-end', summary: 'End combat', risk: 'destructive' });
        case 'apply-planned-change':
          return ok({ changeId: 'chg-1', summary: 'done', mode: 'apply', risk: 'write' });
        default:
          return ok({});
      }
    },
    { playSession: true }
  );
  await page.route('**/api/stream**', route =>
    route.fulfill({
      status: 200,
      contentType: 'text/event-stream',
      body: sse([
        { event: 'settings', data: { gmActionsEnabled: opts.gmActions ?? true } },
        {
          event: 'status',
          data: {
            controlChannel: 'connected',
            foundry: 'reachable',
            lastError: null,
            lastPollAt: null,
            foundryDownSince: null,
          },
        },
        {
          event: 'combat',
          data: {
            combat: combatants
              ? { active: true, round: 2, turn: 0, current: combatants[0], combatants }
              : null,
          },
        },
      ]),
    })
  );
  return calls;
}

const load = async (page: Page): Promise<void> => {
  await page.goto(`/next/?strip=1&token=${GM_TOKEN}`);
  await expect(page.locator('#live-strip')).toBeVisible();
};
const cards = (page: Page): Locator => page.locator('#live-strip li[data-id]');
const pickBar = (page: Page): Locator => page.locator('#live-pick');
const writes = (calls: ToolCall[]): string[] =>
  calls.filter(c => c.confirm === true).map(c => c.name);

test('shows the fight as one row, with duplicate names numbered and a creature at 0 marked', async ({
  page,
}) => {
  await setup(page, FIGHT);
  await load(page);
  await expect(cards(page)).toHaveCount(3);
  await expect(cards(page).locator('button[aria-pressed]')).toHaveText([
    'Brannoc',
    'Goblin 1',
    'Goblin 2',
  ]);
  await expect(cards(page).nth(2)).toContainText('dead');
  await expect(pickBar(page)).toContainText('pick a creature');
});

test('the pick bar is always there; damage applies in one click and clears the pick', async ({
  page,
}) => {
  const calls = await setup(page, FIGHT);
  await load(page);
  await page.getByRole('button', { name: 'Goblin 1', exact: true }).click();
  await expect(pickBar(page)).toContainText('Goblin 1');
  await page.getByRole('textbox', { name: 'Amount' }).fill('5');
  await page.getByRole('button', { name: /Deal 5 damage to Goblin 1/ }).click();
  await expect.poll(() => writes(calls)).toEqual(['apply-planned-change']);
  await expect(pickBar(page)).toContainText('pick a creature');
  const plan = calls.find(c => c.name === 'plan-actor-change');
  expect(plan?.args).toMatchObject({ action: 'damage', targets: ['tk-g1'], amount: 5 });
});

test('a condition chip plans the condition for the picked creature and clears the pick', async ({
  page,
}) => {
  const calls = await setup(page, FIGHT);
  await load(page);
  await page.getByRole('button', { name: 'Goblin 1', exact: true }).click();
  await page.locator('button[data-condition="prone"]').click();
  await expect.poll(() => writes(calls)).toEqual(['apply-planned-change']);
  expect(calls.find(c => c.name === 'plan-actor-change')?.args).toEqual({
    action: 'condition',
    targets: ['tk-g1'],
    condition: 'prone',
    active: true,
  });
  await expect(pickBar(page)).toContainText('pick a creature');
});

test('Next turn is one click; End combat asks one plain question first', async ({ page }) => {
  const calls = await setup(page, FIGHT);
  await load(page);
  await page.locator('#live-next-turn').click();
  await expect.poll(() => calls.map(c => c.name)).toContain('advance-combat-turn');

  await page.locator('#live-end-combat').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('End the fight on Field? Undo stays in Recent Changes.');
  await expect(dialog).not.toContainText('plan-end');
  await expect(dialog.getByRole('checkbox')).toHaveCount(0);
  await dialog.getByRole('button', { name: 'End combat' }).click();
  await expect
    .poll(() => calls.find(c => c.name === 'apply-planned-change'))
    .toMatchObject({ args: { planId: 'plan-end' }, confirm: true, confirmDestructive: true });
});

test('Undo offers only the newest change and asks first', async ({ page }) => {
  const newest = { changeId: 'c2', summary: 'Goblin 1: 5 fire damage', canUndo: true };
  const older = { changeId: 'c1', summary: 'End combat', canUndo: true, risk: 'destructive' };
  const calls = await setup(page, FIGHT, { changes: [newest, older] });
  await load(page);
  await expect(page.locator('#live-undo')).toContainText('Goblin 1: 5 fire damage');
  await page.locator('#live-undo').click();
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Undo Goblin 1: 5 fire damage?');
  expect(calls.some(c => c.name === 'undo-change')).toBe(false);
  await dialog.getByRole('button', { name: 'Undo' }).click();
  await expect
    .poll(() => calls.find(c => c.name === 'undo-change'))
    .toMatchObject({ args: { changeId: 'c2' }, confirm: true });
});

test('after an undo the button says there is nothing to undo', async ({ page }) => {
  const undone = { changeId: 'u1', summary: 'Undid x', mode: 'undo', canUndo: false };
  const older = { changeId: 'c1', summary: 'End combat', canUndo: true, undoneBy: 'u1' };
  await setup(page, FIGHT, { changes: [undone, older] });
  await load(page);
  await expect(page.locator('#live-undo')).toHaveText('Nothing to undo');
});

test('with GM Actions off the strip says why it cannot pick', async ({ page }) => {
  await setup(page, FIGHT, { gmActions: false });
  await load(page);
  await expect(page.locator('#live-gated')).toContainText('GM Actions');
});

test('with no fight it says so and has no pick bar', async ({ page }) => {
  await setup(page, null);
  await load(page);
  await expect(page.locator('#live-strip')).toContainText('No fight.');
  await expect(pickBar(page)).toHaveCount(0);
});

for (const width of [1440, 400]) {
  test(`does not scroll sideways at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page, FIGHT);
    await load(page);
    await expect(cards(page)).toHaveCount(3);
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
