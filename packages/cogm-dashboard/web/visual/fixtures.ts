// Fixtures for the screenshot tests: one fake bridge for the whole React dashboard, with made-up
// names only (a harbor town, three players, a party of two). The repo is public, so nothing here
// comes from a campaign book. Everything a screenshot could show is fixed: the clock stands still
// (page.clock.setFixedTime), the times below are absolute and the browser runs in UTC and en-US
// (playwright.visual.config.ts), so no ages or dates move between runs.
//
// The /api fakes are the e2e helpers (../e2e/support); only the data is new.
import type { Page } from '@playwright/test';

import { fakeCommonRoutes, fakeStream, fakeTools, ok, type ToolCall } from '../e2e/support';

/** 2026-10-10 20:00 UTC: "now" for every screenshot. */
export const NOW = Date.UTC(2026, 9, 10, 20, 0);

const HOUR = 60 * 60 * 1000;
const at = (hour: number, minute = 0): number => Date.UTC(2026, 9, 8, hour, minute);
const iso = (ms: number): string => new Date(ms).toISOString();

export type Moment = 'before' | 'during' | 'after';
export type Theme = 'neutral' | 'veil';

/** What a screen needs from the fake bridge beyond the defaults. */
export interface Setup {
  theme: Theme;
  /** The play session behind the screen: no session (Before), an open one, or one that ended. */
  moment: Moment;
  /** The versions check fails, so the page-wide banner shows. */
  versionMismatch?: boolean;
  /** The module errors the stream brings (Module diagnostics). */
  moduleErrors?: boolean;
}

// ---------------------------------------------------------------- the bridge's answers

const SESSIONS: Record<Moment, { open: boolean; endedAt: string | null }> = {
  before: { open: false, endedAt: null },
  during: { open: true, endedAt: null },
  after: { open: false, endedAt: iso(NOW - 2 * HOUR) },
};

const PREFLIGHT_CHECKS = (versionMismatch: boolean): unknown[] => [
  {
    id: 'versions',
    label: 'Versions match',
    status: versionMismatch ? 'fail' : 'ok',
    detail: versionMismatch
      ? 'The Foundry module is 0.20.2 but the bridge is 0.21.0. Update the module.'
      : 'Bridge 0.21.0, module 0.21.0.',
  },
  { id: 'scene', label: 'Starting scene', status: 'ok', detail: 'Harbor Market is active.' },
  {
    id: 'hidden',
    label: 'Hidden tokens',
    status: 'warn',
    detail: 'One token on the active scene is hidden.',
  },
  { id: 'journals', label: 'Handout pages', status: 'ok', detail: 'All set to None.' },
];

const PREFLIGHT_SCAN = {
  settings: [{ setting: 'core.worldTitle', masked: 'shown', reason: 'names the harbor' }],
  names: [{ kind: 'Actor', name: 'Old Gull', terms: ['gull'] }],
  modules: [],
};

const SWITCHES = {
  switches: {
    switches: [
      { id: 'handouts', name: 'AI Tool: Handouts (writes)', on: true },
      { id: 'party', name: 'AI Tool: Party (writes)', on: true },
      { id: 'live', name: 'AI Tool: Live play (writes)', on: false },
    ],
    ready: null,
    changed: [],
    failed: [],
  },
  gmActionsEnabled: true,
  error: null,
};

const PLAYERS = [
  { userId: 'u1', name: 'Mara' },
  { userId: 'u2', name: 'Tobias' },
  { userId: 'u3', name: 'Nell' },
];

const PLAYER_LINKS = [
  { userId: 'aaaaaaaaaaaaaaaa', name: 'Mara', link: '/me?k=maraKey', createdAt: at(18) },
  { userId: 'bbbbbbbbbbbbbbbb', name: 'Tobias', link: null, createdAt: null },
  { userId: 'cccccccccccccccc', name: 'Nell', link: '/me?k=nellKey', createdAt: at(19) },
];

const SCENES = [
  { id: 's1', name: 'Harbor Market', active: true },
  { id: 's2', name: 'Old Mill', active: false },
];

const page_ = (n: number): string => `JournalEntry.j1.JournalEntryPage.p${n}`;

const HANDOUTS = {
  queue: [
    {
      entryId: 'e1',
      uuid: page_(1),
      title: 'Letter from the harbormaster',
      exists: true,
      sceneId: 's1',
      addedAt: iso(at(10)),
    },
    {
      entryId: 'e2',
      uuid: page_(2),
      title: 'Map of the old mill',
      exists: true,
      sceneId: 's2',
      players: ['u1'],
      addedAt: iso(at(11)),
    },
    {
      entryId: 'e3',
      uuid: page_(3),
      title: 'Torn ledger page',
      exists: true,
      sceneId: null,
      addedAt: iso(at(12)),
    },
  ],
  pages: [
    {
      pageId: 'p6',
      uuid: page_(6),
      title: 'Wanted poster',
      exists: true,
      observable: true,
      feature: 'handouts',
      revealedAt: iso(at(17, 30)),
      seenBy: [
        { userId: 'u1', name: 'Mara', at: iso(at(17, 45)) },
        { userId: 'u2', name: 'Tobias', at: iso(at(18, 5)) },
      ],
    },
    {
      pageId: 'p7',
      uuid: page_(7),
      title: 'Smuggler code',
      exists: true,
      observable: true,
      feature: 'handouts',
      revealedAt: iso(at(18, 40)),
      seenBy: [],
    },
  ],
};

const MEMBERS = [
  {
    actorId: 'a1',
    uuid: 'Actor.a1',
    name: 'Aldric',
    type: 'character',
    level: 3,
    hp: { value: 14, max: 26, temp: 0 },
    ac: 16,
    passivePerception: 13,
    exhaustion: 0,
    hitDice: { value: 2, max: 3 },
    deathSaves: null,
    conditions: ['Poisoned'],
    inspiration: true,
    tokens: [{ tokenId: 't1', name: 'Aldric', hidden: false, inCombat: true }],
  },
  {
    actorId: 'a2',
    uuid: 'Actor.a2',
    name: 'Brenna',
    type: 'character',
    level: 3,
    hp: { value: 0, max: 22, temp: 0 },
    ac: 13,
    passivePerception: 11,
    exhaustion: 1,
    hitDice: null,
    deathSaves: { success: 1, failure: 1 },
    conditions: [],
    inspiration: false,
    tokens: [],
  },
];

const PARTY = {
  groups: [
    {
      actorId: 'g1',
      uuid: 'Actor.g1',
      name: 'The Lantern Crew',
      primary: true,
      level: 3,
      pace: { value: 'normal', label: 'Normal', slowed: false },
      members: MEMBERS,
      restCards: { short: { type: 'request' } },
    },
  ],
  paceOptions: [
    { value: 'slow', label: 'Slow' },
    { value: 'normal', label: 'Normal' },
    { value: 'fast', label: 'Fast' },
  ],
  scene: { sceneId: 's1', name: 'Harbor Market' },
  encounter: { combatId: 'c1', uuid: 'Combat.c1', round: 2, started: true },
  warnings: ['One actor could not be read.'],
};

const PREP = {
  schema: 1,
  action: 'summary',
  worldId: 'harbor-test',
  computedAt: at(18, 30),
  lastSession: {
    number: 3,
    label: '',
    date: '2026-10-01',
    startedAt: '',
    endedAt: '',
    durationMin: 185,
    scenes: ['Harbor Market', 'Old Mill'],
    combats: 1,
    combatRounds: 4,
    pcDowns: 1,
    npcKills: 2,
    spellsCast: 5,
    wentDown: { pcs: ['Brenna'], others: [] },
    beats: [
      { at: '2026-10-01T19:05:00Z', kind: 'scene-change', text: 'Old Mill', actorName: null },
    ],
    beatsTruncated: true,
    handoutsRevealed: [
      { title: 'Wanted poster', uuid: 'x', seenBy: ['Mara', 'Tobias'] },
      { title: 'Smuggler code', uuid: 'y', seenBy: [] },
    ],
  },
  openQuests: [{ journalId: 'q1', name: 'Find the missing ferry', status: '', open: true }],
  openCampaignParts: [
    {
      journalId: 'c1',
      name: 'The Lantern Crew',
      parts: [{ partId: 'p', title: 'The Lighthouse', status: 'in_progress' }],
    },
  ],
  nextSession: {
    journalId: 'n1',
    name: 'Next session',
    playerVisible: true,
    pages: [{ pageId: 'pg', name: 'Plan', text: 'Meet the harbormaster', truncated: true }],
  },
  handoutQueue: [
    { title: 'Torn ledger page', uuid: 'd', sceneId: null, sceneName: null, players: ['Mara'] },
    { title: 'Map of the old mill', uuid: 'e', sceneId: 's2', sceneName: 'Old Mill', players: [] },
  ],
  bosses: [
    {
      sceneId: 's2',
      sceneName: 'Old Mill',
      tokenId: 't',
      tokenName: 'Miller Grim',
      actorName: 'Miller Grim',
      hidden: true,
      legendary: { max: 3, spent: 1, remaining: 2 },
      resistances: null,
      lair: { inside: true, initiative: 20 },
    },
  ],
  preflight: { fail: 0, warn: 1, items: [{ severity: 'warn', title: 'Hidden tokens' }] },
  recentChanges: { count: 1, latest: [{ title: 'Moved a token', appliedAt: '' }] },
  tarokka: { hasReading: true },
  warnings: [],
};

// Card names are made up; the drawer only needs a reading in this shape.
const TAROKKA = {
  available: true,
  reading: {
    readingId: 'r1',
    source: 'builtin-roll',
    readAt: '2026-10-09T18:00:00Z',
    providerVersion: null,
    positions: [
      {
        position: 'p1',
        label: 'First hearth',
        deck: 'common',
        cardId: 'lanterns-3',
        cardName: 'Three of Lanterns',
        gmNote: 'Kept in the lighthouse',
        links: { journalPageUuid: page_(1) },
        linked: true,
        revealed: false,
        revealPageUuid: null,
      },
      {
        position: 'p2',
        label: 'Second lantern',
        deck: 'common',
        cardId: 'keys-7',
        cardName: 'Seven of Keys',
        gmNote: null,
        links: {},
        linked: false,
        revealed: true,
        revealPageUuid: page_(6),
      },
      {
        position: 'p3',
        label: 'Third door',
        deck: 'high',
        cardId: 'high-wanderer',
        cardName: 'The Wanderer',
        gmNote: null,
        links: { sceneUuid: 'Scene.s2' },
        linked: true,
        revealed: false,
        revealPageUuid: null,
      },
    ],
  },
  archivedReadings: 1,
  revealJournalUuid: null,
  note: 'Only the GM sees the vault.',
};

const MODULE_ERRORS = [
  {
    id: 'e1',
    timestampMs: at(19, 1),
    level: 'error',
    message: 'Cannot read properties of undefined',
    stack: 'TypeError at module:fog-helper/main.js',
    module: 'module:fog-helper',
  },
  {
    id: 'w1',
    timestampMs: at(19, 2),
    level: 'warn',
    message: 'Deprecated since v13',
    stack: null,
    module: 'system:dnd5e',
  },
  {
    id: 'e2',
    timestampMs: at(19, 3),
    level: 'error',
    message: 'No stack to tell',
    stack: null,
    module: null,
  },
];

const TOOLS = [
  {
    name: 'apply-planned-change',
    description: 'Apply a plan.',
    inputSchema: {
      type: 'object',
      properties: {
        planId: { type: 'string', 'x-foundry-ref': { kind: 'plan', value: 'id' } },
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
      properties: { title: { type: 'string', description: 'The quest title.' } },
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
        amount: { type: 'number', description: 'Hit points.' },
      },
      required: ['action', 'targets'],
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

/** Answers POST /api/tool for the screen's moment. */
function bridge(moment: Moment): (call: ToolCall) => { json: unknown } {
  return call => {
    switch (call.name) {
      case 'get-play-session':
        return ok({ success: true, worldId: 'harbor-test', ...SESSIONS[moment] });
      case 'get-prep-digest':
        return ok(PREP);
      case 'get-party':
        return ok(PARTY);
      case 'list-revealed-pages':
        return ok(HANDOUTS);
      case 'list-scenes':
        return ok(SCENES);
      case 'get-tarokka-reading':
        return ok(TAROKKA);
      case 'list-ref-choices':
        return ok({ kind: call.args['kind'], choices: [], truncated: false });
      default:
        return ok({});
    }
  };
}

/**
 * Fakes every route the React dashboard calls and freezes the clock, before the page loads. The
 * mist is the default one (calm), set in the browser so a stale value cannot leak in.
 */
export async function fakeDashboard(page: Page, setup: Setup): Promise<void> {
  const versionMismatch = setup.versionMismatch === true;
  await page.addInitScript(() => {
    try {
      localStorage.setItem('cogm_mist', 'calm');
    } catch {
      // Storage refused: the default mist applies anyway.
    }
  });
  // Date stands still; timers run, so the page still renders and polls normally.
  await page.clock.setFixedTime(NOW);

  await fakeCommonRoutes(page, setup.theme);
  await page.route('**/api/space', route => route.fulfill({ json: { available: false } }));
  await page.route('**/api/player/names', route => route.fulfill({ json: PLAYERS }));
  await page.route('**/api/player-links**', route =>
    route.fulfill({ json: { players: PLAYER_LINKS } })
  );
  await page.route('**/api/preflight', route =>
    route.fulfill({
      json: {
        ready: !versionMismatch,
        checks: PREFLIGHT_CHECKS(versionMismatch),
        scan: PREFLIGHT_SCAN,
      },
    })
  );
  await page.route('**/api/session/switches', route => route.fulfill({ json: SWITCHES }));
  await page.route('**/api/tools', route =>
    route.fulfill({ json: { tools: TOOLS, gmActionsEnabled: true } })
  );
  await fakeStream(page, [
    {
      event: 'status',
      data: {
        controlChannel: 'connected',
        foundry: 'reachable',
        lastError: null,
        lastPollAt: iso(NOW),
        foundryDownSince: null,
      },
    },
    { event: 'settings', data: { gmActionsEnabled: true } },
    { event: 'world', data: { id: 'harbor-test', title: 'Harbor Town' } },
    ...(setup.moduleErrors
      ? [{ event: 'errors', data: { errors: MODULE_ERRORS, initial: true } }]
      : []),
  ]);
  await fakeTools(page, bridge(setup.moment), { playSession: true });
}
