// Table at a glance (item dashboard-glance-view) at /?glance=1: party HP and conditions, the fight
// with the current turn, the scene, each with how fresh it is. The bridge and the stream are
// faked. GM only: the Live views entry is the way in, and the data comes over GM routes.
import { expect, test } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeStream, fakeTools, ok } from './support';

const PARTY = {
  groups: [
    {
      members: [
        {
          actorId: 'a1',
          name: 'Aldric',
          hp: { value: 5, max: 20, temp: 0 },
          conditions: ['Poisoned'],
          exhaustion: 0,
        },
        {
          actorId: 'a2',
          name: 'Brenna',
          hp: { value: 18, max: 18, temp: 0 },
          conditions: [],
          exhaustion: 0,
        },
      ],
    },
  ],
};

const combatant = (id: string, name: string, over: Record<string, unknown> = {}): unknown => ({
  id,
  name,
  initiative: 12,
  isCurrentTurn: false,
  hp: { value: 7, max: 7, temp: 0 },
  conditions: [],
  isPC: false,
  category: 'enemy',
  defeated: false,
  deathSaves: null,
  tokenId: `tk-${id}`,
  ...over,
});

test('shows party, fight and scene, each with how fresh it is', async ({ page }) => {
  await fakeCommonRoutes(page);
  const fight = [
    combatant('b', 'Brenna', { initiative: 19, isCurrentTurn: true, isPC: true, category: 'pc' }),
    combatant('g', 'Goblin'),
  ];
  await fakeStream(page, [
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
      data: { combat: { active: true, round: 2, turn: 0, current: fight[0], combatants: fight } },
    },
  ]);
  const calls = await fakeTools(page, call => {
    if (call.name === 'get-party') return ok(PARTY);
    if (call.name === 'get-current-scene') return ok({ id: 's1', name: 'Castle gate' });
    return ok({});
  });
  await page.goto(`/next/?glance=1&token=${GM_TOKEN}`);

  const party = page.locator('#glance-party');
  await expect(party).toContainText('Aldric');
  await expect(party).toContainText('5/20');
  await expect(party).toContainText('Poisoned');
  await expect(party).toContainText('updated');

  await expect(page.locator('#glance-turn')).toHaveText("Round 2, Brenna's turn");
  await expect(page.locator('#glance-combat [data-current="true"]')).toContainText('Brenna');
  await expect(page.locator('#glance-combat')).toContainText('updated');

  await expect(page.locator('#glance-scene-name')).toHaveText('Castle gate');
  await expect(page.locator('#glance-scene')).toContainText('updated');

  const names = calls.map(c => c.name);
  expect(names).toContain('get-party');
  expect(names).toContain('get-current-scene');
  // Read only: no plan, apply or other write is called from this page.
  expect(names.filter(n => /^(plan|apply|undo)-/.test(n))).toEqual([]);
});

test('says there is no fight, and what could not be read', async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, [
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
    { event: 'combat', data: { combat: null } },
  ]);
  await fakeTools(page, call =>
    call.name === 'get-party'
      ? { status: 502, json: { ok: false, error: 'Foundry is not answering.' } }
      : ok({ id: 's1', name: 'Field' })
  );
  await page.goto(`/next/?glance=1&token=${GM_TOKEN}`);
  await expect(page.locator('#glance-combat')).toContainText('No fight right now.');
  await expect(page.locator('#glance-party [role="alert"]')).toContainText('Could not read');
  await expect(page.locator('#glance-scene-name')).toHaveText('Field');
});

test('does not say "no fight" before the live stream has spoken', async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, []);
  await fakeTools(page, () => ok({}));
  await page.goto(`/next/?glance=1&token=${GM_TOKEN}`);
  await expect(page.locator('#glance-combat')).toContainText('Waiting for the live stream.');
  await expect(page.locator('#glance-combat')).not.toContainText('No fight right now.');
});

const STATUS = {
  event: 'status',
  data: {
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  },
};

test('marks an answer Old after 45 s, and keeps the last answer when a re-read fails', async ({
  page,
}) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, [STATUS, { event: 'combat', data: { combat: null } }]);
  let partyFails = false;
  await fakeTools(page, call => {
    if (call.name === 'get-party') {
      return partyFails ? { status: 502, json: { ok: false, error: 'down' } } : ok(PARTY);
    }
    return ok({ id: 's1', name: 'Castle gate' });
  });
  await page.clock.install();
  await page.goto(`/next/?glance=1&token=${GM_TOKEN}`);
  const party = page.locator('#glance-party');
  await expect(party).toContainText('Aldric');
  const stamp = party.locator('[data-old]');
  await expect(stamp).toHaveAttribute('data-old', 'false');
  await expect(stamp).not.toContainText('Old');

  // The next re-read fails: the old rows stay, with the text saying so.
  partyFails = true;
  await page.clock.runFor(16_000);
  await expect(party.locator('[role="alert"]')).toContainText(
    'Could not read the party, showing the last answer'
  );
  await expect(party).toContainText('Aldric');

  // Nothing newer than the first answer for more than 45 s: the marker says Old.
  await page.clock.runFor(35_000);
  await expect(stamp).toHaveAttribute('data-old', 'true');
  await expect(stamp).toContainText('Old:');
});

test('reads Party and Scene again every 15 s', async ({ page }) => {
  await fakeCommonRoutes(page);
  await fakeStream(page, [STATUS, { event: 'combat', data: { combat: null } }]);
  const calls = await fakeTools(page, call =>
    call.name === 'get-party' ? ok(PARTY) : ok({ id: 's1', name: 'Castle gate' })
  );
  await page.clock.install();
  await page.goto(`/next/?glance=1&token=${GM_TOKEN}`);
  await expect(page.locator('#glance-party')).toContainText('Aldric');
  await expect(page.locator('#glance-scene-name')).toHaveText('Castle gate');
  const count = (name: string): number => calls.filter(c => c.name === name).length;
  const party0 = count('get-party');
  const scene0 = count('get-current-scene');

  await page.clock.runFor(14_000);
  expect(count('get-party')).toBe(party0);
  expect(count('get-current-scene')).toBe(scene0);

  await page.clock.runFor(2_000);
  await expect.poll(() => count('get-party')).toBeGreaterThan(party0);
  await expect.poll(() => count('get-current-scene')).toBeGreaterThan(scene0);
});
