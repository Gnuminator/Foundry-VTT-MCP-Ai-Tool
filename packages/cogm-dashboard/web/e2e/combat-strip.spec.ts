// The combat strip on the React dashboard (D-092, I-070, I-095): the rows from a `combat` stream
// event, picking rows and the action bar, Damage / Heal opening its small form (one guarded write
// when its button is pressed) and Condition opening the Tool runner filled in, Boss prompts and the reaction buttons, the fight marked old
// while the bridge is away, and that the strip is out of the way when no fight runs. The bridge
// and the stream are faked in the browser; nothing here needs a world.
import { expect, test, type Locator, type Page } from '@playwright/test';

import {
  GM_TOKEN,
  fakeCommonRoutes,
  fakeTools,
  fromMenu,
  ok,
  toast,
  type ToolCall,
} from './support';

// The dash the strip shows for no value.
const DASH = String.fromCharCode(0x2014);

const STARTED = '2026-10-10T18:00:00.000Z';

// lib/stream.ts AWAY_AFTER_MS: how long a failed poll keeps the strip from saying so.
const AWAY_AFTER_MS = 5000;

// The reads the page and the Tool runner make themselves (see `setup`). The strip writes only
// from the Damage / Heal form and the roll row; a test that clicked other buttons expects no other
// call, whatever a future write is named, and no call that carries a confirm flag.
const PAGE_READS = new Set([
  'get-play-session',
  'get-party',
  'list-revealed-pages',
  'list-scenes',
  'list-ref-choices',
  'get-token-positions',
  'list-recent-changes',
]);
const beyondReads = (calls: ToolCall[]): ToolCall[] =>
  calls.filter(c => !PAGE_READS.has(c.name) || c.confirm === true || c.confirmDestructive === true);

interface Event {
  event: string;
  data: unknown;
}

const sse = (events: Event[], retry: number): string =>
  `retry: ${retry}\n\n${events.map(e => `event: ${e.event}\ndata: ${JSON.stringify(e.data)}\n\n`).join('')}`;

// --- Raw combat data, as the bridge sends it --------------------------------------------------

interface RawCombatant {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  hp: { value: number; max: number; temp: number };
  conditions: string[];
  isPC: boolean;
  category: string;
  defeated: boolean;
  deathSaves: { successes: number; failures: number } | null;
  boss?: unknown;
  tokenId?: string | null;
}

const who = (id: string, name: string, over: Partial<RawCombatant> = {}): RawCombatant => ({
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
  ...over,
});

const fight = (
  combatants: RawCombatant[],
  { round = 2, turn = 0 }: { round?: number; turn?: number } = {}
): Event => ({
  event: 'combat',
  data: {
    combat: { active: true, round, turn, current: combatants[turn] ?? null, combatants },
  },
});

const noFight: Event = { event: 'combat', data: { combat: null } };

const WYRM_BOSS = {
  legendary: { max: 3, spent: 1, remaining: 2 },
  resistances: { max: 3, spent: 2, remaining: 1 },
  lair: { inside: true, initiative: 20 },
};

// Deliberately not in initiative order: the strip shows the bridge's order.
const PARTY_FIGHT = [
  who('g', 'Goblin Archer', {
    initiative: 5,
    hp: { value: 2, max: 7, temp: 0 },
    conditions: ['Prone'],
  }),
  who('b', 'Brannoc', {
    initiative: 19,
    isCurrentTurn: true,
    isPC: true,
    category: 'pc',
    hp: { value: 38, max: 44, temp: 0 },
  }),
  who('o', 'Ogre Brute', { initiative: 15, hp: { value: 30, max: 60, temp: 4 } }),
  who('t', 'Tamsin', { initiative: null, category: 'npc' }),
];

const BOSS_FIGHT = [
  who('w', 'Ancient Wyrm', { initiative: 24, boss: WYRM_BOSS }),
  who('b', 'Brannoc', { initiative: 17, isPC: true, category: 'pc', isCurrentTurn: true }),
  who('m', 'Mira', { initiative: 12, isPC: true, category: 'pc' }),
];

// --- The page ---------------------------------------------------------------------------------

type Layout = 'layered' | 'toggle' | 'auto';

interface Options {
  layout?: Layout;
  full?: boolean;
  gmActions?: boolean;
  /** Sent after the prefs and settings. */
  initial?: Event[];
  /** The Boss prompts flag already in the browser. */
  bossFlag?: 'on' | 'off';
  /** What list-ref-choices answers for the token picker. */
  tokenChoices?: { id: string; name: string }[];
  /** Answers a call before the defaults do (a failing tool); undefined leaves it to them. */
  answer?: (call: ToolCall) => { status?: number; json: unknown } | undefined;
}

interface Fakes {
  /** Sends events on the stream after the page loaded. */
  push: (events: Event[]) => void;
  /** The tool calls the page made. */
  calls: ToolCall[];
}

const TOOLS = [
  {
    name: 'plan-actor-change',
    description: 'Plan damage, healing or a condition for tokens.',
    inputSchema: {
      type: 'object',
      properties: {
        action: { type: 'string', enum: ['damage', 'heal', 'condition'] },
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
    name: 'plan-combat-change',
    description: 'Plan ending the fight.',
    inputSchema: {
      type: 'object',
      properties: { action: { type: 'string', enum: ['end'] }, combatId: { type: 'string' } },
      required: ['action'],
    },
    mutates: 'read',
  },
];

/**
 * An open play session with the layout already picked, a stream that sends the prefs, the
 * settings and `initial` first and then whatever `push` gives it, and empty panels.
 */
async function setup(page: Page, options: Options = {}): Promise<Fakes> {
  const {
    layout = 'layered',
    full = false,
    gmActions = true,
    initial = [],
    bossFlag,
    tokenChoices = [],
    answer,
  } = options;
  if (bossFlag) {
    await page.addInitScript(flag => localStorage.setItem('cogm_boss_prompts', flag), bossFlag);
  }
  await fakeCommonRoutes(page);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/preflight', route =>
    route.fulfill({ json: { ready: true, checks: [], scan: null } })
  );
  await page.route('**/api/player/names', route => route.fulfill({ json: [] }));
  await page.route('**/api/tools', route =>
    route.fulfill({ json: { tools: TOOLS, gmActionsEnabled: gmActions } })
  );
  const calls = await fakeTools(
    page,
    call => {
      const custom = answer?.(call);
      if (custom) return custom;
      switch (call.name) {
        case 'get-play-session':
          return ok({ success: true, worldId: 'w', open: true, startedAt: STARTED, endedAt: null });
        case 'get-party':
          return ok({ groups: [], paceOptions: [], scene: null, encounter: null, warnings: [] });
        case 'list-revealed-pages':
          return ok({ pages: [], queue: [] });
        case 'list-scenes':
          return ok([]);
        case 'get-token-positions':
          return ok({
            success: true,
            sceneName: 'Field',
            tokens: [
              {
                tokenId: 'tk-shop',
                name: 'Shopkeeper',
                actorId: 'a3',
                category: 'npc',
                hidden: false,
              },
              { tokenId: 'tk-wolf', name: 'Wolf', actorId: 'a2', category: 'enemy', hidden: false },
              { tokenId: 'tk-bran', name: 'Brannoc', actorId: 'a1', category: 'pc', hidden: false },
              {
                tokenId: 'tk-mark',
                name: 'Marker',
                actorId: null,
                category: 'enemy',
                hidden: false,
              },
            ],
          });
        case 'plan-actor-change':
          return ok({
            planId: 'plan-hit',
            feature: 'live-play',
            summary: 'Damage',
            risk: 'write',
            requires: { confirm: true, confirmDestructive: false },
          });
        case 'request-player-rolls':
          return ok({ success: true, message: 'sent' });
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
        case 'list-ref-choices':
          return ok({ kind: 'token', choices: tokenChoices, truncated: false });
        default:
          return ok({});
      }
    },
    { playSession: true }
  );

  const first: Event[] = [
    {
      event: 'prefs',
      data: {
        duringLayout: layout,
        duringFull: full,
        layoutPicked: true,
        hintDismissed: true,
        hintSessions: [],
      },
    },
    { event: 'settings', data: { gmActionsEnabled: gmActions } },
    ...initial,
  ];
  const queue: Event[][] = [];
  let wake: () => void = () => undefined;
  let requests = 0;
  await page.route('**/api/stream**', async route => {
    requests += 1;
    let events = first;
    if (requests > 1) {
      while (queue.length === 0) await new Promise<void>(resolve => (wake = resolve));
      events = queue.shift() ?? [];
    }
    await route.fulfill({ status: 200, contentType: 'text/event-stream', body: sse(events, 100) });
  });
  return {
    calls,
    push: (events): void => {
      queue.push(events);
      wake();
    },
  };
}

const strip = (page: Page): Locator => page.locator('#pane-combat');
const rows = (page: Page): Locator => page.locator('#combat-body .combatant');
const row = (page: Page, name: string): Locator => page.locator(`.combatant[data-name="${name}"]`);
const pick = (page: Page, name: string): Locator => page.getByRole('button', { name, exact: true });
const bossToggle = (page: Page): Locator => page.locator('#boss-toggle');
const reaction = (page: Page, name: RegExp | string): Locator =>
  page.getByRole('button', { name: typeof name === 'string' ? `Reaction ready: ${name}` : name });
const away = (page: Page): Locator => page.locator('#combat-away');
const during = (page: Page): Locator => page.locator('#moment-during');

async function load(page: Page): Promise<void> {
  await page.goto(`/next/?token=${GM_TOKEN}`);
  await expect(during(page)).toBeVisible();
}

const status = (over: Record<string, unknown>): Event => ({
  event: 'status',
  data: {
    controlChannel: 'connected',
    foundry: 'reachable',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
    ...over,
  },
});

const BRIDGE_UP = status({});
const FOUNDRY_AWAY = status({ foundry: 'unreachable', lastError: 'Foundry module not connected' });

test.describe('the rows', () => {
  test('one row per combatant in the bridge order, with the old ids and classes', async ({
    page,
  }) => {
    // Rows that cannot be picked (GM Actions off) keep the plain name span.
    await setup(page, { gmActions: false, initial: [fight(PARTY_FIGHT, { turn: 1 })] });
    await load(page);

    await expect(strip(page)).toBeVisible();
    await expect(page.locator('#combat-meta')).toHaveText('Round 2 · 4 combatants');
    await expect(rows(page)).toHaveCount(4);
    await expect(rows(page).locator('.combatant-name .combatant-text')).toHaveText([
      'Goblin Archer',
      'Brannoc',
      'Ogre Brute',
      'Tamsin',
    ]);
    await expect(rows(page).locator('.init-badge')).toHaveText(['5', '19', '15', DASH]);
    await expect(rows(page).locator('.side')).toHaveText(['Enemy', 'PC', 'Enemy', 'NPC']);
    await expect(rows(page).locator('.side-pc')).toHaveCount(1);
    await expect(rows(page).locator('.side-npc')).toHaveCount(1);
    await expect(rows(page).locator('.hp-text')).toHaveText(['2/7', '38/44', '30/60 +4', '20/20']);
    await expect(row(page, 'Brannoc')).toHaveClass(/current/);
    await expect(row(page, 'Brannoc')).toHaveAttribute('aria-current', 'true');
    await expect(row(page, 'Goblin Archer')).not.toHaveClass(/current/);
    // The pane keeps its old ids.
    await expect(page.locator('#combat-body')).toHaveClass(/pane-body/);
    await expect(page.locator('#combat-actions')).toBeHidden();
    await expect(strip(page).getByRole('heading', { name: 'Combat Tracker' })).toBeVisible();
  });

  test('the hit point bar has a fill, a colour and a text equivalent', async ({ page }) => {
    await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    const goblin = row(page, 'Goblin Archer');
    await expect(goblin.locator('.hp-fill')).toHaveClass(/low/);
    await expect(row(page, 'Ogre Brute').locator('.hp-fill')).toHaveClass(/mid/);
    await expect(row(page, 'Brannoc').locator('.hp-fill')).not.toHaveClass(/low|mid/);
    await expect(row(page, 'Ogre Brute').locator('.hp-fill')).toHaveCSS('width', /^\d/);
    const meter = goblin.getByRole('meter', { name: 'Hit points of Goblin Archer' });
    await expect(meter).toHaveAttribute('aria-valuetext', '2 of 7 hit points');
    await expect(meter).toHaveAttribute('aria-valuenow', '2');
    await expect(meter).toHaveAttribute('aria-valuemax', '7');
    await expect(
      row(page, 'Ogre Brute').getByRole('meter', { name: 'Hit points of Ogre Brute' })
    ).toHaveAttribute('aria-valuetext', '30 of 60 hit points, 4 temporary');
  });

  for (const layout of ['layered', 'toggle', 'auto'] as const) {
    test(`conditions show in the ${layout} layout, not only in Auto`, async ({ page }) => {
      await setup(page, { layout, full: true, initial: [fight(PARTY_FIGHT)] });
      await load(page);
      await expect(during(page)).toHaveAttribute('data-layout', layout);
      await expect(row(page, 'Goblin Archer').locator('.condition-chip')).toBeVisible();
      await expect(row(page, 'Goblin Archer').locator('.condition-chip')).toHaveText('Prone');
    });
  }

  test('death saves show at zero hit points, and a defeated row is marked', async ({ page }) => {
    await setup(page, {
      initial: [
        fight([
          who('m', 'Mira', {
            isPC: true,
            category: 'pc',
            hp: { value: 0, max: 27, temp: 0 },
            deathSaves: { successes: 1, failures: 2 },
          }),
          who('g', 'Goblin Archer', { defeated: true, hp: { value: 0, max: 7, temp: 0 } }),
          who('o', 'Ogre Brute', { deathSaves: { successes: 0, failures: 0 } }),
        ]),
      ],
    });
    await load(page);
    await expect(row(page, 'Mira').locator('.death-saves')).toContainText('Death saves ✓1 ✗2');
    await expect(row(page, 'Mira').locator('.death-saves .visually-hidden')).toHaveText(
      'Death saves: 1 success, 2 failures'
    );
    // Saves with hit points left are not shown.
    await expect(row(page, 'Ogre Brute').locator('.death-saves')).toHaveCount(0);
    await expect(row(page, 'Goblin Archer')).toHaveClass(/defeated/);
    await expect(row(page, 'Goblin Archer')).toContainText('defeated');
  });

  test('a fight with nobody in it says so', async ({ page }) => {
    await setup(page, { initial: [fight([])] });
    await load(page);
    await expect(strip(page)).toBeVisible();
    await expect(page.locator('#combat-body')).toHaveText('No combatants in this fight.');
    await expect(page.locator('#combat-meta')).toHaveText('Round 2 · 0 combatants');
  });
});

test.describe('when the strip shows', () => {
  test('Cards: hidden with no fight, shown while one runs, hidden when it ends', async ({
    page,
  }) => {
    // GM Actions is on (the default): the strip still stays away in the calm Cards layout.
    const { push } = await setup(page, { layout: 'layered', initial: [noFight] });
    await load(page);
    await expect(during(page)).toHaveAttribute('data-context', 'calm');
    await expect(strip(page)).toBeHidden();
    push([fight(PARTY_FIGHT)]);
    await expect(during(page)).toHaveAttribute('data-context', 'combat');
    await expect(strip(page)).toBeVisible();
    await expect(rows(page)).toHaveCount(4);
    push([noFight]);
    await expect(strip(page)).toBeHidden();
    await expect(page.locator('#combat-meta')).toHaveText(DASH);
    await expect(page.locator('#combat-body')).toHaveText('No active combat.');
  });

  test('Simple/Full: Full shows the strip with no fight, Simple never does', async ({ page }) => {
    const { push } = await setup(page, { layout: 'toggle', full: true, initial: [noFight] });
    await load(page);
    await expect(strip(page)).toBeVisible();
    await expect(page.locator('#combat-body')).toHaveText('No active combat.');
    await expect(page.locator('#combat-actions')).toBeHidden();
    await expect(bossToggle(page)).toBeHidden();
    push([fight(PARTY_FIGHT)]);
    await expect(rows(page)).toHaveCount(4);
  });

  test('Simple hides it even in a fight', async ({ page }) => {
    await setup(page, { layout: 'toggle', full: false, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(during(page)).toHaveAttribute('data-view', 'simple');
    await expect(strip(page)).toBeHidden();
  });
});

test.describe('start combat', () => {
  // The picker lives in the strip, which shows with no fight only in B's Full view.
  const FULL_CALM: Options = { layout: 'toggle', full: true };

  test('with no fight, a picker ticks the player characters and Hostile tokens and starts them', async ({
    page,
  }) => {
    const { calls } = await setup(page, FULL_CALM);
    await load(page);
    await page.getByRole('button', { name: 'Start combat' }).click();

    const list = page.getByRole('list', { name: 'Tokens to put in the fight' });
    await expect(list.locator('.cs-name')).toHaveText(['Brannoc', 'Marker', 'Wolf', 'Shopkeeper']);
    const box = (name: string): Locator => list.getByRole('checkbox', { name: new RegExp(name) });
    await expect(box('Brannoc')).toBeChecked();
    await expect(box('Wolf')).toBeChecked();
    await expect(box('Shopkeeper')).not.toBeChecked();
    // No actor: it cannot fight, so it is off and cannot be ticked.
    await expect(box('Marker')).toBeDisabled();
    await expect(box('Marker')).not.toBeChecked();

    await box('Shopkeeper').check();
    await box('Brannoc').uncheck();
    await page.getByRole('button', { name: 'Start combat with 2' }).click();

    await expect.poll(() => calls.map(c => c.name)).toContain('apply-planned-change');
    const planned = calls.find(c => c.name === 'plan-combat-change');
    expect(planned?.args).toEqual({ action: 'start', tokenIds: ['tk-wolf', 'tk-shop'] });
    // The picker closes once the change is in.
    await expect(list).toBeHidden();
    // The default dashboard never rolls initiative: the GM does it (or asks Claude).
    expect(calls.map(c => c.name)).not.toContain('roll-initiative-for-npcs');
  });

  test('Cancel closes the picker and writes nothing', async ({ page }) => {
    const { calls } = await setup(page, FULL_CALM);
    await load(page);
    await page.getByRole('button', { name: 'Start combat' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(page.getByRole('button', { name: 'Start combat' })).toBeVisible();
    expect(beyondReads(calls)).toEqual([]);
  });

  for (const [name, options] of [
    ['Cards', { layout: 'layered' }],
    ['Simple', { layout: 'toggle', full: false }],
    ['Auto', { layout: 'auto' }],
  ] as const) {
    test(`${name}: the During bar starts a fight with no fight running, the card stays away`, async ({
      page,
    }) => {
      const { calls } = await setup(page, options);
      await load(page);
      await expect(strip(page)).toBeHidden();
      // One entry point, on the bar.
      const open = page.locator('#during-bar').getByRole('button', { name: 'Start combat' });
      await expect(page.getByRole('button', { name: 'Start combat' })).toHaveCount(1);
      await open.click();

      const list = page.getByRole('list', { name: 'Tokens to put in the fight' });
      await expect(list.locator('.cs-name')).toHaveText([
        'Brannoc',
        'Marker',
        'Wolf',
        'Shopkeeper',
      ]);
      await page.getByRole('button', { name: 'Start combat with 2' }).click();

      await expect.poll(() => calls.map(c => c.name)).toContain('apply-planned-change');
      const planned = calls.find(c => c.name === 'plan-combat-change');
      expect(planned?.args).toEqual({ action: 'start', tokenIds: ['tk-bran', 'tk-wolf'] });
      await expect(list).toBeHidden();
    });
  }

  test('the bar picker closes with Cancel and the button comes back', async ({ page }) => {
    const { calls } = await setup(page, { layout: 'layered' });
    await load(page);
    const bar = page.locator('#during-bar');
    await bar.getByRole('button', { name: 'Start combat' }).click();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(bar.getByRole('button', { name: 'Start combat' })).toBeVisible();
    expect(beyondReads(calls)).toEqual([]);
  });

  test('the bar picker does not reopen by itself after a fight came and went', async ({ page }) => {
    const { push } = await setup(page, { layout: 'layered', initial: [noFight] });
    await load(page);
    const bar = page.locator('#during-bar');
    await bar.getByRole('button', { name: 'Start combat' }).click();
    await expect(page.getByRole('list', { name: 'Tokens to put in the fight' })).toBeVisible();
    push([fight(PARTY_FIGHT)]);
    await expect(rows(page)).toHaveCount(4);
    push([noFight]);
    await expect(bar.getByRole('button', { name: 'Start combat' })).toBeVisible();
    await expect(page.getByRole('list', { name: 'Tokens to put in the fight' })).toHaveCount(0);
  });

  test('the bar picker takes focus when it opens and gives it back on Cancel', async ({ page }) => {
    await setup(page, { layout: 'layered' });
    await load(page);
    const bar = page.locator('#during-bar');
    await bar.getByRole('button', { name: 'Start combat' }).click();
    const list = page.getByRole('list', { name: 'Tokens to put in the fight' });
    await expect(list).toBeVisible();
    await expect(list.getByRole('checkbox').first()).toBeFocused();
    await page.getByRole('button', { name: 'Cancel' }).click();
    await expect(bar.getByRole('button', { name: 'Start combat' })).toBeFocused();
  });

  test('the bar has no Start combat in the Full view, where the strip has it', async ({ page }) => {
    await setup(page, FULL_CALM);
    await load(page);
    await expect(page.getByRole('button', { name: 'Start combat' })).toHaveCount(1);
    await expect(
      page.locator('#during-bar').getByRole('button', { name: 'Start combat' })
    ).toHaveCount(0);
  });

  test('GM Actions off: Start combat on the bar is disabled with a reason and Turn on', async ({
    page,
  }) => {
    await setup(page, { layout: 'layered', gmActions: false });
    await load(page);
    const start = page.locator('#during-bar').getByRole('button', { name: 'Start combat' });
    await expect(start).toHaveAttribute('aria-disabled', 'true');
    await expect(start).toHaveAttribute('title', 'GM Actions is off');
    await expect(page.locator('#during-bar .turn-on-note')).toContainText('GM Actions is off.');
    await expect(
      page.locator('#during-bar').getByRole('button', { name: 'Turn on' })
    ).toBeVisible();
  });

  test('a running fight: no Start combat on the bar', async ({ page }) => {
    await setup(page, { layout: 'layered', initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Start combat' })).toHaveCount(0);
  });

  test('GM Actions off: the strip keeps a disabled Start combat with Turn on', async ({ page }) => {
    await setup(page, { ...FULL_CALM, gmActions: false });
    await load(page);
    await expect(strip(page)).toBeAttached();
    await expect(page.getByRole('button', { name: 'Start combat' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(strip(page).getByRole('button', { name: 'Turn on' })).toBeVisible();
  });

  test('a running fight has no Start combat button', async ({ page }) => {
    await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.getByRole('button', { name: 'Start combat' })).toHaveCount(0);
  });
});

test.describe('picking combatants', () => {
  test('GM Actions off: no rows to pick; End combat and the roll buttons are disabled with Turn on', async ({
    page,
  }) => {
    await setup(page, { gmActions: false, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(row(page, 'Brannoc')).not.toHaveClass(/selectable/);
    await expect(page.locator('#combat-actions')).toBeHidden();
    await expect(page.locator('#combat-body button.combatant-pick')).toHaveCount(0);
    await expect(page.getByRole('button', { name: 'End combat' })).toHaveAttribute(
      'aria-disabled',
      'true'
    );
    await expect(page.locator('#strip-roll-party')).toHaveAttribute('aria-disabled', 'true');
    await expect(strip(page).getByRole('button', { name: 'Turn on' })).toHaveCount(2);
  });

  test('both on: a hint, then a count and the buttons', async ({ page }) => {
    await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    const bar = page.locator('#combat-actions');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.ca-hint')).toHaveText(
      'Click combatants to deal damage or set a condition on them.'
    );
    await expect(bar.locator('.ca-btn')).toHaveText(['Use Foundry targets', 'End combat']);
    await expect(row(page, 'Ogre Brute')).toHaveClass(/selectable/);
    await expect(row(page, 'Ogre Brute')).toHaveAttribute(
      'data-track',
      'dash.combat.select-combatant'
    );

    await row(page, 'Ogre Brute').click();
    await expect(row(page, 'Ogre Brute')).toHaveClass(/selected/);
    await expect(pick(page, 'Ogre Brute')).toHaveAttribute('aria-pressed', 'true');
    await expect(bar.locator('.ca-count')).toHaveText('1 selected');
    await row(page, 'Goblin Archer').click();
    await expect(bar.locator('.ca-count')).toHaveText('2 selected');
    await expect(bar.locator('.ca-btn')).toHaveText([
      'Damage / Heal',
      'Condition',
      'Clear',
      'Use Foundry targets',
      'End combat',
    ]);
    await expect(bar.locator('[data-sel="clear"]')).toHaveText('Clear');

    // A second click on a row lets go of it.
    await row(page, 'Ogre Brute').click();
    await expect(row(page, 'Ogre Brute')).not.toHaveClass(/selected/);
    await expect(pick(page, 'Ogre Brute')).toHaveAttribute('aria-pressed', 'false');
    await expect(bar.locator('.ca-count')).toHaveText('1 selected');

    // Clear lets go of all and brings the hint back.
    await bar.locator('[data-sel="clear"]').click();
    await expect(rows(page).locator('.selected')).toHaveCount(0);
    await expect(bar.locator('.ca-hint')).toBeVisible();
  });

  test('the keyboard can pick a row: Tab to its button, Enter or Space', async ({ page }) => {
    await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    const ogre = pick(page, 'Ogre Brute');
    await ogre.focus();
    await page.keyboard.press('Enter');
    await expect(ogre).toHaveAttribute('aria-pressed', 'true');
    await expect(row(page, 'Ogre Brute')).toHaveClass(/selected/);
    await expect(ogre).toBeFocused();
    await page.keyboard.press('Space');
    await expect(ogre).toHaveAttribute('aria-pressed', 'false');
    await expect(page.locator('#combat-actions .ca-count')).toHaveCount(0);
  });

  test('a picked combatant that leaves the fight is dropped; the fight ending clears the picks', async ({
    page,
  }) => {
    const { push } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Ogre Brute').click();
    await row(page, 'Goblin Archer').click();
    await expect(page.locator('#combat-actions .ca-count')).toHaveText('2 selected');
    push([fight(PARTY_FIGHT.filter(c => c.id !== 'g'))]);
    await expect(page.locator('#combat-actions .ca-count')).toHaveText('1 selected');
    push([noFight]);
    push([fight(PARTY_FIGHT)]);
    await expect(rows(page)).toHaveCount(4);
    await expect(page.locator('#combat-actions .ca-hint')).toBeVisible();
  });

  test('Damage / Heal opens the small form and writes nothing until the button is pressed', async ({
    page,
  }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Ogre Brute').click();
    await row(page, 'Goblin Archer').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();

    const form = page.locator('#damage-form');
    await expect(form).toBeVisible();
    await expect(page.locator('#damage-amount')).toBeFocused();
    await expect(form.locator('#damage-apply')).toHaveText('Type an amount');
    await expect(form).toContainText('Applies to the tokens in Foundry as soon as you press');
    expect(beyondReads(calls)).toEqual([]);
  });

  test('Clear closes the Damage / Heal form for good: the next pick does not reopen it', async ({
    page,
  }) => {
    await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Ogre Brute').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();
    await expect(page.locator('#damage-form')).toBeVisible();
    await page.getByRole('button', { name: 'Clear' }).click();
    await expect(page.locator('#damage-form')).toHaveCount(0);
    await row(page, 'Goblin Archer').click();
    await expect(page.locator('#damage-form')).toHaveCount(0);
  });

  test('Damage: an amount and a type plan and apply on both picked tokens in one click', async ({
    page,
  }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Ogre Brute').click();
    await row(page, 'Goblin Archer').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();
    await page.locator('#damage-amount').fill('8');
    await page.locator('#damage-form').getByRole('button', { name: 'fire' }).click();
    await expect(page.locator('#damage-apply')).toHaveText(
      'Deal 8 fire damage to Goblin Archer and Ogre Brute in Foundry'
    );
    await page.locator('#damage-apply').click();

    await expect(page.locator('#damage-form')).toHaveCount(0);
    expect(
      calls.filter(c => c.name === 'plan-actor-change' || c.name === 'apply-planned-change')
    ).toEqual([
      {
        name: 'plan-actor-change',
        args: {
          action: 'damage',
          targets: ['Goblin Archer', 'Ogre Brute'],
          amount: 8,
          damageType: 'fire',
        },
      },
      { name: 'apply-planned-change', args: { planId: 'plan-hit' }, confirm: true },
    ]);
  });

  test('Heal: the chips go and the plan is a healing', async ({ page }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Brannoc').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();
    const form = page.locator('#damage-form');
    await expect(form.getByRole('button', { name: 'fire' })).toBeVisible();
    await form.getByRole('button', { name: 'Heal', exact: true }).click();
    await expect(form.getByRole('button', { name: 'fire' })).toHaveCount(0);
    await page.locator('#damage-amount').fill('5');
    await page.locator('#damage-amount').press('Enter');
    await expect(form).toHaveCount(0);
    expect(calls.find(c => c.name === 'plan-actor-change')?.args).toEqual({
      action: 'healing',
      targets: ['Brannoc'],
      amount: 5,
    });
  });

  test('Escape closes the Damage / Heal form without writing', async ({ page }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Brannoc').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();
    await page.locator('#damage-amount').press('Escape');
    await expect(page.locator('#damage-form')).toHaveCount(0);
    expect(beyondReads(calls)).toEqual([]);
  });

  test('Ask the party sends one request-player-rolls per player character', async ({ page }) => {
    const { calls } = await setup(page, { initial: [fight(BOSS_FIGHT)] });
    await load(page);
    await page.locator('#strip-roll-what').selectOption('save:dex');
    await page.locator('#strip-roll-dc').fill('14');
    await page.locator('#strip-roll-visibility').selectOption('public');
    await page.locator('#strip-roll-party').click();
    await expect(toast(page, '✓ Sent: Dexterity save DC 14 to 2 characters')).toBeVisible();
    const rolls = calls.filter(c => c.name === 'request-player-rolls');
    expect(rolls.map(c => c.args)).toEqual(
      ['Brannoc', 'Mira'].map(name => ({
        rollType: 'save',
        rollTarget: 'dex',
        targetPlayer: name,
        isPublic: true,
        userConfirmedVisibility: true,
        dc: 14,
        flavor: 'DC 14',
      }))
    );
    expect(rolls.every(c => c.confirm === true)).toBe(true);
  });

  test('a picked player character gets its own Ask button; monsters have none', async ({
    page,
  }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(page.locator('#strip-roll-picked')).toHaveCount(0);
    await row(page, 'Ogre Brute').click();
    await expect(page.locator('#strip-roll-picked')).toHaveCount(0);
    await row(page, 'Brannoc').click();
    await expect(page.locator('#strip-roll-picked')).toHaveText('Ask Brannoc');
    await page.locator('#strip-roll-picked').click();
    await expect(toast(page, '✓ Sent: Perception to Brannoc')).toBeVisible();
    expect(calls.filter(c => c.name === 'request-player-rolls').map(c => c.args)).toEqual([
      {
        rollType: 'skill',
        rollTarget: 'perception',
        targetPlayer: 'Brannoc',
        isPublic: false,
        userConfirmedVisibility: true,
      },
    ]);
  });

  test('End combat opens the Tool runner on plan-combat-change, filled in, and writes nothing', async ({
    page,
  }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await page.locator('#combat-actions [data-sel="end"]').click();

    const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('#tool-detail-name')).toHaveText('plan-combat-change');
    await expect(drawer.locator('#tool-field-action')).toHaveValue('end');
    // Nothing planned or applied: the GM presses Run in the Tool runner.
    await expect(drawer.locator('#tool-run')).toBeVisible();
    expect(beyondReads(calls)).toEqual([]);
  });

  test('two combatants with one name go in by token id, and the picker hint says whose', async ({
    page,
  }) => {
    const wolves = [
      who('c1', 'Wolf', { tokenId: 'tok-wolf-1' }),
      who('c2', 'Brannoc', { isPC: true, category: 'pc', tokenId: 'tok-brannoc' }),
      who('c3', 'Wolf', { tokenId: 'tok-wolf-2' }),
      who('c4', 'Tamsin', { category: 'npc' }),
    ];
    const { calls } = await setup(page, {
      initial: [fight(wolves)],
      tokenChoices: [
        { id: 'tok-wolf-1', name: 'Wolf' },
        { id: 'tok-brannoc', name: 'Brannoc' },
        { id: 'tok-wolf-2', name: 'Wolf' },
      ],
    });
    await load(page);
    await row(page, 'Tamsin').click();
    await page.locator('.combatant[data-id="c3"]').click();
    await page.locator('.combatant[data-id="c1"]').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();
    await page.locator('#damage-amount').fill('4');
    // The button names the tokens; the plan gets a token id for each wolf, the name for a row
    // without a token, in the bridge's order.
    await expect(page.locator('#damage-apply')).toHaveText('Deal 4 damage to 3 tokens in Foundry');
    await page.locator('#damage-apply').click();
    await expect(page.locator('#damage-form')).toHaveCount(0);
    expect(calls.find(c => c.name === 'plan-actor-change')?.args).toEqual({
      action: 'damage',
      targets: ['tok-wolf-1', 'tok-wolf-2', 'Tamsin'],
      amount: 4,
    });
  });

  test('Condition opens it with the action set to condition', async ({ page }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Brannoc').click();
    await page.locator('#combat-actions [data-sel="condition"]').click();
    const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
    await expect(drawer.locator('#tool-detail-name')).toHaveText('plan-actor-change');
    await expect(drawer.locator('#tool-field-action')).toHaveValue('condition');
    await expect(drawer.locator('#tool-field-targets')).toHaveValue('Brannoc');
    expect(beyondReads(calls)).toEqual([]);
  });
});

test.describe('Boss prompts and reactions', () => {
  test('off by default; the switch shows when a boss is up, and turning it on is remembered', async ({
    page,
  }) => {
    await setup(page, { initial: [fight(BOSS_FIGHT, { turn: 1 })] });
    await load(page);
    await expect(bossToggle(page)).toBeVisible();
    await expect(bossToggle(page)).toHaveText('👑 Boss prompts: off');
    await expect(page.locator('.reaction-btn')).toHaveCount(0);
    await expect(page.locator('.boss-line')).toHaveCount(0);
    await expect(page.locator('#boss-prompts')).toBeHidden();

    await bossToggle(page).click();
    await expect(bossToggle(page)).toHaveText('👑 Boss prompts: on');
    await expect(bossToggle(page)).toHaveClass(/on/);
    expect(await page.evaluate(() => localStorage.getItem('cogm_boss_prompts'))).toBe('on');

    // The reaction button is on the boss only.
    await expect(page.locator('.reaction-btn')).toHaveCount(1);
    await expect(row(page, 'Ancient Wyrm').locator('.reaction-btn')).toBeVisible();
    await expect(row(page, 'Brannoc').locator('.reaction-btn')).toHaveCount(0);
    const line = row(page, 'Ancient Wyrm').locator('.boss-line');
    await expect(line).toContainText('Legendary');
    await expect(line).toContainText('2/3');
    await expect(line).toContainText('Resist');
    await expect(line).toContainText('1/3');
    await expect(line).toContainText('in lair');

    // Brannoc is up (turn 1) and is the first under the lair count of 20: both reminders.
    const prompts = page.locator('#boss-prompts');
    await expect(prompts).toBeVisible();
    await expect(prompts.locator('.boss-prompt.prompt-lair')).toContainText(
      "Lair action for Ancient Wyrm (initiative 20), before Brannoc's turn."
    );
    await expect(prompts.locator('.boss-prompt.prompt-legendary')).toContainText(
      'Ancient Wyrm: 2 legendary actions left, one after this turn.'
    );

    await bossToggle(page).click();
    await expect(bossToggle(page)).toHaveText('👑 Boss prompts: off');
    expect(await page.evaluate(() => localStorage.getItem('cogm_boss_prompts'))).toBe('off');
    await expect(page.locator('.reaction-btn')).toHaveCount(0);
  });

  test('a boss that is down gets no reaction button', async ({ page }) => {
    await setup(page, {
      bossFlag: 'on',
      initial: [
        fight([
          who('w', 'Ancient Wyrm', {
            defeated: true,
            boss: WYRM_BOSS,
            hp: { value: 0, max: 367, temp: 0 },
          }),
          who('b', 'Brannoc', { isPC: true, category: 'pc' }),
        ]),
      ],
    });
    await load(page);
    await expect(page.locator('.reaction-btn')).toHaveCount(0);
    // No boss up and the flag on: the switch stays, so it can be turned off.
    await expect(bossToggle(page)).toBeVisible();
  });

  test('flag on and no boss in the fight: no reaction buttons, the switch stays and turns it off', async ({
    page,
  }) => {
    await setup(page, { bossFlag: 'on', initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(page.locator('.reaction-btn')).toHaveCount(0);
    await expect(bossToggle(page)).toBeVisible();
    await expect(bossToggle(page)).toHaveText('👑 Boss prompts: on');

    await bossToggle(page).focus();
    await page.keyboard.press('Enter');
    // Off, and with no boss the switch goes away: the focus lands on the pane, not the page.
    await expect(bossToggle(page)).toBeHidden();
    await expect(strip(page)).toBeFocused();
    expect(await page.evaluate(() => localStorage.getItem('cogm_boss_prompts'))).toBe('off');
  });

  test('flag off and no boss: no switch at all', async ({ page }) => {
    await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(bossToggle(page)).toBeHidden();
    await expect(page.locator('.reaction-btn')).toHaveCount(0);
  });

  test('the switch is hidden with no fight even when the flag is on', async ({ page }) => {
    await setup(page, { bossFlag: 'on', layout: 'toggle', full: true, initial: [noFight] });
    await load(page);
    await expect(strip(page)).toBeVisible();
    await expect(bossToggle(page)).toBeHidden();
  });

  test('the R button has a name and a state, toggles in place and keeps the focus', async ({
    page,
  }) => {
    await setup(page, { bossFlag: 'on', initial: [fight(BOSS_FIGHT, { turn: 1 })] });
    await load(page);
    const r = reaction(page, 'Ancient Wyrm');
    await expect(r).toHaveText('R');
    await expect(r).toHaveAttribute('aria-pressed', 'false');
    await expect(r).toHaveAttribute('data-track', 'dash.combat.reaction');
    await expect(r).toHaveAttribute('title', 'Mark reaction used this round');

    // Mark this very element: a re-render of the strip would replace it.
    await r.evaluate(el => el.setAttribute('data-mark', 'same'));
    await r.focus();
    await page.keyboard.press('Enter');
    const used = page.getByRole('button', { name: 'Reaction used: Ancient Wyrm' });
    await expect(used).toBeFocused();
    await expect(used).toHaveClass(/used/);
    await expect(used).toHaveAttribute('aria-pressed', 'true');
    await expect(used).toHaveAttribute('title', 'Reaction used this round (click to undo)');
    await expect(used).toHaveAttribute('data-mark', 'same');

    await page.keyboard.press('Space');
    const ready = page.getByRole('button', { name: 'Reaction ready: Ancient Wyrm' });
    await expect(ready).toBeFocused();
    await expect(ready).not.toHaveClass(/used/);
    await expect(ready).toHaveAttribute('data-mark', 'same');
  });

  test('a tick is cleared when the round changes, and a tick does not pick the row', async ({
    page,
  }) => {
    const { push } = await setup(page, {
      bossFlag: 'on',
      initial: [fight(BOSS_FIGHT, { round: 2, turn: 1 })],
    });
    await load(page);
    await reaction(page, 'Ancient Wyrm').click();
    await expect(page.getByRole('button', { name: 'Reaction used: Ancient Wyrm' })).toBeVisible();
    // Pressing R is not picking the row.
    await expect(row(page, 'Ancient Wyrm')).not.toHaveClass(/selected/);
    await expect(page.locator('#combat-actions .ca-hint')).toBeVisible();

    // Same round, another change: the tick stays.
    push([fight(BOSS_FIGHT, { round: 2, turn: 2 })]);
    await expect(page.locator('#combat-meta')).toHaveText('Round 2 · 3 combatants');
    await expect(page.getByRole('button', { name: 'Reaction used: Ancient Wyrm' })).toBeVisible();

    push([fight(BOSS_FIGHT, { round: 3, turn: 0 })]);
    await expect(page.locator('#combat-meta')).toHaveText('Round 3 · 3 combatants');
    await expect(page.getByRole('button', { name: 'Reaction ready: Ancient Wyrm' })).toBeVisible();
  });
});

test.describe('the bridge is away', () => {
  test('the fight stays, marked as the last one seen, and its buttons are off until it is back', async ({
    page,
  }) => {
    const { push, calls } = await setup(page, {
      bossFlag: 'on',
      initial: [BRIDGE_UP, fight(BOSS_FIGHT, { turn: 1 })],
    });
    await load(page);
    const note = away(page);
    await expect(note).toHaveAttribute('role', 'status');
    await expect(note).toHaveText('');
    await expect(rows(page)).toHaveCount(3);
    await row(page, 'Brannoc').click();
    await row(page, 'Mira').click();
    await expect(strip(page)).not.toHaveClass(/is-stale/);

    push([FOUNDRY_AWAY]);
    await expect(note).toHaveText('The bridge is away: this is the fight as last seen.');
    await expect(strip(page)).toHaveClass(/is-stale/);
    // The rows are still there.
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator('#combat-meta')).toHaveText('Round 2 · 3 combatants');
    await expect(page.locator('#combat-body')).toHaveCSS('filter', /grayscale/);
    // The action bar and the R buttons are off, and do nothing.
    for (const button of [
      page.locator('#combat-actions [data-sel="damage"]'),
      page.locator('#combat-actions [data-sel="condition"]'),
      page.locator('#combat-actions [data-sel="clear"]'),
      reaction(page, 'Ancient Wyrm'),
    ]) {
      await expect(button).toBeDisabled();
    }
    // Playwright waits for a button that says it is disabled; force the click through.
    await page.locator('#combat-actions [data-sel="damage"]').click({ force: true });
    await expect(page.locator('#damage-form')).toHaveCount(0);
    await reaction(page, 'Ancient Wyrm').click({ force: true });
    await expect(reaction(page, 'Ancient Wyrm')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#combat-actions [data-sel="clear"]').click({ force: true });
    await expect(page.locator('#combat-actions .ca-count')).toHaveText('2 selected');
    expect(beyondReads(calls)).toEqual([]);

    // Back, with a fresh fight: live again.
    push([BRIDGE_UP, fight(BOSS_FIGHT, { turn: 2 })]);
    await expect(note).toHaveText('');
    await expect(strip(page)).not.toHaveClass(/is-stale/);
    await expect(page.locator('#combat-body')).toHaveCSS('filter', 'none');
    await expect(page.locator('#combat-actions [data-sel="damage"]')).toBeEnabled();
    await expect(reaction(page, 'Ancient Wyrm')).toBeEnabled();
    await reaction(page, 'Ancient Wyrm').click();
    await expect(page.getByRole('button', { name: 'Reaction used: Ancient Wyrm' })).toBeVisible();
    await page.locator('#combat-actions [data-sel="damage"]').click();
    await expect(page.locator('#damage-form')).toBeVisible();
  });

  test('a dropped control channel counts too, and a bridge that came back with the same fight is live', async ({
    page,
  }) => {
    const { push } = await setup(page, {
      initial: [fight(PARTY_FIGHT)],
    });
    await load(page);
    push([status({ controlChannel: 'disconnected', foundry: 'unknown' })]);
    await expect(away(page)).toHaveText('The bridge is away: this is the fight as last seen.');
    // The server sends a fight only when it changed: the status alone makes it live again.
    push([BRIDGE_UP]);
    await expect(away(page)).toHaveText('');
    await expect(rows(page)).toHaveCount(4);
  });

  test('a fight that ended while the bridge was away goes when the bridge says so', async ({
    page,
  }) => {
    const { push } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    push([FOUNDRY_AWAY]);
    await expect(away(page)).not.toHaveText('');
    push([BRIDGE_UP, noFight]);
    await expect(strip(page)).toBeHidden();
    await expect(away(page)).toHaveText('');
  });

  test('a `combat: null` on a new stream takes the fight away, with the bridge fine all along', async ({
    page,
  }) => {
    // The server answers every new stream with the fight or `{combat: null}` (app.ts), so a page
    // that missed the end, with the bridge fine all along, clears its strip.
    const { push } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Ogre Brute').click();
    await expect(rows(page)).toHaveCount(4);
    push([noFight]);
    await expect(strip(page)).toBeHidden();
    await expect(away(page)).toHaveText('');
    push([fight(BOSS_FIGHT)]);
    await expect(rows(page)).toHaveCount(3);
    await expect(page.locator('#combat-actions .ca-hint')).toBeVisible();
  });

  test('a failed poll that the next one clears is never shown', async ({ page }) => {
    const { push } = await setup(page, { initial: [BRIDGE_UP, fight(PARTY_FIGHT)] });
    await load(page);
    await expect(strip(page)).toBeVisible();
    // One poll fails: the control channel is up and Foundry's state is unknown.
    push([status({ foundry: 'unknown' })]);
    await page.waitForTimeout(1500);
    await expect(strip(page)).not.toHaveClass(/is-stale/);
    await expect(away(page)).toHaveText('');
    // The next poll succeeds, and nothing was ever shown, even once the wait is over.
    push([BRIDGE_UP]);
    await page.waitForTimeout(AWAY_AFTER_MS + 500);
    await expect(strip(page)).not.toHaveClass(/is-stale/);
    await expect(away(page)).toHaveText('');
  });

  test('doubt that lasts is shown after the wait, and back is at once', async ({ page }) => {
    const { push } = await setup(page, { initial: [BRIDGE_UP, fight(PARTY_FIGHT)] });
    await load(page);
    // The strip loads as its own chunk: a strip that mounts in doubt says so at once, so wait for it.
    await expect(strip(page)).toBeVisible();
    push([status({ foundry: 'unknown' })]);
    await page.waitForTimeout(AWAY_AFTER_MS - 1500);
    await expect(away(page)).toHaveText('');
    await expect(away(page)).toHaveText('The bridge is away: this is the fight as last seen.', {
      timeout: 4000,
    });
    await expect(strip(page)).toHaveClass(/is-stale/);
    push([BRIDGE_UP]);
    await expect(away(page)).toHaveText('', { timeout: 1000 });
    await expect(strip(page)).not.toHaveClass(/is-stale/);
  });

  test('after a dropped channel the reconnect stays marked until a poll succeeds', async ({
    page,
  }) => {
    const { push } = await setup(page, { initial: [BRIDGE_UP, fight(PARTY_FIGHT)] });
    await load(page);
    push([status({ controlChannel: 'disconnected', foundry: 'unknown' })]);
    await expect(away(page)).toHaveText('The bridge is away: this is the fight as last seen.', {
      timeout: 1000,
    });
    // The channel is back, Foundry not yet known: on its own a blip, here still the same outage.
    push([status({ controlChannel: 'connected', foundry: 'unknown' })]);
    await page.waitForTimeout(1000);
    await expect(away(page)).toHaveText('The bridge is away: this is the fight as last seen.');
    await expect(strip(page)).toHaveClass(/is-stale/);
    push([BRIDGE_UP]);
    await expect(away(page)).toHaveText('', { timeout: 1000 });
    await expect(strip(page)).not.toHaveClass(/is-stale/);
  });

  test('a Foundry that says it is unreachable is shown at once', async ({ page }) => {
    const { push } = await setup(page, { initial: [BRIDGE_UP, fight(PARTY_FIGHT)] });
    await load(page);
    push([FOUNDRY_AWAY]);
    await expect(away(page)).toHaveText('The bridge is away: this is the fight as last seen.', {
      timeout: 1000,
    });
  });

  test('without a fight there is nothing to mark', async ({ page }) => {
    await setup(page, {
      layout: 'toggle',
      full: true,
      initial: [FOUNDRY_AWAY, noFight],
    });
    await load(page);
    await expect(away(page)).toHaveText('');
    await expect(page.locator('#combat-body')).toHaveText('No active combat.');
  });
});

test.describe('the layout trial', () => {
  test('the Auto step shows a sample fight with no buttons, and Stop takes it away', async ({
    page,
  }) => {
    await setup(page, { initial: [noFight] });
    await load(page);
    await expect(strip(page)).toBeHidden();
    await fromMenu(page, 'btn-layout-tour');
    await page.locator('#layout-tour-next').click();
    await page.locator('#layout-tour-next').click();
    await expect(strip(page)).toBeVisible();
    await expect(rows(page).locator('.combatant-text')).toHaveText([
      'Fighter',
      'Wolf',
      'Cleric',
      'Wolf',
    ]);
    await expect(page.locator('#combat-meta')).toHaveText('Round 2 · 4 combatants');
    await expect(page.locator('#combat-actions')).toBeHidden();
    await expect(page.locator('#combat-body button.combatant-pick')).toHaveCount(0);
    await expect(bossToggle(page)).toBeHidden();
    await page.locator('#layout-tour-stop').click();
    await expect(strip(page)).toBeHidden();
  });

  test('a real fight takes over from the sample', async ({ page }) => {
    const { push } = await setup(page, { initial: [noFight] });
    await load(page);
    await fromMenu(page, 'btn-layout-tour');
    await page.locator('#layout-tour-next').click();
    await page.locator('#layout-tour-next').click();
    await expect(row(page, 'Fighter')).toBeVisible();
    push([fight(PARTY_FIGHT)]);
    await expect(row(page, 'Brannoc')).toBeVisible();
    await expect(row(page, 'Fighter')).toHaveCount(0);
  });
});

/** A tool that failed: the dashboard's error body (`kind` says where it failed). */
const failed = (error: string, kind = 'tool'): { status: number; json: unknown } => ({
  // As the dashboard's tool route answers: 502 for a timeout or channel error, 422 for a tool error.
  status: kind === 'tool' ? 422 : 502,
  json: { ok: false, error, kind },
});

const toastLike = (page: Page, text: RegExp): Locator =>
  page.locator('.toast-stack').getByText(text);

test.describe('when a write or a roll request fails', () => {
  const openDamage = async (page: Page): Promise<void> => {
    await row(page, 'Ogre Brute').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();
    await page.locator('#damage-amount').fill('8');
  };

  test('a plan that fails keeps the draft, so Apply can be pressed again', async ({ page }) => {
    const { calls } = await setup(page, {
      initial: [fight(PARTY_FIGHT)],
      answer: call => (call.name === 'plan-actor-change' ? failed('No such token') : undefined),
    });
    await load(page);
    await openDamage(page);
    await page.locator('#damage-apply').click();
    await expect(toastLike(page, /Actor change:.*No such token/)).toBeVisible();
    // Nothing was planned, so nothing can have landed: the amount stays and the form stays open.
    await expect(page.locator('#damage-form')).toBeVisible();
    await expect(page.locator('#damage-amount')).toHaveValue('8');
    await expect(page.locator('#damage-apply')).toBeEnabled();
    expect(calls.filter(c => c.name === 'apply-planned-change')).toEqual([]);
  });

  test('a double click sends one plan', async ({ page }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await openDamage(page);
    await page.locator('#damage-apply').dblclick();
    await expect(page.locator('#damage-form')).toHaveCount(0);
    // The form closes as soon as the plan is made; the apply follows a tick later.
    await expect.poll(() => calls.filter(c => c.name === 'apply-planned-change').length).toBe(1);
    expect(calls.filter(c => c.name === 'plan-actor-change')).toHaveLength(1);
  });

  test('Undo on the toast undoes the hit', async ({ page }) => {
    const { calls } = await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await openDamage(page);
    await page.locator('#damage-apply').click();
    await expect(page.locator('#damage-form')).toHaveCount(0);
    await page.locator('.toast-stack .toast-undo .toast-action').click();
    await expect
      .poll(() => calls.find(c => c.name === 'undo-change'))
      .toEqual({
        name: 'undo-change',
        args: { changeId: 'chg-start' },
        confirm: true,
        confirmDestructive: true,
      });
  });

  test('an apply with no answer may have landed: the amount is cleared, not kept for a second hit', async ({
    page,
  }) => {
    await setup(page, {
      initial: [fight(PARTY_FIGHT)],
      answer: call =>
        call.name === 'apply-planned-change'
          ? failed('The bridge did not answer', 'timeout')
          : undefined,
    });
    await load(page);
    await openDamage(page);
    await page.locator('#damage-apply').click();
    await expect(toastLike(page, /timed out.*check Recent Changes/)).toBeVisible();
    await expect(page.locator('#damage-form')).toBeVisible();
    await expect(page.locator('#damage-amount')).toHaveValue('');
    await expect(page.locator('#damage-apply')).toHaveText('Type an amount');
  });

  test('one of two roll requests fails: the toast says who got it and who did not', async ({
    page,
  }) => {
    const { calls } = await setup(page, {
      initial: [fight(BOSS_FIGHT)],
      answer: call =>
        call.name === 'request-player-rolls' && call.args['targetPlayer'] === 'Mira'
          ? failed('Mira is not logged in')
          : undefined,
    });
    await load(page);
    await page.locator('#strip-roll-party').click();
    await expect(
      toastLike(page, /✓ Sent: Perception to Brannoc\. Not sent: Mira: .*Mira is not logged in/)
    ).toBeVisible();
    expect(calls.filter(c => c.name === 'request-player-rolls')).toHaveLength(2);
  });

  test('the strip and the Party card share one saved roll choice', async ({ page }) => {
    const member = { actorId: 'a1', uuid: 'Actor.a1', name: 'Brannoc', type: 'character' };
    await setup(page, {
      initial: [fight(BOSS_FIGHT)],
      answer: call =>
        call.name === 'get-party'
          ? ok({
              groups: [
                {
                  actorId: 'g1',
                  uuid: 'Actor.g1',
                  name: 'The Party',
                  primary: true,
                  pace: { value: 'normal', label: 'Normal', slowed: false },
                  members: [member],
                },
              ],
              paceOptions: [],
              scene: null,
              encounter: null,
              warnings: [],
            })
          : undefined,
    });
    await load(page);
    await fromMenu(page, 'btn-party');
    const stripWhat = page.locator('#strip-roll-what');
    const partyWhat = page.locator('#party-roll-what');
    await expect(partyWhat).toBeAttached();
    await stripWhat.selectOption('save:dex');
    await expect(partyWhat).toHaveValue('save:dex');
    // Each bar used to keep its own copy: a change on one wrote the other's old choice back.
    await page.locator('#party-roll-dc').fill('13');
    await expect(page.locator('#strip-roll-dc')).toHaveValue('13');
    await expect(stripWhat).toHaveValue('save:dex');
    await expect(partyWhat).toHaveValue('save:dex');
  });

  test('a roll request with no answer says it may have been sent', async ({ page }) => {
    await setup(page, {
      initial: [fight(BOSS_FIGHT)],
      answer: call =>
        call.name === 'request-player-rolls'
          ? failed('The bridge did not answer', 'timeout')
          : undefined,
    });
    await load(page);
    await page.locator('#strip-roll-party').click();
    await expect(toastLike(page, /not confirmed.*may have been sent, check chat/)).toBeVisible();
  });
});

test('a strip chunk that fails to load leaves the page working without the strip', async ({
  page,
}) => {
  let hits = 0;
  await page.route('**/CombatStrip-*.js', route => {
    hits += 1;
    return route.abort();
  });
  await setup(page, { initial: [fight(PARTY_FIGHT)] });
  await load(page);
  await expect.poll(() => hits).toBeGreaterThan(0);
  await expect(strip(page)).toHaveCount(0);
  await expect(page.locator('#btn-advanced')).toBeVisible();
  await expect(during(page)).toBeVisible();
});

test.describe('a phone', () => {
  test('the strip shows a fight and keeps the page from scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await setup(page, { initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(rows(page)).toHaveCount(4);
    await expect(row(page, 'Ogre Brute').locator('.hp-text')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
