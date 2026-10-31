// Live screen A (item live-screen-a) at /next/?live=1: the strip on top, Party always open, Handouts,
// "What just happened" as one list with an AI only box and Undo on each line, a permanent
// "Undo: <last change>" in the header, a "How do I..." entry, More with the theme and the way back;
// and the default dashboard's header switch that gets here. The bridge and the stream are faked.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, ok, type ToolCall } from './support';

const NL = String.fromCharCode(10);
const sse = (events: { event: string; data: unknown }[]): string =>
  `retry: 600000${NL}${NL}${events
    .map(e => `event: ${e.event}${NL}data: ${JSON.stringify(e.data)}${NL}${NL}`)
    .join('')}`;

const MARA = {
  id: 'm',
  name: 'Mara',
  initiative: 19,
  isCurrentTurn: true,
  hp: { value: 38, max: 44, temp: 0 },
  conditions: [],
  isPC: true,
  category: 'pc',
  defeated: false,
  deathSaves: null,
  tokenId: 'tk-m',
};

const PARTY = {
  groups: [
    {
      actorId: 'g1',
      name: 'The party',
      pace: { value: 'normal', label: 'Normal', slowed: false },
      members: [],
      restCards: {},
    },
  ],
  paceOptions: [{ value: 'normal', label: 'Normal' }],
  scene: { sceneId: 's1', name: 'Field' },
  encounter: null,
  warnings: [],
};

const AI_CHANGE = {
  changeId: 'c2',
  summary: 'Goblin 1: 5 fire damage',
  canUndo: true,
  appliedAt: '2026-10-31T19:00:00Z',
};

const EVERYONE = {
  changes: [
    {
      kind: 'ai',
      id: 'c2',
      at: '2026-10-31T19:00:00Z',
      by: 'Claude',
      summary: 'Goblin 1: 5 fire damage',
      lines: [],
      canUndo: true,
    },
    {
      kind: 'human',
      id: 'h1',
      at: '2026-10-31T18:59:00Z',
      by: 'Tobias',
      summary: 'Moved Tobias',
      lines: [],
      canUndo: false,
    },
  ],
};

async function setup(
  page: Page,
  opts: { changes?: unknown[]; calm?: boolean } = {}
): Promise<ToolCall[]> {
  await fakeCommonRoutes(page);
  await page.route('**/api/tools', route =>
    route.fulfill({
      json: { tools: [{ name: 'list-recent-changes' }, { name: 'list-changes' }] },
    })
  );
  const calls = await fakeTools(
    page,
    call => {
      switch (call.name) {
        case 'list-scenes':
          return ok([{ id: 's1', name: 'Field', active: true }]);
        case 'list-revealed-pages':
          return ok({ pages: [], queue: [] });
        case 'list-recent-changes':
          return ok({ changes: opts.changes ?? [AI_CHANGE] });
        case 'list-changes':
          return ok(EVERYONE);
        case 'get-party':
          return ok(PARTY);
        case 'undo-change':
          return ok({ changeId: 'u1', summary: 'Undid', mode: 'undo' });
        case 'get-token-positions':
          return ok({
            success: true,
            sceneId: 's1',
            sceneName: 'Field',
            tokens: [
              { tokenId: 'tk-m', name: 'Mara', actorId: 'a1', category: 'pc', hidden: false },
              { tokenId: 'tk-w', name: 'Wolf', actorId: 'a2', category: 'enemy', hidden: false },
            ],
          });
        case 'plan-combat-change':
          return ok({
            planId: 'plan-start',
            feature: 'live-play',
            summary: 'Start combat on "Field" with 2 tokens',
            risk: 'write',
            requires: { confirm: true, confirmDestructive: false },
          });
        case 'apply-planned-change':
          return ok({
            changeId: 'chg-start',
            planId: 'plan-start',
            feature: 'live-play',
            summary: 'Start combat on "Field" with 2 tokens',
            mode: 'apply',
            risk: 'write',
          });
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
        { event: 'settings', data: { gmActionsEnabled: true } },
        {
          event: 'combat',
          data: {
            combat: opts.calm
              ? null
              : { active: true, round: 1, turn: 0, current: MARA, combatants: [MARA] },
          },
        },
      ]),
    })
  );
  return calls;
}

const load = async (page: Page): Promise<void> => {
  await page.goto(`/next/?live=1&token=${GM_TOKEN}`);
  await expect(page.locator('#live-screen')).toBeVisible();
};

test('lays out the strip, Party, Handouts and What just happened on one page', async ({ page }) => {
  await setup(page);
  await load(page);
  await expect(page.locator('#live-strip')).toBeVisible();
  await expect(page.locator('#party-drawer')).toBeVisible();
  await expect(page.locator('#handouts-drawer')).toBeVisible();
  await expect(page.locator('#pane-changes')).toContainText('What just happened');
  // Party is open for good: no close button, and the moment tabs, the banner and the layout
  // choices of the During view are not on this page.
  await expect(page.locator('#party-drawer').getByRole('button', { name: 'Close' })).toHaveCount(0);
  await expect(page.locator('#moments')).toHaveCount(0);
  await expect(page.locator('.link-banner')).toHaveCount(0);
  await expect(page.getByRole('button', { name: /Layout|Auto|Cards/ })).toHaveCount(0);
});

test('the header has the permanent Undo, Live play, How do I and More', async ({ page }) => {
  await setup(page);
  await load(page);
  const header = page.locator('#live-header');
  await expect(header.locator('#live-header-undo')).toHaveText('Undo: Goblin 1: 5 fire damage');
  await expect(header.locator('#btn-gm')).toBeVisible();
  await expect(header.locator('#live-how-do-i')).toHaveText('How do I...');
  await header.locator('#live-more').click();
  const more = page.getByRole('dialog', { name: 'More' });
  await expect(more.getByRole('link', { name: 'Old dashboard' })).toBeVisible();
  await expect(more.getByRole('link', { name: 'Back to the During view' })).toBeVisible();
});

test('the header Undo undoes the newest change in one click, without a confirm window', async ({
  page,
}) => {
  const calls = await setup(page);
  await load(page);
  await page.locator('#live-header-undo').click();
  await expect
    .poll(() => calls.find(c => c.name === 'undo-change'))
    .toMatchObject({ args: { changeId: 'c2' }, confirm: true });
  await expect(page.getByRole('dialog', { name: 'Undo' })).toHaveCount(0);
});

test('What just happened is one list with an AI only box and Undo on each line', async ({
  page,
}) => {
  await setup(page);
  await load(page);
  const list = page.locator('#pane-changes');
  await expect(list).toContainText('Moved Tobias');
  await expect(list).toContainText('Goblin 1: 5 fire damage');
  await expect(list.getByRole('button', { name: 'Undo: Goblin 1: 5 fire damage' })).toBeVisible();
  await list.getByLabel('AI only').check();
  await expect(list).not.toContainText('Moved Tobias');
  await expect(list).toContainText('Goblin 1: 5 fire damage');
  // One list: the AI and Everyone tabs of Recent Changes are not here.
  await expect(list.locator('#changes-tab-ai')).toHaveCount(0);
});

test('Start combat in two clicks also rolls initiative for the NPCs', async ({ page }) => {
  const calls = await setup(page, { calm: true });
  await load(page);
  await page.getByRole('button', { name: 'Start combat' }).click();
  await page.getByRole('button', { name: 'Start combat with 2' }).click();
  await expect
    .poll(() => calls.find(c => c.name === 'roll-initiative-for-npcs'))
    .toMatchObject({ args: { scope: 'npcs' }, confirm: true });
  await expect(page.getByText('✓ Rolled initiative for the NPCs', { exact: true })).toBeVisible();
  const names = calls.map(c => c.name);
  expect(names.indexOf('apply-planned-change')).toBeLessThan(
    names.indexOf('roll-initiative-for-npcs')
  );
});

test('How do I... opens the GM coach guide', async ({ page }) => {
  await setup(page);
  const request = page.waitForRequest(req => req.url().includes('/api/help/gm-coach'));
  await load(page);
  await page.locator('#live-how-do-i').click();
  await request;
  await expect(page.locator('#pane-help')).toBeVisible();
});

test('the default dashboard has the switch that opens the Live view', async ({ page }) => {
  await setup(page);
  await page.goto(`/next/?token=${GM_TOKEN}`);
  const link = page.locator('#try-live-screen');
  await expect(link).toHaveText('Try the new live screen');
  await expect(link).toHaveAttribute('href', './?live=1');
});

for (const width of [1440, 400]) {
  test(`does not scroll sideways at ${width} wide`, async ({ page }) => {
    await page.setViewportSize({ width, height: 900 });
    await setup(page);
    await load(page);
    await expect(page.locator('#party-drawer')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
}
