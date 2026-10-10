// get-prep-digest: what the last session left and what the next one needs.
import { at } from './common';

export const PREP = {
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
      { at: '2026-10-01T19:40:00Z', kind: 'down', text: 'Brenna went down', actorName: 'Brenna' },
    ],
    beatsTruncated: true,
    handoutsRevealed: [
      { title: 'Wanted poster', uuid: 'x', seenBy: ['Mara', 'Tobias'] },
      { title: 'Smuggler code', uuid: 'y', seenBy: [] },
    ],
  },
  openQuests: [
    { journalId: 'q1', name: 'Find the missing ferry', status: '', open: true },
    { journalId: 'q2', name: 'Return the harbormaster’s lantern', status: '', open: true },
  ],
  openCampaignParts: [
    {
      journalId: 'c1',
      name: 'The Lantern Crew',
      parts: [
        { partId: 'p1', title: 'The Lighthouse', status: 'in_progress' },
        { partId: 'p2', title: 'The Salt Warehouses', status: 'not_started' },
      ],
    },
  ],
  nextSession: {
    journalId: 'n1',
    name: 'Next session',
    playerVisible: true,
    pages: [
      { pageId: 'pg', name: 'Plan', text: 'Meet the harbormaster at dusk.', truncated: true },
    ],
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

/** A world with no session behind it and nothing planned. */
export const PREP_FRESH = {
  ...PREP,
  lastSession: null,
  openQuests: [],
  openCampaignParts: [],
  nextSession: null,
  handoutQueue: [],
  bosses: [],
  preflight: { fail: 0, warn: 0, items: [] },
  recentChanges: { count: 0, latest: [] },
  tarokka: { hasReading: false },
};

/** Warnings, a failed pre-flight, and names that run long. */
export const PREP_BUSY = {
  ...PREP,
  openQuests: [
    {
      journalId: 'q9',
      name: 'Find out who has been moving the harbor chains at night and why the bells ring early',
      status: '',
      open: true,
    },
  ],
  preflight: {
    fail: 1,
    warn: 2,
    items: [
      { severity: 'fail', title: 'Versions match' },
      { severity: 'warn', title: 'Hidden tokens' },
      { severity: 'warn', title: 'Handout pages' },
    ],
  },
  warnings: ['The journal "Next session" has two pages named Plan.'],
};
