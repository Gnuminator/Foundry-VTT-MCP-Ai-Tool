// The combat strip on the React dashboard (D-092, I-070, I-095): the rows from a `combat` stream
// event, picking rows and the action bar, Damage / Heal and Condition opening the Tool runner
// filled in (and writing nothing), Boss prompts and the reaction buttons, the fight marked old
// while the bridge is away, and that the strip is out of the way when no fight runs. The bridge
// and the stream are faked in the browser; nothing here needs a world.
import { expect, test, type Locator, type Page } from '@playwright/test';

import { GM_TOKEN, fakeCommonRoutes, fakeTools, fromMenu, ok } from './support';

// The dash the strip shows for no value.
const DASH = String.fromCharCode(0x2014);

const STARTED = '2026-10-10T18:00:00.000Z';

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
  combatButtons?: boolean;
  gmActions?: boolean;
  /** Sent after the prefs and settings. */
  initial?: Event[];
  /** The Boss prompts flag already in the browser. */
  bossFlag?: 'on' | 'off';
}

interface Fakes {
  /** Sends events on the stream after the page loaded. */
  push: (events: Event[]) => void;
  /** The tool calls the page made. */
  calls: { name: string }[];
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
];

/**
 * An open play session with the layout already picked, a stream that sends the prefs, the
 * settings and `initial` first and then whatever `push` gives it, and empty panels.
 */
async function setup(page: Page, options: Options = {}): Promise<Fakes> {
  const {
    layout = 'layered',
    full = false,
    combatButtons = false,
    gmActions = true,
    initial = [],
    bossFlag,
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
      switch (call.name) {
        case 'get-play-session':
          return ok({ success: true, worldId: 'w', open: true, startedAt: STARTED, endedAt: null });
        case 'get-party':
          return ok({ groups: [], paceOptions: [], scene: null, encounter: null, warnings: [] });
        case 'list-revealed-pages':
          return ok({ pages: [], queue: [] });
        case 'list-scenes':
          return ok([]);
        case 'list-ref-choices':
          return ok({ kind: 'token', choices: [], truncated: false });
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
        combatButtons,
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
    await setup(page, { initial: [fight(PARTY_FIGHT, { turn: 1 })] });
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

test.describe('picking combatants', () => {
  test('Combat buttons off: rows cannot be picked and there is no action bar', async ({ page }) => {
    await setup(page, { combatButtons: false, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(row(page, 'Brannoc')).not.toHaveClass(/selectable/);
    await expect(page.locator('#combat-body button.combatant-pick')).toHaveCount(0);
    await row(page, 'Brannoc').click();
    await expect(row(page, 'Brannoc')).not.toHaveClass(/selected/);
    await expect(page.locator('#combat-actions')).toBeHidden();
  });

  test('Combat buttons on but GM Actions off: still no rows to pick, no action bar', async ({
    page,
  }) => {
    await setup(page, { combatButtons: true, gmActions: false, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(row(page, 'Brannoc')).not.toHaveClass(/selectable/);
    await expect(page.locator('#combat-actions')).toBeHidden();
    await expect(page.locator('#combat-body button.combatant-pick')).toHaveCount(0);
  });

  test('both on: a hint, then a count and the three buttons', async ({ page }) => {
    await setup(page, { combatButtons: true, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    const bar = page.locator('#combat-actions');
    await expect(bar).toBeVisible();
    await expect(bar.locator('.ca-hint')).toHaveText(
      'Click combatants to deal damage or set a condition on them.'
    );
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
    await expect(bar.locator('.ca-btn')).toHaveText(['Damage / Heal', 'Condition', 'Clear']);
    await expect(bar.locator('.ca-btn.ghost')).toHaveText('Clear');

    // A second click on a row lets go of it.
    await row(page, 'Ogre Brute').click();
    await expect(row(page, 'Ogre Brute')).not.toHaveClass(/selected/);
    await expect(pick(page, 'Ogre Brute')).toHaveAttribute('aria-pressed', 'false');
    await expect(bar.locator('.ca-count')).toHaveText('1 selected');

    // Clear lets go of all and brings the hint back.
    await bar.locator('.ca-btn.ghost').click();
    await expect(rows(page).locator('.selected')).toHaveCount(0);
    await expect(bar.locator('.ca-hint')).toBeVisible();
  });

  test('the keyboard can pick a row: Tab to its button, Enter or Space', async ({ page }) => {
    await setup(page, { combatButtons: true, initial: [fight(PARTY_FIGHT)] });
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
    const { push } = await setup(page, { combatButtons: true, initial: [fight(PARTY_FIGHT)] });
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

  test('Damage / Heal opens the Tool runner on plan-actor-change, filled in, and writes nothing', async ({
    page,
  }) => {
    const { calls } = await setup(page, { combatButtons: true, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Ogre Brute').click();
    await row(page, 'Goblin Archer').click();
    await page.locator('#combat-actions [data-sel="damage"]').click();

    const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
    await expect(drawer).toBeVisible();
    await expect(drawer.locator('#tool-detail-name')).toHaveText('plan-actor-change');
    await expect(drawer.locator('#tool-field-action')).toHaveValue('damage');
    // The bridge's order, not the order they were picked in.
    await expect(drawer.locator('#tool-field-targets')).toHaveValue('Goblin Archer\nOgre Brute');
    // Nothing planned or applied: the GM presses Run in the Tool runner.
    await expect(drawer.locator('#tool-run')).toBeVisible();
    expect(calls.filter(c => /plan-|apply-/.test(c.name))).toEqual([]);
  });

  test('Condition opens it with the action set to condition', async ({ page }) => {
    const { calls } = await setup(page, { combatButtons: true, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await row(page, 'Brannoc').click();
    await page.locator('#combat-actions [data-sel="condition"]').click();
    const drawer = page.getByRole('dialog', { name: '🛠 Tool Runner' });
    await expect(drawer.locator('#tool-detail-name')).toHaveText('plan-actor-change');
    await expect(drawer.locator('#tool-field-action')).toHaveValue('condition');
    await expect(drawer.locator('#tool-field-targets')).toHaveValue('Brannoc');
    expect(calls.filter(c => /plan-|apply-/.test(c.name))).toEqual([]);
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
      combatButtons: true,
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
      combatButtons: true,
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
    await expect(page.getByRole('dialog', { name: '🛠 Tool Runner' })).toHaveCount(0);
    await reaction(page, 'Ancient Wyrm').click({ force: true });
    await expect(reaction(page, 'Ancient Wyrm')).toHaveAttribute('aria-pressed', 'false');
    await page.locator('#combat-actions [data-sel="clear"]').click({ force: true });
    await expect(page.locator('#combat-actions .ca-count')).toHaveText('2 selected');
    expect(calls.filter(c => /plan-|apply-/.test(c.name))).toEqual([]);

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
    await expect(page.getByRole('dialog', { name: '🛠 Tool Runner' })).toBeVisible();
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
    await setup(page, { combatButtons: true, initial: [noFight] });
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

test.describe('a phone', () => {
  test('the strip shows a fight and keeps the page from scrolling sideways', async ({ page }) => {
    await page.setViewportSize({ width: 390, height: 800 });
    await setup(page, { combatButtons: true, initial: [fight(PARTY_FIGHT)] });
    await load(page);
    await expect(rows(page)).toHaveCount(4);
    await expect(row(page, 'Ogre Brute').locator('.hp-text')).toBeVisible();
    const overflow = await page.evaluate(
      () => document.documentElement.scrollWidth - document.documentElement.clientWidth
    );
    expect(overflow).toBeLessThanOrEqual(0);
  });
});
