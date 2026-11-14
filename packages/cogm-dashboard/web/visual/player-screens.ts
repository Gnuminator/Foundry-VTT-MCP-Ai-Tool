// The player pages the visual tests photograph: /player (no personal link, with one, a handout
// meant for one player, a fight running) and /me (the player's own sheet). They are plain pages
// (public/player.html, public/me.html), not the React dashboard, so they have their own fake: the
// player stream (/api/player/stream) and /api/me, with made-up names only (same harbor town as
// fixtures.ts). One list, used by the screenshot tests and by the axe check.
import { expect, type Page } from '@playwright/test';

import { apiBody, fakeCommonRoutes } from '../e2e/support';

import { NOW } from './fixtures';

export interface PlayerScreen {
  /** The file stem of the page shot, and the test title. */
  name: string;
  path: '/player' | '/me';
  /** The name picked under "Who are you?" (kept on the device); null shows the name picker. */
  who: { userId: string; name: string } | null;
  /** The player has their personal link (the key kept on this device). */
  key: boolean;
  /** The player stream's frames for this screen. */
  stream: 'quiet' | 'roll' | 'handouts' | 'fight';
  /** Waits until the page shows what the screen is about. */
  ready: (page: Page) => Promise<void>;
}

const MARA = { userId: 'u1', name: 'Mara' };
const ME_KEY = 'visual-me-key';

const at = (minutesAgo: number): number => NOW - minutesAgo * 60_000;

const FEED = [
  { id: 'e1', timestampMs: at(42), type: 'scene', text: 'The party reached the harbor.' },
  { id: 'e2', timestampMs: at(31), type: 'roll', text: 'Mara rolled Perception: 17.' },
  { id: 'e3', timestampMs: at(12), type: 'damage', text: 'Brenna took 6 damage.' },
];

const HANDOUTS = [
  {
    id: 'h1',
    title: 'Recap: the night at the ferry',
    html: '<p>The party found the ferry empty and a lantern still burning.</p>',
    revealedAt: new Date(at(600)).toISOString(),
  },
  {
    id: 'h2',
    title: 'Wanted poster',
    html: '<p>Reward for the one who carried the ledger off the dock.</p>',
    revealedAt: new Date(at(240)).toISOString(),
  },
  {
    id: 'h3',
    title: 'A note slipped under the door',
    html: '<p>Meet me at the old mill after dark. Come alone.</p>',
    revealedAt: new Date(at(20)).toISOString(),
    isNew: true,
    players: ['u1'],
  },
  {
    // Meant for another player: Mara's page must not show it.
    id: 'h4',
    title: 'A sealed letter',
    html: '<p>Not for Mara.</p>',
    revealedAt: new Date(at(18)).toISOString(),
    players: ['u2'],
  },
  {
    id: 'h5',
    title: 'Quest: find the missing ferry',
    html: '<p>Ask along the docks who saw the ferry last.</p>',
    revealedAt: new Date(at(300)).toISOString(),
  },
];

const combatant = (
  id: string,
  name: string,
  initiative: number,
  side: 'pc' | 'enemy',
  extra: Record<string, unknown> = {}
): Record<string, unknown> => ({
  id,
  name,
  initiative,
  isCurrentTurn: false,
  isPC: side === 'pc',
  actorId: null,
  side,
  defeated: false,
  hp: null,
  hpBand: null,
  conditions: [],
  ...extra,
});

const FIGHT = {
  active: true,
  round: 2,
  turn: 0,
  combatants: [
    combatant('c1', 'Harbor thug', 17, 'enemy', { isCurrentTurn: true, hpBand: 'bloodied' }),
    combatant('c2', 'Brenna', 14, 'pc', {
      actorId: 'a-brenna',
      hp: { value: 18, max: 32, temp: 0 },
      conditions: ['Poisoned'],
    }),
    combatant('c3', 'Orin', 12, 'pc', { actorId: 'a-orin', hp: { value: 27, max: 27, temp: 0 } }),
    combatant('c4', 'Harbor thug', 8, 'enemy', { hpBand: 'healthy' }),
  ],
};

function playerState(screen: PlayerScreen): Record<string, unknown> {
  return {
    status: 'live',
    world: { title: 'Harbor Town', systemId: 'dnd5e' },
    scene: 'Harbor at dusk',
    sceneEnvironment: { timeOfDay: 'Dusk', weather: 'Rain' },
    combat: screen.stream === 'fight' ? FIGHT : { active: false, round: 0, combatants: [] },
    events: FEED,
    session: { open: true, endedAt: null },
    handouts: [],
  };
}

const SHEET = {
  id: 'a-brenna',
  name: 'Brenna Quill',
  level: 4,
  classes: [{ name: 'Cleric', levels: 4, subclass: 'Life Domain', hitDie: 'd8' }],
  species: 'Half-elf',
  background: 'Acolyte',
  alignment: null,
  xp: 2700,
  size: 'med',
  ac: 17,
  hp: { value: 18, max: 32, temp: 0 },
  hitDice: { value: 3, max: 4 },
  deathSaves: { success: 0, failure: 0 },
  exhaustion: 0,
  inspiration: false,
  proficiencyBonus: 2,
  initiative: 1,
  speed: { walk: 30 },
  speedUnits: 'ft',
  senses: [],
  abilities: [
    ['str', 'Strength', 12, 1, 1, false],
    ['dex', 'Dexterity', 12, 1, 1, false],
    ['con', 'Constitution', 14, 2, 2, false],
    ['int', 'Intelligence', 10, 0, 0, false],
    ['wis', 'Wisdom', 17, 3, 5, true],
    ['cha', 'Charisma', 14, 2, 4, true],
  ].map(([key, label, score, mod, save, saveProficient]) => ({
    key,
    label,
    score,
    mod,
    save,
    saveProficient,
  })),
  skills: [
    { key: 'ins', label: 'Insight', ability: 'wis', total: 5, passive: 15, proficiency: 1 },
    { key: 'med', label: 'Medicine', ability: 'wis', total: 5, passive: 15, proficiency: 1 },
    { key: 'prc', label: 'Perception', ability: 'wis', total: 3, passive: 13, proficiency: 0 },
  ],
  passivePerception: 13,
  conditions: ['Poisoned'],
  concentration: 'Bless',
  spellcasting: { ability: 'wis', dc: 13, attack: 5 },
  slots: [
    { level: 1, value: 2, max: 4, pact: false },
    { level: 2, value: 3, max: 3, pact: false },
  ],
  spells: [
    {
      id: 's1',
      name: 'Bless',
      level: 1,
      school: 'enchantment',
      prepared: true,
      castingTime: '1 action',
      range: '30 ft',
      duration: '1 minute',
      concentration: true,
      ritual: false,
      components: 'V, S, M',
      material: null,
    },
    {
      id: 's2',
      name: 'Guidance',
      level: 0,
      school: 'divination',
      prepared: true,
      castingTime: '1 action',
      range: 'Touch',
      duration: '1 minute',
      concentration: true,
      ritual: false,
      components: 'V, S',
      material: null,
    },
  ],
  features: [
    {
      id: 'f1',
      name: 'Channel Divinity',
      kind: 'class',
      uses: { value: 1, max: 1, recovery: 'sr' },
      description: '',
    },
  ],
  inventory: [
    {
      id: 'i1',
      name: 'Mace',
      type: 'weapon',
      quantity: 1,
      equipped: true,
      attuned: false,
      attunement: null,
      uses: null,
      attack: '+3',
      damage: '1d6+1 bludgeoning',
      description: '',
    },
    {
      id: 'i2',
      name: 'Rope (50 ft)',
      type: 'loot',
      quantity: 1,
      equipped: false,
      attuned: false,
      attunement: null,
      uses: null,
      attack: null,
      damage: null,
      description: '',
    },
  ],
  currency: { cp: 0, sp: 4, ep: 0, gp: 38, pp: 0 },
  languages: ['Common', 'Elvish'],
  armorProficiencies: [],
  weaponProficiencies: [],
  toolProficiencies: [],
  resistances: [],
  immunities: [],
  vulnerabilities: [],
  personality: { traits: '', ideals: '', bonds: '', flaws: '', appearance: '' },
};

export const PLAYER_SCREENS: PlayerScreen[] = [
  {
    // First visit: no personal link, no name picked yet.
    name: 'player-no-key',
    path: '/player',
    who: null,
    key: false,
    stream: 'quiet',
    ready: async (page): Promise<void> => {
      await expect(page.locator('#who-picker')).toBeVisible();
      await expect(page.locator('#feed').getByText('The party reached the harbor.')).toBeVisible();
    },
  },
  {
    // The personal link is on the device: "Mine" with the character and an open roll request.
    name: 'player-key',
    path: '/player',
    who: MARA,
    key: true,
    stream: 'roll',
    ready: async (page): Promise<void> => {
      await expect(page.locator('#mine-chars').getByText('Brenna Quill')).toBeVisible();
      await expect(page.locator('#roll-banner')).toBeVisible();
      await expect(page.locator('#mine-rolls button[data-roll]')).toBeVisible();
    },
  },
  {
    // A handout meant just for Mara shows; the one for Tobias does not.
    name: 'player-private-handout',
    path: '/player',
    who: MARA,
    key: false,
    stream: 'handouts',
    ready: async (page): Promise<void> => {
      await expect(page.locator('.handout-private')).toBeVisible();
      await expect(page.getByText('A sealed letter')).toHaveCount(0);
      await page.locator('summary', { hasText: 'A note slipped under the door' }).click();
      await expect(page.getByText('Meet me at the old mill')).toBeVisible();
    },
  },
  {
    // A fight is running and it is the player's turn after the next one.
    name: 'player-fight',
    path: '/player',
    who: MARA,
    key: true,
    stream: 'fight',
    ready: async (page): Promise<void> => {
      await expect(page.locator('#combat').getByText('Harbor thug').first()).toBeVisible();
      await expect(page.locator('#mine-turn')).toHaveText('You are up next, Brenna.');
    },
  },
  {
    name: 'me',
    path: '/me',
    who: null,
    key: true,
    stream: 'quiet',
    ready: async (page): Promise<void> => {
      await expect(page.locator('#me-name')).toHaveText('Brenna Quill');
      await expect(page.locator('#me-updated')).toContainText('Updated');
    },
  },
  {
    // The "Your Claude connector" card, opened (made-up values, never a real pair).
    name: 'me-connector',
    path: '/me',
    who: null,
    key: true,
    stream: 'quiet',
    ready: async (page): Promise<void> => {
      await expect(page.locator('#me-name')).toHaveText('Brenna Quill');
      await expect(page.locator('#me-connector')).toBeVisible();
      await page.locator('#me-connector summary').click();
      await expect(page.locator('#mc-id')).toHaveValue('visual-client.access');
    },
  },
];

/** The stream the player page reads: one answer with the frames, and no reconnect. */
async function fakePlayerStream(page: Page, screen: PlayerScreen): Promise<void> {
  const frames: { event: string; data: unknown }[] = [
    { event: 'state', data: playerState(screen) },
    {
      event: 'handouts',
      data: { handouts: screen.stream === 'handouts' ? HANDOUTS : HANDOUTS.slice(0, 2) },
    },
    { event: 'theme', data: { theme: 'neutral' } },
    {
      event: 'rolls',
      data: {
        open:
          screen.stream === 'roll'
            ? [{ id: 'r1', sentAt: at(2), label: 'Perception (Private)', userId: 'u1' }]
            : [],
      },
    },
  ];
  const body = `retry: 600000\n\n${frames
    .map(f => `event: ${f.event}\ndata: ${JSON.stringify(f.data)}\n\n`)
    .join('')}`;
  await page.route('**/api/player/stream**', route =>
    route.fulfill({ status: 200, contentType: 'text/event-stream', body })
  );
}

/** Loads the player page as the screen needs it and brings it to its state, then settles it. */
export async function showPlayerScreen(page: Page, screen: PlayerScreen): Promise<void> {
  await page.addInitScript(
    ([who, key]) => {
      try {
        localStorage.setItem('cogm_mist', 'calm');
        if (who) localStorage.setItem('cogm_player_who', who);
        if (key) localStorage.setItem('cogm_me_key', key);
      } catch {
        // Storage refused: the page shows its first-visit state.
      }
    },
    [screen.who ? JSON.stringify(screen.who) : '', screen.key ? ME_KEY : ''] as const
  );
  await page.clock.setFixedTime(NOW);
  await fakeCommonRoutes(page);
  await page.route('**/api/player/names', route =>
    route.fulfill({
      json: apiBody('/api/player/names', [
        { userId: 'u1', name: 'Mara' },
        { userId: 'u2', name: 'Tobias' },
        { userId: 'u3', name: 'Nell' },
      ]),
    })
  );
  // Opening a handout tells the GM's seen log: answered here, so no shot depends on the server.
  await page.route('**/api/player/handout-seen', route => route.fulfill({ status: 204 }));
  await page.route('**/api/me', route =>
    route.fulfill({
      json: {
        userId: 'u1',
        userName: 'Mara',
        sheets: [SHEET],
        rollRequests:
          screen.stream === 'roll' ? [{ buttonId: 'b1', label: 'Perception (Private)' }] : [],
        theme: 'neutral',
        privateRolls: [],
      },
    })
  );
  await page.route('**/api/me/connector', route =>
    route.fulfill({
      json:
        screen.name === 'me-connector'
          ? {
              enabled: true,
              endpoint: 'https://player-ai.example.com/mcp/player',
              clientId: 'visual-client.access',
              clientSecret: 'visual-secret-not-real',
            }
          : { enabled: false },
    })
  );
  await fakePlayerStream(page, screen);
  await page.goto(screen.path);
  await expect(page.locator('html')).toHaveAttribute('data-theme', 'neutral');
  await screen.ready(page);
  await page.evaluate(() => document.fonts.ready);
  await page.waitForLoadState('networkidle');
  await page.mouse.move(0, 0);
  await page.evaluate(() =>
    Promise.all(
      document
        .getAnimations()
        .filter(a => Number.isFinite(a.effect?.getComputedTiming().endTime))
        .map(a => a.finished)
    )
  );
}
