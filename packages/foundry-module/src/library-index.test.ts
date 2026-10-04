/**
 * Unit tests for the Obsidian Library queries (`library-index.ts`): `getLibraryIndex` and
 * `getLibraryDocuments`. The Foundry globals they read (`game`, `fromUuid`, `fromUuidSync`,
 * `location`, `CONFIG`) are stubbed per test and restored afterwards. All names and texts are
 * made up for these tests.
 */
import { afterEach, describe, expect, it } from 'vitest';
import type { LibraryDocument, LibraryIndexResponse } from '@gnuminator/shared';
import {
  BOOK_TITLES,
  LIBRARY_LIMITS,
  LIBRARY_SCHEMA,
  bookTitleOf,
  getLibraryDocuments,
  getLibraryIndex,
} from './library-index.js';

type Rec = Record<string, unknown>;

// ---------------------------------------------------------------------------
// Global stubs
// ---------------------------------------------------------------------------

const saved = new Map<string, { had: boolean; value: unknown }>();

function setGlobal(key: string, value: unknown): void {
  const g = globalThis as unknown as Rec;
  if (!saved.has(key)) saved.set(key, { had: key in g, value: g[key] });
  g[key] = value;
}

afterEach(() => {
  const g = globalThis as unknown as Rec;
  for (const [key, prior] of saved) {
    if (prior.had) g[key] = prior.value;
    else delete g[key];
  }
  saved.clear();
});

/** A 16-character alphanumeric document id from a number, so ids sort by their number. */
function docId(n: number): string {
  return String(n).padStart(16, '0');
}

interface MockPackOptions {
  documentName?: string;
  label?: string;
  folders?: Record<string, Rec>;
  getIndex?: (options: unknown) => Promise<unknown>;
}

function mockPack(collection: string, entries: Rec[], options: MockPackOptions = {}): Rec {
  const folders = options.folders ?? {};
  return {
    collection,
    documentName: options.documentName ?? 'Actor',
    metadata: {
      label: options.label ?? 'Test Pack',
      packageType: 'world',
      packageName: 'w',
    },
    getIndex: options.getIndex ?? ((): Promise<unknown> => Promise.resolve(entries)),
    folders: { get: (id: string) => folders[id] },
  };
}

function installGame(packs: Rec[], isGM = true): void {
  const byId = new Map(packs.map(pack => [pack.collection as string, pack]));
  setGlobal('game', {
    user: { isGM },
    world: { id: 'test-world' },
    packs: { get: (id: string) => byId.get(id), contents: packs },
  });
}

function npcEntry(n: number, overrides: Rec = {}): Rec {
  return {
    _id: docId(n),
    name: `Snow Weasel ${n}`,
    type: 'npc',
    img: 'icons/svg/mystery-man.svg',
    ...overrides,
  };
}

async function indexOk(data: unknown): Promise<LibraryIndexResponse> {
  const result = await getLibraryIndex(data);
  if (!result.success) throw new Error(`getLibraryIndex failed: ${result.error}`);
  return result;
}

async function documentsOk(uuids: string[]): Promise<LibraryDocument[]> {
  const result = await getLibraryDocuments({ uuids });
  if (!result.success) throw new Error(`getLibraryDocuments failed: ${result.error}`);
  return result.documents;
}

// ---------------------------------------------------------------------------
// getLibraryIndex
// ---------------------------------------------------------------------------

describe('getLibraryIndex: gate and request', () => {
  it('refuses a non-GM client', async () => {
    installGame([mockPack('world.test-monsters', [npcEntry(1)])], false);
    expect(await getLibraryIndex({ packs: ['world.test-monsters'] })).toEqual({
      success: false,
      error: 'Access denied',
    });
  });

  it('refuses when there is no game', async () => {
    expect(await getLibraryIndex({ packs: [] })).toEqual({
      success: false,
      error: 'Access denied',
    });
  });

  it('answers a GM with the schema, world id and an empty page for no packs', async () => {
    installGame([]);
    const response = await indexOk({ packs: [] });
    expect(response).toMatchObject({
      success: true,
      schema: LIBRARY_SCHEMA,
      worldId: 'test-world',
      packs: [],
      missing: [],
      entries: [],
      next: null,
    });
  });

  it('treats a missing or odd request as no packs', async () => {
    installGame([mockPack('world.test-monsters', [npcEntry(1)])]);
    for (const data of [undefined, null, 'text', 42, {}, { packs: 'world.test-monsters' }]) {
      expect((await indexOk(data)).entries).toEqual([]);
    }
  });

  it('drops invalid pack ids and keeps the valid ones once', async () => {
    installGame([mockPack('world.test-monsters', [npcEntry(1)])]);
    const bad = ['nodot', '.x', 'a.b.c', '../x', '', 5, null, {}, 'a b.c'];
    const response = await indexOk({
      packs: [...bad, 'world.test-monsters', 'world.test-monsters'],
    });
    expect(response.packs.map(p => p.id)).toEqual(['world.test-monsters']);
    expect(response.missing).toEqual([]);
    expect(response.entries.length).toBe(1);
  });

  it('lists a requested pack that does not exist as missing, in request order', async () => {
    installGame([mockPack('world.test-monsters', [npcEntry(1)])]);
    const response = await indexOk({
      packs: ['world.gone-b', 'world.test-monsters', 'world.gone-a'],
    });
    expect(response.packs.map(p => p.id)).toEqual(['world.test-monsters']);
    expect(response.missing).toEqual(['world.gone-b', 'world.gone-a']);
  });

  it('looks at no more than 100 packs', async () => {
    installGame([]);
    const ids = Array.from({ length: 105 }, (_, n) => `world.pack-${n}`);
    const response = await indexOk({ packs: ids });
    expect(response.missing.length).toBe(LIBRARY_LIMITS.packs);
    expect(response.missing[99]).toBe('world.pack-99');
  });
});

describe('getLibraryIndex: rows', () => {
  it('keeps only npc rows of an Actor pack and writes the uuid, pack and id', async () => {
    installGame([
      mockPack('world.test-monsters', [
        npcEntry(2),
        npcEntry(1),
        { _id: docId(3), name: 'Hero', type: 'character' },
        { _id: docId(4), name: 'Cart', type: 'vehicle' },
      ]),
    ]);
    const response = await indexOk({ packs: ['world.test-monsters'] });
    expect(response.packs).toEqual([
      {
        id: 'world.test-monsters',
        label: 'Test Pack',
        documentName: 'Actor',
        packageType: 'world',
        packageName: 'w',
        total: 2,
      },
    ]);
    expect(response.entries.map(e => e.id)).toEqual([docId(1), docId(2)]);
    expect(response.entries[0]).toMatchObject({
      uuid: `Compendium.world.test-monsters.Actor.${docId(1)}`,
      pack: 'world.test-monsters',
      id: docId(1),
      name: 'Snow Weasel 1',
      type: 'npc',
      subtype: null,
      group: null,
      identifier: null,
      classIdentifier: null,
      rules: null,
    });
    expect(response.entries[0]?.sig).toMatch(/^[0-9a-z]+$/);
  });

  it('keeps every item of an Item pack and reads type, subtype, identifier and rules', async () => {
    installGame([
      mockPack(
        'world.test-items',
        [
          {
            _id: docId(1),
            name: 'Frostbrand Copy',
            type: 'weapon',
            system: { source: { rules: '2024' } },
          },
          {
            _id: docId(2),
            name: 'Icewalker',
            type: 'subclass',
            system: {
              identifier: 'icewalker',
              classIdentifier: 'ranger',
              source: { rules: '2014' },
            },
          },
          {
            _id: docId(3),
            name: 'Weasel Lore',
            type: 'feat',
            system: { type: { value: 'class' }, source: { rules: 'legacy' } },
          },
        ],
        { documentName: 'Item', label: 'Test Items' }
      ),
    ]);
    const response = await indexOk({ packs: ['world.test-items'] });
    expect(
      response.entries.map(e => [
        e.uuid,
        e.type,
        e.subtype,
        e.identifier,
        e.classIdentifier,
        e.rules,
      ])
    ).toEqual([
      [`Compendium.world.test-items.Item.${docId(1)}`, 'weapon', null, null, null, '2024'],
      [
        `Compendium.world.test-items.Item.${docId(2)}`,
        'subclass',
        null,
        'icewalker',
        'ranger',
        '2014',
      ],
      [`Compendium.world.test-items.Item.${docId(3)}`, 'feat', 'class', null, null, null],
    ]);
  });

  it('asks the pack index for the fields it needs, including the whole source object', async () => {
    let asked: unknown = null;
    installGame([
      mockPack('world.test-monsters', [], {
        getIndex: (options): Promise<unknown> => {
          asked = options;
          return Promise.resolve([npcEntry(1)]);
        },
      }),
    ]);
    await indexOk({ packs: ['world.test-monsters'] });
    const fields = (asked as { fields: string[] }).fields;
    expect(fields).toEqual(
      expect.arrayContaining([
        'system.type.value',
        'system.identifier',
        'system.classIdentifier',
        '_stats.modifiedTime',
        'system.source',
        'folder',
      ])
    );
    expect(fields).not.toContain('system.source.rules');
  });

  it('reads an index that is a plain list, an object with contents, or has the id under id', async () => {
    installGame([
      mockPack('world.list', [npcEntry(1)]),
      mockPack('world.contents', [], {
        getIndex: () => Promise.resolve({ contents: [npcEntry(2)] }),
      }),
      mockPack('world.plainid', [], {
        getIndex: () => Promise.resolve([{ id: docId(3), name: 'Snow Weasel 3', type: 'npc' }]),
      }),
    ]);
    const response = await indexOk({ packs: ['world.list', 'world.contents', 'world.plainid'] });
    expect(response.entries.map(e => e.id)).toEqual([docId(1), docId(2), docId(3)]);
  });

  it('skips an entry whose id is not a 16 character id and entries that are not objects', async () => {
    installGame([
      mockPack('world.test-monsters', [
        npcEntry(1),
        { _id: 'short', name: 'Bad', type: 'npc' },
        { name: 'No id', type: 'npc' },
        'text' as unknown as Rec,
        null as unknown as Rec,
      ]),
    ]);
    const response = await indexOk({ packs: ['world.test-monsters'] });
    expect(response.entries.map(e => e.id)).toEqual([docId(1)]);
  });

  it('a pack without a getIndex function gives no rows', async () => {
    const pack = mockPack('world.test-monsters', []);
    delete pack.getIndex;
    installGame([pack]);
    const response = await indexOk({ packs: ['world.test-monsters'] });
    expect(response.packs[0]?.total).toBe(0);
    expect(response.entries).toEqual([]);
  });

  it('lists a pack of another document type without rows', async () => {
    let called = false;
    installGame([
      mockPack('world.test-journals', [npcEntry(1)], {
        documentName: 'JournalEntry',
        getIndex: (): Promise<unknown> => {
          called = true;
          return Promise.resolve([npcEntry(1)]);
        },
      }),
    ]);
    const response = await indexOk({ packs: ['world.test-journals'] });
    expect(called).toBe(false);
    expect(response.packs).toEqual([
      expect.objectContaining({
        id: 'world.test-journals',
        documentName: 'JournalEntry',
        total: 0,
      }),
    ]);
    expect(response.entries).toEqual([]);
  });

  it('falls back to the pack title, then the id, for the label', async () => {
    const titled = mockPack('world.titled', []);
    (titled.metadata as Rec).label = undefined;
    titled.title = 'Titled Pack';
    const bare = mockPack('world.bare', []);
    (bare.metadata as Rec).label = undefined;
    installGame([titled, bare]);
    const response = await indexOk({ packs: ['world.titled', 'world.bare'] });
    expect(response.packs.map(p => p.label)).toEqual(['Titled Pack', 'world.bare']);
  });
});

describe('getLibraryIndex: group', () => {
  const folders: Record<string, Rec> = {
    top: { name: 'Animals', ancestors: [] },
    // Foundry's ancestors are parent-first: the nearest parent, then up to the root.
    deep: { name: 'Weasels', ancestors: [{ name: 'Animals' }, { name: 'Core Rules' }] },
    rulesOnly: { name: '5e Core Rules', ancestors: [] },
    rulesChild: { name: 'Monsters', ancestors: [{ name: 'Core Rules' }] },
    rulesInner: { name: 'Small Beasts', ancestors: [{ name: 'Beasts' }, { name: 'SRD Rules' }] },
    wordy: { name: 'Rulesome Things', ancestors: [] },
  };

  async function groupOfFolder(folder: string | null): Promise<string | null> {
    installGame([
      mockPack('world.test-monsters', [npcEntry(1, folder ? { folder } : {})], { folders }),
    ]);
    return (await indexOk({ packs: ['world.test-monsters'] })).entries[0]?.group ?? null;
  }

  it('is null for an entry without a folder or with an unknown folder', async () => {
    expect(await groupOfFolder(null)).toBeNull();
    expect(await groupOfFolder('missing')).toBeNull();
  });

  it('is the folder name for a top level folder', async () => {
    expect(await groupOfFolder('top')).toBe('Animals');
  });

  it('is the top-most folder name that is not a rules grouping', async () => {
    expect(await groupOfFolder('deep')).toBe('Animals');
    expect(await groupOfFolder('rulesChild')).toBe('Monsters');
    expect(await groupOfFolder('rulesInner')).toBe('Beasts');
  });

  it('is null when every folder of the chain is a rules grouping', async () => {
    expect(await groupOfFolder('rulesOnly')).toBeNull();
  });

  it('only skips the whole word rules', async () => {
    expect(await groupOfFolder('wordy')).toBe('Rulesome Things');
  });
});

describe('getLibraryIndex: sig', () => {
  async function sigWith(entry: Rec): Promise<string> {
    installGame([mockPack('world.test-monsters', [entry])]);
    return (await indexOk({ packs: ['world.test-monsters'] })).entries[0]?.sig ?? '';
  }

  it('is stable for the same entry', async () => {
    const entry = npcEntry(1, { _stats: { modifiedTime: 100 } });
    expect(await sigWith(entry)).toBe(await sigWith({ ...entry }));
  });

  it('changes when the modified time changes', async () => {
    const a = await sigWith(npcEntry(1, { _stats: { modifiedTime: 100 } }));
    const b = await sigWith(npcEntry(1, { _stats: { modifiedTime: 101 } }));
    expect(a).not.toBe(b);
  });

  it('changes when the name changes', async () => {
    const a = await sigWith(npcEntry(1, { name: 'Snow Weasel' }));
    const b = await sigWith(npcEntry(1, { name: 'Snow Weasel Elder' }));
    expect(a).not.toBe(b);
  });

  it('changes with the image, rules and type, but not with an unlisted field', async () => {
    const base = await sigWith(npcEntry(1));
    expect(await sigWith(npcEntry(1, { img: 'ddb-images/x.png' }))).not.toBe(base);
    expect(await sigWith(npcEntry(1, { system: { source: { rules: '2024' } } }))).not.toBe(base);
    expect(await sigWith(npcEntry(1, { system: { identifier: 'weasel' } }))).not.toBe(base);
    expect(await sigWith(npcEntry(1, { flags: { other: 1 }, sort: 7 }))).toBe(base);
  });

  it('changes with the source book and the page (the note moves or its page changes)', async () => {
    const base = await sigWith(npcEntry(1, { system: { source: { book: 'MM 2024' } } }));
    expect(await sigWith(npcEntry(1, { system: { source: { book: 'MM' } } }))).not.toBe(base);
    expect(
      await sigWith(npcEntry(1, { system: { source: { book: 'MM 2024', page: '12' } } }))
    ).not.toBe(base);
  });
});

describe('getLibraryIndex: source book (I-100)', () => {
  async function rowOf(source: unknown, i18n?: Record<string, string>): Promise<Rec> {
    installGame([mockPack('world.test-monsters', [npcEntry(1, { system: { source } })])]);
    if (i18n) {
      const game = (globalThis as unknown as { game: Rec }).game;
      game.i18n = { localize: (key: string): string => i18n[key] ?? key };
    }
    const row = (await indexOk({ packs: ['world.test-monsters'] })).entries[0];
    return { book: row?.book, bookTitle: row?.bookTitle, page: row?.page };
  }

  it('takes the full title from the dnd5e registry, localized', async () => {
    setGlobal('CONFIG', {
      DND5E: { sourceBooks: { 'SRD 5.2': 'SOURCE.BOOK.SRD52', XYZ: { label: 'Book of Xyz' } } },
    });
    expect(
      await rowOf({ book: 'SRD 5.2', page: '7' }, { 'SOURCE.BOOK.SRD52': 'SRD 5.2 (Localized)' })
    ).toEqual({ book: 'SRD 5.2', bookTitle: 'SRD 5.2 (Localized)', page: '7' });
    expect(await rowOf({ book: 'XYZ' })).toEqual({
      book: 'XYZ',
      bookTitle: 'Book of Xyz',
      page: null,
    });
  });

  it('falls back to its own table, then to the code itself', async () => {
    setGlobal('CONFIG', { DND5E: { sourceBooks: { 'MM 2024': 'SOURCE.BOOK.MISSING' } } });
    // An unresolved localization key does not count as a title.
    expect((await rowOf({ book: 'MM 2024', page: 12 })).bookTitle).toBe('Monster Manual (2024)');
    expect((await rowOf({ book: 'MM 2024', page: 12 })).page).toBe('12');
    expect((await rowOf({ book: 'PHB' })).bookTitle).toBe("Player's Handbook (2014)");
    expect((await rowOf({ book: 'CoS' })).bookTitle).toBe('Curse of Strahd');
    expect((await rowOf({ book: 'Homebrew' })).bookTitle).toBe('Homebrew');
    expect(await rowOf({ custom: 'Table Notes' })).toEqual({
      book: 'Table Notes',
      bookTitle: 'Table Notes',
      page: null,
    });
  });

  it('has no book without a source, and every common code has a title', async () => {
    expect(await rowOf(undefined)).toEqual({ book: null, bookTitle: null, page: null });
    expect(await rowOf({ rules: '2024', page: '3' })).toEqual({
      book: null,
      bookTitle: null,
      page: '3',
    });
    for (const code of ['PHB 2024', 'DMG 2024', 'DMG', 'MM', 'XGtE', 'TCoE', 'MotM', 'SRD 5.1']) {
      expect(BOOK_TITLES[code]).toBeTruthy();
      expect(bookTitleOf(code)).toBe(BOOK_TITLES[code]);
    }
  });
});

describe('getLibraryIndex: origin and all packs', () => {
  it('carries the origin of the GM client', async () => {
    installGame([]);
    setGlobal('location', { origin: 'http://localhost:30001' });
    expect((await indexOk({ packs: [] })).origin).toBe('http://localhost:30001');
  });

  it('adds the route prefix from foundry.utils.getRoute and never a trailing slash', async () => {
    installGame([]);
    setGlobal('location', { origin: 'https://table.example' });
    setGlobal('foundry', { utils: { getRoute: () => '/vtt/' } });
    expect((await indexOk({ packs: [] })).origin).toBe('https://table.example/vtt');
    setGlobal('foundry', { utils: { getRoute: () => '/a/b/' } });
    expect((await indexOk({ packs: [] })).origin).toBe('https://table.example/a/b');
    // No prefix: getRoute('/') is just a slash.
    setGlobal('foundry', { utils: { getRoute: () => '/' } });
    expect((await indexOk({ packs: [] })).origin).toBe('https://table.example');
  });

  it('keeps the bare origin when getRoute is missing, throws or answers nonsense', async () => {
    installGame([]);
    setGlobal('location', { origin: 'http://localhost:30001/' });
    for (const getRoute of [
      undefined,
      (): never => {
        throw new Error('boom');
      },
      (): number => 5,
    ]) {
      setGlobal('foundry', { utils: { getRoute } });
      expect((await indexOk({ packs: [] })).origin).toBe('http://localhost:30001');
    }
  });

  it('has an empty origin when location is missing or not http', async () => {
    installGame([]);
    expect((await indexOk({ packs: [] })).origin).toBe('');
    setGlobal('location', { origin: 'null' });
    expect((await indexOk({ packs: [] })).origin).toBe('');
  });

  it('lists every pack of the world sorted by id, whether requested or not', async () => {
    installGame([
      mockPack('world.zeta', [], { documentName: 'Item' }),
      mockPack('dnd5e.monsters', []),
      mockPack('world.alpha', [], { documentName: 'JournalEntry' }),
    ]);
    const response = await indexOk({ packs: ['dnd5e.monsters'] });
    expect(response.allPacks).toEqual([
      { id: 'dnd5e.monsters', documentName: 'Actor' },
      { id: 'world.alpha', documentName: 'JournalEntry' },
      { id: 'world.zeta', documentName: 'Item' },
    ]);
  });

  it('reads the packs from a values() iterator when there is no contents list', async () => {
    const pack = mockPack('world.test-monsters', [npcEntry(1)]);
    setGlobal('game', {
      user: { isGM: true },
      world: { id: 'test-world' },
      packs: {
        get: (id: string) => (id === 'world.test-monsters' ? pack : undefined),
        values: () => [pack][Symbol.iterator](),
      },
    });
    const response = await indexOk({ packs: ['world.test-monsters'] });
    expect(response.allPacks).toEqual([{ id: 'world.test-monsters', documentName: 'Actor' }]);
  });
});

describe('getLibraryIndex: paging', () => {
  function bigPack(count: number, collection = 'world.big'): Rec {
    return mockPack(
      collection,
      Array.from({ length: count }, (_, n) => npcEntry(n))
    );
  }

  /** Every page of a walk with the same packs, until `next` is null. */
  async function walk(packs: string[]): Promise<LibraryIndexResponse[]> {
    const pages: LibraryIndexResponse[] = [];
    let after: string | null = null;
    for (let guard = 0; guard < 100; guard++) {
      const page: LibraryIndexResponse = await indexOk({ packs, after });
      pages.push(page);
      if (page.next === null) return pages;
      after = page.next;
    }
    throw new Error('the walk never ended');
  }

  it('pages at the index page maximum with a cursor and ends with null', async () => {
    installGame([bigPack(LIBRARY_LIMITS.indexPageMax + 3)]);
    const first = await indexOk({ packs: ['world.big'] });
    expect(first.entries.length).toBe(LIBRARY_LIMITS.indexPageMax);
    expect(first.next).toBe(`0:${docId(LIBRARY_LIMITS.indexPageMax - 1)}`);
    expect(first.packs[0]?.total).toBe(LIBRARY_LIMITS.indexPageMax + 3);

    const second = await indexOk({ packs: ['world.big'], after: first.next });
    expect(second.entries.map(e => e.id)).toEqual([
      docId(LIBRARY_LIMITS.indexPageMax),
      docId(LIBRARY_LIMITS.indexPageMax + 1),
      docId(LIBRARY_LIMITS.indexPageMax + 2),
    ]);
    expect(second.next).toBeNull();
  });

  it('has no next cursor when the rows exactly fill one page', async () => {
    installGame([bigPack(LIBRARY_LIMITS.indexPageMax)]);
    const response = await indexOk({ packs: ['world.big'] });
    expect(response.entries.length).toBe(LIBRARY_LIMITS.indexPageMax);
    expect(response.next).toBeNull();
  });

  it('keeps the index page maximum at a thousand rows', () => {
    expect(LIBRARY_LIMITS.indexPageMax).toBe(1000);
    expect(LIBRARY_LIMITS.indexPageBytes).toBe(512 * 1024);
  });

  it('walks several pages and returns every row once, in pack order then id order', async () => {
    const total = LIBRARY_LIMITS.indexPageMax * 2 + 7;
    installGame([bigPack(total, 'world.big'), mockPack('world.small', [npcEntry(1), npcEntry(0)])]);
    const pages = await walk(['world.big', 'world.small']);
    expect(pages.length).toBe(3);
    const uuids = pages.flatMap(page => page.entries.map(entry => entry.uuid));
    expect(uuids.length).toBe(total + 2);
    expect(new Set(uuids).size).toBe(uuids.length);
    expect(uuids[0]).toBe(`Compendium.world.big.Actor.${docId(0)}`);
    expect(uuids[total - 1]).toBe(`Compendium.world.big.Actor.${docId(total - 1)}`);
    expect(uuids.slice(total)).toEqual([
      `Compendium.world.small.Actor.${docId(0)}`,
      `Compendium.world.small.Actor.${docId(1)}`,
    ]);
  });

  it('cuts a page at the byte budget before the row maximum', async () => {
    const fat = (n: number): Rec =>
      npcEntry(n, {
        name: 'n'.repeat(200),
        system: {
          type: { value: 't'.repeat(200) },
          identifier: 'i'.repeat(200),
          classIdentifier: 'c'.repeat(200),
        },
      });
    installGame([
      mockPack(
        'world.fat',
        Array.from({ length: 900 }, (_, n) => fat(n))
      ),
    ]);
    const pages = await walk(['world.fat']);
    expect(pages.length).toBeGreaterThan(1);
    for (const page of pages) {
      expect(page.entries.length).toBeLessThan(LIBRARY_LIMITS.indexPageMax);
      const bytes = new TextEncoder().encode(JSON.stringify(page.entries)).length;
      expect(bytes).toBeLessThanOrEqual(LIBRARY_LIMITS.indexPageBytes);
    }
    expect(pages.flatMap(page => page.entries).length).toBe(900);
  });

  it('starts strictly after the cursor row even when that row was removed meanwhile', async () => {
    const cursor = `0:${docId(6)}`;
    // The cursor row (id 6) is gone and a row with id 5 appeared before it.
    installGame([
      mockPack('world.one', [npcEntry(2), npcEntry(4), npcEntry(5), npcEntry(8), npcEntry(10)]),
    ]);
    const response = await indexOk({ packs: ['world.one'], after: cursor });
    expect(response.entries.map(e => e.id)).toEqual([docId(8), docId(10)]);
  });

  it('does not skip a row when one is inserted before the cursor between pages', async () => {
    const count = LIBRARY_LIMITS.indexPageMax + 5;
    // Ids 1, 3, 5, ...: leave room to insert a row in front of the cursor.
    const entries = Array.from({ length: count }, (_, n) => npcEntry(n * 2 + 1));
    installGame([mockPack('world.big', entries)]);
    const first = await indexOk({ packs: ['world.big'] });
    expect(first.entries.length).toBe(LIBRARY_LIMITS.indexPageMax);

    // A document with a small id is added after the first page was served. With an offset
    // cursor every later row would shift down by one and the first of them would repeat or
    // be skipped; the key cursor continues exactly after the last served row.
    installGame([mockPack('world.big', [npcEntry(0), ...entries])]);
    const second = await indexOk({ packs: ['world.big'], after: first.next });
    const expected = entries.slice(LIBRARY_LIMITS.indexPageMax).map(e => e._id);
    expect(second.entries.map(e => e.id)).toEqual(expected);
    expect(second.next).toBeNull();
  });

  it('does not repeat a row when one is removed before the cursor between pages', async () => {
    const count = LIBRARY_LIMITS.indexPageMax + 5;
    const entries = Array.from({ length: count }, (_, n) => npcEntry(n));
    installGame([mockPack('world.big', entries)]);
    const first = await indexOk({ packs: ['world.big'] });
    installGame([mockPack('world.big', entries.slice(1))]);
    const second = await indexOk({ packs: ['world.big'], after: first.next });
    expect(second.entries.map(e => e.id)).toEqual(
      entries.slice(LIBRARY_LIMITS.indexPageMax).map(e => e._id)
    );
  });

  it('pages over the rows of several packs as one list', async () => {
    installGame([
      mockPack('world.one', [npcEntry(1), npcEntry(2)]),
      mockPack('world.two', [npcEntry(1)]),
    ]);
    const response = await indexOk({
      packs: ['world.one', 'world.two'],
      after: `0:${docId(1)}`,
    });
    expect(response.entries.map(e => e.uuid)).toEqual([
      `Compendium.world.one.Actor.${docId(2)}`,
      `Compendium.world.two.Actor.${docId(1)}`,
    ]);
  });

  it('continues in the next pack when the cursor is the last row of a pack', async () => {
    installGame([
      mockPack('world.one', [npcEntry(1), npcEntry(2)]),
      mockPack('world.two', [npcEntry(1)]),
    ]);
    const response = await indexOk({
      packs: ['world.one', 'world.two'],
      after: `0:${docId(2)}`,
    });
    expect(response.entries.map(e => e.uuid)).toEqual([`Compendium.world.two.Actor.${docId(1)}`]);
  });

  it('numbers the packs by their place in the request, missing ones included', async () => {
    installGame([mockPack('world.two', [npcEntry(1), npcEntry(2)])]);
    const response = await indexOk({ packs: ['world.gone', 'world.two'], after: `1:${docId(1)}` });
    expect(response.entries.map(e => e.id)).toEqual([docId(2)]);
  });

  it('accepts a null or missing cursor and a cursor past the last row', async () => {
    installGame([mockPack('world.one', [npcEntry(1)])]);
    expect((await indexOk({ packs: ['world.one'], after: null })).entries.length).toBe(1);
    const past = await indexOk({ packs: ['world.one'], after: `0:${docId(10)}` });
    expect(past.entries).toEqual([]);
    expect(past.next).toBeNull();
  });

  it('refuses a malformed cursor', async () => {
    installGame([mockPack('world.one', [npcEntry(1)])]);
    const bad = [
      'abc',
      '-1',
      '1',
      '10',
      '1.5',
      '',
      ' 1',
      5,
      {},
      '0:short',
      `0:${docId(1)}x`,
      `x:${docId(1)}`,
      `-1:${docId(1)}`,
      `0: ${docId(1)}`,
      `0:${docId(1)}\n`,
      `1:${docId(1)}`,
      `1234:${docId(1)}`,
    ];
    for (const after of bad) {
      expect(await getLibraryIndex({ packs: ['world.one'], after })).toEqual({
        success: false,
        error: 'Invalid cursor',
      });
    }
  });
});

// ---------------------------------------------------------------------------
// getLibraryDocuments
// ---------------------------------------------------------------------------

const SPELL_UUID = `Compendium.world.test-spells.Item.${docId(1)}`;
const ITEM_UUID = `Compendium.world.test-items.Item.${docId(2)}`;
const CLASS_UUID = `Compendium.world.test-classes.Item.${docId(3)}`;
const NPC_UUID = `Compendium.world.test-monsters.Actor.${docId(4)}`;

function uuidN(n: number, pack = 'world.test-items'): string {
  return `Compendium.${pack}.Item.${docId(n)}`;
}

/** The `getDocuments` calls the last `installDocs` mock received, one per pack. */
let packCalls: Array<{ pack: string; ids: string[] }> = [];

/**
 * Install packs that answer `getDocuments({ _id__in })` from a map of uuid to document (an Error
 * value is a document that does not load); returns the uuids it was asked for. Any pack id
 * exists, so a uuid outside the map is simply not found.
 */
function installDocs(docs: Record<string, unknown>): string[] {
  const asked: string[] = [];
  packCalls = [];
  const byKey = new Map<string, { uuid: string; doc: unknown }>();
  for (const [uuid, doc] of Object.entries(docs)) {
    const parts = uuid.split('.');
    byKey.set(`${parts[1]}.${parts[2]}.${parts[4]}`, { uuid, doc });
  }
  const packs = {
    get: (id: string): Rec => ({
      collection: id,
      getDocuments: (query: { _id__in: string[] }): Promise<unknown[]> => {
        packCalls.push({ pack: id, ids: query._id__in });
        const found: unknown[] = [];
        for (const docId of query._id__in) {
          const hit = byKey.get(`${id}.${docId}`);
          asked.push(hit?.uuid ?? `Compendium.${id}.Item.${docId}`);
          if (hit && !(hit.doc instanceof Error)) found.push({ id: docId, ...(hit.doc as Rec) });
        }
        return Promise.resolve(found);
      },
    }),
  };
  setGlobal('game', { user: { isGM: true }, world: { id: 'test-world' }, packs });
  return asked;
}

function itemDoc(type: string, name: string, system: Rec = {}, extra: Rec = {}): Rec {
  return { type, name, _source: { name }, system, ...extra };
}

describe('getLibraryDocuments: gate and request', () => {
  it('refuses a non-GM client', async () => {
    setGlobal('game', { user: { isGM: false }, world: { id: 'test-world' } });
    expect(await getLibraryDocuments({ uuids: [SPELL_UUID] })).toEqual({
      success: false,
      error: 'Access denied',
    });
  });

  it('answers a GM with the schema and world id', async () => {
    installDocs({});
    expect(await getLibraryDocuments({ uuids: [] })).toEqual({
      success: true,
      schema: LIBRARY_SCHEMA,
      worldId: 'test-world',
      documents: [],
      missing: [],
      deferred: [],
    });
  });

  it('drops uuids that are not compendium actor or item uuids and repeats', async () => {
    const asked = installDocs({ [SPELL_UUID]: itemDoc('spell', 'Frost Nip') });
    const bad = [
      'Actor.AAAAAAAAAAAAAAAA',
      `Compendium.world.test-spells.JournalEntry.${docId(1)}`,
      'Compendium.world.test-spells.Item.short',
      `Compendium.world.test-spells.Item.${docId(1)}\n`,
      `Compendium.world.test-spells.Item.${docId(1)}.extra`,
      `compendium.world.test-spells.Item.${docId(1)}`,
      7,
      null,
    ];
    const response = await getLibraryDocuments({ uuids: [...bad, SPELL_UUID, SPELL_UUID] });
    expect(response.success && response.documents.map(d => d.uuid)).toEqual([SPELL_UUID]);
    expect(asked).toEqual([SPELL_UUID]);
  });

  it('treats a missing or odd request as no uuids', async () => {
    installDocs({});
    for (const data of [undefined, null, 'x', {}, { uuids: SPELL_UUID }]) {
      const response = await getLibraryDocuments(data);
      expect(response.success && response.documents).toEqual([]);
    }
  });

  it('asks for at most 40 documents', async () => {
    const asked = installDocs({});
    const uuids = Array.from({ length: 45 }, (_, n) => uuidN(n));
    const response = await getLibraryDocuments({ uuids });
    expect(asked.length).toBe(LIBRARY_LIMITS.documentsPerRequest);
    expect(response.success && response.missing.length).toBe(LIBRARY_LIMITS.documentsPerRequest);
  });

  it('lists a document that cannot be loaded as missing and keeps the others', async () => {
    installDocs({
      [SPELL_UUID]: itemDoc('spell', 'Frost Nip'),
      [ITEM_UUID]: new Error('deleted meanwhile'),
    });
    const response = await getLibraryDocuments({ uuids: [ITEM_UUID, SPELL_UUID, CLASS_UUID] });
    expect(response.success).toBe(true);
    if (!response.success) return;
    expect(response.documents.map(d => d.uuid)).toEqual([SPELL_UUID]);
    expect(response.missing).toEqual([ITEM_UUID, CLASS_UUID]);
  });

  it('lists everything as missing when the pack does not exist', async () => {
    setGlobal('game', { user: { isGM: true }, world: { id: 'test-world' } });
    const response = await getLibraryDocuments({ uuids: [SPELL_UUID] });
    expect(response.success && response.missing).toEqual([SPELL_UUID]);
  });

  it('writes the pack, id, name, document name and type of an item', async () => {
    installDocs({ [SPELL_UUID]: itemDoc('spell', 'Frost Nip', { type: { value: 'cantrip' } }) });
    const [doc] = await documentsOk([SPELL_UUID]);
    expect(doc).toMatchObject({
      uuid: SPELL_UUID,
      pack: 'world.test-spells',
      id: docId(1),
      name: 'Frost Nip',
      documentName: 'Item',
      type: 'spell',
      subtype: 'cantrip',
      statBlock: null,
    });
  });

  it('names a document by its stored name and keeps a real image path', async () => {
    installDocs({
      [ITEM_UUID]: {
        type: 'loot',
        name: 'Strange Stick',
        _source: { name: 'Moon Spear' },
        img: 'ddb-images/spear.png',
        system: {},
      },
    });
    const [doc] = await documentsOk([ITEM_UUID]);
    expect(doc?.name).toBe('Moon Spear');
    expect(doc?.img).toBe('ddb-images/spear.png');
  });

  it('has no image for a placeholder icon', async () => {
    installDocs({ [ITEM_UUID]: { ...itemDoc('loot', 'Rock'), img: 'icons/svg/item-bag.svg' } });
    expect((await documentsOk([ITEM_UUID]))[0]?.img).toBeNull();
  });
});

describe('getLibraryDocuments: spell facts', () => {
  const frostNip = (): Rec =>
    itemDoc(
      'spell',
      'Frost Nip',
      {
        level: 1,
        school: 'evo',
        properties: new Set(['concentration', 'ritual']),
        materials: { value: 'a snowflake' },
        description: { value: '<p>A chill bites.</p>' },
        source: { book: 'XYZ', page: '12', rules: '2014' },
      },
      {
        labels: {
          level: '1st Level',
          school: 'Evocation',
          activation: '1 Action',
          range: '30 ft',
          target: '1 creature',
          components: { vsm: 'V, S, M' },
          duration: '1 minute',
        },
      }
    );

  it('reads the facts from the dnd5e labels', async () => {
    installDocs({ [SPELL_UUID]: frostNip() });
    const [doc] = await documentsOk([SPELL_UUID]);
    expect(doc?.facts).toEqual([
      { label: 'Level', value: '1st Level' },
      { label: 'School', value: 'Evocation' },
      { label: 'Casting Time', value: '1 Action' },
      { label: 'Range', value: '30 ft' },
      { label: 'Target', value: '1 creature' },
      { label: 'Components', value: 'V, S, M (a snowflake)' },
      { label: 'Duration', value: 'Concentration, 1 minute' },
      { label: 'Ritual', value: 'Yes' },
      { label: 'Source', value: 'XYZ p. 12' },
    ]);
    expect(doc).toMatchObject({
      source: 'XYZ p. 12',
      rules: '2014',
      book: 'XYZ',
      bookTitle: 'XYZ',
      page: '12',
      description: '<p>A chill bites.</p>',
      truncated: false,
    });
  });

  it('falls back to the level number and the config school when there are no labels', async () => {
    setGlobal('CONFIG', { DND5E: { spellSchools: { evo: { label: 'Evocation' } } } });
    const cantrip = itemDoc('spell', 'Frost Nip', { level: 0, school: 'evo' });
    const third = itemDoc('spell', 'Deep Freeze', { level: 3 });
    const none = itemDoc('spell', 'Odd Spell');
    installDocs({ [SPELL_UUID]: cantrip, [ITEM_UUID]: third, [CLASS_UUID]: none });
    const [a, b, c] = await documentsOk([SPELL_UUID, ITEM_UUID, CLASS_UUID]);
    expect(a?.facts).toEqual([
      { label: 'Level', value: 'Cantrip' },
      { label: 'School', value: 'Evocation' },
    ]);
    expect(b?.facts).toEqual([{ label: 'Level', value: 'Level 3' }]);
    expect(c?.facts).toEqual([{ label: 'Level', value: 'Level ?' }]);
  });

  it('writes only concentration when the spell has no ritual tag and no duration label', async () => {
    installDocs({
      [SPELL_UUID]: itemDoc('spell', 'Frost Nip', { level: 1, properties: ['concentration'] }),
    });
    const facts = (await documentsOk([SPELL_UUID]))[0]?.facts ?? [];
    expect(facts.find(f => f.label === 'Duration')?.value).toBe('Concentration,');
    expect(facts.find(f => f.label === 'Ritual')).toBeUndefined();
  });

  it('has no source and no source fact without a book', async () => {
    installDocs({
      [SPELL_UUID]: itemDoc('spell', 'Frost Nip', { level: 1, source: { page: '3' } }),
    });
    const [doc] = await documentsOk([SPELL_UUID]);
    expect(doc?.source).toBeNull();
    expect(doc?.facts.find(f => f.label === 'Source')).toBeUndefined();
  });

  it('writes the book alone when there is no page, and reads the label or custom source', async () => {
    installDocs({
      [SPELL_UUID]: itemDoc('spell', 'A', { level: 1, source: { book: 'XYZ' } }),
      [ITEM_UUID]: itemDoc('spell', 'B', {
        level: 1,
        source: { label: 'Homebrew Pack', page: '9' },
      }),
      [CLASS_UUID]: itemDoc('spell', 'C', { level: 1, source: { custom: 'Table Notes' } }),
    });
    const docs = await documentsOk([SPELL_UUID, ITEM_UUID, CLASS_UUID]);
    expect(docs.map(d => d.source)).toEqual(['XYZ', 'Homebrew Pack p. 9', 'Table Notes']);
  });
});

describe('getLibraryDocuments: other facts', () => {
  it('reads the facts of a physical item, falling back to raw keys without CONFIG', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc(
        'weapon',
        'Icy Rapier',
        {
          type: { label: 'Martial Melee' },
          rarity: 'rare',
          attunement: 'required',
          price: { value: 50, denomination: 'gp' },
          weight: { value: 3, units: 'lb' },
        },
        {
          labels: {
            armor: 'AC 15',
            damages: [{ formula: '1d8', damageType: 'Cold' }, { formula: '1d4' }],
            properties: [{ label: 'Finesse' }, { label: 'Light' }, {}],
          },
        }
      ),
    });
    const [doc] = await documentsOk([ITEM_UUID]);
    expect(doc?.facts).toEqual([
      { label: 'Type', value: 'Martial Melee' },
      { label: 'Rarity', value: 'rare' },
      { label: 'Attunement', value: 'required' },
      { label: 'Armor', value: 'AC 15' },
      { label: 'Damage', value: '1d8 Cold, 1d4' },
      { label: 'Properties', value: 'Finesse, Light' },
      { label: 'Price', value: '50 gp' },
      { label: 'Weight', value: '3 lb' },
    ]);
  });

  it('uses the config tables for rarity, attunement and the item type when it has them', async () => {
    setGlobal('CONFIG', {
      DND5E: {
        itemRarity: { rare: 'Rare' },
        attunementTypes: { required: 'Attunement Required' },
        itemTypes: { wondrous: 'Wondrous Item' },
      },
    });
    installDocs({
      [ITEM_UUID]: itemDoc('wondrous', 'Snow Globe', { rarity: 'rare', attunement: 'required' }),
    });
    const [doc] = await documentsOk([ITEM_UUID]);
    expect(doc?.facts).toEqual([
      { label: 'Type', value: 'Wondrous Item' },
      { label: 'Rarity', value: 'Rare' },
      { label: 'Attunement', value: 'Attunement Required' },
    ]);
  });

  it('uses the default coin and weight units and leaves out zero price and weight', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc('loot', 'Rope', { price: { value: 2 }, weight: { value: 10 } }),
      [SPELL_UUID]: itemDoc('loot', 'Pebble', { price: { value: 0 }, weight: { value: 0 } }),
    });
    const [rope, pebble] = await documentsOk([ITEM_UUID, SPELL_UUID]);
    expect(rope?.facts).toEqual([
      { label: 'Type', value: 'loot' },
      { label: 'Price', value: '2 gp' },
      { label: 'Weight', value: '10 lb' },
    ]);
    expect(pebble?.facts).toEqual([{ label: 'Type', value: 'loot' }]);
  });

  it('reads the facts of a class: hit die, primary ability and spellcasting', async () => {
    installDocs({
      [CLASS_UUID]: itemDoc('class', 'Frost Warden', {
        hd: { denomination: 'd8' },
        primaryAbility: { value: new Set(['int', 'wis']) },
        spellcasting: { progression: 'half' },
      }),
    });
    const [doc] = await documentsOk([CLASS_UUID]);
    expect(doc?.facts).toEqual([
      { label: 'Hit Die', value: 'd8' },
      { label: 'Primary Ability', value: 'int, wis' },
      { label: 'Spellcasting', value: 'half' },
    ]);
  });

  it('uses the config labels for the primary ability and spell progression, and the old hit dice', async () => {
    setGlobal('CONFIG', {
      DND5E: {
        abilities: { int: { label: 'Intelligence' } },
        spellProgression: { full: 'Full Caster' },
      },
    });
    installDocs({
      [CLASS_UUID]: itemDoc('class', 'Frost Warden', {
        hitDice: 'd6',
        primaryAbility: { value: ['int'] },
        spellcasting: { progression: 'full' },
      }),
    });
    const [doc] = await documentsOk([CLASS_UUID]);
    expect(doc?.facts).toEqual([
      { label: 'Hit Die', value: 'd6' },
      { label: 'Primary Ability', value: 'Intelligence' },
      { label: 'Spellcasting', value: 'Full Caster' },
    ]);
  });

  it('leaves out spellcasting for a class that has none', async () => {
    installDocs({
      [CLASS_UUID]: itemDoc('class', 'Brawler', {
        hd: { denomination: 'd12' },
        spellcasting: { progression: 'none' },
      }),
    });
    const [doc] = await documentsOk([CLASS_UUID]);
    expect(doc?.facts).toEqual([{ label: 'Hit Die', value: 'd12' }]);
  });

  it('writes the class of a subclass', async () => {
    installDocs({
      [CLASS_UUID]: itemDoc('subclass', 'Icewalker', { classIdentifier: 'frost-warden' }),
    });
    expect((await documentsOk([CLASS_UUID]))[0]?.facts).toEqual([
      { label: 'Class', value: 'frost-warden' },
    ]);
  });

  it('reads the facts of a feat from the feature type table', async () => {
    setGlobal('CONFIG', {
      DND5E: {
        featureTypes: { class: { label: 'Class Feature', subtypes: { weasel: 'Weasel Path' } } },
      },
    });
    installDocs({
      [ITEM_UUID]: itemDoc('feat', 'Snow Step', {
        type: { value: 'class', subtype: 'weasel' },
        requirements: 'Frost Warden 3',
        prerequisites: { level: 3, repeatable: true },
      }),
    });
    expect((await documentsOk([ITEM_UUID]))[0]?.facts).toEqual([
      { label: 'Type', value: 'Class Feature (Weasel Path)' },
      { label: 'Requirements', value: 'Frost Warden 3' },
      { label: 'Prerequisite', value: 'Level 3' },
      { label: 'Repeatable', value: 'Yes' },
    ]);
  });

  it('reads the facts of a species', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc('race', 'Snowfolk', {
        type: { value: 'humanoid' },
        movement: { walk: 25 },
        senses: { darkvision: 60 },
      }),
    });
    expect((await documentsOk([ITEM_UUID]))[0]?.facts).toEqual([
      { label: 'Creature Type', value: 'humanoid' },
      { label: 'Speed', value: '25 ft' },
      { label: 'Darkvision', value: '60 ft' },
    ]);
  });

  it('reads the dnd5e 6 paths of a species: speeds.walk and senses.ranges.darkvision', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc('race', 'Snowfolk', {
        type: { value: 'humanoid' },
        movement: { speeds: { walk: '30' }, units: 'ft' },
        senses: { ranges: { darkvision: 90 }, units: 'ft' },
      }),
    });
    expect((await documentsOk([ITEM_UUID]))[0]?.facts).toEqual([
      { label: 'Creature Type', value: 'humanoid' },
      { label: 'Speed', value: '30 ft' },
      { label: 'Darkvision', value: '90 ft' },
    ]);
  });

  it('prefers the dnd5e 6 species paths over the old ones and uses the stored units', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc('race', 'Snowfolk', {
        movement: { speeds: { walk: 9 }, walk: 25, units: 'm' },
        senses: { ranges: { darkvision: 18 }, darkvision: 60, units: 'm' },
      }),
    });
    expect((await documentsOk([ITEM_UUID]))[0]?.facts).toEqual([
      { label: 'Speed', value: '9 m' },
      { label: 'Darkvision', value: '18 m' },
    ]);
  });

  it('gives a background only its source as a fact', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc('background', 'Trapper', { source: { book: 'XYZ', page: '1' } }),
    });
    expect((await documentsOk([ITEM_UUID]))[0]?.facts).toEqual([
      { label: 'Source', value: 'XYZ p. 1' },
    ]);
  });

  it('keeps at most 30 facts, clips them and never writes an empty one', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc('weapon', 'Long Name', { type: { label: 'x'.repeat(500) } }),
    });
    const facts = (await documentsOk([ITEM_UUID]))[0]?.facts ?? [];
    expect(facts.length).toBeLessThanOrEqual(LIBRARY_LIMITS.factsPerDocument);
    expect(facts[0]?.value.length).toBe(200);
    for (const fact of facts) expect(fact.value.trim()).not.toBe('');
  });
});

describe('getLibraryDocuments: advancement links', () => {
  const grantUuid = (n: number): string => `Compendium.world.test-features.Item.${docId(n)}`;

  function classWithAdvancement(advancement: unknown): Rec {
    return itemDoc(
      'class',
      'Frost Warden',
      {},
      { _source: { name: 'Frost Warden', system: { advancement } } }
    );
  }

  function names(map: Record<string, string>): void {
    setGlobal('fromUuidSync', (uuid: string) => (map[uuid] ? { name: map[uuid] } : null));
  }

  it('reads grants and choices from the advancement object map', async () => {
    names({
      [grantUuid(1)]: 'Snow Step',
      [grantUuid(2)]: 'Frost Sense',
      [grantUuid(3)]: 'Weasel Lore',
      [grantUuid(4)]: 'Chill Aura',
    });
    installDocs({
      [CLASS_UUID]: classWithAdvancement({
        a1: {
          type: 'ItemGrant',
          level: 1,
          configuration: { items: [{ uuid: grantUuid(2) }, { uuid: grantUuid(1) }] },
        },
        a2: {
          type: 'ItemGrant',
          level: 5,
          configuration: { items: [{ uuid: grantUuid(4) }] },
        },
        a3: {
          type: 'ItemChoice',
          level: 1,
          configuration: {
            pool: [{ uuid: grantUuid(3) }],
            choices: { '7': { count: 1 }, '3': { count: 1 } },
          },
        },
        a4: { type: 'HitPoints', level: 1, configuration: { items: [{ uuid: grantUuid(9) }] } },
      }),
    });
    const [doc] = await documentsOk([CLASS_UUID]);
    expect(doc?.links).toEqual([
      { uuid: grantUuid(2), name: 'Frost Sense', level: 1, kind: 'grant' },
      { uuid: grantUuid(1), name: 'Snow Step', level: 1, kind: 'grant' },
      { uuid: grantUuid(3), name: 'Weasel Lore', level: 3, kind: 'choice' },
      { uuid: grantUuid(4), name: 'Chill Aura', level: 5, kind: 'grant' },
    ]);
  });

  it('sorts links of one level by name', async () => {
    names({ [grantUuid(1)]: 'Zeta Step', [grantUuid(2)]: 'Alpha Step' });
    installDocs({
      [CLASS_UUID]: classWithAdvancement({
        a1: {
          type: 'ItemGrant',
          level: 2,
          configuration: { items: [{ uuid: grantUuid(1) }, { uuid: grantUuid(2) }] },
        },
      }),
    });
    expect((await documentsOk([CLASS_UUID]))[0]?.links.map(l => l.name)).toEqual([
      'Alpha Step',
      'Zeta Step',
    ]);
  });

  it('accepts an advancement list, uuid strings, and a choice without choice levels', async () => {
    names({ [grantUuid(1)]: 'Snow Step', [grantUuid(2)]: 'Frost Sense' });
    installDocs({
      [CLASS_UUID]: classWithAdvancement([
        { type: 'ItemGrant', level: 4, configuration: { items: [grantUuid(1)] } },
        { type: 'ItemChoice', level: 6, configuration: { pool: [grantUuid(2)], choices: {} } },
      ]),
    });
    expect((await documentsOk([CLASS_UUID]))[0]?.links).toEqual([
      { uuid: grantUuid(1), name: 'Snow Step', level: 4, kind: 'grant' },
      { uuid: grantUuid(2), name: 'Frost Sense', level: 6, kind: 'choice' },
    ]);
  });

  it('keeps one link per uuid and drops uuids that are not compendium uuids', async () => {
    installDocs({
      [CLASS_UUID]: classWithAdvancement({
        a1: {
          type: 'ItemGrant',
          level: 1,
          configuration: {
            items: [
              { uuid: grantUuid(1) },
              { uuid: grantUuid(1) },
              { uuid: `Item.${docId(5)}` },
              { uuid: 42 },
              {},
              'Actor.xx',
            ],
          },
        },
        a2: { type: 'ItemGrant', level: 2, configuration: { items: [{ uuid: grantUuid(1) }] } },
      }),
    });
    const links = (await documentsOk([CLASS_UUID]))[0]?.links ?? [];
    expect(links).toEqual([{ uuid: grantUuid(1), name: null, level: 1, kind: 'grant' }]);
  });

  it('has a null name when fromUuidSync is missing, throws or finds nothing', async () => {
    const advancement = {
      a1: { type: 'ItemGrant', level: 1, configuration: { items: [{ uuid: grantUuid(1) }] } },
    };
    installDocs({ [CLASS_UUID]: classWithAdvancement(advancement) });
    expect((await documentsOk([CLASS_UUID]))[0]?.links[0]?.name).toBeNull();

    setGlobal('fromUuidSync', () => {
      throw new Error('not indexed');
    });
    expect((await documentsOk([CLASS_UUID]))[0]?.links[0]?.name).toBeNull();

    setGlobal('fromUuidSync', () => ({ name: '' }));
    expect((await documentsOk([CLASS_UUID]))[0]?.links[0]?.name).toBeNull();
  });

  it('looks the name up without strict mode', async () => {
    const calls: unknown[][] = [];
    setGlobal('fromUuidSync', (...args: unknown[]) => {
      calls.push(args);
      return { name: 'Snow Step' };
    });
    installDocs({
      [CLASS_UUID]: classWithAdvancement({
        a1: { type: 'ItemGrant', level: 1, configuration: { items: [{ uuid: grantUuid(1) }] } },
      }),
    });
    await documentsOk([CLASS_UUID]);
    expect(calls).toEqual([[grantUuid(1), { strict: false }]]);
  });

  it('has no links for an item without advancement', async () => {
    installDocs({ [ITEM_UUID]: itemDoc('loot', 'Rope') });
    expect((await documentsOk([ITEM_UUID]))[0]?.links).toEqual([]);
  });

  it('keeps at most 300 links', async () => {
    const items = Array.from({ length: 350 }, (_, n) => ({ uuid: grantUuid(n + 1) }));
    installDocs({
      [CLASS_UUID]: classWithAdvancement({
        a1: { type: 'ItemGrant', level: 1, configuration: { items } },
      }),
    });
    expect((await documentsOk([CLASS_UUID]))[0]?.links.length).toBe(
      LIBRARY_LIMITS.linksPerDocument
    );
  });
});

describe('getLibraryDocuments: npc documents', () => {
  function npcDoc(extra: Rec = {}): Rec {
    return {
      type: 'npc',
      name: 'Snow Weasel',
      _source: { name: 'Snow Weasel', system: { advancement: { a: { type: 'ItemGrant' } } } },
      img: 'ddb-images/weasel.png',
      system: {
        description: { value: '<p>Not a stat block text.</p>' },
        attributes: { ac: { value: 12 }, hp: { max: 9 } },
        details: {
          cr: 0.125,
          type: { value: 'beast' },
          alignment: 'unaligned',
          biography: { value: '<p>Lives in the snow.</p>' },
        },
        source: { book: 'XYZ', page: '4', rules: '2024' },
      },
      items: {
        contents: [
          {
            type: 'feat',
            name: 'Slip Away',
            _source: { name: 'Slip Away' },
            sort: 1,
            system: {
              description: { value: '<p>Slides.</p>' },
              activities: { contents: [{ activation: { type: 'bonus' } }] },
              properties: new Set<string>(),
            },
          },
        ],
      },
      ...extra,
    };
  }

  it('gives an NPC a stat block and no description, links or facts besides the source', async () => {
    installDocs({ [NPC_UUID]: npcDoc() });
    const [doc] = await documentsOk([NPC_UUID]);
    expect(doc).toMatchObject({
      uuid: NPC_UUID,
      pack: 'world.test-monsters',
      id: docId(4),
      name: 'Snow Weasel',
      documentName: 'Actor',
      type: 'npc',
      img: 'ddb-images/weasel.png',
      source: 'XYZ p. 4',
      rules: '2024',
      description: null,
      links: [],
      truncated: false,
      facts: [{ label: 'Source', value: 'XYZ p. 4' }],
    });
    expect(doc?.statBlock).not.toBeNull();
    expect(doc?.statBlock?.rules).toBe('2024');
    expect(doc?.statBlock?.upper.map(l => l.label)).toEqual(['AC', 'HP']);
    expect(doc?.statBlock?.sections.map(s => [s.key, s.entries.map(e => e.name)])).toEqual([
      ['bonus', ['Slip Away']],
    ]);
    expect(doc?.statBlock?.description).toBe('<p>Lives in the snow.</p>');
  });

  it('uses the document rules as the stat block fallback and 2014 when it has none', async () => {
    const noRules = npcDoc();
    (noRules.system as Rec).source = { book: 'XYZ' };
    installDocs({ [NPC_UUID]: noRules });
    const [doc] = await documentsOk([NPC_UUID]);
    expect(doc?.rules).toBeNull();
    expect(doc?.statBlock?.rules).toBe('2014');
  });

  it('is truncated when the stat block text is cut at the description limit', async () => {
    const big = npcDoc();
    (big.system as Rec).details = {
      cr: 1,
      biography: { value: 'x'.repeat(LIBRARY_LIMITS.descriptionBytes + 100) },
    };
    installDocs({ [NPC_UUID]: big });
    const [doc] = await documentsOk([NPC_UUID]);
    expect(doc?.truncated).toBe(true);
    expect(doc?.statBlock?.truncated).toBe(true);
    // The feature text ('<p>Slides.</p>', 14 bytes) is served first and uses part of the budget.
    expect(doc?.statBlock?.description?.length).toBe(LIBRARY_LIMITS.descriptionBytes - 14);
  });
});

describe('getLibraryDocuments: descriptions and budget', () => {
  it('has a null description for an empty or blank description', async () => {
    installDocs({
      [ITEM_UUID]: itemDoc('loot', 'Rock', { description: { value: '' } }),
      [SPELL_UUID]: itemDoc('loot', 'Pebble', { description: { value: '  \n ' } }),
      [CLASS_UUID]: itemDoc('loot', 'Stone'),
    });
    const docs = await documentsOk([ITEM_UUID, SPELL_UUID, CLASS_UUID]);
    expect(docs.map(d => d.description)).toEqual([null, null, null]);
    expect(docs.map(d => d.truncated)).toEqual([false, false, false]);
  });

  it('keeps a description exactly at the limit whole', async () => {
    const text = 'x'.repeat(LIBRARY_LIMITS.descriptionBytes);
    installDocs({ [ITEM_UUID]: itemDoc('loot', 'Rock', { description: { value: text } }) });
    const [doc] = await documentsOk([ITEM_UUID]);
    expect(doc?.description).toBe(text);
    expect(doc?.truncated).toBe(false);
  });

  it('cuts a description over the limit and marks the document truncated', async () => {
    const text = 'x'.repeat(LIBRARY_LIMITS.descriptionBytes + 500);
    installDocs({ [ITEM_UUID]: itemDoc('loot', 'Rock', { description: { value: text } }) });
    const [doc] = await documentsOk([ITEM_UUID]);
    expect(doc?.description?.length).toBe(LIBRARY_LIMITS.descriptionBytes);
    expect(doc?.truncated).toBe(true);
  });

  it('defers the documents that do not fit the response budget but returns at least one', async () => {
    const text = 'x'.repeat(250 * 1024);
    const uuids = Array.from({ length: 9 }, (_, n) => uuidN(n + 10));
    const docs: Record<string, unknown> = {};
    for (const uuid of uuids) docs[uuid] = itemDoc('loot', 'Big', { description: { value: text } });
    const asked = installDocs(docs);
    const response = await getLibraryDocuments({ uuids });
    expect(response.success).toBe(true);
    if (!response.success) return;
    expect(response.documents.length).toBeGreaterThanOrEqual(1);
    expect(response.documents.length).toBeLessThan(uuids.length);
    expect(response.deferred.length).toBeGreaterThan(0);
    // Served documents and deferred uuids together are the request, in order.
    expect([...response.documents.map(d => d.uuid), ...response.deferred]).toEqual(uuids);
    // All nine documents sit in one pack: one call loads them.
    expect(packCalls).toEqual([{ pack: 'world.test-items', ids: uuids.map(u => u.slice(-16)) }]);
    expect(asked.length).toBe(uuids.length);
    const bytes = JSON.stringify(response.documents).length;
    expect(bytes).toBeLessThanOrEqual(LIBRARY_LIMITS.responseBudgetBytes);
  });

  it('loads the documents of one pack in one getDocuments call and of each pack once', async () => {
    const spellA = uuidN(1, 'world.test-spells');
    const spellB = uuidN(2, 'world.test-spells');
    const itemA = uuidN(3, 'world.test-items');
    const docs = {
      [spellA]: itemDoc('spell', 'Frost Nip'),
      [itemA]: itemDoc('loot', 'Rope'),
      [spellB]: itemDoc('spell', 'Drift'),
    };
    installDocs(docs);
    const response = await getLibraryDocuments({ uuids: [spellA, itemA, spellB] });
    expect(response.success && response.documents.map(d => d.uuid)).toEqual([
      spellA,
      itemA,
      spellB,
    ]);
    expect(packCalls).toEqual([
      { pack: 'world.test-spells', ids: [docId(1), docId(2)] },
      { pack: 'world.test-items', ids: [docId(3)] },
    ]);
  });

  it('lists every id of a pack as missing when its getDocuments call fails', async () => {
    setGlobal('game', {
      user: { isGM: true },
      world: { id: 'test-world' },
      packs: {
        get: (id: string) => ({
          collection: id,
          getDocuments: (): Promise<unknown[]> => Promise.reject(new Error('pack locked')),
        }),
      },
    });
    const response = await getLibraryDocuments({ uuids: [SPELL_UUID, ITEM_UUID] });
    expect(response.success && response.missing).toEqual([SPELL_UUID, ITEM_UUID]);
  });

  it('ignores documents a pack returns that were not asked for', async () => {
    setGlobal('game', {
      user: { isGM: true },
      world: { id: 'test-world' },
      packs: {
        get: (id: string) => ({
          collection: id,
          getDocuments: (): Promise<unknown[]> =>
            Promise.resolve([
              { id: docId(99), ...itemDoc('loot', 'Stray') },
              { id: docId(1), ...itemDoc('spell', 'Frost Nip') },
            ]),
        }),
      },
    });
    const response = await getLibraryDocuments({ uuids: [SPELL_UUID] });
    expect(response.success && response.documents.map(d => d.name)).toEqual(['Frost Nip']);
  });

  it('never loads a pack whose documents are all deferred by the budget', async () => {
    const text = 'x'.repeat(250 * 1024);
    const bigUuids = Array.from({ length: 9 }, (_, n) => uuidN(n + 10, 'world.first'));
    const lateUuid = uuidN(50, 'world.second');
    const docs: Record<string, unknown> = {
      [lateUuid]: itemDoc('loot', 'Late'),
    };
    for (const uuid of bigUuids)
      docs[uuid] = itemDoc('loot', 'Big', { description: { value: text } });
    installDocs(docs);
    const response = await getLibraryDocuments({ uuids: [...bigUuids, lateUuid] });
    expect(response.success && response.deferred.includes(lateUuid)).toBe(true);
    expect(packCalls.map(call => call.pack)).toEqual(['world.first']);
  });

  it('always returns a first document even when it alone is large', async () => {
    const text = 'x'.repeat(LIBRARY_LIMITS.descriptionBytes);
    installDocs({ [ITEM_UUID]: itemDoc('loot', 'Big', { description: { value: text } }) });
    const response = await getLibraryDocuments({ uuids: [ITEM_UUID] });
    expect(response.success && response.documents.length).toBe(1);
    expect(response.success && response.deferred).toEqual([]);
  });
});
