/**
 * Unit tests for the Foundry export index (Obsidian O4, chunk C2): the module
 * query `getExportIndex` (`export-index.ts`).
 *
 * Harness: the Phase 9 Foundry mock (`test-support/foundry-mock`). Ownership,
 * banned users and `hasPlayerOwner` go through the mock's `testUserPermission`
 * surface (the Foundry 14.368 order: GM is OWNER, a banned user NONE, else
 * `getUserLevel`; `common/abstract/document.mjs:386-415`). The mock installs a
 * bare `foundry` global, so the v14-only journal categories are switched on per
 * test with the schema fact the module detects them by
 * (`foundry.documents.BaseJournalEntry.metadata.embedded.JournalEntryCategory`).
 *
 * Anything a player or the vault could see is covered by the canary test at the
 * end: secret strings are planted in every field the export must never carry,
 * and none may appear in the serialized response. What the Library lane deliberately
 * exports (an NPC's stat block and its biography, the actor portrait path, the scene map
 * path, an opted-in image page's figure) is planted with plain strings instead and has its
 * own positive tests.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import type {
  ExportActorEntry,
  ExportEntry,
  ExportIdEntry,
  ExportIndexResponse,
  ExportItemEntry,
  ExportJournalEntry,
  ExportSceneEntry,
} from '@gnuminator/shared';
import {
  MockCollection,
  createTestWorld,
  makeCombatant,
  makeEffect,
  makeItem,
  makeJournalPage,
  makeNote,
  makeToken,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { EXPORT_INDEX_LIMITS, EXPORT_INDEX_QUERY, getExportIndex } from './export-index.js';
import { QueryHandlers } from './queries.js';
import { MODULE_ID } from './constants.js';
import { bridgeHandlers } from './bridge-handlers.js';

type Doc = ReturnType<typeof makeItem>;

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Fixtures and readers
// ---------------------------------------------------------------------------

/** A 16-character alphanumeric document id, padded so that ids sort by their prefix. */
function id16(prefix: string): string {
  return `${prefix}${'0'.repeat(16)}`.slice(0, 16);
}

/** Server time in ms: a fixed base plus an offset, so times read as small numbers. */
const BASE = 1_700_000_000_000;
function t(offset: number): number {
  return BASE + offset;
}

function stats(modified: number, created: number = modified): { _stats: object } {
  return { _stats: { createdTime: t(created), modifiedTime: t(modified) } };
}

/** Turn on the journal categories schema fact (Foundry 14). */
function useV14Journals(): void {
  const g = globalThis as unknown as { foundry: Record<string, unknown> };
  g.foundry.documents = {
    BaseJournalEntry: {
      metadata: { embedded: { JournalEntryCategory: 'categories', JournalEntryPage: 'pages' } },
    },
  };
}

function addPlayer(id = 'p1', name = 'Alice', role = 1): Doc {
  return world.addUser({ id, name, role });
}

/** A folder document; `ancestors` is Foundry's parent-first chain (`client/documents/folder.mjs:104`). */
function addFolder(name: string, parent?: Doc, modified?: number): Doc {
  const folderId = id16(`fold${world.folders.size}`);
  const ancestors: Doc[] = parent ? [parent, ...(parent.ancestors as Doc[])] : [];
  return world.addFolder({
    id: folderId,
    name,
    folder: parent ?? null,
    ancestors,
    ...(modified === undefined ? {} : stats(modified)),
  });
}

function classItem(name: string, levels: number, identifier: string): Doc {
  return makeItem({ name, type: 'class', system: { levels, identifier } });
}

function ok(data?: unknown): ExportIndexResponse {
  const result = getExportIndex(data);
  if (!result.success) throw new Error(`getExportIndex failed: ${result.error}`);
  return result;
}

function rows(data?: unknown): ExportEntry[] {
  return ok(data).entries as ExportEntry[];
}

function idRows(data?: unknown): ExportIdEntry[] {
  return ok({ idsOnly: true, ...(data as object) }).entries as ExportIdEntry[];
}

function actorRow(response: ExportIndexResponse, id: string): ExportActorEntry {
  const entry = (response.entries as ExportEntry[]).find(e => e.id === id);
  if (!entry || entry.kind !== 'actor') throw new Error(`no actor entry ${id}`);
  return entry;
}

function sceneRow(response: ExportIndexResponse, id: string): ExportSceneEntry {
  const entry = (response.entries as ExportEntry[]).find(e => e.id === id);
  if (!entry || entry.kind !== 'scene') throw new Error(`no scene entry ${id}`);
  return entry;
}

function journalRow(response: ExportIndexResponse, id: string): ExportJournalEntry {
  const entry = (response.entries as ExportEntry[]).find(e => e.id === id);
  if (!entry || entry.kind !== 'journal') throw new Error(`no journal entry ${id}`);
  return entry;
}

function itemRow(response: ExportIndexResponse, id: string): ExportItemEntry {
  const entry = (response.entries as ExportEntry[]).find(e => e.id === id);
  if (!entry || entry.kind !== 'item') throw new Error(`no item entry ${id}`);
  return entry;
}

/** The signature of one document after a fresh call. */
function sigOf(id: string, data?: unknown): string {
  const entry = (ok(data).entries as Array<ExportEntry | ExportIdEntry>).find(e =>
    'id' in e ? e.id === id : e.uuid.endsWith(`.${id}`)
  );
  if (!entry) throw new Error(`no entry ${id}`);
  return entry.sig;
}

// ---------------------------------------------------------------------------
// The GM gate
// ---------------------------------------------------------------------------

describe('getExportIndex: GM gate', () => {
  it('answers a GM client', () => {
    expect(getExportIndex({}).success).toBe(true);
  });

  it('refuses a non-GM client in the function itself', () => {
    world.addActor({ id: id16('a1'), name: 'Silvera', type: 'character' });
    (globalThis as unknown as { game: { user: { isGM: boolean } } }).game.user.isGM = false;
    expect(getExportIndex({})).toEqual({ success: false, error: 'Access denied' });
  });

  it('refuses a non-GM client even when allowNonGmAccess is on', () => {
    world.setSetting(MODULE_ID, 'allowNonGmAccess', true);
    (globalThis as unknown as { game: { user: { isGM: boolean } } }).game.user.isGM = false;
    expect(getExportIndex({})).toEqual({ success: false, error: 'Access denied' });
  });

  it('refuses when there is no current user', () => {
    (globalThis as unknown as { game: { user: unknown } }).game.user = undefined;
    expect(getExportIndex({})).toEqual({ success: false, error: 'Access denied' });
  });

  describe('through the registered handler', () => {
    const method = `${MODULE_ID}.${EXPORT_INDEX_QUERY}`;

    beforeEach(() => {
      vi.spyOn(console, 'warn').mockImplementation(() => undefined);
      vi.spyOn(console, 'log').mockImplementation(() => undefined);
      vi.spyOn(console, 'error').mockImplementation(() => undefined);
      (globalThis as unknown as { CONFIG: { queries: object } }).CONFIG.queries = {};
      bridgeHandlers.deleteByPrefix('');
      new QueryHandlers().registerHandlers();
    });

    afterEach(() => {
      bridgeHandlers.deleteByPrefix('');
    });

    it('is registered in the module-private table, never in CONFIG.queries', () => {
      expect(typeof bridgeHandlers.get(method)).toBe('function');
      const queries = (globalThis as unknown as { CONFIG: { queries: Record<string, unknown> } })
        .CONFIG.queries;
      expect(Object.keys(queries).filter(key => key.includes('getExportIndex'))).toEqual([]);
    });

    it('returns the index to a GM', async () => {
      world.addActor({ id: id16('a1'), name: 'Silvera', type: 'character' });
      const response = (await bridgeHandlers.get(method)?.({ kinds: ['actor'] })) as
        | ExportIndexResponse
        | undefined;
      expect(response?.success).toBe(true);
      expect((response?.entries as ExportEntry[]).map(e => e.id)).toEqual([id16('a1')]);
    });

    it('denies a non-GM client through the gate', async () => {
      (globalThis as unknown as { game: { user: { isGM: boolean } } }).game.user.isGM = false;
      const response = await bridgeHandlers.get(method)?.({});
      expect(response).toEqual({ error: 'Access denied', success: false });
    });

    it('denies a non-GM client even with allowNonGmAccess on', async () => {
      world.setSetting(MODULE_ID, 'allowNonGmAccess', true);
      (globalThis as unknown as { game: { user: { isGM: boolean } } }).game.user.isGM = false;
      const response = (await bridgeHandlers.get(method)?.({})) as { success: boolean };
      expect(response.success).toBe(false);
      expect(response).toMatchObject({ error: 'Access denied' });
    });
  });
});

// ---------------------------------------------------------------------------
// Request handling
// ---------------------------------------------------------------------------

describe('getExportIndex: request handling', () => {
  beforeEach(() => {
    world.addActor({ id: id16('a1'), name: 'Silvera', type: 'character' });
    world.addScene({ id: id16('s1'), name: 'Gates' });
    world.addJournal({ id: id16('j1'), name: 'Notes' });
    world.addItem({ id: id16('i1'), name: 'Rope', type: 'loot' });
  });

  it('a missing, null or non-object request means the defaults', () => {
    for (const data of [undefined, null, 'text', 42, []]) {
      expect(rows(data).map(e => e.kind)).toEqual(['actor', 'scene', 'journal', 'item']);
    }
  });

  it('kinds selects the kinds, always listed in the fixed order', () => {
    expect(rows({ kinds: ['item', 'actor'] }).map(e => e.kind)).toEqual(['actor', 'item']);
    expect(rows({ kinds: ['scene'] }).map(e => e.kind)).toEqual(['scene']);
  });

  it('unknown kinds are ignored and an empty selection returns nothing', () => {
    expect(rows({ kinds: ['combat', 'user'] })).toEqual([]);
    expect(rows({ kinds: [] })).toEqual([]);
    expect(rows({ kinds: 'actor' }).length).toBe(4);
  });

  it('rejects a malformed cursor with the one hard error', () => {
    for (const after of ['nonsense', 'actor:short', `user:${id16('a1')}`, 42, {}]) {
      expect(getExportIndex({ after })).toEqual({ success: false, error: 'Invalid cursor' });
    }
  });

  it('an empty or null cursor means the first page', () => {
    expect(rows({ after: null }).length).toBe(4);
    expect(rows({ after: '' }).length).toBe(4);
  });

  it('storyItemTypes: default, custom, empty, and not-an-array', () => {
    world.addItem({ id: id16('i2'), name: 'Fireball', type: 'spell' });
    world.addItem({ id: id16('i3'), name: 'Rage', type: 'feat' });
    const itemNames = (data: object): string[] =>
      rows({ kinds: ['item'], ...data }).map(e => e.name);
    expect(itemNames({})).toEqual(['Rope']);
    expect(itemNames({ storyItemTypes: ['spell', 'feat'] })).toEqual(['Fireball', 'Rage']);
    expect(itemNames({ storyItemTypes: [] })).toEqual([]);
    expect(itemNames({ storyItemTypes: 'spell' })).toEqual(['Rope']);
    expect(itemNames({ storyItemTypes: [42, '', 'x'.repeat(65), 'spell'] })).toEqual(['Fireball']);
  });

  it('ignores request fields that are not valid ids', () => {
    const folder = addFolder('Hidden');
    world.addActor({ id: id16('a2'), name: 'Filed', type: 'npc', folder });
    const bad = ['short', 42, null, `${id16('a')}!`, {}];
    expect(rows({ kinds: ['actor'], excludeFolderIds: bad }).length).toBe(2);
    expect(rows({ kinds: ['actor'], excludeFolderIds: [folder.id] }).length).toBe(1);
  });
});

// ---------------------------------------------------------------------------
// Response envelope
// ---------------------------------------------------------------------------

describe('getExportIndex: response envelope', () => {
  it('carries the schema, world id, client id, timing and an empty truncated list', () => {
    const response = ok({});
    expect(response.success).toBe(true);
    expect(response.schema).toBe(1);
    expect(response.worldId).toBe('test-world');
    expect(response.clientId).toMatch(/^[0-9a-f]{16}$/);
    expect(response.buildMs).toBeGreaterThanOrEqual(0);
    expect(response.truncated).toEqual([]);
    expect(response.next).toBeNull();
    expect(response.entries).toEqual([]);
    expect(response.watermark).toBe(0);
  });

  it('the client id is stable within a page load', () => {
    expect(ok({}).clientId).toBe(ok({}).clientId);
  });

  it('the watermark is the newest effective time of the requested kinds', () => {
    world.addActor({ id: id16('a1'), name: 'A', type: 'character', ...stats(300) });
    world.addScene({ id: id16('s1'), name: 'S', ...stats(900) });
    expect(ok({}).watermark).toBe(t(900));
    expect(ok({ kinds: ['actor'] }).watermark).toBe(t(300));
  });

  it('the watermark ignores the paging, since and uuid filters', () => {
    world.addActor({ id: id16('a1'), name: 'A', type: 'character', ...stats(300) });
    world.addActor({ id: id16('a2'), name: 'B', type: 'character', ...stats(500) });
    expect(ok({ limit: 1 }).watermark).toBe(t(500));
    expect(ok({ sinceModifiedTime: t(9999) }).watermark).toBe(t(500));
    expect(ok({ uuids: [`Actor.${id16('a1')}`] }).watermark).toBe(t(500));
    expect(ok({ after: `actor:${id16('a2')}` }).watermark).toBe(t(500));
  });

  it('usersSignature is stable and moves with a user id, role or banned flag', () => {
    const alice = addPlayer('p1', 'Alice', 1);
    addPlayer('p2', 'Bob', 1);
    const first = ok({}).usersSignature;
    expect(ok({}).usersSignature).toBe(first);
    alice.name = 'Alicia';
    expect(ok({}).usersSignature).toBe(first);
    alice.role = 2;
    const trusted = ok({}).usersSignature;
    expect(trusted).not.toBe(first);
    alice.role = 0;
    const banned = ok({}).usersSignature;
    expect(banned).not.toBe(trusted);
    addPlayer('p3', 'Cara', 1);
    expect(ok({}).usersSignature).not.toBe(banned);
  });
});

// ---------------------------------------------------------------------------
// Actor entries
// ---------------------------------------------------------------------------

const ACTOR_KEYS = [
  'ac',
  'actorType',
  'alignment',
  'background',
  'classes',
  'cr',
  'created',
  'creatureType',
  'disposition',
  'features',
  'folder',
  'hpMax',
  'id',
  'img',
  'kind',
  'level',
  'modified',
  'name',
  'notableItems',
  'owners',
  'pc',
  'playerAccess',
  'playerName',
  'playerVisible',
  'rules',
  'sig',
  'size',
  'sourceBook',
  'sourceUuid',
  'species',
  'statBlock',
  'tokenName',
  'uuid',
];

const WORLD_SWORD = id16('sword');

function addHero(overrides: Record<string, unknown> = {}): Doc {
  return world.addActor({
    id: id16('hero'),
    name: 'Silvera',
    type: 'character',
    ownership: { p1: 3 },
    ...stats(200, 100),
    system: {
      attributes: { hp: { value: 5, max: 31, temp: 2 }, ac: { value: 18 } },
      traits: { size: 'med' },
      details: {
        level: 5,
        alignment: 'Chaotic Good',
        race: { id: 'race', name: 'Elf' },
        background: { id: 'bg', name: 'Sage' },
      },
    },
    prototypeToken: { name: 'Silvera', disposition: 1, displayName: 50 },
    items: [
      classItem('Wizard', 2, 'wizard'),
      classItem('Fighter', 3, 'fighter'),
      makeItem({ name: 'Champion', type: 'subclass', system: { classIdentifier: 'fighter' } }),
      makeItem({
        name: 'Longsword +1',
        type: 'weapon',
        system: { properties: new Set(['mgc']), rarity: 'uncommon' },
        _stats: { duplicateSource: `Item.${WORLD_SWORD}` },
      }),
      makeItem({ name: 'Rope', type: 'loot' }),
    ],
    ...overrides,
  });
}

function addGoblin(overrides: Record<string, unknown> = {}): Doc {
  return world.addActor({
    id: id16('gob'),
    name: 'Goblin Boss',
    type: 'npc',
    ownership: { default: 0 },
    system: {
      attributes: { hp: { value: 21, max: 21 }, ac: { value: 17 } },
      traits: { size: 'sm' },
      details: {
        alignment: 'neutral evil',
        cr: 1,
        type: { value: 'humanoid', subtype: 'goblinoid' },
      },
      source: { book: 'MM', page: '166', rules: '2014' },
    },
    prototypeToken: { name: 'Goblin', disposition: -1, displayName: 0 },
    ...overrides,
  });
}

describe('getExportIndex: actor entries', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('exports a player character with the listed fields and nothing else', () => {
    addHero();
    const entry = actorRow(ok({ kinds: ['actor'] }), id16('hero'));
    expect(Object.keys(entry).sort()).toEqual(ACTOR_KEYS);
    expect(entry).toMatchObject({
      kind: 'actor',
      uuid: `Actor.${id16('hero')}`,
      name: 'Silvera',
      folder: null,
      created: t(100),
      modified: t(200),
      playerAccess: 'owner',
      playerVisible: true,
      rules: null,
      actorType: 'character',
      pc: true,
      owners: ['Alice'],
      hpMax: 31,
      ac: 18,
      size: 'med',
      alignment: 'Chaotic Good',
      disposition: 'friendly',
      tokenName: 'Silvera',
      playerName: 'Silvera',
      level: 5,
      classes: [
        { name: 'Fighter', levels: 3, subclass: 'Champion' },
        { name: 'Wizard', levels: 2, subclass: null },
      ],
      species: 'Elf',
      background: 'Sage',
      cr: null,
      creatureType: null,
      sourceBook: null,
      features: [
        { name: 'Fighter', type: 'class' },
        { name: 'Wizard', type: 'class' },
        { name: 'Rope', type: 'loot' },
        { name: 'Champion', type: 'subclass' },
        { name: 'Longsword +1', type: 'weapon' },
      ],
      notableItems: [{ name: 'Longsword +1', sourceUuid: `Item.${WORLD_SWORD}` }],
      img: null,
      statBlock: null,
    });
    expect(entry.sig).toMatch(/^[0-9a-z]+$/);
  });

  it('exports an npc with its challenge rating, creature type, source and rules', () => {
    addGoblin();
    const entry = actorRow(ok({ kinds: ['actor'] }), id16('gob'));
    expect(Object.keys(entry).sort()).toEqual(ACTOR_KEYS);
    expect(entry).toMatchObject({
      actorType: 'npc',
      pc: false,
      owners: [],
      playerAccess: 'none',
      playerVisible: false,
      hpMax: 21,
      ac: 17,
      size: 'sm',
      alignment: 'neutral evil',
      disposition: 'hostile',
      tokenName: 'Goblin',
      playerName: 'Unknown creature',
      level: null,
      classes: [],
      species: null,
      background: null,
      cr: 1,
      creatureType: 'humanoid',
      sourceBook: 'MM',
      rules: '2014',
      img: null,
      sourceUuid: null,
    });
    // The stat block is the NPC's, built by stat-block.ts (its own tests cover the layout).
    expect(entry.statBlock).toMatchObject({
      rules: '2014',
      tag: 'Humanoid (goblinoid), neutral evil',
      truncated: false,
    });
  });

  it('exports what an npc was made from: the compendium entry first, never the actor itself', () => {
    const monster = 'Compendium.aitool-content.monsters.Actor.AAAAAAAAAAAAAAAA';
    const original = `Actor.${id16('orig')}`;
    addGoblin({ _stats: { compendiumSource: monster, duplicateSource: original } });
    world.addActor({
      id: id16('copy'),
      name: 'Goblin Boss copy',
      type: 'npc',
      _stats: { compendiumSource: null, duplicateSource: original },
    });
    // Adventure Muncher writes the actor's own id as its source.
    world.addActor({
      id: id16('self'),
      name: 'Self',
      type: 'npc',
      _stats: { compendiumSource: `Actor.${id16('self')}` },
    });
    const result = ok({ kinds: ['actor'] });
    expect(actorRow(result, id16('gob')).sourceUuid).toBe(monster);
    expect(actorRow(result, id16('copy')).sourceUuid).toBe(original);
    expect(actorRow(result, id16('self')).sourceUuid).toBeNull();
  });

  it('exports characters and npcs only', () => {
    for (const type of ['character', 'npc', 'vehicle', 'group', 'encounter']) {
      world.addActor({ id: id16(type), name: type, type });
    }
    expect(
      rows({ kinds: ['actor'] })
        .map(e => e.name)
        .sort()
    ).toEqual(['character', 'npc']);
  });

  it('tells a PC from an NPC by hasPlayerOwner, whatever the actor type', () => {
    world.addActor({ id: id16('npcpc'), name: 'Familiar', type: 'npc', ownership: { p1: 3 } });
    world.addActor({
      id: id16('lone'),
      name: 'Lone',
      type: 'character',
      ownership: { default: 0 },
    });
    const response = ok({ kinds: ['actor'] });
    expect(actorRow(response, id16('npcpc'))).toMatchObject({ actorType: 'npc', pc: true });
    expect(actorRow(response, id16('lone'))).toMatchObject({ actorType: 'character', pc: false });
  });

  it('a PC without a prototype token is named by its own name, an NPC is unknown', () => {
    world.addActor({ id: id16('pc'), name: 'Kestrel', type: 'character', ownership: { p1: 3 } });
    world.addActor({ id: id16('npc'), name: 'Ismark', type: 'npc' });
    const response = ok({ kinds: ['actor'] });
    expect(actorRow(response, id16('pc'))).toMatchObject({
      playerName: 'Kestrel',
      tokenName: null,
    });
    expect(actorRow(response, id16('npc'))).toMatchObject({
      playerName: 'Unknown creature',
      tokenName: null,
      disposition: null,
    });
  });

  it('a token display mode that shows its name to players reveals it', () => {
    addGoblin({ prototypeToken: { name: 'Goblin', disposition: -1, displayName: 30 } });
    expect(actorRow(ok({ kinds: ['actor'] }), id16('gob')).playerName).toBe('Goblin');
  });

  it('reads the four disposition names and nothing else', () => {
    const cases: Array<[number, string | null]> = [
      [-2, 'secret'],
      [-1, 'hostile'],
      [0, 'neutral'],
      [1, 'friendly'],
      [7, null],
    ];
    cases.forEach(([level], index) => {
      world.addActor({
        id: id16(`d${index}`),
        name: `D${index}`,
        type: 'npc',
        prototypeToken: { name: 'x', disposition: level },
      });
    });
    const response = ok({ kinds: ['actor'] });
    cases.forEach(([, name], index) => {
      expect(actorRow(response, id16(`d${index}`)).disposition).toBe(name);
    });
  });

  it('reads custom creature types and the custom source line', () => {
    addGoblin({
      system: {
        details: { type: { value: 'custom', custom: 'Wisp' } },
        source: { custom: 'Homebrew' },
      },
    });
    world.addActor({
      id: id16('blank'),
      name: 'Blank',
      type: 'npc',
      system: { details: { type: { value: 'custom' } } },
    });
    const response = ok({ kinds: ['actor'] });
    expect(actorRow(response, id16('gob'))).toMatchObject({
      creatureType: 'Wisp',
      sourceBook: 'Homebrew',
    });
    expect(actorRow(response, id16('blank')).creatureType).toBeNull();
  });

  it('a class item without a stored identifier is matched to its subclass by the slugged name', () => {
    world.addActor({
      id: id16('hunter'),
      name: 'Aster',
      type: 'character',
      items: [
        makeItem({ name: 'Blood Hunter', type: 'class', system: { levels: 2 } }),
        makeItem({
          name: 'Order of the Ghostslayer',
          type: 'subclass',
          system: { classIdentifier: 'blood-hunter' },
        }),
      ],
    });
    expect(actorRow(ok({ kinds: ['actor'] }), id16('hunter')).classes).toEqual([
      { name: 'Blood Hunter', levels: 2, subclass: 'Order of the Ghostslayer' },
    ]);
  });

  it('species and background are read from linked documents only, not from an id string', () => {
    addHero({ system: { details: { race: 'AbCdEfGhIjKlMnOp', background: null } } });
    expect(actorRow(ok({ kinds: ['actor'] }), id16('hero'))).toMatchObject({
      species: null,
      background: null,
    });
  });

  it('player access is the highest level any non-GM user holds', () => {
    addPlayer('p2', 'Bob');
    addPlayer('p3', 'Cara');
    const at = (ownership: Record<string, number>): string => {
      const actor = addGoblin({ ownership });
      const level = actorRow(ok({ kinds: ['actor'] }), id16('gob')).playerAccess;
      void actor.delete();
      return level;
    };
    expect(at({ default: 0 })).toBe('none');
    expect(at({ default: 0, p1: 1 })).toBe('limited');
    expect(at({ default: 0, p1: 1, p2: 2 })).toBe('observer');
    expect(at({ default: 0, p1: 1, p2: 2, p3: 3 })).toBe('owner');
    expect(at({ default: 2 })).toBe('observer');
    expect(at({ default: 3 })).toBe('owner');
  });

  it('playerVisible is true from observer up, and false for limited', () => {
    addGoblin({ ownership: { default: 0, p1: 1 } });
    expect(actorRow(ok({ kinds: ['actor'] }), id16('gob')).playerVisible).toBe(false);
    addGoblin({ ownership: { default: 0, p1: 2 } });
    expect(actorRow(ok({ kinds: ['actor'] }), id16('gob')).playerVisible).toBe(true);
  });

  it('owners lists the non-GM users with OWNER by name, sorted, without banned users', () => {
    addPlayer('p2', 'Bob');
    addPlayer('p3', 'Zed', 0);
    world.addUser({ id: 'gm2', name: 'Second GM', isGM: true, role: 4 });
    addHero({ ownership: { p1: 3, p2: 3, p3: 3, gm2: 3 } });
    const entry = actorRow(ok({ kinds: ['actor'] }), id16('hero'));
    expect(entry.owners).toEqual(['Alice', 'Bob']);
    expect(entry.playerAccess).toBe('owner');
  });

  it('a banned user does not count towards player access', () => {
    addPlayer('p2', 'Bob', 0);
    addGoblin({ ownership: { default: 0, p2: 3 } });
    expect(actorRow(ok({ kinds: ['actor'] }), id16('gob'))).toMatchObject({
      playerAccess: 'none',
      owners: [],
      pc: false,
    });
  });

  it('rules: the tag the tools wrote, then the actor source, then the world setting', () => {
    addHero();
    expect(actorRow(ok({ kinds: ['actor'] }), id16('hero')).rules).toBeNull();
    world.setSetting('dnd5e', 'rulesVersion', 'modern');
    expect(actorRow(ok({ kinds: ['actor'] }), id16('hero')).rules).toBe('2024');
    world.setSetting('dnd5e', 'rulesVersion', 'legacy');
    expect(actorRow(ok({ kinds: ['actor'] }), id16('hero')).rules).toBe('2014');

    addGoblin();
    world.setSetting('dnd5e', 'rulesVersion', 'modern');
    expect(actorRow(ok({ kinds: ['actor'] }), id16('gob')).rules).toBe('2014');

    addGoblin({
      flags: { 'foundry-mcp-bridge': { rules: { version: '2024', source: 'gm', at: 'now' } } },
    });
    expect(actorRow(ok({ kinds: ['actor'] }), id16('gob')).rules).toBe('2024');
  });

  it('names a feature by its stored name, never by the unidentified name', () => {
    world.addActor({
      id: id16('carrier'),
      name: 'Carrier',
      type: 'character',
      items: [
        makeItem({
          name: 'Mysterious Ring',
          type: 'equipment',
          _source: { name: 'Ring of Fire', system: {} },
          system: { properties: ['mgc'] },
        }),
      ],
    });
    const entry = actorRow(ok({ kinds: ['actor'] }), id16('carrier'));
    expect(entry.features).toEqual([{ name: 'Ring of Fire', type: 'equipment' }]);
    expect(entry.notableItems).toEqual([{ name: 'Ring of Fire', sourceUuid: null }]);
  });

  it('notable items are magical, or uncommon and rarer; a plain or common item is not', () => {
    world.addActor({
      id: id16('carrier'),
      name: 'Carrier',
      type: 'character',
      items: [
        makeItem({ name: 'Plain', type: 'loot', system: { rarity: 'common' } }),
        makeItem({ name: 'Uncommon', type: 'loot', system: { rarity: 'uncommon' } }),
        makeItem({ name: 'Artifact', type: 'loot', system: { rarity: 'artifact' } }),
        makeItem({ name: 'Magic', type: 'loot', system: { properties: new Set(['mgc']) } }),
        makeItem({ name: 'Mundane', type: 'weapon', system: { properties: new Set(['fin']) } }),
      ],
    });
    expect(
      actorRow(ok({ kinds: ['actor'] }), id16('carrier')).notableItems.map(n => n.name)
    ).toEqual(['Artifact', 'Magic', 'Uncommon']);
  });

  it('caps features at 80 and notable items at 40', () => {
    const items = Array.from({ length: 90 }, (_, index) =>
      makeItem({
        name: `Item ${String(index).padStart(3, '0')}`,
        type: 'loot',
        system: { properties: new Set(['mgc']) },
      })
    );
    world.addActor({ id: id16('packrat'), name: 'Packrat', type: 'character', items });
    const entry = actorRow(ok({ kinds: ['actor'] }), id16('packrat'));
    expect(entry.features.length).toBe(EXPORT_INDEX_LIMITS.featuresPerActor);
    expect(entry.notableItems.length).toBe(EXPORT_INDEX_LIMITS.notableItemsPerActor);
    expect(entry.features[0]?.name).toBe('Item 000');
  });
});

// ---------------------------------------------------------------------------
// Scene entries
// ---------------------------------------------------------------------------

const JOURNAL_ID = id16('jour');
const PAGE_ID = id16('pg01');

function addScene(overrides: Record<string, unknown> = {}): Doc {
  return world.addScene({
    id: id16('scene'),
    name: 'Vallaki',
    navName: 'The Town',
    navigation: true,
    ownership: { default: 1 },
    ...stats(300, 50),
    journal: { id: JOURNAL_ID },
    journalEntryPage: PAGE_ID,
    notes: [],
    ...overrides,
  });
}

describe('getExportIndex: scene entries', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('exports a scene with the listed fields', () => {
    addScene();
    const entry = sceneRow(ok({ kinds: ['scene'] }), id16('scene'));
    expect(Object.keys(entry).sort()).toEqual([
      'created',
      'folder',
      'id',
      'journal',
      'kind',
      'map',
      'modified',
      'name',
      'navName',
      'navigation',
      'pins',
      'playerAccess',
      'playerVisible',
      'rules',
      'sig',
      'tokens',
      'uuid',
    ]);
    expect(entry).toMatchObject({
      kind: 'scene',
      uuid: `Scene.${id16('scene')}`,
      name: 'Vallaki',
      navName: 'The Town',
      navigation: true,
      folder: null,
      created: t(50),
      modified: t(300),
      playerAccess: 'limited',
      playerVisible: true,
      rules: null,
      journal: {
        uuid: `JournalEntry.${JOURNAL_ID}`,
        pageUuid: `JournalEntry.${JOURNAL_ID}.JournalEntryPage.${PAGE_ID}`,
      },
      pins: [],
      tokens: [],
      map: null,
    });
  });

  it('reads the linked journal from an id string or from the stored source', () => {
    addScene({ journal: JOURNAL_ID, journalEntryPage: null });
    expect(sceneRow(ok({ kinds: ['scene'] }), id16('scene')).journal).toEqual({
      uuid: `JournalEntry.${JOURNAL_ID}`,
      pageUuid: null,
    });

    addScene({
      journal: null,
      journalEntryPage: null,
      _source: { journal: JOURNAL_ID, journalEntryPage: PAGE_ID },
    });
    expect(sceneRow(ok({ kinds: ['scene'] }), id16('scene')).journal).toEqual({
      uuid: `JournalEntry.${JOURNAL_ID}`,
      pageUuid: `JournalEntry.${JOURNAL_ID}.JournalEntryPage.${PAGE_ID}`,
    });
  });

  it('a scene without a journal has journal null, and an empty navName is null', () => {
    addScene({ journal: null, journalEntryPage: null, navName: '' });
    const entry = sceneRow(ok({ kinds: ['scene'] }), id16('scene'));
    expect(entry.journal).toBeNull();
    expect(entry.navName).toBeNull();
  });

  it('playerVisible needs the navigation bar and at least limited access', () => {
    const visible = (overrides: Record<string, unknown>): boolean => {
      addScene(overrides);
      return sceneRow(ok({ kinds: ['scene'] }), id16('scene')).playerVisible;
    };
    expect(visible({ navigation: true, ownership: { default: 1 } })).toBe(true);
    expect(visible({ navigation: true, ownership: { default: 2 } })).toBe(true);
    expect(visible({ navigation: false, ownership: { default: 1 } })).toBe(false);
    expect(visible({ navigation: true, ownership: { default: 0 } })).toBe(false);
    expect(visible({ navigation: false, ownership: { default: 0 } })).toBe(false);
  });

  it('exports map notes as pins sorted by id, with labels and journal links', () => {
    const entry = id16('entry');
    addScene({
      notes: [
        makeNote({ id: id16('n2'), text: '', page: { name: 'Bell Tower' } }),
        makeNote({
          id: id16('n1'),
          text: 'Church',
          entryId: entry,
          pageId: PAGE_ID,
          entry: { name: 'Vallaki' },
          page: { name: 'Ignored' },
        }),
        makeNote({ id: id16('n4'), text: '' }),
        makeNote({ id: id16('n3'), text: '', entry: { name: 'Notes' }, entryId: entry }),
      ],
    });
    const scene = sceneRow(ok({ kinds: ['scene'] }), id16('scene'));
    expect(scene.pins).toEqual([
      {
        label: 'Church',
        entryUuid: `JournalEntry.${entry}`,
        pageUuid: `JournalEntry.${entry}.JournalEntryPage.${PAGE_ID}`,
      },
      { label: 'Bell Tower', entryUuid: null, pageUuid: null },
      { label: 'Notes', entryUuid: `JournalEntry.${entry}`, pageUuid: null },
      { label: null, entryUuid: null, pageUuid: null },
    ]);
  });

  it('caps pins at 300, keeping the lowest ids', () => {
    const notes = Array.from({ length: 305 }, (_, index) =>
      makeNote({ id: id16(`n${String(index).padStart(3, '0')}`), text: `Pin ${index}` })
    );
    addScene({ notes });
    const scene = sceneRow(ok({ kinds: ['scene'] }), id16('scene'));
    expect(scene.pins.length).toBe(EXPORT_INDEX_LIMITS.pinsPerScene);
    expect(scene.pins[0]?.label).toBe('Pin 0');
    expect(scene.pins[299]?.label).toBe('Pin 299');
  });

  it('folds tokens by world actor, name, disposition and hidden, without positions', () => {
    world.addActor({ id: id16('wolf'), name: 'Wolf', type: 'npc' });
    world.addActor({ id: id16('strahd'), name: 'Strahd von Zarovich', type: 'npc' });
    addScene({
      tokens: [
        makeToken({ id: id16('t1'), name: 'Wolf', actorId: id16('wolf'), disposition: -1, x: 1 }),
        makeToken({ id: id16('t2'), name: 'Wolf', actorId: id16('wolf'), disposition: -1, x: 2 }),
        makeToken({
          id: id16('t3'),
          name: 'Wolf',
          actorId: id16('wolf'),
          disposition: -1,
          hidden: true,
        }),
        makeToken({
          id: id16('t4'),
          name: 'The Stranger',
          actorId: id16('strahd'),
          actorLink: true,
          disposition: 0,
        }),
        makeToken({ id: id16('t5'), name: 'Lost', actorId: id16('gone') }),
      ],
    });
    const scene = sceneRow(ok({ kinds: ['scene'] }), id16('scene'));
    expect(scene.tokens).toEqual([
      {
        name: 'Lost',
        actorUuid: null,
        actorType: null,
        actorLink: false,
        disposition: 'neutral',
        hidden: false,
        count: 1,
      },
      {
        name: 'The Stranger',
        actorUuid: `Actor.${id16('strahd')}`,
        actorType: 'npc',
        actorLink: true,
        disposition: 'neutral',
        hidden: false,
        count: 1,
      },
      {
        name: 'Wolf',
        actorUuid: `Actor.${id16('wolf')}`,
        actorType: 'npc',
        actorLink: false,
        disposition: 'hostile',
        hidden: false,
        count: 2,
      },
      {
        name: 'Wolf',
        actorUuid: `Actor.${id16('wolf')}`,
        actorType: 'npc',
        actorLink: false,
        disposition: 'hostile',
        hidden: true,
        count: 1,
      },
    ]);
  });

  it('caps token rows at 200', () => {
    const tokens = Array.from({ length: 205 }, (_, index) =>
      makeToken({
        id: id16(`t${String(index).padStart(3, '0')}`),
        name: `Token ${String(index).padStart(3, '0')}`,
      })
    );
    addScene({ tokens });
    const scene = sceneRow(ok({ kinds: ['scene'] }), id16('scene'));
    expect(scene.tokens?.length).toBe(EXPORT_INDEX_LIMITS.tokensPerScene);
    expect(scene.tokens?.[199]?.name).toBe('Token 199');
  });

  it('clips a long pin label and a long name to 200 characters', () => {
    addScene({
      name: 'S'.repeat(300),
      navName: 'N'.repeat(300),
      notes: [makeNote({ id: id16('n1'), text: 'P'.repeat(300) })],
    });
    const scene = sceneRow(ok({ kinds: ['scene'] }), id16('scene'));
    expect(scene.name.length).toBe(200);
    expect(scene.navName?.length).toBe(200);
    expect(scene.pins[0]?.label?.length).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Journal entries and page text
// ---------------------------------------------------------------------------

function page(id: string, overrides: Record<string, unknown> = {}): Doc {
  return makeJournalPage({ id, name: `Page ${id.slice(0, 4)}`, ...overrides });
}

function addJournal(overrides: Record<string, unknown> = {}): Doc {
  return world.addJournal({
    id: JOURNAL_ID,
    name: 'Barovia',
    ownership: { default: 2 },
    ...stats(400, 60),
    pages: [
      page(id16('pg02'), { sort: 200, name: 'Second' }),
      page(id16('pg01'), { sort: 100, name: 'First' }),
    ],
    ...overrides,
  });
}

describe('getExportIndex: journal entries', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('exports a journal with the listed fields and its pages in sort order', () => {
    addJournal();
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(Object.keys(entry).sort()).toEqual([
      'categories',
      'created',
      'folder',
      'id',
      'kind',
      'modified',
      'name',
      'pages',
      'pagesTotal',
      'playerAccess',
      'playerVisible',
      'rules',
      'sig',
      'textIncluded',
      'uuid',
    ]);
    expect(entry).toMatchObject({
      kind: 'journal',
      uuid: `JournalEntry.${JOURNAL_ID}`,
      name: 'Barovia',
      playerAccess: 'observer',
      playerVisible: true,
      textIncluded: false,
      categories: [],
      pagesTotal: 2,
      created: t(60),
      modified: t(400),
    });
    expect(entry.pages.map(p => p.name)).toEqual(['First', 'Second']);
    expect(Object.keys(entry.pages[0] ?? {}).sort()).toEqual([
      'category',
      'id',
      'modified',
      'name',
      'playerAccess',
      'playerVisible',
      'sort',
      'type',
      'uuid',
    ]);
    expect(entry.pages[0]).toMatchObject({
      uuid: `JournalEntry.${JOURNAL_ID}.JournalEntryPage.${id16('pg01')}`,
      id: id16('pg01'),
      type: 'text',
      category: null,
      sort: 100,
      modified: null,
    });
  });

  it('breaks a sort tie by page id', () => {
    addJournal({
      pages: [
        page(id16('pgb'), { sort: 5, name: 'B' }),
        page(id16('pga'), { sort: 5, name: 'A' }),
        page(id16('pgc'), { sort: 1, name: 'C' }),
      ],
    });
    expect(journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID).pages.map(p => p.name)).toEqual([
      'C',
      'A',
      'B',
    ]);
  });

  it('caps pages at 1000 and reports the full count in pagesTotal', () => {
    const pages = Array.from({ length: 1005 }, (_, index) =>
      page(id16(`pg${String(index).padStart(4, '0')}`), { sort: index, name: `P${index}` })
    );
    addJournal({ pages });
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(entry.pages.length).toBe(EXPORT_INDEX_LIMITS.pagesPerJournal);
    expect(entry.pagesTotal).toBe(1005);
    expect(entry.pages[999]?.name).toBe('P999');
  });

  it('page access follows the M2 rule: inherit, own ownership, and a hidden journal', () => {
    addJournal({
      ownership: { default: 2 },
      pages: [
        page(id16('inh'), { name: 'Inherits' }),
        page(id16('hid'), { name: 'Hidden', ownership: { default: 0 } }),
        page(id16('own'), { name: 'Owned', ownership: { default: 0, p1: 3 } }),
        page(id16('lim'), { name: 'Limited', ownership: { default: 1 } }),
      ],
    });
    const byName = new Map(
      journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID).pages.map(p => [p.name, p])
    );
    expect(byName.get('Inherits')).toMatchObject({ playerAccess: 'observer', playerVisible: true });
    expect(byName.get('Hidden')).toMatchObject({ playerAccess: 'none', playerVisible: false });
    expect(byName.get('Owned')).toMatchObject({ playerAccess: 'owner', playerVisible: true });
    expect(byName.get('Limited')).toMatchObject({ playerAccess: 'limited', playerVisible: false });
  });

  it('a page of a journal players cannot see is not visible to players, whatever its own level', () => {
    addJournal({
      ownership: { default: 1 },
      pages: [page(id16('own'), { name: 'Owned', ownership: { default: 3 } })],
    });
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(entry).toMatchObject({ playerAccess: 'limited', playerVisible: false });
    expect(entry.pages[0]).toMatchObject({ playerAccess: 'owner', playerVisible: false });
  });

  it('carries page types other than text and their categories on Foundry 14', () => {
    useV14Journals();
    const category = id16('cat1');
    addJournal({
      categories: new MockCollection([
        { id: id16('cat2'), name: 'Second', sort: 20 },
        { id: category, name: 'First', sort: 10, _source: { name: 'First' } },
      ]),
      pages: [
        page(id16('pg01'), { name: 'Map', type: 'image', src: 'maps/x.webp', category }),
        page(id16('pg02'), { name: 'Notes', category: '' }),
      ],
    });
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(entry.categories).toEqual([
      { id: category, name: 'First', sort: 10 },
      { id: id16('cat2'), name: 'Second', sort: 20 },
    ]);
    expect(entry.pages.map(p => [p.name, p.type, p.category])).toEqual([
      ['Map', 'image', category],
      ['Notes', 'text', null],
    ]);
  });

  it('Foundry 13 has no categories: the list is empty and a page category is null', () => {
    addJournal({
      categories: new MockCollection([{ id: id16('cat1'), name: 'Ghost', sort: 1 }]),
      pages: [page(id16('pg01'), { name: 'Map', category: id16('cat1') })],
    });
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(entry.categories).toEqual([]);
    expect(entry.pages[0]?.category).toBeNull();
  });
});

describe('getExportIndex: journal page text', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
    addJournal({
      pages: [
        page(id16('pg01'), { sort: 1, text: { content: '<p>Html body</p>' } }),
        page(id16('pg02'), {
          sort: 2,
          type: 'text',
          text: { content: '<p>Rendered</p>', markdown: '# Source', format: 2 },
        }),
        page(id16('pg03'), { sort: 3, type: 'image', src: 'maps/x.webp' }),
      ],
    });
  });

  it('sends no text and no text key unless the journal is opted in', () => {
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(entry.textIncluded).toBe(false);
    for (const p of entry.pages) expect(Object.keys(p)).not.toContain('text');
    expect(JSON.stringify(entry)).not.toContain('Html body');
  });

  it('opts in a journal that holds session notes (flag sessionNotes, D-087) by itself', () => {
    world.journal.get(JOURNAL_ID)!.flags = { 'foundry-mcp-bridge': { sessionNotes: true } };
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(entry.textIncluded).toBe(true);
    expect(entry.pages[0]?.text?.content).toBe('<p>Html body</p>');
  });

  it('opts in by journal id, sending html or markdown by page format', () => {
    const entry = journalRow(
      ok({ kinds: ['journal'], includeText: { folderIds: [], journalIds: [JOURNAL_ID] } }),
      JOURNAL_ID
    );
    expect(entry.textIncluded).toBe(true);
    expect(entry.pages[0]?.text).toEqual({
      format: 'html',
      content: '<p>Html body</p>',
      truncated: false,
    });
    expect(entry.pages[1]?.text).toEqual({
      format: 'markdown',
      content: '# Source',
      truncated: false,
    });
  });

  it('an image page carries only a small figure, a page of another type has no text key', () => {
    addJournal({
      pages: [
        page(id16('pg01'), { sort: 1, text: { content: '<p>Html body</p>' } }),
        page(id16('pg02'), {
          sort: 2,
          type: 'image',
          src: 'maps/x.webp',
          image: { caption: 'A "map" <of> Vallaki & more' },
        }),
        page(id16('pg03'), { sort: 3, type: 'video', src: 'clips/x.webm' }),
        page(id16('pg04'), { sort: 4, type: 'image', src: 'icons/svg/mystery-man.svg' }),
      ],
    });
    const entry = journalRow(
      ok({ kinds: ['journal'], includeText: { folderIds: [], journalIds: [JOURNAL_ID] } }),
      JOURNAL_ID
    );
    expect(entry.pages[1]?.text).toEqual({
      format: 'html',
      content:
        '<figure><img src="maps/x.webp" alt="A &quot;map&quot; &lt;of&gt; Vallaki &amp; more">' +
        '<figcaption>A &quot;map&quot; &lt;of&gt; Vallaki &amp; more</figcaption></figure>',
      truncated: false,
    });
    // A video page and an image page whose picture is only a placeholder icon: no text key.
    for (const index of [2, 3]) {
      expect(Object.keys(entry.pages[index] ?? {})).not.toContain('text');
      expect(Object.keys(entry.pages[index] ?? {})).not.toContain('textOmitted');
    }
  });

  it('an image page of a journal that is not opted in has no text, so no src either', () => {
    addJournal({
      pages: [page(id16('pg01'), { sort: 1, type: 'image', src: 'maps/secret.webp' })],
    });
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(Object.keys(entry.pages[0] ?? {})).not.toContain('text');
    expect(JSON.stringify(entry)).not.toContain('secret.webp');
  });

  it('opts in by folder, and by an ancestor folder, but not by a sibling folder', () => {
    const root = addFolder('Campaign');
    const child = addFolder('Chapter 1', root);
    const other = addFolder('Elsewhere');
    addJournal({ folder: child });
    const text = (folderIds: string[]): boolean =>
      journalRow(ok({ kinds: ['journal'], includeText: { folderIds, journalIds: [] } }), JOURNAL_ID)
        .textIncluded;
    expect(text([child.id as string])).toBe(true);
    expect(text([root.id as string])).toBe(true);
    expect(text([other.id as string])).toBe(false);
    expect(text([])).toBe(false);
  });

  it('ignores includeText ids that are not sixteen alphanumeric characters', () => {
    const entry = journalRow(
      ok({
        kinds: ['journal'],
        includeText: {
          folderIds: ['../etc', 42, null],
          journalIds: ['short', JOURNAL_ID.slice(1)],
        },
      }),
      JOURNAL_ID
    );
    expect(entry.textIncluded).toBe(false);
  });

  it('a markdown page with no markdown source sends an empty string', () => {
    addJournal({
      pages: [page(id16('pg01'), { text: { content: '<p>x</p>', format: 2 } })],
    });
    const entry = journalRow(
      ok({ kinds: ['journal'], includeText: { folderIds: [], journalIds: [JOURNAL_ID] } }),
      JOURNAL_ID
    );
    expect(entry.pages[0]?.text).toEqual({ format: 'markdown', content: '', truncated: false });
  });

  it('cuts one page at 512 KB and marks it truncated, never inside a surrogate pair', () => {
    const limit = EXPORT_INDEX_LIMITS.textPerPageBytes;
    // Each emoji is 4 UTF-8 bytes and 2 UTF-16 units; 512 KB / 4 is an exact fit, so add one.
    const emoji = '\u{1F600}';
    addJournal({
      pages: [
        page(id16('pg01'), { text: { content: `${'a'.repeat(limit - 2)}${emoji}` } }),
        page(id16('pg02'), { text: { content: 'a'.repeat(limit) } }),
        page(id16('pg03'), { text: { content: 'a'.repeat(limit + 1) } }),
      ],
    });
    const entry = journalRow(
      ok({ kinds: ['journal'], includeText: { folderIds: [], journalIds: [JOURNAL_ID] } }),
      JOURNAL_ID
    );
    const [first, second, third] = entry.pages.map(p => p.text);
    expect(first?.truncated).toBe(true);
    expect(first?.content.length).toBe(limit - 2);
    expect(Buffer.byteLength(first?.content ?? '', 'utf8')).toBeLessThanOrEqual(limit);
    expect(/[\uD800-\uDBFF]$/.test(first?.content ?? '')).toBe(false);
    expect(second?.truncated).toBe(false);
    expect(second?.content.length).toBe(limit);
    expect(third?.truncated).toBe(true);
    expect(third?.content.length).toBe(limit);
  });

  it('stops sending text after 2 MB per journal: later pages get textOmitted budget', () => {
    const chunk = 500_000;
    addJournal({
      pages: Array.from({ length: 6 }, (_, index) =>
        page(id16(`pg0${index}`), { sort: index, text: { content: 'b'.repeat(chunk) } })
      ),
    });
    const entry = journalRow(
      ok({ kinds: ['journal'], includeText: { folderIds: [], journalIds: [JOURNAL_ID] } }),
      JOURNAL_ID
    );
    const sent = entry.pages.filter(p => p.text !== null && p.text !== undefined);
    const omitted = entry.pages.filter(p => p.textOmitted === 'budget');
    expect(sent.length).toBe(4);
    expect(omitted.length).toBe(2);
    for (const p of omitted) expect(p.text).toBeNull();
    // Once the budget is out, every later text page is omitted, even a short one.
    expect(entry.pages.slice(4).every(p => p.textOmitted === 'budget')).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// Item entries
// ---------------------------------------------------------------------------

const ITEM_ID = id16('itm');

function addWorldItem(overrides: Record<string, unknown> = {}): Doc {
  return world.addItem({
    id: ITEM_ID,
    name: 'Sunblade',
    type: 'weapon',
    ownership: { default: 0 },
    ...stats(500, 70),
    system: {
      identified: true,
      rarity: 'rare',
      attunement: 'required',
      properties: new Set(['mgc', 'fin']),
      source: { rules: '2014' },
    },
    ...overrides,
  });
}

/** A dnd5e 6 item system: a `rarities` Set with a `rarity` getter over it (`dnd5e.mjs:29524`, `:29627-29632`). */
function dnd5e6System(rarities: string[], extra: Record<string, unknown> = {}): object {
  const system: Record<string, unknown> = { rarities: new Set(rarities), ...extra };
  Object.defineProperty(system, 'rarity', {
    enumerable: false,
    get: () => (system.rarities as Set<string>).values().next().value ?? '',
  });
  return system;
}

/** An actor carrying `items`, for the holder index. */
function addCarrier(id: string, name: string, items: Doc[]): Doc {
  return world.addActor({ id: id16(id), name, type: 'character', items });
}

function embedded(name: string, overrides: Record<string, unknown> = {}): Doc {
  return makeItem({ name, type: 'weapon', ...overrides });
}

describe('getExportIndex: item entries', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('exports a story item with the listed fields', () => {
    addWorldItem();
    const entry = itemRow(ok({ kinds: ['item'] }), ITEM_ID);
    expect(Object.keys(entry).sort()).toEqual([
      'attunement',
      'created',
      'folder',
      'holders',
      'id',
      'identified',
      'itemType',
      'kind',
      'magical',
      'modified',
      'name',
      'playerAccess',
      'playerName',
      'playerVisible',
      'rarity',
      'rules',
      'sig',
      'uuid',
    ]);
    expect(entry).toMatchObject({
      kind: 'item',
      uuid: `Item.${ITEM_ID}`,
      name: 'Sunblade',
      itemType: 'weapon',
      rarity: 'rare',
      attunement: 'required',
      magical: true,
      identified: true,
      playerName: 'Sunblade',
      playerAccess: 'none',
      playerVisible: false,
      rules: '2014',
      created: t(70),
      modified: t(500),
      holders: [],
      folder: null,
    });
  });

  it('exports the default story item types and no others', () => {
    for (const type of [
      'weapon',
      'equipment',
      'consumable',
      'tool',
      'loot',
      'container',
      'spell',
      'feat',
      'class',
    ]) {
      world.addItem({ id: id16(type), name: type, type });
    }
    expect(
      rows({ kinds: ['item'] })
        .map(e => (e.kind === 'item' ? e.itemType : ''))
        .sort()
    ).toEqual(['consumable', 'container', 'equipment', 'loot', 'tool', 'weapon']);
  });

  it('an unidentified item exports its stored name; playerName is what players see', () => {
    // dnd5e overwrites `name` with the unidentified name on every client (`dnd5e.mjs:29434-29441`).
    addWorldItem({
      name: 'Old Sword',
      _source: { name: 'Sunblade', system: {} },
      system: { identified: false, rarity: 'rare', properties: new Set(['mgc']) },
    });
    const entry = itemRow(ok({ kinds: ['item'] }), ITEM_ID);
    expect(entry).toMatchObject({ name: 'Sunblade', playerName: 'Old Sword', identified: false });
  });

  it('an item with no identified flag counts as identified', () => {
    addWorldItem({ system: {} });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID).identified).toBe(true);
  });

  it('dnd5e 6: the rarity comes from the getter over the rarities set', () => {
    addWorldItem({ system: dnd5e6System(['veryRare']) });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID).rarity).toBe('veryRare');
    addWorldItem({ system: dnd5e6System([]) });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID).rarity).toBeNull();
  });

  it('dnd5e 5.x: the rarity is a string, and an empty string is no rarity', () => {
    addWorldItem({ system: { rarity: 'legendary' } });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID).rarity).toBe('legendary');
    addWorldItem({ system: { rarity: '' } });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID).rarity).toBeNull();
    addWorldItem({ system: {} });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID).rarity).toBeNull();
  });

  it('magical is the mgc property, as a Set (dnd5e 5 and 6) or as an array', () => {
    const magical = (properties: unknown): boolean => {
      addWorldItem({ system: { properties } });
      return itemRow(ok({ kinds: ['item'] }), ITEM_ID).magical;
    };
    expect(magical(new Set(['mgc']))).toBe(true);
    expect(magical(['mgc', 'fin'])).toBe(true);
    expect(magical(new Set(['fin']))).toBe(false);
    expect(magical([])).toBe(false);
    expect(magical(undefined)).toBe(false);
    expect(magical('mgc')).toBe(false);
  });

  it('attunement is the stored value, and an empty value is null', () => {
    const attunement = (value: unknown): string | null => {
      addWorldItem({ system: { attunement: value } });
      return itemRow(ok({ kinds: ['item'] }), ITEM_ID).attunement;
    };
    expect(attunement('required')).toBe('required');
    expect(attunement('optional')).toBe('optional');
    expect(attunement('')).toBeNull();
    expect(attunement(undefined)).toBeNull();
    expect(attunement(1)).toBeNull();
  });

  it('player access and visibility follow the item ownership', () => {
    addWorldItem({ ownership: { default: 2 } });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID)).toMatchObject({
      playerAccess: 'observer',
      playerVisible: true,
    });
    addWorldItem({ ownership: { default: 1 } });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID)).toMatchObject({
      playerAccess: 'limited',
      playerVisible: false,
    });
  });

  it('carries the folder with its path from the root', () => {
    const root = addFolder('Treasure');
    const child = addFolder('Vallaki', root);
    addWorldItem({ folder: child });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID).folder).toEqual({
      id: child.id,
      path: ['Treasure', 'Vallaki'],
    });
  });
});

describe('getExportIndex: item holders', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  const holders = (): ExportItemEntry['holders'] =>
    itemRow(ok({ kinds: ['item'] }), ITEM_ID).holders;

  it('finds an actor by the duplicate source or the compendium source of its item', () => {
    addWorldItem();
    addCarrier('dup', 'Duplicated', [
      embedded('Sunblade', { _stats: { duplicateSource: `Item.${ITEM_ID}` } }),
    ]);
    addCarrier('comp', 'Compendium', [
      embedded('Renamed', { _stats: { compendiumSource: `Item.${ITEM_ID}` } }),
    ]);
    addCarrier('none', 'Empty', [embedded('Other', { _stats: { duplicateSource: 'Item.other' } })]);
    expect(holders()).toEqual([
      { uuid: `Actor.${id16('comp')}`, name: 'Compendium', match: 'source' },
      { uuid: `Actor.${id16('dup')}`, name: 'Duplicated', match: 'source' },
    ]);
  });

  it('falls back to the same name for a magical item, and only then', () => {
    addWorldItem();
    addCarrier('copy', 'Copier', [embedded('Sunblade')]);
    expect(holders()).toEqual([{ uuid: `Actor.${id16('copy')}`, name: 'Copier', match: 'name' }]);

    addWorldItem({ system: { properties: new Set(['fin']) } });
    expect(holders()).toEqual([]);
  });

  it('matches the stored name of an unidentified carried item', () => {
    addWorldItem();
    addCarrier('copy', 'Copier', [
      embedded('Old Sword', { _source: { name: 'Sunblade', system: {} } }),
    ]);
    expect(holders().map(h => h.match)).toEqual(['name']);
  });

  it('one row per actor: a source match wins over a name match', () => {
    addWorldItem();
    addCarrier('both', 'Both', [
      embedded('Sunblade'),
      embedded('Sunblade', { _stats: { duplicateSource: `Item.${ITEM_ID}` } }),
      embedded('Sunblade', { _stats: { duplicateSource: `Item.${ITEM_ID}` } }),
    ]);
    expect(holders()).toEqual([{ uuid: `Actor.${id16('both')}`, name: 'Both', match: 'source' }]);
  });

  it('sorts holders by name and caps them at 20', () => {
    addWorldItem();
    for (let index = 24; index >= 0; index -= 1) {
      addCarrier(`h${String(index).padStart(2, '0')}`, `Holder ${String(index).padStart(2, '0')}`, [
        embedded('Sunblade', { _stats: { duplicateSource: `Item.${ITEM_ID}` } }),
      ]);
    }
    const list = holders();
    expect(list.length).toBe(EXPORT_INDEX_LIMITS.holdersPerItem);
    expect(list.map(h => h.name)).toEqual(
      Array.from({ length: 20 }, (_, index) => `Holder ${String(index).padStart(2, '0')}`)
    );
  });
});

// ---------------------------------------------------------------------------
// Effective modified time, since, uuids and idsOnly
// ---------------------------------------------------------------------------

function modifiedOf(id: string, data?: unknown): number | null {
  const entry = (ok(data).entries as ExportEntry[]).find(e => e.id === id);
  if (!entry) throw new Error(`no entry ${id}`);
  return entry.modified;
}

describe('getExportIndex: effective modified time', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('an actor is as new as its newest embedded item, or its own time when that is newer', () => {
    world.addActor({
      id: id16('a1'),
      name: 'A',
      type: 'character',
      ...stats(100),
      items: [
        makeItem({ name: 'Old', ...stats(50) }),
        makeItem({ name: 'New', ...stats(500) }),
        makeItem({ name: 'Unstamped' }),
      ],
    });
    world.addActor({
      id: id16('a2'),
      name: 'B',
      type: 'character',
      ...stats(900),
      items: [makeItem({ name: 'Old', ...stats(50) })],
    });
    expect(modifiedOf(id16('a1'))).toBe(t(500));
    expect(modifiedOf(id16('a2'))).toBe(t(900));
  });

  it('a folder counts for its whole ancestor chain, and a folder without a time adds nothing', () => {
    const root = addFolder('Root', undefined, 900);
    const child = addFolder('Child', root);
    const bare = addFolder('Bare');
    world.addActor({ id: id16('a1'), name: 'A', type: 'npc', ...stats(200), folder: child });
    world.addActor({ id: id16('a2'), name: 'B', type: 'npc', ...stats(200), folder: bare });
    expect(modifiedOf(id16('a1'))).toBe(t(900));
    expect(modifiedOf(id16('a2'))).toBe(t(200));
  });

  it('a scene is as new as its notes that carry a time and never as its tokens', () => {
    world.addScene({
      id: id16('s1'),
      name: 'S',
      ...stats(100),
      notes: [
        makeNote({ id: id16('n1'), text: 'Pin', ...stats(600) }),
        makeNote({ id: id16('n2') }),
      ],
      tokens: [makeToken({ id: id16('t1'), name: 'Wolf', ...stats(9999) })],
    });
    world.addScene({
      id: id16('s2'),
      name: 'T',
      ...stats(100),
      tokens: [makeToken({ id: id16('t2'), name: 'Wolf', ...stats(9999), x: 500 })],
    });
    expect(modifiedOf(id16('s1'))).toBe(t(600));
    expect(modifiedOf(id16('s2'))).toBe(t(100));
  });

  it('a journal is as new as its newest page', () => {
    world.addJournal({
      id: JOURNAL_ID,
      name: 'J',
      ...stats(100),
      pages: [page(id16('pg01'), stats(300)), page(id16('pg02'), stats(700)), page(id16('pg03'))],
    });
    expect(modifiedOf(JOURNAL_ID)).toBe(t(700));
  });

  it('Foundry 14: a journal category counts; on Foundry 13 it does not', () => {
    const categories = (): MockCollection<Record<string, unknown> & { id: string }> =>
      new MockCollection([{ id: id16('cat1'), name: 'Places', sort: 1, ...stats(900) }]);
    world.addJournal({ id: JOURNAL_ID, name: 'J', ...stats(100), categories: categories() });
    expect(modifiedOf(JOURNAL_ID)).toBe(t(100));
    useV14Journals();
    expect(modifiedOf(JOURNAL_ID)).toBe(t(900));
  });

  it('an item is as new as the newest embedded item of the actors that carry it', () => {
    world.addItem({ id: ITEM_ID, name: 'Sunblade', type: 'weapon', ...stats(100) });
    world.addActor({
      id: id16('c1'),
      name: 'Carrier',
      type: 'character',
      items: [
        makeItem({
          name: 'Sunblade',
          _stats: { modifiedTime: t(400), duplicateSource: `Item.${ITEM_ID}` },
        }),
      ],
    });
    expect(modifiedOf(ITEM_ID)).toBe(t(400));
  });

  it('an item that nobody carries keeps its own time, and a folder can make it newer', () => {
    const folder = addFolder('Treasure', undefined, 800);
    world.addItem({ id: ITEM_ID, name: 'Sunblade', type: 'weapon', ...stats(100) });
    world.addItem({ id: id16('itm2'), name: 'Rope', type: 'loot', ...stats(100), folder });
    expect(modifiedOf(ITEM_ID)).toBe(t(100));
    expect(modifiedOf(id16('itm2'))).toBe(t(800));
  });

  it('a document with no time anywhere has a null time and the watermark stays 0', () => {
    world.addActor({ id: id16('a1'), name: 'A', type: 'character', items: [makeItem({})] });
    expect(modifiedOf(id16('a1'))).toBeNull();
    expect(ok({}).watermark).toBe(0);
  });
});

describe('getExportIndex: sinceModifiedTime', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
    world.addActor({ id: id16('a1'), name: 'One', type: 'npc', ...stats(100) });
    world.addActor({ id: id16('a2'), name: 'Two', type: 'npc', ...stats(200) });
    world.addActor({ id: id16('a3'), name: 'Three', type: 'npc', ...stats(300) });
    world.addActor({ id: id16('a4'), name: 'Unstamped', type: 'npc' });
  });

  const names = (data: object): string[] => rows({ kinds: ['actor'], ...data }).map(e => e.name);

  it('returns entries strictly newer than the time, and always the ones with no time', () => {
    expect(names({ sinceModifiedTime: t(200) })).toEqual(['Three', 'Unstamped']);
    expect(names({ sinceModifiedTime: t(199) })).toEqual(['Two', 'Three', 'Unstamped']);
    expect(names({ sinceModifiedTime: t(300) })).toEqual(['Unstamped']);
  });

  it('a value that is not a number means everything', () => {
    expect(names({ sinceModifiedTime: 'yesterday' }).length).toBe(4);
    expect(names({ sinceModifiedTime: null }).length).toBe(4);
    expect(names({ sinceModifiedTime: -5 }).length).toBe(4);
  });

  it('works together with the cursor', () => {
    expect(names({ sinceModifiedTime: t(100), after: `actor:${id16('a2')}` })).toEqual([
      'Three',
      'Unstamped',
    ]);
  });
});

describe('getExportIndex: uuids', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
    world.addActor({ id: id16('a1'), name: 'One', type: 'npc', ...stats(100) });
    world.addActor({ id: id16('a2'), name: 'Two', type: 'npc', ...stats(200) });
    world.addActor({ id: id16('v1'), name: 'Cart', type: 'vehicle' });
    world.addScene({ id: id16('s1'), name: 'Gates', ...stats(300) });
    world.addItem({ id: id16('i1'), name: 'Fireball', type: 'spell' });
  });

  const names = (data: object): string[] => rows(data).map(e => e.name);

  it('fetches exactly the named documents, in the fixed order, ignoring the since filter', () => {
    const uuids = [`Scene.${id16('s1')}`, `Actor.${id16('a1')}`];
    expect(names({ uuids })).toEqual(['One', 'Gates']);
    expect(names({ uuids, sinceModifiedTime: t(9999) })).toEqual(['One', 'Gates']);
  });

  it('an empty list returns nothing, and a value that is not a list is ignored', () => {
    expect(names({ uuids: [] })).toEqual([]);
    expect(names({ uuids: `Actor.${id16('a1')}` }).length).toBe(3);
  });

  it('skips unknown, malformed and non-exportable uuids and lists each document once', () => {
    const uuids = [
      `Actor.${id16('a2')}`,
      `Actor.${id16('a2')}`,
      `Actor.${id16('zz')}`,
      `Actor.${id16('v1')}`,
      `Item.${id16('i1')}`,
      `Actor.${id16('a2')}.Item.${id16('it')}`,
      `Compendium.dnd5e.monsters.Actor.${id16('a2')}`,
      'Actor',
      42,
      null,
      `Actor.${id16('a2')}\n`,
    ];
    expect(names({ uuids })).toEqual(['Two']);
  });

  it('still applies the kinds filter and the folder exclusion', () => {
    const folder = addFolder('Hidden');
    world.addActor({ id: id16('a3'), name: 'Filed', type: 'npc', folder });
    const uuids = [`Actor.${id16('a1')}`, `Scene.${id16('s1')}`, `Actor.${id16('a3')}`];
    expect(names({ uuids, kinds: ['scene'] })).toEqual(['Gates']);
    expect(names({ uuids, excludeFolderIds: [folder.id] })).toEqual(['One', 'Gates']);
  });

  it('takes at most 500 uuids', () => {
    const uuids: string[] = [];
    for (let index = 0; index < 505; index += 1) {
      const id = id16(`b${String(index).padStart(4, '0')}`);
      world.addActor({ id, name: `Bulk ${index}`, type: 'npc' });
      uuids.push(`Actor.${id}`);
    }
    const response = ok({ uuids, limit: 500 });
    expect(response.entries.length).toBe(EXPORT_INDEX_LIMITS.uuidsPerRequest);
    expect(response.next).toBeNull();
  });
});

describe('getExportIndex: idsOnly', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
    world.addActor({ id: id16('a1'), name: 'One', type: 'npc', ...stats(100) });
    world.addScene({ id: id16('s1'), name: 'Gates', ...stats(300) });
    world.addJournal({ id: JOURNAL_ID, name: 'Notes' });
    world.addItem({ id: id16('i1'), name: 'Rope', type: 'loot', ...stats(50) });
  });

  it('returns reconciliation rows with only uuid, kind, sig and modified', () => {
    const response = ok({ idsOnly: true });
    expect(response.entries).toEqual([
      { uuid: `Actor.${id16('a1')}`, kind: 'actor', sig: expect.any(String), modified: t(100) },
      { uuid: `Scene.${id16('s1')}`, kind: 'scene', sig: expect.any(String), modified: t(300) },
      {
        uuid: `JournalEntry.${JOURNAL_ID}`,
        kind: 'journal',
        sig: expect.any(String),
        modified: null,
      },
      { uuid: `Item.${id16('i1')}`, kind: 'item', sig: expect.any(String), modified: t(50) },
    ]);
    for (const entry of idRows())
      expect(Object.keys(entry).sort()).toEqual(['kind', 'modified', 'sig', 'uuid']);
  });

  it('the signature equals the one of the full entry', () => {
    const full = ok({}).entries as ExportEntry[];
    const ids = idRows();
    expect(ids.map(e => e.sig)).toEqual(full.map(e => e.sig));
    expect(ids.map(e => e.modified)).toEqual(full.map(e => e.modified));
  });

  it('ignores sinceModifiedTime: it lists every document', () => {
    expect(idRows({ sinceModifiedTime: t(9999) }).length).toBe(4);
  });

  it('still honours kinds, uuids and the folder exclusion', () => {
    expect(idRows({ kinds: ['scene'] }).map(e => e.kind)).toEqual(['scene']);
    expect(idRows({ uuids: [`Item.${id16('i1')}`] }).map(e => e.kind)).toEqual(['item']);
    const folder = addFolder('Hidden');
    world.addItem({ id: id16('i2'), name: 'Filed', type: 'loot', folder });
    expect(idRows({ kinds: ['item'], excludeFolderIds: [folder.id] }).length).toBe(1);
  });

  it('never carries page text, even for an opted-in journal', () => {
    world.addJournal({
      id: JOURNAL_ID,
      name: 'Notes',
      pages: [page(id16('pg01'), { text: { content: 'CANARY_IDS_TEXT' } })],
    });
    const response = ok({
      idsOnly: true,
      includeText: { folderIds: [], journalIds: [JOURNAL_ID] },
    });
    expect(JSON.stringify(response)).not.toContain('CANARY_IDS_TEXT');
  });
});

// ---------------------------------------------------------------------------
// Paging, budgets and caps
// ---------------------------------------------------------------------------

function bulk(kind: 'actor' | 'scene' | 'journal' | 'item', count: number): void {
  const letter = { actor: 'a', scene: 's', journal: 'j', item: 'i' }[kind];
  for (let n = 0; n < count; n += 1) {
    const id = id16(`${letter}${String(n).padStart(5, '0')}`);
    if (kind === 'actor') world.addActor({ id, name: `A${n}`, type: 'npc' });
    if (kind === 'scene') world.addScene({ id, name: `S${n}` });
    if (kind === 'journal') world.addJournal({ id, name: `J${n}` });
    if (kind === 'item') world.addItem({ id, name: `I${n}`, type: 'loot' });
  }
}

/** Every page of a walk through the index, following `next`. */
function walk(data: object): ExportIndexResponse[] {
  const pages: ExportIndexResponse[] = [];
  let after: string | null = null;
  do {
    const page: ExportIndexResponse = ok({ ...data, ...(after ? { after } : {}) });
    pages.push(page);
    after = page.next;
  } while (after && pages.length < 50);
  return pages;
}

const rank = { actor: 0, scene: 1, journal: 2, item: 3 } as const;
const rankOf = (e: ExportEntry | ExportIdEntry): number =>
  rank['kind' in e ? e.kind : 'actor'] as number;
const idOf = (e: ExportEntry | ExportIdEntry): string =>
  'id' in e ? e.id : (e.uuid.split('.').pop() ?? '');

describe('getExportIndex: cursor paging', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
    world.addActor({ id: id16('a2'), name: 'A2', type: 'npc' });
    world.addActor({ id: id16('a1'), name: 'A1', type: 'npc' });
    world.addScene({ id: id16('s2'), name: 'S2' });
    world.addScene({ id: id16('s1'), name: 'S1' });
    world.addJournal({ id: id16('j2'), name: 'J2' });
    world.addJournal({ id: id16('j1'), name: 'J1' });
    world.addItem({ id: id16('i2'), name: 'I2', type: 'loot' });
    world.addItem({ id: id16('i1'), name: 'I1', type: 'loot' });
  });

  it('walks kind by kind and id by id, with next naming the last entry returned', () => {
    const pages = walk({ limit: 3 });
    expect(pages.map(p => p.entries.map(e => (e as ExportEntry).name))).toEqual([
      ['A1', 'A2', 'S1'],
      ['S2', 'J1', 'J2'],
      ['I1', 'I2'],
    ]);
    expect(pages.map(p => p.next)).toEqual([`scene:${id16('s1')}`, `journal:${id16('j2')}`, null]);
  });

  it('next is null when the last page is exactly full', () => {
    expect(ok({ limit: 8 }).next).toBeNull();
    expect(ok({ limit: 7 }).next).toBe(`item:${id16('i1')}`);
  });

  it('the order is strictly increasing by kind, then id, with no duplicates, in both modes', () => {
    for (const mode of [{}, { idsOnly: true }]) {
      const all = walk({ limit: 2, ...mode }).flatMap(
        p => p.entries as Array<ExportEntry | ExportIdEntry>
      );
      expect(all.length).toBe(8);
      const keys = all.map(e => `${rankOf(e)}:${idOf(e)}`);
      expect(new Set(keys).size).toBe(8);
      expect([...keys].sort()).toEqual(keys);
    }
  });

  it('a cursor starts after a document that no longer exists', () => {
    const first = ok({ limit: 3 });
    expect(first.next).toBe(`scene:${id16('s1')}`);
    void world.scenes.get(id16('s1'))?.delete();
    const second = ok({ limit: 3, after: first.next });
    expect((second.entries as ExportEntry[]).map(e => e.name)).toEqual(['S2', 'J1', 'J2']);
  });

  it('a document added behind the cursor is skipped and one added ahead of it is returned', () => {
    const first = ok({ limit: 3 });
    world.addActor({ id: id16('a0'), name: 'Behind', type: 'npc' });
    world.addScene({ id: id16('s3'), name: 'Ahead' });
    const names = walk({ limit: 50, after: first.next }).flatMap(p =>
      (p.entries as ExportEntry[]).map(e => e.name)
    );
    expect(names).toEqual(['S2', 'Ahead', 'J1', 'J2', 'I1', 'I2']);
  });

  it('a cursor names a kind and an id, in any position of the kind order', () => {
    const names = (after: string): string[] =>
      (ok({ after }).entries as ExportEntry[]).map(e => e.name);
    expect(names(`journal:${'0'.repeat(16)}`)).toEqual(['J1', 'J2', 'I1', 'I2']);
    expect(names(`actor:${id16('a2')}`)).toEqual(['S1', 'S2', 'J1', 'J2', 'I1', 'I2']);
    expect(names(`item:${id16('i2')}`)).toEqual([]);
  });
});

describe('getExportIndex: limit', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('clamps to at least one and floors a fraction', () => {
    bulk('actor', 5);
    expect(ok({ limit: 0 }).entries.length).toBe(1);
    expect(ok({ limit: -3 }).entries.length).toBe(1);
    expect(ok({ limit: 2.7 }).entries.length).toBe(2);
  });

  it('a limit that is not a number means the default of 200', () => {
    bulk('actor', 205);
    expect(ok({}).entries.length).toBe(200);
    expect(ok({ limit: 'many' }).entries.length).toBe(200);
    expect(ok({ limit: null }).entries.length).toBe(200);
  });

  it('never returns more than 500 entries a page', () => {
    bulk('actor', 520);
    const response = ok({ limit: 5000 });
    expect(response.entries.length).toBe(EXPORT_INDEX_LIMITS.pageMax);
    expect(response.next).not.toBeNull();
  });

  it('idsOnly defaults to 5000 a page and allows more when asked', () => {
    bulk('actor', 4500);
    bulk('journal', 600);
    const first = ok({ idsOnly: true });
    expect(first.entries.length).toBe(EXPORT_INDEX_LIMITS.idsPageDefault);
    expect(first.next).not.toBeNull();
    const all = ok({ idsOnly: true, limit: 50_000 });
    expect(all.entries.length).toBe(5100);
    expect(all.next).toBeNull();
  });
});

describe('getExportIndex: response budgets', () => {
  const textPages = (count: number, size: number): Doc[] =>
    Array.from({ length: count }, (_, index) =>
      page(id16(`pg0${index}`), { sort: index, text: { content: 'c'.repeat(size) } })
    );
  const optIn = (...ids: string[]): object => ({
    kinds: ['journal'],
    includeText: { folderIds: [], journalIds: ids },
  });

  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('splits a response at 512 KB: two large journals arrive one to a page', () => {
    world.addJournal({ id: id16('j1'), name: 'One', pages: textPages(1, 400_000) });
    world.addJournal({ id: id16('j2'), name: 'Two', pages: textPages(1, 400_000) });
    const pages = walk(optIn(id16('j1'), id16('j2')));
    expect(pages.map(p => p.entries.length)).toEqual([1, 1]);
    expect(pages[0]?.next).toBe(`journal:${id16('j1')}`);
    expect(pages[1]?.next).toBeNull();
    expect(pages.flatMap(p => (p.entries as ExportEntry[]).map(e => e.name))).toEqual([
      'One',
      'Two',
    ]);
  });

  it('a journal larger than the budget is still returned, alone and whole', () => {
    world.addJournal({ id: id16('j1'), name: 'Big', pages: textPages(3, 400_000) });
    world.addJournal({ id: id16('j2'), name: 'After' });
    const first = ok(optIn(id16('j1')));
    expect(first.entries.length).toBe(1);
    expect(first.next).toBe(`journal:${id16('j1')}`);
    const entry = journalRow(first, id16('j1'));
    expect(entry.pages.every(p => p.text?.truncated === false)).toBe(true);
    expect(JSON.stringify(first).length).toBeGreaterThan(EXPORT_INDEX_LIMITS.responseBudgetBytes);
  });

  it('small entries share a page up to the budget', () => {
    world.addJournal({ id: id16('j1'), name: 'One', pages: textPages(1, 100_000) });
    world.addJournal({ id: id16('j2'), name: 'Two', pages: textPages(1, 100_000) });
    world.addJournal({ id: id16('j3'), name: 'Three', pages: textPages(1, 100_000) });
    const response = ok(optIn(id16('j1'), id16('j2'), id16('j3')));
    expect(response.entries.length).toBe(3);
    expect(response.next).toBeNull();
  });

  it('a journal over 2.5 MB is rebuilt without text: every text page is omitted for budget', () => {
    // 1000 pages whose names escape to 6 bytes a character, plus 2 MB of text.
    const pages = Array.from({ length: 1000 }, (_, index) =>
      page(id16(`pg${String(index).padStart(4, '0')}`), {
        sort: index,
        name: '\u0001'.repeat(200),
        text: { content: index < 5 ? 'd'.repeat(500_000) : '' },
      })
    );
    world.addJournal({ id: id16('j1'), name: 'Huge', pages });
    const control = journalRow(ok({ kinds: ['journal'] }), id16('j1'));
    expect(control.pages.length).toBe(1000);

    const response = ok(optIn(id16('j1')));
    const entry = journalRow(response, id16('j1'));
    expect(entry.textIncluded).toBe(true);
    expect(entry.pages.length).toBe(1000);
    expect(entry.pages.every(p => p.text === null && p.textOmitted === 'budget')).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(entry), 'utf8')).toBeLessThan(
      EXPORT_INDEX_LIMITS.responseHardCapBytes
    );
  });

  it('a journal just under 2.5 MB keeps its text', () => {
    world.addJournal({ id: id16('j1'), name: 'Fits', pages: textPages(4, 500_000) });
    const entry = journalRow(ok(optIn(id16('j1'))), id16('j1'));
    expect(entry.pages.every(p => p.text?.content.length === 500_000)).toBe(true);
    expect(Buffer.byteLength(JSON.stringify(entry), 'utf8')).toBeLessThan(
      EXPORT_INDEX_LIMITS.responseHardCapBytes
    );
  });
});

describe('getExportIndex: world caps', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it.each([
    ['actor', 5000],
    ['scene', 1000],
    ['journal', 3000],
    ['item', 5000],
  ] as const)('%s: one past the cap of %i is reported in truncated and dropped', (kind, cap) => {
    bulk(kind, cap + 1);
    const response = ok({ kinds: [kind], idsOnly: true, limit: 10_000 });
    expect(response.truncated).toEqual([{ kind, total: cap + 1, cap }]);
    expect(response.entries.length).toBeLessThanOrEqual(cap);
    const highest = id16(`${kind[0]}${String(cap).padStart(5, '0')}`);
    const uuids = (response.entries as ExportIdEntry[]).map(e => e.uuid);
    expect(uuids.some(uuid => uuid.endsWith(highest))).toBe(false);
  });

  it('a world exactly at the cap reports nothing', () => {
    bulk('scene', 1000);
    expect(ok({ kinds: ['scene'], idsOnly: true, limit: 10_000 }).truncated).toEqual([]);
  });

  it('a cap applies after the folder exclusion and only to the kinds asked for', () => {
    const folder = addFolder('Old');
    for (let n = 0; n < 5; n += 1) {
      world.addActor({ id: id16(`x${n}`), name: `X${n}`, type: 'npc', folder });
    }
    bulk('scene', 1001);
    expect(ok({ kinds: ['actor'], excludeFolderIds: [folder.id] }).truncated).toEqual([]);
    expect(ok({ kinds: ['scene'], idsOnly: true }).truncated).toEqual([
      { kind: 'scene', total: 1001, cap: 1000 },
    ]);
  });
});

describe('getExportIndex: name clipping', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it('clips names to 200 characters and never splits a surrogate pair', () => {
    const emoji = '\u{1F600}';
    world.addActor({ id: id16('a1'), name: 'x'.repeat(250), type: 'npc' });
    world.addActor({ id: id16('a2'), name: `${'a'.repeat(199)}${emoji}tail`, type: 'npc' });
    world.addActor({ id: id16('a3'), name: 'y'.repeat(200), type: 'npc' });
    world.addActor({ id: id16('a4'), name: `${'b'.repeat(198)}${emoji}`, type: 'npc' });
    const response = ok({ kinds: ['actor'] });
    expect(actorRow(response, id16('a1')).name.length).toBe(200);
    const split = actorRow(response, id16('a2')).name;
    expect(split.length).toBe(199);
    expect(/[\uD800-\uDBFF]$/.test(split)).toBe(false);
    expect(actorRow(response, id16('a3')).name.length).toBe(200);
    expect(actorRow(response, id16('a4')).name).toBe(`${'b'.repeat(198)}${emoji}`);
  });

  it('clips folder path segments, page names and category names as well', () => {
    useV14Journals();
    const folder = addFolder('F'.repeat(300));
    world.addJournal({
      id: JOURNAL_ID,
      name: 'J',
      folder,
      categories: new MockCollection([{ id: id16('cat1'), name: 'C'.repeat(300), sort: 1 }]),
      pages: [page(id16('pg01'), { name: 'P'.repeat(300) })],
    });
    const entry = journalRow(ok({ kinds: ['journal'] }), JOURNAL_ID);
    expect(entry.folder?.path[0]?.length).toBe(200);
    expect(entry.categories[0]?.name.length).toBe(200);
    expect(entry.pages[0]?.name.length).toBe(200);
  });
});

// ---------------------------------------------------------------------------
// Signatures
// ---------------------------------------------------------------------------

const HERO_ID = id16('hero');
const SCENE_ID = id16('scene');

interface SigWorld {
  alice: Doc;
  hero: Doc;
  scene: Doc;
  journal: Doc;
  item: Doc;
}

type SigKind = 'hero' | 'scene' | 'journal' | 'item';

describe('getExportIndex: sig', () => {
  let fx: SigWorld;

  /** One document of every kind, with a player who owns the hero. */
  beforeEach(() => {
    const alice = addPlayer('p1', 'Alice');
    const hero = addHero();
    const scene = addScene({
      notes: [
        makeNote({ id: id16('n1'), text: 'Church' }),
        makeNote({ id: id16('n2'), text: 'Inn' }),
      ],
      tokens: [makeToken({ id: id16('t1'), name: 'Wolf', x: 100 })],
    });
    const journal = addJournal();
    const item = addWorldItem();
    fx = { alice, hero, scene, journal, item };
  });

  const sigs = (data?: unknown): Record<SigKind, string> => ({
    hero: sigOf(HERO_ID, data),
    scene: sigOf(SCENE_ID, data),
    journal: sigOf(JOURNAL_ID, data),
    item: sigOf(ITEM_ID, data),
  });

  const journalPage = (id: string): Doc => {
    const found = (fx.journal.pages as MockCollection<Doc>).get(id);
    if (!found) throw new Error(`no page ${id}`);
    return found;
  };

  it('is a short base36 string, stable across calls, and the same in every mode', () => {
    const full = sigs();
    for (const value of Object.values(full)) expect(value).toMatch(/^[0-9a-z]{1,11}$/);
    expect(sigs()).toEqual(full);
    expect(sigs({ idsOnly: true })).toEqual(full);
    expect(
      sigs({
        uuids: [
          `Actor.${HERO_ID}`,
          `Scene.${SCENE_ID}`,
          `JournalEntry.${JOURNAL_ID}`,
          `Item.${ITEM_ID}`,
        ],
      })
    ).toEqual(full);
    expect(new Set(Object.values(full)).size).toBe(4);
  });

  const optIn = { includeText: { folderIds: [], journalIds: [JOURNAL_ID] } };

  it('a journal signature follows the opt-in state, not the text', () => {
    const plain = sigOf(JOURNAL_ID);
    const opted = sigOf(JOURNAL_ID, optIn);
    expect(opted).not.toBe(plain);
    expect(sigOf(JOURNAL_ID, { idsOnly: true, ...optIn })).toBe(opted);
    journalPage(id16('pg01')).text = { content: 'A whole new chapter' };
    expect(sigOf(JOURNAL_ID, optIn)).toBe(opted);
  });

  it('the modified time is not part of the signature', () => {
    const before = sigs();
    const modifiedBefore = modifiedOf(HERO_ID);
    fx.hero._stats = { createdTime: t(100), modifiedTime: t(9000) };
    expect(modifiedOf(HERO_ID)).not.toBe(modifiedBefore);
    expect(sigs()).toEqual(before);
  });

  it('the created time is', () => {
    const before = sigs().hero;
    fx.hero._stats = { createdTime: t(1), modifiedTime: t(200) };
    expect(sigOf(HERO_ID)).not.toBe(before);
  });

  type Change = (w: SigWorld) => void;
  const changing = (label: string, kind: SigKind, fn: Change): [string, SigKind, Change] => [
    label,
    kind,
    fn,
  ];
  const quiet = (label: string, fn: Change): [string, Change] => [label, fn];

  const changes = [
    changing('an actor is renamed', 'hero', w => void (w.hero.name = 'Silvera the Bold')),
    changing('an actor max HP changes', 'hero', w => void (w.hero.system.attributes.hp.max = 40)),
    changing('an actor AC changes', 'hero', w => void (w.hero.system.attributes.ac.value = 20)),
    changing('an actor ownership changes', 'hero', w => void (w.hero.ownership = { p1: 2 })),
    changing('a portrait changes', 'hero', w => void (w.hero.img = 'portraits/new.webp')),
    changing(
      'a scene map changes',
      'scene',
      w => void (w.scene.background = { src: 'maps/new.webp' })
    ),
    changing(
      'an actor moves into a folder',
      'hero',
      w => void (w.hero.folder = addFolder('Party'))
    ),
    changing(
      'an actor gains an item',
      'hero',
      w =>
        void w.hero.items.add(
          makeItem({ id: id16('cloak'), name: 'Cloak of Protection', type: 'equipment' })
        )
    ),
    changing('the player who owns an actor is banned', 'hero', w => void (w.alice.role = 0)),
    changing('a pin is deleted', 'scene', w => void w.scene.notes.delete(id16('n2'))),
    changing(
      'a token arrives',
      'scene',
      w => void w.scene.tokens.add(makeToken({ id: id16('t2'), name: 'Bat', x: 5 }))
    ),
    changing(
      'a token is hidden',
      'scene',
      w => void (w.scene.tokens.get(id16('t1')).hidden = true)
    ),
    changing(
      'a token is renamed',
      'scene',
      w => void (w.scene.tokens.get(id16('t1')).name = 'Dire Wolf')
    ),
    changing('a token leaves', 'scene', w => void w.scene.tokens.delete(id16('t1'))),
    changing(
      'a pin is relabelled',
      'scene',
      w => void (w.scene.notes.get(id16('n1')).text = 'Cathedral')
    ),
    changing('a scene leaves the navigation bar', 'scene', w => void (w.scene.navigation = false)),
    changing('a scene ownership changes', 'scene', w => void (w.scene.ownership = { default: 0 })),
    changing('a page is deleted', 'journal', w => void w.journal.pages.delete(id16('pg01'))),
    changing(
      'a page is added',
      'journal',
      w => void w.journal.pages.add(page(id16('pg03'), { name: 'Third', sort: 300 }))
    ),
    changing(
      'a page is renamed',
      'journal',
      w => void (w.journal.pages.get(id16('pg01')).name = 'Renamed')
    ),
    changing(
      'a page modified time moves',
      'journal',
      w => void (w.journal.pages.get(id16('pg01'))._stats = { modifiedTime: t(999) })
    ),
    changing(
      'a page gets its own ownership',
      'journal',
      w => void (w.journal.pages.get(id16('pg01')).ownership = { default: 0 })
    ),
    changing(
      'a journal ownership changes',
      'journal',
      w => void (w.journal.ownership = { default: 0 })
    ),
    changing('every player is banned', 'journal', w => void (w.alice.role = 0)),
    changing('an item rarity changes', 'item', w => void (w.item.system.rarity = 'legendary')),
    changing('an item is unidentified', 'item', w => void (w.item.system.identified = false)),
    changing('an item ownership changes', 'item', w => void (w.item.ownership = { default: 2 })),
    changing(
      'an actor starts to carry an item',
      'item',
      () =>
        void addCarrier('carry', 'Carrier', [
          embedded('Sunblade', { _stats: { duplicateSource: `Item.${ITEM_ID}` } }),
        ])
    ),
  ];

  it.each(changes)('changes when %s', (_label, kind, change) => {
    const before = sigs();
    change(fx);
    expect(sigs()[kind]).not.toBe(before[kind]);
  });

  const noise = [
    quiet('current and temporary HP change', w => {
      w.hero.system.attributes.hp.value = 1;
      w.hero.system.attributes.hp.temp = 12;
    }),
    quiet(
      'a biography is written',
      w => void (w.hero.system.details.biography = { value: '<p>Secret</p>' })
    ),
    quiet(
      'an effect is added to an actor',
      w => void w.hero.effects.add(makeEffect({ id: id16('eff'), name: 'Blessed' }))
    ),
    quiet('actor flags change', w => void (w.hero.flags = { other: { counter: 3 } })),
    quiet(
      'an embedded item description is edited',
      w => void ((w.hero.items.contents[0] as Doc).system.description = { value: 'Edited' })
    ),
    quiet(
      'token art changes',
      w => void (w.hero.prototypeToken.texture = { src: 'tokens/new.webp' })
    ),
    quiet('a token moves, turns and changes art', w => {
      const token = w.scene.tokens.get(id16('t1'));
      token.x = 900;
      token.y = 450;
      token.rotation = 90;
      token.texture = { src: 'tokens/other.webp' };
    }),
    quiet('a wall is drawn', w => void w.scene.walls.add({ id: id16('w1'), c: [0, 0, 100, 100] })),
    quiet('scene flags change', w => void (w.scene.flags = { other: { note: 'x' } })),
    quiet(
      'page text is edited',
      w => void (w.journal.pages.get(id16('pg01')).text = { content: 'Changed' })
    ),
    quiet('journal flags change', w => void (w.journal.flags = { other: { a: 1 } })),
    quiet(
      'an item description and price change',
      w => void (w.item.system = { ...w.item.system, description: { value: 'Hum' }, price: 50 })
    ),
    quiet('the item flags change', w => void (w.item.flags = { other: { seen: true } })),
  ];

  it.each(noise)('does not change when %s', (_label, change) => {
    const before = sigs();
    change(fx);
    expect(sigs()).toEqual(before);
  });

  it('a role change that leaves the access alone does not move the signature', () => {
    const before = sigs();
    fx.alice.role = 2;
    expect(sigs()).toEqual(before);
  });
});

// ---------------------------------------------------------------------------
// excludeFolderIds
// ---------------------------------------------------------------------------

describe('getExportIndex: excludeFolderIds', () => {
  let secret: Doc;
  let deep: Doc;
  let open: Doc;

  beforeEach(() => {
    addPlayer('p1', 'Alice');
    secret = addFolder('Secret', undefined, 9500);
    deep = addFolder('Deep', secret);
    open = addFolder('Open');
    world.addActor({ id: id16('a1'), name: 'Filed in secret', type: 'npc', folder: secret });
    world.addActor({ id: id16('a2'), name: 'Filed deep', type: 'npc', folder: deep });
    world.addActor({
      id: id16('a3'),
      name: 'Filed open',
      type: 'npc',
      folder: open,
      ...stats(300),
    });
    world.addActor({ id: id16('a4'), name: 'Unfiled', type: 'npc', ...stats(200) });
    world.addScene({ id: id16('s1'), name: 'Deep scene', folder: deep });
    world.addScene({ id: id16('s2'), name: 'Open scene', folder: open });
    world.addJournal({ id: id16('j1'), name: 'Secret journal', folder: secret });
    world.addJournal({ id: id16('j2'), name: 'Open journal' });
    world.addItem({ id: id16('i1'), name: 'Deep item', type: 'loot', folder: deep });
    world.addItem({ id: id16('i2'), name: 'Open item', type: 'loot', folder: open });
  });

  const names = (data: object): string[] => rows(data).map(e => e.name);

  it('leaves out every kind in the folder and in its subfolders', () => {
    expect(names({ excludeFolderIds: [secret.id] })).toEqual([
      'Filed open',
      'Unfiled',
      'Open scene',
      'Open journal',
      'Open item',
    ]);
  });

  it('excluding a subfolder leaves the parent folder alone', () => {
    expect(names({ excludeFolderIds: [deep.id] })).toContain('Filed in secret');
    expect(names({ excludeFolderIds: [deep.id] })).not.toContain('Filed deep');
    expect(names({ excludeFolderIds: [deep.id] })).toContain('Secret journal');
  });

  it('applies to the ids listing and to the paged walk as well', () => {
    const listed = idRows({ excludeFolderIds: [secret.id, open.id] });
    expect(listed.map(e => e.uuid)).toEqual([`Actor.${id16('a4')}`, `JournalEntry.${id16('j2')}`]);
    const walked = walk({ limit: 1, excludeFolderIds: [secret.id, open.id] }).flatMap(
      p => p.entries as ExportEntry[]
    );
    expect(walked.map(e => e.name)).toEqual(['Unfiled', 'Open journal']);
  });

  it('keeps an excluded document out of the watermark, and its folder time too', () => {
    world.addActor({ id: id16('a5'), name: 'Late', type: 'npc', folder: deep, ...stats(8000) });
    expect(ok({}).watermark).toBe(t(9500));
    expect(ok({ excludeFolderIds: [secret.id] }).watermark).toBe(t(300));
  });

  it('ignores ids that name no folder, and a value that is not a list', () => {
    expect(rows({ excludeFolderIds: [id16('nope'), 7, null] }).length).toBe(10);
    expect(rows({ excludeFolderIds: secret.id }).length).toBe(10);
    expect(rows({ excludeFolderIds: [] }).length).toBe(10);
  });

  it('page text stays out of an excluded folder even when its journal was named', () => {
    const response = ok({
      excludeFolderIds: [secret.id],
      includeText: { folderIds: [], journalIds: [id16('j1'), id16('j2')] },
    });
    const ids = (response.entries as ExportEntry[]).map(e => e.id);
    expect(ids).not.toContain(id16('j1'));
    expect(ids).toContain(id16('j2'));
  });
});

// ---------------------------------------------------------------------------
// Foundry 13/14 and dnd5e 5.x/6.x shapes
// ---------------------------------------------------------------------------

describe('getExportIndex: version shapes', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  it.each([
    [
      'dnd5e 5.x (string rarity)',
      { rarity: 'veryRare', attunement: 'required', properties: new Set(['mgc', 'fin']) },
    ],
    [
      'dnd5e 6.x (rarities set behind a getter)',
      dnd5e6System(['veryRare'], {
        attunement: 'required',
        properties: new Set(['mgc', 'fin']),
      }),
    ],
  ])('an item exports the same story fields under %s', (_label, system) => {
    addWorldItem({ system });
    expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID)).toMatchObject({
      rarity: 'veryRare',
      attunement: 'required',
      magical: true,
      identified: true,
    });
  });

  it.each([
    ['Foundry 13 (no categories)', false],
    ['Foundry 14 (categories)', true],
  ])('a journal keeps its pages and text under %s', (_label, v14) => {
    if (v14) useV14Journals();
    addJournal({
      categories: new MockCollection([{ id: id16('cat1'), name: 'Places', sort: 1 }]),
      pages: [
        page(id16('pg01'), {
          sort: 1,
          name: 'Church',
          category: id16('cat1'),
          text: { content: '<p>Bells</p>' },
        }),
      ],
    });
    const entry = journalRow(
      ok({ kinds: ['journal'], includeText: { folderIds: [], journalIds: [JOURNAL_ID] } }),
      JOURNAL_ID
    );
    expect(entry.pages.map(p => p.name)).toEqual(['Church']);
    expect(entry.pages[0]?.text?.content).toBe('<p>Bells</p>');
    expect(entry.categories.length).toBe(v14 ? 1 : 0);
    expect(entry.pages[0]?.category).toBe(v14 ? id16('cat1') : null);
  });

  it('an unidentified item keeps its stored name on both systems', () => {
    for (const system of [
      { identified: false, rarity: 'rare' },
      dnd5e6System(['rare'], { identified: false }),
    ]) {
      addWorldItem({
        name: 'Old Sword',
        _source: { name: 'Sunblade', system: {} },
        system,
      });
      expect(itemRow(ok({ kinds: ['item'] }), ITEM_ID)).toMatchObject({
        name: 'Sunblade',
        playerName: 'Old Sword',
        identified: false,
      });
    }
  });
});

// ---------------------------------------------------------------------------
// The canary: nothing outside the exported fields may leave the module
// ---------------------------------------------------------------------------

describe('getExportIndex: canary', () => {
  const OPTED_TEXT = 'VISIBLE_OPTED_IN_TEXT';
  const OPTED_JOURNAL = id16('optj');
  const SECRET_JOURNAL = id16('secj');

  /** Plant `CANARY_*` strings in every place the export must never read. */
  function plant(): void {
    addPlayer('p1', 'Alice');
    const other = addPlayer('p2', 'CANARY_OTHER_PLAYER');
    other.avatar = 'CANARY_AVATAR.webp';
    other.character = HERO_ID;
    other.flags = { canary: 'CANARY_USER_FLAG' };

    const folder = addFolder('Party');
    folder.description = 'CANARY_FOLDER_DESCRIPTION';
    folder.flags = { canary: 'CANARY_FOLDER_FLAG' };

    const hero = addHero({
      folder,
      img: 'portraits/silvera.webp',
      flags: { canary: { note: 'CANARY_ACTOR_FLAG' } },
      effects: [
        makeEffect({ id: id16('eff'), name: 'CANARY_EFFECT', statuses: ['CANARY_STATUS'] }),
      ],
      system: {
        attributes: { hp: { value: 31415, max: 31, temp: 27182 }, ac: { value: 18 } },
        traits: { size: 'med' },
        details: {
          level: 5,
          alignment: 'Chaotic Good',
          biography: { value: 'CANARY_BIOGRAPHY', public: 'CANARY_PUBLIC_BIO' },
          appearance: 'CANARY_APPEARANCE',
          trait: 'CANARY_TRAIT',
          ideal: 'CANARY_IDEAL',
          bond: 'CANARY_BOND',
          flaw: 'CANARY_FLAW',
        },
        currency: { gp: 999_991 },
        conditions: 'CANARY_CONDITION',
      },
      prototypeToken: {
        name: 'Silvera',
        disposition: 1,
        displayName: 50,
        texture: { src: 'CANARY_TOKEN_ART.webp' },
      },
    });
    hero.items.add(
      makeItem({
        id: id16('spell'),
        name: 'Second Wind',
        type: 'feat',
        img: 'CANARY_ITEM_IMG.webp',
        flags: { canary: 'CANARY_ITEM_FLAG' },
        system: {
          description: {
            value: 'CANARY_ITEM_DESCRIPTION',
            unidentified: 'CANARY_UNIDENTIFIED_DESCRIPTION',
            chat: 'CANARY_CHAT_DESCRIPTION',
          },
          activities: { a1: { name: 'Use', description: 'CANARY_ACTION_TEXT' } },
        },
      })
    );
    hero.ownership = { p1: 3, p2: 0 };

    addGoblin({
      flags: { canary: 'CANARY_NPC_FLAG' },
      system: {
        attributes: { hp: { value: 7, max: 21 }, ac: { value: 17 } },
        traits: { size: 'sm' },
        details: {
          alignment: 'neutral evil',
          cr: 1,
          type: { value: 'humanoid', subtype: 'goblinoid' },
          biography: { value: '<p>Goblin lore.</p>' },
        },
        source: { book: 'MM', page: '166', rules: '2014' },
      },
    });

    addScene({
      img: 'CANARY_MAP.webp',
      flags: { canary: 'CANARY_SCENE_FLAG' },
      background: { src: 'maps/vallaki.webp' },
      _source: { background: { src: 'CANARY_SOURCE_BACKGROUND.webp' } },
      description: 'CANARY_SCENE_DESCRIPTION',
      tokens: [
        makeToken({
          id: id16('t1'),
          name: 'Wolf',
          x: 424242,
          texture: { src: 'CANARY_TOKEN_TEXTURE.webp' },
        }),
      ],
      walls: [{ id: id16('w1'), c: [424243, 0, 1, 1], flags: { canary: 'CANARY_WALL_FLAG' } }],
      lights: [{ id: id16('l1'), config: { color: 'CANARY_LIGHT' } }],
      sounds: [{ id: id16('so1'), path: 'CANARY_SOUND.ogg' }],
      notes: [
        makeNote({
          id: id16('n1'),
          text: 'Church',
          x: 424244,
          flags: { canary: 'CANARY_NOTE_FLAG' },
          texture: { src: 'CANARY_NOTE_ICON.webp' },
        }),
      ],
    });

    addJournal({
      id: SECRET_JOURNAL,
      name: 'Secrets',
      flags: { canary: 'CANARY_JOURNAL_FLAG' },
      pages: [
        page(id16('pgh'), {
          name: 'Html page',
          sort: 1,
          text: { content: '<p>CANARY_PAGE_HTML</p>', markdown: 'CANARY_PAGE_MARKDOWN', format: 1 },
          flags: { canary: 'CANARY_PAGE_FLAG' },
        }),
        page(id16('pgm'), {
          name: 'Markdown page',
          sort: 2,
          text: { markdown: 'CANARY_PAGE_MD_ONLY', content: '', format: 2 },
        }),
        page(id16('pgi'), {
          name: 'Image page',
          sort: 3,
          type: 'image',
          src: 'CANARY_PAGE_SRC.webp',
          image: { caption: 'CANARY_CAPTION' },
        }),
      ],
    });
    addJournal({
      id: OPTED_JOURNAL,
      name: 'Opted in',
      pages: [page(id16('pgo'), { name: 'Chapter', text: { content: OPTED_TEXT } })],
    });

    addWorldItem({
      img: 'CANARY_SWORD_IMG.webp',
      flags: { canary: 'CANARY_WORLD_ITEM_FLAG' },
      system: {
        identified: true,
        rarity: 'rare',
        properties: new Set(['mgc']),
        description: { value: 'CANARY_SWORD_DESCRIPTION', unidentified: 'CANARY_SWORD_UNKNOWN' },
        price: { value: 424245 },
      },
    });

    world.addMessage({
      id: id16('msg'),
      content: 'CANARY_CHAT_MESSAGE',
      whisper: ['p1'],
      flags: { canary: 'CANARY_MESSAGE_FLAG' },
    });
    world.setCombat({
      turns: [makeCombatant({ id: id16('cb1'), name: 'CANARY_COMBATANT', initiative: 424246 })],
    });
    world.setSetting('foundry-mcp-bridge', 'apiKey', 'CANARY_SETTING');
    world.setSetting('some-module', 'secret', 'CANARY_OTHER_SETTING');
    world.addPack({
      id: 'world.canary',
      label: 'CANARY_PACK',
      documents: [makeItem({ id: id16('pk1'), name: 'CANARY_PACK_ITEM' })],
    });
    world.playlists.add({ id: id16('pl1'), name: 'CANARY_PLAYLIST' } as never);
  }

  const optIn = { includeText: { folderIds: [], journalIds: [OPTED_JOURNAL] } };

  const requests: Array<[string, object]> = [
    ['a full page', {}],
    ['a full page with one journal opted in', optIn],
    ['a page of the ids listing', { idsOnly: true }],
    ['a walk of one entry a page', { limit: 1 }],
    [
      'a uuids fetch',
      { uuids: [`Actor.${HERO_ID}`, `Scene.${SCENE_ID}`, `JournalEntry.${SECRET_JOURNAL}`] },
    ],
    [
      'a request for every kind and no folder filter',
      { kinds: ['actor', 'scene', 'journal', 'item'] },
    ],
  ];

  it.each(requests)('%s carries none of the planted canary strings', (_label, data) => {
    plant();
    for (const page of walk(data)) {
      const json = JSON.stringify(page);
      expect(json).not.toContain('CANARY');
      expect(json).not.toMatch(/31415|27182|424242|424243|424244|424245|424246|999991/);
      expect(json).not.toContain('"flags"');
    }
  });

  it('the export still carries what it should: names, ids and the opted-in text', () => {
    plant();
    const response = ok(optIn);
    const json = JSON.stringify(response);
    expect(json).toContain(OPTED_TEXT);
    expect(json).toContain('Silvera');
    expect(json).toContain('Church');
    expect(json).toContain('Second Wind');
    expect(json).toContain('Sunblade');
    expect(actorRow(response, HERO_ID).hpMax).toBe(31);
    expect(actorRow(response, HERO_ID).owners).toEqual(['Alice']);
    expect(journalRow(response, SECRET_JOURNAL).textIncluded).toBe(false);
  });

  it('page text of a journal that was not opted in never appears, in any format', () => {
    plant();
    const response = ok({ kinds: ['journal'] });
    const secret = journalRow(response, SECRET_JOURNAL);
    expect(secret.pages.length).toBe(3);
    expect(secret.pages.every(p => !('text' in p) || p.text === null)).toBe(true);
    expect(JSON.stringify(secret)).not.toContain('CANARY');
  });

  it('the canary is not vacuous: the planted strings really are in the world', () => {
    plant();
    const hero = world.actors.get(HERO_ID);
    expect(hero?.system.details.biography.value).toBe('CANARY_BIOGRAPHY');
    expect(hero?.system.attributes.hp.value).toBe(31415);
    expect(hero?.effects.contents[0]?.name).toBe('CANARY_EFFECT');
    expect(world.scenes.get(SCENE_ID)?.tokens.get(id16('t1'))?.texture.src).toBe(
      'CANARY_TOKEN_TEXTURE.webp'
    );
    const html = world.journal.get(SECRET_JOURNAL)?.pages.get(id16('pgh'));
    expect(html?.text.content).toContain('CANARY_PAGE_HTML');
    expect(html?.text.markdown).toContain('CANARY_PAGE_MARKDOWN');
    expect(world.users.get('p2')?.name).toBe('CANARY_OTHER_PLAYER');
    expect(world.messages.get(id16('msg'))?.content).toBe('CANARY_CHAT_MESSAGE');
    expect(world.combats.size + (world.currentCombat ? 1 : 0)).toBeGreaterThan(0);
    expect(world.packs.get('world.canary')).toBeDefined();
    expect(world.playlists.size).toBe(1);
  });

  it('a whole-world export names no user other than the owners of an actor', () => {
    plant();
    const json = JSON.stringify(ok({}));
    expect(json).not.toContain('CANARY_OTHER_PLAYER');
    expect(json).not.toContain('Gamemaster');
  });
});

// ---------------------------------------------------------------------------
// What the Library lane deliberately exports
// ---------------------------------------------------------------------------

describe('getExportIndex: stat block, portrait, map and origin', () => {
  beforeEach(() => {
    addPlayer('p1', 'Alice');
  });

  const scimitar = (): Doc =>
    makeItem({
      id: id16('scim'),
      name: 'Scimitar',
      type: 'weapon',
      system: {
        description: { value: '<p>Slash for 5 damage.</p>' },
        activities: { contents: [{ activation: { type: 'action' } }] },
        properties: new Set<string>(),
      },
    });

  it('sends an NPC its stat block with feature texts and the NPC biography', () => {
    addGoblin({
      items: [scimitar()],
      system: {
        attributes: { hp: { value: 7, max: 21 }, ac: { value: 17 } },
        traits: { size: 'sm' },
        details: {
          alignment: 'neutral evil',
          cr: 1,
          type: { value: 'humanoid', subtype: 'goblinoid' },
          biography: { value: '<p>Goblin lore.</p>' },
        },
        source: { book: 'MM', page: '166', rules: '2014' },
      },
    });
    const block = actorRow(ok({ kinds: ['actor'] }), id16('gob')).statBlock;
    expect(block?.description).toBe('<p>Goblin lore.</p>');
    expect(block?.sections).toEqual([
      {
        key: 'action',
        label: 'Actions',
        intro: null,
        entries: [{ name: 'Scimitar', html: '<p>Slash for 5 damage.</p>' }],
      },
    ]);
  });

  it('never gives a player character a stat block, and its biography never leaves', () => {
    addHero({
      system: {
        attributes: { hp: { value: 5, max: 31 }, ac: { value: 18 } },
        traits: { size: 'med' },
        details: { level: 5, biography: { value: 'PC_BIOGRAPHY_TEXT' } },
      },
    });
    // An npc-type actor that a player owns is a player character too.
    addGoblin({
      id: id16('pcnpc'),
      ownership: { p1: 3 },
      system: {
        attributes: { hp: { max: 9 }, ac: { value: 10 } },
        traits: { size: 'sm' },
        details: {
          cr: 0,
          type: { value: 'humanoid' },
          biography: { value: 'OWNED_NPC_BIOGRAPHY' },
        },
      },
    });
    const response = ok({ kinds: ['actor'] });
    expect(actorRow(response, HERO_ID).statBlock).toBeNull();
    expect(actorRow(response, id16('pcnpc')).statBlock).toBeNull();
    const json = JSON.stringify(response);
    expect(json).not.toContain('PC_BIOGRAPHY_TEXT');
    expect(json).not.toContain('OWNED_NPC_BIOGRAPHY');
  });

  it('an ids page carries no stat block but the same signature as the full entry', () => {
    addGoblin({ items: [scimitar()] });
    const full = ok({ kinds: ['actor'] });
    const ids = ok({ kinds: ['actor'], idsOnly: true });
    expect(actorRow(full, id16('gob')).statBlock).not.toBeNull();
    expect(JSON.stringify(ids)).not.toContain('statBlock');
    expect(sigOf(id16('gob'), { idsOnly: true })).toBe(actorRow(full, id16('gob')).sig);
  });

  it('exports the actor portrait path, and null for a placeholder icon', () => {
    addHero({ img: 'portraits/silvera.webp' });
    addGoblin({ img: 'icons/svg/mystery-man.svg' });
    const response = ok({ kinds: ['actor'] });
    expect(actorRow(response, HERO_ID).img).toBe('portraits/silvera.webp');
    expect(actorRow(response, id16('gob')).img).toBeNull();
  });

  it('exports the scene map path from the background, else from the first level', () => {
    addScene({ background: { src: 'maps/vallaki.webp' } });
    expect(sceneRow(ok({ kinds: ['scene'] }), SCENE_ID).map).toBe('maps/vallaki.webp');
    world.scenes.delete(SCENE_ID);
    addScene({
      background: { src: '' },
      levels: { contents: [{ background: { src: 'https://cdn.example/level.webp' } }] },
    });
    expect(sceneRow(ok({ kinds: ['scene'] }), SCENE_ID).map).toBe('https://cdn.example/level.webp');
    world.scenes.delete(SCENE_ID);
    addScene({ background: { src: 'icons/svg/mystery-man.svg' } });
    expect(sceneRow(ok({ kinds: ['scene'] }), SCENE_ID).map).toBeNull();
  });

  it('refuses image paths that are not plain files', () => {
    addHero({ img: 'javascript:alert(1)' });
    addGoblin({ img: `data:image/png;base64,${'A'.repeat(20)}` });
    const response = ok({ kinds: ['actor'] });
    expect(actorRow(response, HERO_ID).img).toBeNull();
    expect(actorRow(response, id16('gob')).img).toBeNull();
  });

  describe('origin', () => {
    const setLocation = (origin: string | undefined): void => {
      vi.stubGlobal('location', origin === undefined ? undefined : { origin });
    };
    const setRoute = (getRoute: unknown): void => {
      (
        globalThis as unknown as { foundry: { utils: Record<string, unknown> } }
      ).foundry.utils.getRoute = getRoute;
    };
    afterEach(() => {
      vi.unstubAllGlobals();
    });

    it('is the location origin when Foundry has no route prefix', () => {
      setLocation('http://localhost:30001');
      setRoute((path: string) => path);
      expect(ok({}).origin).toBe('http://localhost:30001');
    });

    it('includes the route prefix and has no trailing slash', () => {
      setLocation('https://table.example');
      setRoute(() => '/vtt/');
      expect(ok({}).origin).toBe('https://table.example/vtt');
      setRoute(() => '/a/b/');
      expect(ok({}).origin).toBe('https://table.example/a/b');
    });

    it('falls back to the bare origin when getRoute is missing, throws or answers nonsense', () => {
      setLocation('http://localhost:30001/');
      setRoute(undefined);
      expect(ok({}).origin).toBe('http://localhost:30001');
      setRoute(() => {
        throw new Error('boom');
      });
      expect(ok({}).origin).toBe('http://localhost:30001');
      setRoute(() => 42);
      expect(ok({}).origin).toBe('http://localhost:30001');
    });

    it('is empty without an http location', () => {
      setLocation(undefined);
      expect(ok({}).origin).toBe('');
      setLocation('null');
      expect(ok({}).origin).toBe('');
    });
  });
});

describe('getExportIndex: NPC signature', () => {
  let npc: Doc;
  let biographyReads: number;

  beforeEach(() => {
    addPlayer('p1', 'Alice');
    biographyReads = 0;
    const details: Record<string, unknown> = {
      alignment: 'neutral evil',
      cr: 1,
      type: { value: 'humanoid', subtype: 'goblinoid' },
    };
    Object.defineProperty(details, 'biography', {
      enumerable: true,
      get: () => {
        biographyReads += 1;
        return { value: '<p>Lore.</p>' };
      },
    });
    npc = addGoblin({
      ...stats(200, 100),
      items: [
        makeItem({
          id: id16('scim'),
          name: 'Scimitar',
          type: 'weapon',
          ...stats(150),
          system: {
            description: { value: '<p>Slash.</p>' },
            activities: { contents: [{ activation: { type: 'action' } }] },
            properties: new Set<string>(),
          },
        }),
      ],
      system: {
        attributes: { hp: { value: 21, max: 21 }, ac: { value: 17 } },
        traits: { size: 'sm' },
        details,
        source: { book: 'MM', page: '166', rules: '2014' },
      },
    });
  });

  it('does not build the stat block for an ids page', () => {
    // Creating the mock document read the biography once (it clones its source).
    biographyReads = 0;
    ok({ kinds: ['actor'], idsOnly: true });
    expect(biographyReads).toBe(0);
    ok({ kinds: ['actor'] });
    expect(biographyReads).toBeGreaterThan(0);
  });

  it('stays the same while the actor and its items are unchanged, in every mode', () => {
    const before = sigOf(id16('gob'));
    expect(sigOf(id16('gob'))).toBe(before);
    expect(sigOf(id16('gob'), { idsOnly: true })).toBe(before);
  });

  it('moves when the actor modified time moves', () => {
    const before = sigOf(id16('gob'));
    npc._stats = { createdTime: t(100), modifiedTime: t(900) };
    expect(sigOf(id16('gob'))).not.toBe(before);
  });

  it('moves when an embedded item changes, is added or is deleted', () => {
    const before = sigOf(id16('gob'));
    (npc.items as MockCollection<Doc>).get(id16('scim'))._stats = { modifiedTime: t(800) };
    const edited = sigOf(id16('gob'));
    expect(edited).not.toBe(before);
    (npc.items as MockCollection<Doc>).add(
      makeItem({ id: id16('bow'), name: 'Bow', type: 'weapon', ...stats(300) })
    );
    const added = sigOf(id16('gob'));
    expect(added).not.toBe(edited);
    (npc.items as MockCollection<Doc>).delete(id16('bow'));
    expect(sigOf(id16('gob'))).toBe(edited);
  });

  it('moves when the rules tag changes', () => {
    const before = sigOf(id16('gob'));
    npc.system.source.rules = '2024';
    expect(sigOf(id16('gob'))).not.toBe(before);
  });

  it('hashes the stat block itself when a document has no modified time', () => {
    const bare = world.addActor({
      id: id16('bare'),
      name: 'Bare Goblin',
      type: 'npc',
      system: {
        attributes: { hp: { max: 5 }, ac: { value: 10 } },
        details: { cr: 0, type: { value: 'humanoid' }, biography: { value: '<p>One.</p>' } },
      },
    });
    const before = sigOf(id16('bare'));
    expect(sigOf(id16('bare'), { idsOnly: true })).toBe(before);
    bare.system.details.biography = { value: '<p>Two.</p>' };
    expect(sigOf(id16('bare'))).not.toBe(before);
  });
});
