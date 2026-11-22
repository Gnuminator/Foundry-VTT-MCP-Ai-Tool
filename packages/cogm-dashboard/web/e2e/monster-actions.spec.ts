// Monster action buttons on the live strip (item monster-actions-e2e): a hit asks one confirm for
// all damage parts, an unknown verdict never skips the confirm, and no target rolls nothing. The
// bridge and the stream are faked; nothing here needs a world.
import { expect, test, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok, type ToolCall } from './support';

const FIGHT = [
  {
    id: 'g1',
    name: 'Ilvara',
    initiative: 12,
    isCurrentTurn: true,
    hp: { value: 20, max: 20, temp: 0 },
    conditions: [],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
    tokenId: 'tk-g1',
  },
];
const TARGET = { tokenId: 'tk-brannoc', name: 'Brannoc', actorId: 'a-brannoc' };
const HIT = {
  attackTotal: 17,
  targetName: 'Brannoc',
  targetAC: 15,
  hit: true,
  isCritical: false,
  damageTotal: 12,
  damageByType: [
    { type: 'piercing', total: 7 },
    { type: 'poison', total: 5 },
  ],
  item: 'Shortsword',
};

async function setup(
  page: Page,
  opts: {
    targets: unknown[];
    selected?: unknown[];
    activity: Record<string, unknown>;
    autoApply?: boolean;
  }
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
          return ok({ changes: [] });
        case 'search-character-items':
          return ok({ matches: [{ id: 'w1', name: 'Shortsword' }], totalMatches: 1 });
        case 'get-targets':
          return ok({ targets: opts.targets, selected: opts.selected ?? [] });
        case 'use-npc-activity':
          return ok(opts.activity);
        case 'plan-actor-change':
          return ok({
            planId: `plan-${typeof call.args['damageType'] === 'string' ? call.args['damageType'] : 'x'}`,
            summary: 'Damage',
            risk: 'write',
            autoApply: opts.autoApply ?? true,
          });
        case 'apply-planned-change':
          return ok({ changeId: 'chg-1', summary: 'done', mode: 'apply', risk: 'write' });
        default:
          return ok({});
      }
    },
    { playSession: true }
  );
  await fakeStream(page, [
    { event: 'settings', data: { gmActionsEnabled: true } },
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
      data: { combat: { active: true, round: 1, turn: 0, current: FIGHT[0], combatants: FIGHT } },
    },
  ]);
  await page.goto(`/next/?strip=1&token=${GM_TOKEN}`);
  await expect(page.locator('#live-strip')).toBeVisible();
  await page.getByRole('button', { name: 'Ilvara', exact: true }).click();
  return calls;
}

const names = (calls: ToolCall[]): string[] => calls.map(c => c.name);
const press = (page: Page): Promise<void> =>
  page.getByRole('button', { name: 'Shortsword', exact: true }).click();

test('a hit asks one confirm for all damage parts, then applies each part', async ({ page }) => {
  const calls = await setup(page, { targets: [TARGET], activity: HIT, autoApply: false });
  await press(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Deal 7 piercing and 5 poison damage to Brannoc?');
  await expect(dialog).not.toContainText('Hit not confirmed');
  expect(calls.find(c => c.name === 'use-npc-activity')?.args).toEqual({
    actor: 'tk-g1',
    itemName: 'w1',
    isPublic: true,
  });
  // Nothing is applied before the answer.
  expect(names(calls)).not.toContain('apply-planned-change');
  await dialog.getByRole('button', { name: 'Apply damage' }).click();
  await expect.poll(() => names(calls).filter(n => n === 'apply-planned-change')).toHaveLength(2);
  const plans = calls.filter(c => c.name === 'plan-actor-change');
  expect(plans.map(p => p.args)).toEqual([
    { action: 'damage', targets: ['tk-brannoc'], amount: 7, damageType: 'piercing' },
    { action: 'damage', targets: ['tk-brannoc'], amount: 5, damageType: 'poison' },
  ]);
  // One question covered both parts: no second dialog.
  await expect(page.getByRole('dialog')).toHaveCount(0);
  await expect(page.locator('#live-action-result')).toContainText('hit');
});

test('a known hit with the apply-without-confirming switch on applies without a question', async ({
  page,
}) => {
  const calls = await setup(page, { targets: [TARGET], activity: HIT, autoApply: true });
  await press(page);
  await expect.poll(() => names(calls).filter(n => n === 'apply-planned-change')).toHaveLength(2);
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('an unknown verdict never skips the confirm and says so', async ({ page }) => {
  const calls = await setup(page, {
    targets: [TARGET],
    activity: { ...HIT, hit: null, targetAC: null },
    autoApply: true,
  });
  await press(page);
  const dialog = page.getByRole('dialog');
  await expect(dialog).toContainText('Hit not confirmed');
  await expect(dialog).toContainText('Deal 7 piercing and 5 poison damage to Brannoc?');
  expect(names(calls)).not.toContain('apply-planned-change');
  await expect(page.locator('#live-action-result')).toContainText('check the chat card');
});

test('a miss plans no damage', async ({ page }) => {
  const calls = await setup(page, {
    targets: [TARGET],
    activity: { ...HIT, hit: false, damageTotal: null, damageByType: [] },
  });
  await press(page);
  await expect(page.locator('#live-action-result')).toContainText('miss');
  // The press has settled (the line is set before the damage step runs).
  await expect(page.getByRole('button', { name: 'Shortsword', exact: true })).not.toHaveAttribute(
    'aria-busy',
    'true'
  );
  expect(names(calls)).not.toContain('plan-actor-change');
  await expect(page.getByRole('dialog')).toHaveCount(0);
});

test('with no target in Foundry the button rolls nothing', async ({ page }) => {
  const calls = await setup(page, { targets: [], activity: HIT });
  await press(page);
  await expect(page.locator('#live-action-result')).toContainText('Target one creature in Foundry');
  expect(names(calls)).toContain('get-targets');
  expect(names(calls)).not.toContain('use-npc-activity');
  expect(names(calls)).not.toContain('plan-actor-change');
});

test('a creature only selected in Foundry, not targeted, rolls nothing', async ({ page }) => {
  const calls = await setup(page, { targets: [], selected: [TARGET], activity: HIT });
  await press(page);
  await expect(page.locator('#live-action-result')).toContainText('Target one creature in Foundry');
  expect(names(calls)).not.toContain('use-npc-activity');
});
