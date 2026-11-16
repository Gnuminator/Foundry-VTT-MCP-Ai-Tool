/**
 * playerRead: one player's own Claude. Everything is scoped to the user resolved from `userId`;
 * the canary strings below must never appear in any answer for player A.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { RulesSearchDataAccess } from './data-access/rules-search.js';
import {
  isDeniedPack,
  playerRead,
  PLAYER_READ_QUERY,
  warmPlayerIndexes,
  type PlayerReadDeps,
} from './player-read.js';
import { NON_WRITE_METHODS, WRITE_METHODS } from './write-gate.js';

const g = globalThis as any;
const savedGame = g.game;

const userA = { id: 'playerA00000001', name: 'Alice', isGM: false };
const userB = { id: 'playerB00000001', name: 'Bob', isGM: false };
const gm = { id: 'gm0000000000001', name: 'GM', isGM: true };

const CANARIES = [
  'CANARY-WORLD-JOURNAL',
  'CANARY-ADVENTURE',
  'CANARY-DMG',
  'CANARY-SYSTEM',
  'CANARY-HIDDEN-PACK',
  'CANARY-NONE-ENTRY',
  'CANARY-OTHER-ACTOR',
  'CANARY-WORLD-PACK',
  'CANARY-GM-SECRET-ITEM',
  'CANARY-GM-SECRET-PAGE',
  'CANARY-UNIDENTIFIED-TRUE',
];

/** A document a given set of users may observe (everyone in `users`). */
function perm(users: unknown[], level = 'OBSERVER') {
  return (u: unknown, l: string): boolean => (l === level || l === 'OBSERVER') && users.includes(u);
}

function actor(id: string, name: string, owners: unknown[], type = 'character'): any {
  return {
    id,
    name,
    type,
    system: { details: { level: 2 } },
    items: [],
    testUserPermission: (u: unknown, l: string): boolean =>
      owners.includes(u) && (l === 'OWNER' || l === 'OBSERVER'),
  };
}

function itemDoc(id: string, name: string, type: string, html: string, viewers: unknown[]): any {
  return {
    id,
    _id: id,
    name,
    type,
    system: { description: { value: html } },
    testUserPermission: perm(viewers),
  };
}

function journalDoc(
  id: string,
  name: string,
  pages: Array<[string, string]>,
  viewers: unknown[]
): any {
  return {
    id,
    _id: id,
    name,
    pages: pages.map(([pname, text], i) => ({
      id: `${id}p${i}`,
      name: pname,
      text: { content: text },
    })),
    testUserPermission: perm(viewers),
  };
}

function pack(
  id: string,
  type: string,
  docs: any[],
  opts: { viewers?: unknown[]; packageType?: string; label?: string } = {}
): any {
  const [pkg] = id.split('.');
  // Foundry 14: a document or page inside a pack uses the PACK's permission level.
  const packLevel = perm(opts.viewers ?? [userA, userB]);
  for (const d of docs) {
    d.testUserPermission = packLevel;
    for (const p of d.pages ?? []) p.testUserPermission = packLevel;
  }
  return {
    documentName: type,
    collection: id,
    metadata: {
      id,
      label: opts.label ?? id,
      packageName: pkg,
      type,
      packageType: opts.packageType ?? 'module',
    },
    getDocuments: async (): Promise<any[]> => docs,
    getDocument: async (docId: string): Promise<any> => docs.find(d => d.id === docId) ?? null,
    // Like Foundry: system fields come back only when listed in options.fields.
    getIndex: async (options?: { fields?: string[] }): Promise<any[]> => {
      const fields = options?.fields ?? [];
      return docs.map(d => {
        const system: Record<string, unknown> = {};
        if (d.system && 'identified' in d.system && fields.includes('system.identified')) {
          system.identified = d.system.identified;
        }
        if (d.system && 'identified' in d.system && fields.includes('system.unidentified.name')) {
          system.unidentified = { name: d.system.unidentified?.name };
        }
        return {
          _id: d.id,
          name: d.name,
          type: d.type,
          ...(Object.keys(system).length > 0 ? { system } : {}),
        };
      });
    },
    testUserPermission: perm(opts.viewers ?? [userA, userB]),
  };
}

const levelUpCalls: any[] = [];
const rulesSearch = new RulesSearchDataAccess();
const deps: PlayerReadDeps = {
  rulesSearch,
  levelUp: {
    getLevelUpOptions: async data => {
      levelUpCalls.push(data);
      return { ok: true, identifier: data.identifier };
    },
  },
};

function install(): void {
  const fireball = itemDoc(
    'spellfireball01',
    'Fireball',
    'spell',
    '<p>A bright streak flashes and blossoms into an explosion of flame. Fireball damage 8d6.</p><section class="secret"><p>CANARY-GM-SECRET-ITEM fireball</p></section>',
    [userA, userB]
  );
  const ring = itemDoc(
    'ringunid000001',
    'Mystery ring',
    'equipment',
    '<p>CANARY-UNIDENTIFIED-TRUE ring of fireball</p>',
    [userA]
  );
  ring.system.identified = false;
  ring.system.unidentified = { name: 'Plain ring', description: '<p>A plain iron ring.</p>' };
  const longSpell = itemDoc(
    'spelllong000001',
    'Wishful',
    'spell',
    `<p>${'word '.repeat(2000)}</p>`,
    [userA]
  );
  const phb = pack('dnd-players-handbook.spells', 'Item', [fireball, ring, longSpell]);
  const grapple = journalDoc(
    'jrnlgrapple0001',
    'Grappling',
    [
      [
        'Grappling',
        `<p>Grappling lets you seize a creature. ${'detail '.repeat(300)}</p><section class="secret"><p>CANARY-GM-SECRET-PAGE grappling</p></section>`,
      ],
    ],
    [userA]
  );
  const phbJournal = pack('dnd-players-handbook.rules', 'JournalEntry', [grapple]);

  g.game = {
    users: { get: (id: string): unknown => [userA, userB, gm].find(u => u.id === id) },
    actors: [
      actor('actorA0000000001', 'Brenna', [userA]),
      actor('actorB0000000001', 'Tamsin', [userB]),
      actor('actorGM000000001', 'CANARY-OTHER-ACTOR', [gm], 'character'),
      actor('npcA00000000001', 'Wolf', [userA], 'npc'),
    ],
    journal: [
      journalDoc(
        'worldjrnl000001',
        'Barovia',
        [['Strahd', '<p>CANARY-WORLD-JOURNAL Strahd fireball grappling</p>']],
        [userA]
      ),
    ],
    packs: [
      phb,
      phbJournal,
      pack('adv.curse', 'Adventure', [
        itemDoc('adv1', 'CANARY-ADVENTURE fireball', 'spell', '<p>CANARY-ADVENTURE fireball</p>', [
          userA,
        ]),
      ]),
      pack('aitool-content.journals', 'JournalEntry', [
        journalDoc(
          'dmg1',
          'DMG',
          [['Ravenloft', '<p>CANARY-DMG Ravenloft fireball grappling</p>']],
          [userA]
        ),
      ]),
      pack('dnd5e.rules', 'JournalEntry', [
        journalDoc(
          'sys1',
          'System',
          [['Rules', '<p>CANARY-SYSTEM fireball grappling</p>']],
          [userA]
        ),
      ]),
      pack('dnd5e.monsters', 'Item', [
        itemDoc('mon1', 'Strahd fireball', 'npc', '<p>CANARY-SYSTEM fireball</p>', [userA]),
      ]),
      pack(
        'other-mod.secret',
        'Item',
        [
          itemDoc('hid1', 'Hidden fireball', 'spell', '<p>CANARY-HIDDEN-PACK fireball</p>', [
            userA,
          ]),
          itemDoc(
            'spellnone000001',
            'Fireball Secret',
            'spell',
            '<p>CANARY-NONE-ENTRY fireball variant.</p>',
            [userA]
          ),
        ],
        { viewers: [userB] }
      ),
      pack(
        'other-mod.hiddenbook',
        'JournalEntry',
        [
          journalDoc(
            'hidj1',
            'Hidden book',
            [['Secret page', '<p>CANARY-NONE-ENTRY grappling</p>']],
            [userA]
          ),
        ],
        { viewers: [userB] }
      ),
      pack(
        'world.mine',
        'Item',
        [itemDoc('wp1', 'World fireball', 'spell', '<p>CANARY-WORLD-PACK fireball</p>', [userB])],
        { packageType: 'world', viewers: [userB] }
      ),
      // The live campaign keeps the kept books in world.player-* packs: readable when observed.
      pack(
        'world.player-feats',
        'Item',
        [itemDoc('wf1', 'Lucky Charm', 'feat', '<p>POSITIVE-WORLD-FEAT text</p>', [userA])],
        { packageType: 'world', viewers: [userA] }
      ),
    ],
  };
}

function assertNoCanary(value: unknown): void {
  const text = JSON.stringify(value);
  for (const c of CANARIES) expect(text).not.toContain(c);
}

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  levelUpCalls.length = 0;
  // The index is cached per pack id for minutes: a test must not see the last test's packs.
  rulesSearch.clearCache();
  install();
});
afterEach(() => {
  g.game = savedGame;
  vi.restoreAllMocks();
});

const as = (action: string, extra: Record<string, unknown> = {}): Promise<any> =>
  playerRead({ userId: userA.id, action, ...extra }, deps) as Promise<any>;

describe('playerRead: user checks', () => {
  it('refuses a GM user and an unknown user, and an unknown action', async () => {
    await expect(playerRead({ userId: gm.id, action: 'character' }, deps)).rejects.toThrow(
      'No such player'
    );
    await expect(
      playerRead({ userId: 'nobody', action: 'searchBooks', query: 'fireball' }, deps)
    ).rejects.toThrow('No such player');
    await expect(playerRead({ action: 'character' }, deps)).rejects.toThrow('No such player');
    await expect(as('dropTable')).rejects.toThrow();
  });

  it('is classified as a read', () => {
    expect(PLAYER_READ_QUERY).toBe('playerRead');
    expect(NON_WRITE_METHODS).toContain('playerRead');
    expect(WRITE_METHODS).not.toContain('playerRead');
  });
});

describe('playerRead: characters', () => {
  it('returns only the user own character', async () => {
    const r = await as('character');
    expect(r.sheets.map((s: any) => s.name)).toEqual(['Brenna']);
    assertNoCanary(r);
    expect(JSON.stringify(r)).not.toContain('Tamsin');
  });

  it('filters by name and reports no match', async () => {
    expect((await as('character', { name: 'bren' })).sheets).toHaveLength(1);
    const none = await as('character', { name: 'Tamsin' });
    expect(none).toEqual({ sheets: [], note: 'No character of yours matches that name.' });
  });

  it('levelUp uses the owned actor id, never a client identifier', async () => {
    const r = await as('levelUp', { className: 'Fighter', identifier: 'actorB0000000001' });
    expect(r.identifier).toBe('actorA0000000001');
    expect(levelUpCalls).toEqual([{ identifier: 'actorA0000000001', className: 'Fighter' }]);
    await as('levelUp', { name: 'brenna' });
    expect(levelUpCalls[1].identifier).toBe('actorA0000000001');
  });

  it('levelUp for another player or GM actor gives the generic error', async () => {
    for (const name of ['Tamsin', 'CANARY-OTHER-ACTOR', 'actorB0000000001', 'Wolf']) {
      await expect(as('levelUp', { name })).rejects.toThrow(
        'Character not found among your characters'
      );
    }
    // A foreign userId smuggled inside name does nothing.
    await expect(as('levelUp', { name: userB.id })).rejects.toThrow(
      'Character not found among your characters'
    );
    expect(levelUpCalls).toEqual([]);
  });

  it('levelUp with several owned characters asks for a name', async () => {
    g.game.actors.push(actor('actorA0000000002', 'Cass', [userA]));
    await expect(as('levelUp')).rejects.toThrow(/Brenna, Cass/);
  });
});

describe('warmPlayerIndexes', () => {
  it('builds the indexes of the packs players may observe, so the first search does not', async () => {
    const all = [userA, userB, gm];
    g.game.users = Object.assign([...all], {
      get: (id: string): unknown => all.find(u => u.id === id),
    });
    const spy = vi.spyOn(rulesSearch, 'warmScoped');
    const n = await warmPlayerIndexes({ rulesSearch });
    const warmed = spy.mock.calls[0][0].map((p: any) => p.metadata.id);
    expect(n).toBe(warmed.length);
    expect(warmed.length).toBeGreaterThan(0);
    // The adventure packs stay cold; packs only player B may observe are warmed (the cache is
    // shared), which must not change what player A finds.
    for (const id of ['aitool-content.journals', 'adv.curse', 'dnd5e.rules', 'dnd5e.monsters']) {
      expect(warmed).not.toContain(id);
    }
    expect(warmed).toContain('other-mod.hiddenbook');
    expect(warmed).toContain('other-mod.secret');
    expect(warmed).toContain('world.mine');
    // The search after the warm-up reads the cache: it does not call getDocuments again.
    const docs = g.game.packs.filter((p: any) => warmed.includes(p.metadata.id));
    const counts = docs.map((p: any) => vi.spyOn(p, 'getDocuments'));
    const r = await as('searchBooks', { query: 'fireball' });
    expect(r.results.map((h: any) => h.name)).toContain('Fireball');
    for (const c of counts) expect(c).not.toHaveBeenCalled();
    assertNoCanary(r);
    // The shared cache holds packs player A cannot observe; A's search still finds nothing of them.
    const g2 = await as('searchBooks', { query: 'grappling' });
    expect(g2.results.map((h: any) => h.name)).toEqual(['Grappling']);
    assertNoCanary(g2);
  });
});

describe('playerRead: books', () => {
  it('searchBooks finds a rules entry and leaks nothing else', async () => {
    const r = await as('searchBooks', {
      query: 'fireball',
      includeWorld: true,
      includeOtherBooks: true,
    });
    expect(r.results.map((h: any) => h.name)).toContain('Fireball');
    expect(r.results[0]).not.toHaveProperty('score');
    expect(r.results[0]).not.toHaveProperty('readWith');
    assertNoCanary(r);
    const g2 = await as('searchBooks', { query: 'grappling', includeWorld: true });
    expect(g2.results.map((h: any) => h.name)).toEqual(['Grappling']);
    assertNoCanary(g2);
  });

  it('caps limit and excerptChars', async () => {
    const r = await as('searchBooks', { query: 'grappling', excerptChars: 5000, limit: 500 });
    expect(r.results.length).toBeLessThanOrEqual(10);
    expect(r.results[0].snippet.length).toBeLessThanOrEqual(600 + 6);
    const small = await as('searchBooks', { query: 'grappling' });
    expect(small.results[0].snippet.length).toBeLessThanOrEqual(240 + 6);
  });

  it('findEntries lists readable entries by name and type', async () => {
    const r = await as('findEntries', { query: 'fireball', type: 'spell' });
    expect(r.results).toEqual([
      expect.objectContaining({
        packId: 'dnd-players-handbook.spells',
        entryId: 'spellfireball01',
        name: 'Fireball',
        type: 'spell',
      }),
    ]);
    assertNoCanary(r);
    const all = await as('findEntries', { limit: 999 });
    assertNoCanary(all);
    expect(all.results.length).toBeLessThanOrEqual(20);
    const journals = await as('findEntries', { type: 'JournalEntry' });
    expect(journals.results.map((x: any) => x.name)).toEqual(['Grappling']);
  });

  it('getEntry returns an item and a journal (visible pages only)', async () => {
    const item = await as('getEntry', {
      packId: 'dnd-players-handbook.spells',
      entryId: 'spellfireball01',
    });
    expect(item).toMatchObject({ name: 'Fireball', type: 'spell' });
    expect(item.description).toContain('explosion of flame');
    const jr = await as('getEntry', {
      packId: 'dnd-players-handbook.rules',
      entryId: 'jrnlgrapple0001',
    });
    expect(jr.description).toContain('Grappling: Grappling lets you seize');
    assertNoCanary(jr);
  });

  it('getEntry caps the description', async () => {
    const r = await as('getEntry', {
      packId: 'dnd-players-handbook.spells',
      entryId: 'spelllong000001',
    });
    expect(r.description.length).toBe(6000);
    expect(r.truncated).toBe(true);
  });

  it('getEntry gives one identical error for every unreadable entry', async () => {
    const attempts: Array<[string, string]> = [
      ['other-mod.secret', 'spellnone000001'], // a pack the user cannot observe
      ['other-mod.hiddenbook', 'hidj1'],
      ['dnd-players-handbook.spells', 'doesnotexist'],
      ['aitool-content.journals', 'dmg1'],
      ['dnd5e.rules', 'sys1'],
      ['dnd5e.monsters', 'mon1'],
      ['adv.curse', 'adv1'],
      ['other-mod.secret', 'hid1'],
      ['world.mine', 'wp1'],
      ['nope.nothing', 'x'],
    ];
    for (const [packId, entryId] of attempts) {
      await expect(as('getEntry', { packId, entryId })).rejects.toThrow(/^Entry not found$/);
    }
    await expect(as('getEntry', {})).rejects.toThrow('Entry not found');
  });

  it('reads an observable world.player-* pack, and not a world pack the user cannot observe', async () => {
    const r = await as('findEntries', { query: 'lucky' });
    expect(r.results.map((x: any) => x.name)).toEqual(['Lucky Charm']);
    const e = await as('getEntry', { packId: 'world.player-feats', entryId: 'wf1' });
    expect(e.description).toContain('POSITIVE-WORLD-FEAT');
    const none = await as('findEntries', { query: 'world fireball' });
    expect(none.results).toEqual([]);
  });

  it('keeps GM secret blocks and unidentified text out of search and getEntry', async () => {
    for (const query of ['fireball', 'grappling', 'ring iron']) {
      assertNoCanary(await as('searchBooks', { query, excerptChars: 600 }));
    }
    const item = await as('getEntry', {
      packId: 'dnd-players-handbook.spells',
      entryId: 'spellfireball01',
    });
    expect(item.description).toContain('explosion of flame');
    assertNoCanary(item);
    const ring = await as('getEntry', {
      packId: 'dnd-players-handbook.spells',
      entryId: 'ringunid000001',
    });
    expect(ring.description).toBe('A plain iron ring.');
    const book = await as('getEntry', {
      packId: 'dnd-players-handbook.rules',
      entryId: 'jrnlgrapple0001',
    });
    expect(book.description).toContain('seize a creature');
    assertNoCanary(book);
  });

  it('a GM search that ran first does not put secrets or the true name in the player answers', async () => {
    g.game.settings = { get: (): string => '' };
    const gmFirst = await deps.rulesSearch.searchRules({ query: 'fireball', excerptChars: 4000 });
    expect(JSON.stringify(gmFirst)).toContain('CANARY-GM-SECRET-ITEM');
    for (const query of ['fireball', 'grappling', 'ring iron']) {
      assertNoCanary(await as('searchBooks', { query, excerptChars: 600 }));
    }
    const ring = await as('searchBooks', { query: 'plain iron ring' });
    expect(ring.results.map((h: any) => h.name)).toEqual(['Plain ring']);
  });

  it('findEntries lists an unidentified item under its unidentified name only', async () => {
    const byTrueName = await as('findEntries', { query: 'mystery' });
    expect(byTrueName.results).toEqual([]);
    const byShownName = await as('findEntries', { query: 'plain ring' });
    expect(byShownName.results).toEqual([
      expect.objectContaining({ entryId: 'ringunid000001', name: 'Plain ring' }),
    ]);
    assertNoCanary(byShownName);
    expect(JSON.stringify(byShownName)).not.toContain('Mystery');
    const entry = await as('getEntry', {
      packId: 'dnd-players-handbook.spells',
      entryId: 'ringunid000001',
    });
    expect(entry.name).toBe('Plain ring');
  });

  it('an unidentified item with no unidentified name shows a placeholder', async () => {
    const pack = g.game.packs[0];
    const doc = (await pack.getDocuments()).find((d: any) => d.id === 'ringunid000001');
    doc.system.unidentified.name = '';
    const r = await as('findEntries', { query: 'unidentified' });
    expect(r.results.map((x: any) => x.name)).toEqual(['Unidentified item']);
    expect(JSON.stringify(r)).not.toContain('Mystery');
    const entry = await as('getEntry', {
      packId: 'dnd-players-handbook.spells',
      entryId: 'ringunid000001',
    });
    expect(entry.name).toBe('Unidentified item');
    expect(JSON.stringify(entry)).not.toContain('Mystery');
    const found = await as('searchBooks', { query: 'plain iron ring' });
    expect(found.results.map((x: any) => x.name)).toEqual(['Unidentified item']);
    expect(JSON.stringify(found)).not.toContain('Mystery');
  });

  it('findEntries takes "species" for the dnd5e type "race"', async () => {
    g.game.packs.push(
      pack('dnd-players-handbook.origins', 'Item', [
        itemDoc('spHuman00000001', 'Human', 'race', '<p>People.</p>', [userA]),
      ])
    );
    const r = await as('findEntries', { query: 'human', type: 'species' });
    expect(r.results).toEqual([expect.objectContaining({ name: 'Human', type: 'race' })]);
  });

  it('the GM search keeps the full text, separate from the player index', async () => {
    g.game.settings = { get: (): string => '' };
    await as('searchBooks', { query: 'fireball' });
    const gmResult = await deps.rulesSearch.searchRules({ query: 'fireball', excerptChars: 4000 });
    expect(JSON.stringify(gmResult)).toContain('CANARY-GM-SECRET-ITEM');
  });

  it('a permission function that is missing counts as not allowed', async () => {
    const spells = g.game.packs[0];
    delete spells.testUserPermission;
    const r = await as('findEntries', { query: 'fireball' });
    expect(r.results).toEqual([]);
  });
});

describe('isDeniedPack', () => {
  it('denies adventures, dnd5e and the DMG pack, but not world packs as a class', () => {
    const mk = (id: string, type = 'Item', packageType = 'module'): any =>
      ({
        documentName: type,
        metadata: { id, type, packageType, packageName: id.split('.')[0] },
      }) as any;
    expect(isDeniedPack(mk('x.y', 'Adventure'))).toBe(true);
    expect(isDeniedPack(mk('dnd5e.rules'))).toBe(true);
    expect(isDeniedPack(mk('aitool-content.journals', 'JournalEntry'))).toBe(true);
    expect(isDeniedPack(mk('world.player-feats', 'Item', 'world'))).toBe(false);
    expect(isDeniedPack(mk('dnd-players-handbook.spells'))).toBe(false);
    expect(isDeniedPack(mk('aitool-content.spells'))).toBe(false);
  });
});
