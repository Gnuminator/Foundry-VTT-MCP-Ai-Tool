/**
 * Contract: the Foundry mock's default documents against the shapes captured from a real
 * Foundry 14 / dnd5e 6 server (`captured/*.json`, written by `scripts/test-env/capture-shapes.mjs`).
 *
 * For each kind with a maker, the fake's top-level keys must be real keys of that document (or a
 * listed instance helper), and every key the real document always has must be made by the fake or
 * listed as missing. Both lists are exact: an entry the fake no longer needs fails the test, so the
 * lists only ever shrink as the fake is brought closer to the real thing. Re-capture after a
 * Foundry or dnd5e update and read the diff of `captured/` with the test result.
 */
import { readFileSync, readdirSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';

import { describe, expect, it } from 'vitest';

import {
  makeActor,
  makeCombat,
  makeCombatant,
  makeEffect,
  makeItem,
  makeJournal,
  makeJournalPage,
  makeScene,
  makeToken,
  makeUser,
} from './index.js';

const DIR = join(dirname(fileURLToPath(import.meta.url)), 'captured');

interface Captured {
  kind: string;
  foundry: string;
  system: string;
  samples: number;
  paths: Record<string, string>;
}

function load(kind: string): Captured {
  return JSON.parse(readFileSync(join(DIR, `${kind}.json`), 'utf8')) as Captured;
}

const topLevel = (c: Captured): { all: Set<string>; always: Set<string> } => {
  const all = new Set<string>();
  const always = new Set<string>();
  for (const [path, v] of Object.entries(c.paths)) {
    if (path.includes('.') || path.includes('[')) continue;
    all.add(path);
    if (Number(v.split(':')[1]) === c.samples) always.add(path);
  }
  return { all, always };
};

/** Properties of a document instance (not of its data) that the mock carries on purpose. */
const INSTANCE = new Set(['id', 'documentName', 'hasPlayerOwner', '_source', 'isGM', 'active']);

interface Case {
  kind: string;
  make: () => Record<string, unknown>;
  /** Keys the fake has that the real document's data does not (beyond the instance helpers). */
  fakeOnly?: string[];
  /** Keys every real document has that the fake does not make by default. */
  missing: string[];
}

// The mock names a document's id `id`; the real data (`toObject()`) has `_id` too. That is the
// first gap in every list below, and the one to close first.
const ACTOR_MISSING = ['_id', '_stats', 'folder', 'img', 'ownership', 'prototypeToken', 'sort'];
const ITEM_MISSING = ['_id', '_stats', 'effects', 'folder', 'img', 'ownership', 'sort'];

const CASES: Case[] = [
  { kind: 'Actor.character', make: () => makeActor({ type: 'character' }), missing: ACTOR_MISSING },
  { kind: 'Actor.npc', make: () => makeActor({ type: 'npc' }), missing: ACTOR_MISSING },
  { kind: 'Actor.Item.weapon', make: () => makeItem({ type: 'weapon' }), missing: ITEM_MISSING },
  { kind: 'Actor.Item.spell', make: () => makeItem({ type: 'spell' }), missing: ITEM_MISSING },
  {
    kind: 'Actor.ActiveEffect',
    make: () => makeEffect(),
    missing: [
      '_id',
      '_stats',
      'description',
      'duration',
      'folder',
      'img',
      'origin',
      'showIcon',
      'sort',
      'start',
      'statuses',
      'system',
      'tint',
      'transfer',
      'type',
    ],
  },
  {
    kind: 'Scene',
    make: () => makeScene(),
    // Foundry 14 scene data has no `templates`; the fake still makes them.
    fakeOnly: ['templates'],
    missing: [
      '_id',
      '_stats',
      'drawings',
      'environment',
      'fog',
      'folder',
      'grid',
      'initial',
      'initialLevel',
      'journal',
      'journalEntryPage',
      'levels',
      'navName',
      'navOrder',
      'ownership',
      'playlist',
      'playlistSound',
      'regions',
      'shiftX',
      'shiftY',
      'sort',
      'thumb',
      'tiles',
      'tokenVision',
      'transition',
      'weather',
    ],
  },
  {
    kind: 'Scene.Token',
    make: () => makeToken(),
    missing: [
      '_id',
      '_movementHistory',
      '_regions',
      'actorId',
      'actorLink',
      'alpha',
      'bar1',
      'bar2',
      'delta',
      'depth',
      'detectionModes',
      'displayBars',
      'displayName',
      'elevation',
      'level',
      'light',
      'lockRotation',
      'locked',
      'movementAction',
      'occludable',
      'ring',
      'rotation',
      'shape',
      'sight',
      'sort',
      'turnMarker',
    ],
  },
  {
    kind: 'User',
    make: () => makeUser(),
    missing: [
      '_id',
      '_stats',
      'avatar',
      'character',
      'color',
      'flags',
      'hotbar',
      'password',
      'passwordSalt',
      'permissions',
      'pronouns',
      'role',
    ],
  },
  {
    kind: 'JournalEntry',
    make: () => makeJournal(),
    missing: ['_id', '_stats', 'categories', 'folder', 'ownership', 'sort'],
  },
  {
    kind: 'JournalEntry.Page.text',
    make: () => makeJournalPage(),
    missing: ['_id', '_stats', 'category', 'image', 'sort', 'src', 'system', 'title', 'video'],
  },
];

describe('captured shapes', () => {
  it('has a capture for every kind in the contract and is from the supported versions', () => {
    const files = new Set(readdirSync(DIR).map(f => f.replace(/\.json$/, '')));
    for (const c of CASES) expect(files.has(c.kind), `captured/${c.kind}.json`).toBe(true);
    for (const kind of files) {
      const cap = load(kind);
      expect(cap.kind).toBe(kind);
      expect(cap.foundry).toMatch(/^14\./);
      expect(cap.system).toMatch(/^dnd5e 6\./);
      expect(cap.samples).toBeGreaterThan(0);
    }
  });

  describe.each(CASES)('$kind', c => {
    const real = topLevel(load(c.kind));
    const made = c.make() as Record<string, unknown>;
    const keys = Object.keys(made).filter(k => typeof made[k] !== 'function');

    it('makes only keys the real document has', () => {
      const fakeOnly = keys.filter(k => !real.all.has(k) && !INSTANCE.has(k)).sort();
      expect(fakeOnly).toEqual([...(c.fakeOnly ?? [])].sort());
    });

    it('makes every key the real document always has', () => {
      const missing = [...real.always].filter(k => !keys.includes(k)).sort();
      expect(missing).toEqual([...c.missing].sort());
    });
  });

  it('covers kinds the fake has no maker for (a note for the next lane)', () => {
    // Combat and Combatant had no samples on the test world; Scene.Note neither. Capture them
    // once the world has some, then add them to CASES.
    expect(typeof makeCombat).toBe('function');
    expect(typeof makeCombatant).toBe('function');
  });
});
