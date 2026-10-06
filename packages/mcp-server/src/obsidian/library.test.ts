/**
 * The Library (design 13): categories, note rendering (stat blocks, facts, advancement links)
 * and the sync (paths allocated from the index before any note exists, signatures, the fetch
 * queue, trash for documents that left the packs, Library links for world notes).
 *
 * Every name and text here is made up; no book content.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type {
  ExportStatBlock,
  LibraryDocument,
  LibraryIndexRow,
  LibraryPackInfo,
} from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  bookBasePaths,
  bookBaseTitle,
  isNoBookNoteText,
  libraryCategory,
  NO_BOOK_LINK_LIMIT,
  NO_BOOK_NOTE_PATH,
  renderBookBase,
  renderLibraryNote,
  renderNoBookNote,
  type LibraryNoteContext,
} from './library-render.js';
import { LibrarySync, type LibrarySyncDeps } from './library-sync.js';
import { versionedSig, type LinkContext } from './mirror-common.js';
import { KEPT_AT_OLD_PATH } from './note-writer.js';
import { checkMarkdownOwnership } from './ownership.js';
import { statBlockMarkdown } from './stat-block-md.js';

const WORLD = 'test-world';
const PACK = 'world.test-bestiary';
const SPELLS = 'world.test-spells';
const CLASSES = 'world.test-classes';
const id = (n: number): string => `doc${String(n).padStart(13, '0')}`;
const uuidOf = (pack: string, type: 'Actor' | 'Item', n: number): string =>
  `Compendium.${pack}.${type}.${id(n)}`;

const WEASEL = uuidOf(PACK, 'Actor', 1);
const SPARK = uuidOf(SPELLS, 'Item', 2);
const SPARK_2024 = uuidOf(SPELLS, 'Item', 3);
const WARDEN = uuidOf(CLASSES, 'Item', 4);
const PATH = uuidOf(CLASSES, 'Item', 5);
const GLOW = uuidOf(CLASSES, 'Item', 6);

function row(
  over: Partial<LibraryIndexRow> & Pick<LibraryIndexRow, 'uuid' | 'name' | 'type'>
): LibraryIndexRow {
  const parts = over.uuid.split('.');
  return {
    pack: `${parts[1]}.${parts[2]}`,
    id: parts[4] ?? '',
    subtype: null,
    group: null,
    identifier: null,
    classIdentifier: null,
    rules: '2014',
    sig: 's1',
    ...over,
  };
}

const STAT_BLOCK: ExportStatBlock = {
  rules: '2014',
  tag: 'Tiny beast, unaligned',
  upper: [
    { label: 'Armor Class', value: '13' },
    { label: 'Hit Points', value: '4 (1d4 + 2)' },
    { label: 'Speed', value: '30 ft' },
  ],
  abilities: ['str', 'dex', 'con', 'int', 'wis', 'cha'].map((key, i) => ({
    key,
    label: key.toUpperCase(),
    score: 10 + i,
    mod: Math.floor(i / 2),
    save: Math.floor(i / 2),
  })),
  lower: [
    { label: 'Proficiency Bonus', value: '+2' },
    { label: 'Challenge', value: '0 (10 XP)' },
  ],
  sections: [
    {
      key: 'trait',
      label: 'Traits',
      intro: null,
      entries: [{ name: 'Slippery', html: '<p>It squeezes through gaps.</p>' }],
    },
    {
      key: 'action',
      label: 'Actions',
      intro: null,
      entries: [
        {
          name: 'Nip (3/Day)',
          html: `<p>[[/roll 1d20 + 4]] to hit. <em>Hit:</em> [[/damage 1d4 + 2 piercing average=true]] damage. It may cast @UUID[${SPARK}]{frost spark}.</p>`,
        },
      ],
    },
  ],
  spells: [{ name: 'Frost Spark', level: 0, sourceUuid: null }],
  description: '<p>A made-up weasel.</p>',
  truncated: false,
};

function linkCtx(fromPath: string, library?: LinkContext['library']): LinkContext {
  return {
    pageUuid: WEASEL,
    openBase: 'http://localhost:3100',
    fromPath,
    resolve: () => null,
    ...(library ? { library } : {}),
  };
}

describe('libraryCategory', () => {
  const BOOK = { book: 'TB 2024', bookTitle: 'Test Bestiary (2024)' };

  it('sorts documents into folders by kind, then book, with player-safe rules content', () => {
    expect(
      libraryCategory({ uuid: WEASEL, type: 'npc', subtype: null, group: null, ...BOOK })
    ).toMatchObject({
      folder: 'AI Tool/Library/Monsters/Test Bestiary (2024)',
      tag: 'monster',
      playerSafe: false,
    });
    expect(libraryCategory({ type: 'spell', subtype: null, group: null, ...BOOK }).folder).toBe(
      'AI Tool/Library/Spells/Test Bestiary (2024)'
    );
    expect(
      libraryCategory({ type: 'feat', subtype: 'class', group: 'Warden (2014)', ...BOOK }).folder
    ).toBe('AI Tool/Library/Class features/Test Bestiary (2024)/Warden (2014)');
    expect(
      libraryCategory({ type: 'feat', subtype: 'race', group: 'Weaselkin', ...BOOK }).folder
    ).toBe('AI Tool/Library/Species traits/Test Bestiary (2024)/Weaselkin');
    expect(libraryCategory({ type: 'feat', subtype: 'feat', group: null }).tag).toBe('feat');
    expect(libraryCategory({ type: 'loot', subtype: null, group: null, ...BOOK })).toMatchObject({
      folder: 'AI Tool/Library/Items/Test Bestiary (2024)',
      playerSafe: true,
    });
    expect(libraryCategory({ type: 'feat', subtype: 'monster', group: null }).playerSafe).toBe(
      false
    );
  });

  it('puts an entry without a book in Other, a homebrew code as it is, and the code without a title', () => {
    expect(libraryCategory({ type: 'spell', subtype: null, group: null }).folder).toBe(
      'AI Tool/Library/Spells/Other'
    );
    expect(
      libraryCategory({ type: 'spell', subtype: null, group: null, book: null, bookTitle: null })
        .folder
    ).toBe('AI Tool/Library/Spells/Other');
    expect(
      libraryCategory({ type: 'spell', subtype: null, group: null, book: 'Homebrew' }).folder
    ).toBe('AI Tool/Library/Spells/Homebrew');
    expect(
      libraryCategory({ type: 'spell', subtype: null, group: null, book: 'XYZ', bookTitle: null })
        .folder
    ).toBe('AI Tool/Library/Spells/XYZ');
  });

  it('makes a book title a safe folder name', () => {
    const odd = libraryCategory({
      type: 'npc',
      subtype: null,
      group: null,
      bookTitle: 'Strange: Tome/of <Things>?. ',
    }).folder;
    expect(odd).toBe('AI Tool/Library/Monsters/Strange Tome of Things');
    const long = libraryCategory({
      type: 'npc',
      subtype: null,
      group: null,
      bookTitle: 'A'.repeat(200),
    }).folder;
    expect(long).toBe(`AI Tool/Library/Monsters/${'A'.repeat(60)}`);
    expect(
      libraryCategory({ type: 'npc', subtype: null, group: null, bookTitle: '.hidden' }).folder
    ).toBe('AI Tool/Library/Monsters/_hidden');
  });
});

describe('book bases', () => {
  it('filters the Library by book and reads the title back, quotes and all', () => {
    const title = 'Player\'s Guide: "Quoted" (2024)';
    const text = renderBookBase(WORLD, title);
    expect(text).toContain(`    - file.inFolder("Campaigns/${WORLD}/AI Tool/Library")`);
    expect(text).toContain(`    - 'book == "Player''s Guide: \\"Quoted\\" (2024)"'`);
    expect(text).toContain("    name: 'Player''s Guide: \"Quoted\" (2024)'");
    expect(bookBaseTitle(text)).toBe(title);
    expect(bookBaseTitle('filters:\n  and:\n    - type == "x"\n')).toBeNull();
  });

  it('gives each title its own file, a hash when two titles clean to the same name', () => {
    const paths = bookBasePaths(['B: Two', 'A Book', 'B  Two', 'A Book']);
    expect(paths.get('A Book')).toBe('AI Tool/Library/Books/A Book.base');
    expect(paths.get('B  Two')).toBe('AI Tool/Library/Books/B Two.base');
    expect(paths.get('B: Two')).toMatch(/^AI Tool\/Library\/Books\/B Two \([0-9a-z]{6}\)\.base$/);
  });
});

describe('the "Without a book" note (I-120 c)', () => {
  it('groups by kind folder, sorts by name, escapes names and stops at the link limit', () => {
    const entries = [
      { path: 'AI Tool/Library/Items/Other/b.md', name: 'b [x]' },
      { path: 'AI Tool/Library/Items/Other/A.md', name: 'A' },
      { path: 'AI Tool/Library/Feats/Other/Tough.md', name: 'Tough' },
    ];
    const text = renderNoBookNote(WORLD, NO_BOOK_NOTE_PATH, entries);
    expect(NO_BOOK_NOTE_PATH).toBe('AI Tool/Library/Books/Without a book.md');
    expect(isNoBookNoteText(text)).toBe(true);
    expect(text).not.toMatch(/^book:/m);
    const body = text.slice(text.indexOf('3 notes.'));
    expect(body.split('\n').filter(line => line.startsWith('## '))).toEqual([
      '## Feats',
      '## Items',
    ]);
    expect(body).toContain('- [A](../Items/Other/A.md)\n- [b \\[x\\]](../Items/Other/b.md)');

    const many = Array.from({ length: NO_BOOK_LINK_LIMIT + 2 }, (_, i) => ({
      path: `AI Tool/Library/Items/Other/n${i}.md`,
      name: `n${i}`,
    }));
    const capped = renderNoBookNote(WORLD, NO_BOOK_NOTE_PATH, many);
    expect(capped.split('\n').filter(line => line.startsWith('- ['))).toHaveLength(
      NO_BOOK_LINK_LIMIT
    );
    expect(capped).toContain(`${NO_BOOK_LINK_LIMIT + 2} notes.`);
    expect(capped).toContain('And 2 more.');
  });
});

describe('statBlockMarkdown', () => {
  it('renders one callout with the book layout and readable rolls', () => {
    const text = statBlockMarkdown(
      'Snow Weasel',
      STAT_BLOCK,
      linkCtx('AI Tool/Library/Monsters/Snow Weasel.md')
    );
    expect(text.split('\n').every(line => line.startsWith('>'))).toBe(true);
    expect(text).toContain('> [!statblock] Snow Weasel');
    expect(text).toContain('> *Tiny beast, unaligned*');
    expect(text).toContain('> **Armor Class** 13\n> **Hit Points** 4 (1d4 + 2)');
    expect(text).toContain('> | 10 (+0) | 11 (+0) | 12 (+1) | 13 (+1) | 14 (+2) | 15 (+2) |');
    expect(text).toContain('> **Proficiency Bonus** +2');
    expect(text).toContain('> ***Slippery.*** It squeezes through gaps.');
    expect(text).toContain('> ### Actions');
    expect(text).toContain(
      '> ***Nip (3/Day).*** 1d20 + 4 to hit. *Hit:* 4 (1d4 + 2) piercing damage.'
    );
    expect(text).toContain('> **Cantrips** Frost Spark');
    expect(text).not.toMatch(/\[\[\/|@UUID|`/);
  });

  it('adds a save row when a save differs from the modifier', () => {
    const block = {
      ...STAT_BLOCK,
      abilities: STAT_BLOCK.abilities.map(a => (a.key === 'dex' ? { ...a, save: 5 } : a)),
    };
    const text = statBlockMarkdown('Snow Weasel', block, linkCtx('x.md'));
    expect(text).toContain('> | Score | 10 (+0) |');
    expect(text).toContain('> | Save | +0 | +5 |');
  });

  it('does not repeat a name the feature text already opens with', () => {
    const block = {
      ...STAT_BLOCK,
      sections: [
        {
          key: 'action',
          label: 'Actions',
          intro: null,
          entries: [
            {
              name: 'Sneeze Blast (Recharge 6)',
              html: '<p><em><strong>Sneeze Blast <span>(Recharge 6)</span>.</strong></em> A cone of fluff.</p>',
            },
            { name: 'Wiggle', html: '<p><strong>Note.</strong> Not the name.</p>' },
          ],
        },
      ],
    };
    const text = statBlockMarkdown('Snow Weasel', block, linkCtx('x.md'));
    expect(text).toContain('> ***Sneeze Blast (Recharge 6).*** A cone of fluff.');
    expect(text.match(/Sneeze Blast/g)).toHaveLength(1);
    expect(text).toContain('> ***Wiggle.*** **Note.** Not the name.');
  });
});

describe('renderLibraryNote', () => {
  const ctx = (paths: Record<string, string>): LibraryNoteContext => {
    const library = {
      byUuid: (uuid: string) =>
        paths[uuid] ? { notePath: paths[uuid] ?? null, name: uuid.slice(-4) } : null,
      legacy: () => null,
      spellByName: (name: string) => (name === 'Frost Spark' ? SPARK : null),
    };
    return {
      worldId: WORLD,
      openBase: 'http://localhost:3100',
      linkContext: (fromPath, uuid, selfName) => ({
        ...linkCtx(fromPath, library),
        pageUuid: uuid,
        selfName,
      }),
      library,
      packLabel: pack => `Label of ${pack}`,
      classByIdentifier: identifier =>
        identifier === 'warden' ? { uuid: WARDEN, name: 'Warden' } : null,
      subclassesOf: identifier =>
        identifier === 'warden' ? [{ uuid: PATH, name: 'Path of Embers' }] : [],
      image: (src, _alt, width) =>
        `![[Campaigns/${WORLD}/AI Tool/Attachments/${src}${width ? `|${width}` : ''}]]`,
    };
  };
  const paths = {
    [WEASEL]: 'AI Tool/Library/Monsters/Snow Weasel.md',
    [SPARK]: 'AI Tool/Library/Spells/Frost Spark.md',
    [WARDEN]: 'AI Tool/Library/Classes/Warden.md',
    [PATH]: 'AI Tool/Library/Subclasses/Path of Embers.md',
    [GLOW]: 'AI Tool/Library/Class features/Warden/Ember Glow.md',
  };
  const base = (over: Partial<LibraryDocument>): LibraryDocument => ({
    uuid: SPARK,
    pack: SPELLS,
    id: id(2),
    name: 'Frost Spark',
    documentName: 'Item',
    type: 'spell',
    subtype: null,
    img: null,
    source: 'Made-up Book p. 3',
    rules: '2014',
    facts: [
      { label: 'Level', value: 'Cantrip' },
      { label: 'School', value: 'Evocation' },
    ],
    description: '<p>A made-up spark. Make a [[/save dex 12 format=long]].</p>',
    statBlock: null,
    links: [],
    truncated: false,
    ...over,
  });

  it('writes an owned note with facts as properties and readable text', () => {
    const text = renderLibraryNote(
      base({}),
      { sig: 'sig1.r2', identifier: null, group: null },
      paths[SPARK] ?? '',
      ctx(paths)
    );
    expect(checkMarkdownOwnership(text).owned).toBe(true);
    expect(text).toContain('type: "library-spell"');
    expect(text).toContain(`fvtt_uuid: "${SPARK}"`);
    expect(text).toContain('level: "Cantrip"');
    expect(text).toContain('fvtt_sig: "sig1.r2"');
    expect(text).toContain('player_safe: true');
    expect(text).toContain('  - "library"\n  - "spell"');
    expect(text).toContain('**School** Evocation');
    expect(text).toContain('**Source** Made-up Book p. 3');
    expect(text).toContain('Make a DC 12 Dexterity saving throw.');
    expect(text).toContain('kept out of git');
  });

  it('renders a monster with its portrait, stat block, spell links and description', () => {
    const doc = base({
      uuid: WEASEL,
      pack: PACK,
      name: 'Snow Weasel',
      documentName: 'Actor',
      type: 'npc',
      img: 'beasts/weasel.png',
      facts: [],
      description: null,
      statBlock: STAT_BLOCK,
    });
    const text = renderLibraryNote(
      doc,
      { sig: 's', identifier: null, group: null },
      paths[WEASEL] ?? '',
      ctx(paths)
    );
    expect(text).toContain('type: "library-monster"');
    expect(text).toContain('player_safe: false');
    expect(text).toContain('![[Campaigns/test-world/AI Tool/Attachments/beasts/weasel.png|250]]');
    expect(text).toContain('[frost spark](../Spells/Frost%20Spark.md)');
    expect(text).toContain('**Cantrips** [Frost Spark](../Spells/Frost%20Spark.md)');
    expect(text).toContain('## Description\n\nA made-up weasel.');
  });

  it('links a class to its subclasses and features by level, and a subclass to its class', () => {
    const cls = base({
      uuid: WARDEN,
      pack: CLASSES,
      name: 'Warden',
      type: 'class',
      facts: [{ label: 'Hit Die', value: 'd10' }],
      description: null,
      links: [
        { uuid: GLOW, name: 'Ember Glow', level: 1, kind: 'grant' },
        { uuid: uuidOf(CLASSES, 'Item', 99), name: 'Elsewhere', level: 3, kind: 'choice' },
      ],
    });
    const text = renderLibraryNote(
      cls,
      { sig: 's', identifier: 'warden', group: null },
      paths[WARDEN] ?? '',
      ctx(paths)
    );
    expect(text).toContain(
      '## Subclasses\n\n- [Path of Embers](../Subclasses/Path%20of%20Embers.md)'
    );
    expect(text).toContain(
      '- **Level 1:** [Ember Glow](../Class%20features/Warden/Ember%20Glow.md)'
    );
    expect(text).toContain(
      `- **Level 3:** [Elsewhere](http://localhost:3100/open?uuid=${encodeURIComponent(uuidOf(CLASSES, 'Item', 99))}) (choice)`
    );
    const sub = base({
      uuid: PATH,
      pack: CLASSES,
      name: 'Path of Embers',
      type: 'subclass',
      facts: [{ label: 'Class', value: 'warden' }],
      description: null,
    });
    const subText = renderLibraryNote(
      sub,
      { sig: 's', identifier: null, group: null },
      paths[PATH] ?? '',
      ctx(paths)
    );
    expect(subText).toContain('**Class** [Warden](../Classes/Warden.md)');
  });
});

// ---------------------------------------------------------------------------
// The sync, with a fake module
// ---------------------------------------------------------------------------

interface FakeLibrary {
  packs: LibraryPackInfo[];
  rows: LibraryIndexRow[];
  missing: string[];
  docs: Map<string, LibraryDocument>;
  documentCalls: string[][];
  /** Index rows per page (default: all on one page). */
  pageSize?: number;
  indexCalls?: number;
  /** Answer the next cursor page with 'Invalid cursor' once. */
  invalidCursorOnce?: boolean;
}

let dir: string;
let fake: FakeLibrary;

function packInfo(packId: string, documentName: string): LibraryPackInfo {
  return {
    id: packId,
    label: `Label ${packId}`,
    documentName,
    packageType: 'world',
    packageName: 'w',
    total: 0,
  };
}

function deps(over: Partial<LibrarySyncDeps> = {}): LibrarySyncDeps {
  const campaignRoot = path.join(dir, 'Campaigns', WORLD);
  return {
    foundry: {
      query: (method: string, data?: unknown): Promise<unknown> => {
        const request = (data ?? {}) as { packs?: string[]; uuids?: string[]; after?: string };
        if (method.endsWith('.getLibraryIndex')) {
          fake.indexCalls = (fake.indexCalls ?? 0) + 1;
          const wanted = new Set(request.packs ?? []);
          if (request.after && fake.invalidCursorOnce) {
            fake.invalidCursorOnce = false;
            return Promise.resolve({ success: false, error: 'Invalid cursor' });
          }
          const all = fake.rows.filter(r => wanted.has(r.pack));
          const start = request.after ? Number(request.after.slice(1)) : 0;
          const size = fake.pageSize ?? all.length;
          const end = start + Math.max(1, size);
          return Promise.resolve({
            success: true,
            schema: 1,
            worldId: WORLD,
            origin: 'http://localhost:30001',
            packs: fake.packs.filter(p => wanted.has(p.id)),
            missing: [...wanted].filter(p => !fake.packs.some(info => info.id === p)),
            allPacks: fake.packs.map(p => ({ id: p.id, documentName: p.documentName })),
            entries: all.slice(start, end),
            next: end < all.length ? `p${end}` : null,
          });
        }
        fake.documentCalls.push(request.uuids ?? []);
        return Promise.resolve({
          success: true,
          schema: 1,
          worldId: WORLD,
          documents: (request.uuids ?? []).map(u => fake.docs.get(u)).filter(Boolean),
          missing: [],
          deferred: [],
        });
      },
    },
    vaultDir: dir,
    campaignRoot,
    worldId: WORLD,
    openBase: 'http://localhost:3100',
    now: () => Date.now(),
    linkContext: (fromPath, uuid, selfName) => ({ ...linkCtx(fromPath), pageUuid: uuid, selfName }),
    assertTrash: () => Promise.resolve(),
    trashBlocked: null,
    ...over,
  };
}

function doc(r: LibraryIndexRow, over: Partial<LibraryDocument> = {}): LibraryDocument {
  return {
    uuid: r.uuid,
    pack: r.pack,
    id: r.id,
    name: r.name,
    documentName: r.uuid.split('.')[3] === 'Actor' ? 'Actor' : 'Item',
    type: r.type,
    subtype: r.subtype,
    img: null,
    source: null,
    rules: r.rules,
    facts: [],
    description: `<p>About ${r.name}.</p>`,
    statBlock: r.type === 'npc' ? STAT_BLOCK : null,
    links: [],
    truncated: false,
    ...over,
  };
}

async function files(): Promise<string[]> {
  const out: string[] = [];
  const root = path.join(dir, 'Campaigns', WORLD);
  const walk = async (rel: string): Promise<void> => {
    for (const entry of await fsp
      .readdir(path.join(root, rel), { withFileTypes: true })
      .catch(() => [])) {
      const child = rel ? `${rel}/${entry.name}` : entry.name;
      if (entry.isDirectory()) await walk(child);
      else if (!entry.name.startsWith('.')) out.push(child);
    }
  };
  await walk('');
  return out.sort();
}

beforeEach(async () => {
  dir = await fsp.mkdtemp(path.join(os.tmpdir(), 'library-sync-'));
  const rows = [
    row({ uuid: WEASEL, name: 'Snow Weasel', type: 'npc' }),
    row({ uuid: SPARK, name: 'Frost Spark', type: 'spell', rules: '2014' }),
    row({ uuid: SPARK_2024, name: 'Frost Spark', type: 'spell', rules: '2024' }),
  ];
  fake = {
    packs: [packInfo(PACK, 'Actor'), packInfo(SPELLS, 'Item')],
    rows,
    missing: [],
    docs: new Map(rows.map(r => [r.uuid, doc(r)])),
    documentCalls: [],
  };
});

afterEach(async () => {
  await fsp.rm(dir, { recursive: true, force: true });
});

describe('LibrarySync', () => {
  it('allocates every path from the index first, then writes the notes in batches', async () => {
    const sync = new LibrarySync(WORLD);
    expect(sync.refreshDue([PACK, SPELLS], Date.now())).toBe(true);
    await sync.refresh([PACK, SPELLS], deps());
    expect(sync.pending).toBe(3);
    // Links work before any note is written (world notes render with them right away).
    const links = sync.links();
    expect(links.byUuid(WEASEL)).toEqual({
      notePath: 'AI Tool/Library/Monsters/Other/Snow Weasel.md',
      name: 'Snow Weasel',
    });
    expect(links.byUuid(SPARK)?.notePath).toBe(
      'AI Tool/Library/Spells/Other/Frost Spark (2014).md'
    );
    expect(links.byUuid(SPARK_2024)?.notePath).toBe(
      'AI Tool/Library/Spells/Other/Frost Spark (2024).md'
    );
    expect(links.legacy(PACK, id(1))).toBe(WEASEL);
    expect(links.legacy(PACK, 'snow weasel')).toBe(WEASEL);
    expect(links.legacy('world.unknown', id(1))).toBeNull();
    expect(links.spellByName?.('Frost Spark')).toBeTruthy();

    expect(await sync.work(Date.now() + 10_000, deps())).toBe(3);
    expect(sync.pending).toBe(0);
    expect(await files()).toEqual([
      'AI Tool/Library/Books/Without a book.md',
      'AI Tool/Library/Monsters/Other/Snow Weasel.md',
      'AI Tool/Library/Spells/Other/Frost Spark (2014).md',
      'AI Tool/Library/Spells/Other/Frost Spark (2024).md',
    ]);
    // No entry names a book: one note links them all (I-120 c), grouped by kind folder.
    const noBook = await fsp.readFile(
      path.join(dir, 'Campaigns', WORLD, 'AI Tool/Library/Books/Without a book.md'),
      'utf8'
    );
    expect(noBook).toContain('type: "library-no-book"');
    expect(checkMarkdownOwnership(noBook).owned).toBe(true);
    expect(noBook).toContain(
      [
        '3 notes.',
        '',
        '## Monsters',
        '',
        '- [Snow Weasel](../Monsters/Other/Snow%20Weasel.md)',
        '',
        '## Spells',
        '',
        '- [Frost Spark](../Spells/Other/Frost%20Spark%20%282014%29.md)',
        '- [Frost Spark](../Spells/Other/Frost%20Spark%20%282024%29.md)',
      ].join('\n')
    );
    const weasel = await fsp.readFile(
      path.join(dir, 'Campaigns', WORLD, 'AI Tool/Library/Monsters/Other/Snow Weasel.md'),
      'utf8'
    );
    expect(weasel).toContain(`fvtt_sig: "${versionedSig('s1')}"`);
    expect(weasel).toContain('> [!statblock] Snow Weasel');
    expect(sync.status([PACK, SPELLS]).counts).toEqual({ monster: 1, spell: 2 });
  });

  it('writes the "Without a book" note only after a complete refresh', async () => {
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK, SPELLS], deps());
    await sync.work(Date.now() + 10_000, deps());
    const noBookPath = path.join(
      dir,
      'Campaigns',
      WORLD,
      'AI Tool/Library/Books/Without a book.md'
    );
    const before = await fsp.readFile(noBookPath, 'utf8');
    expect(before).toContain('3 notes.');
    // A row Foundry sent malformed makes the refresh incomplete: the note keeps all three.
    fake.rows = fake.rows.map(r =>
      r.uuid === SPARK_2024 ? ({ ...r, name: 42 } as unknown as LibraryIndexRow) : r
    );
    sync.requestRefresh();
    await sync.refresh([PACK, SPELLS], deps());
    expect(await fsp.readFile(noBookPath, 'utf8')).toBe(before);
  });

  it('fetches nothing again while the signatures stay the same, and only the changed one after', async () => {
    const first = new LibrarySync(WORLD);
    await first.refresh([PACK, SPELLS], deps());
    await first.work(Date.now() + 10_000, deps());
    fake.documentCalls = [];
    // A restart: a fresh sync finds the notes and their signatures.
    const second = new LibrarySync(WORLD);
    await second.refresh([PACK, SPELLS], deps());
    expect(second.pending).toBe(0);
    fake.rows = fake.rows.map(r => (r.uuid === WEASEL ? { ...r, sig: 's2' } : r));
    second.requestRefresh();
    await second.refresh([PACK, SPELLS], deps());
    expect(second.pending).toBe(1);
    await second.work(Date.now() + 10_000, deps());
    expect(fake.documentCalls).toEqual([[WEASEL]]);
  });

  it('trashes notes whose document left the packs, but keeps a missing pack and edited notes', async () => {
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK, SPELLS], deps());
    await sync.work(Date.now() + 10_000, deps());
    const spark2024 = path.join(
      dir,
      'Campaigns',
      WORLD,
      'AI Tool/Library/Spells/Other/Frost Spark (2024).md'
    );
    await fsp.appendFile(spark2024, '\nMy own note.\n');
    // The spells pack disappears from this world (module off): its notes stay.
    fake.packs = fake.packs.filter(p => p.id !== SPELLS);
    fake.rows = fake.rows.filter(r => r.pack !== SPELLS);
    await sync.refresh([PACK, SPELLS], deps());
    expect((await files()).filter(f => !f.includes('/Books/'))).toHaveLength(3);
    expect(sync.status([PACK, SPELLS]).missingPacks).toEqual([SPELLS]);
    // The GM drops the pack from the settings: unedited notes go to the trash, edited ones stay.
    await sync.refresh([PACK], deps());
    const left = await files();
    expect(left).toContain('AI Tool/Library/Monsters/Other/Snow Weasel.md');
    expect(left).toContain('AI Tool/Library/Spells/Other/Frost Spark (2024).md');
    expect(left).not.toContain('AI Tool/Library/Spells/Other/Frost Spark (2014).md');
    const trash = path.join(
      dir,
      '.trash',
      'Campaigns',
      WORLD,
      'AI Tool/Library/Spells/Other/Frost Spark (2014).md'
    );
    await expect(fsp.stat(trash)).resolves.toBeTruthy();
    expect(sync.status([PACK]).skipped.map(s => s.path)).toContain(
      'AI Tool/Library/Spells/Other/Frost Spark (2024).md'
    );
  });

  it('never overwrites a Library note the GM edited', async () => {
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK], deps());
    await sync.work(Date.now() + 10_000, deps());
    const weasel = path.join(
      dir,
      'Campaigns',
      WORLD,
      'AI Tool/Library/Monsters/Other/Snow Weasel.md'
    );
    await fsp.appendFile(weasel, '\nEdited.\n');
    sync.forceRender();
    await sync.refresh([PACK], deps());
    await sync.work(Date.now() + 10_000, deps());
    expect(await fsp.readFile(weasel, 'utf8')).toContain('Edited.');
    expect(sync.status([PACK]).skipped).toEqual([
      { path: 'AI Tool/Library/Monsters/Other/Snow Weasel.md', reason: 'edited in Obsidian' },
    ]);
  });

  it('reports a changed membership so world notes re-render their links', async () => {
    const sync = new LibrarySync(WORLD);
    expect((await sync.refresh([PACK], deps())).membershipChanged).toBe(false);
    expect((await sync.refresh([PACK], deps())).membershipChanged).toBe(false);
    expect((await sync.refresh([PACK, SPELLS], deps())).membershipChanged).toBe(true);
  });

  it('re-renders a class note when a subclass joins later, also after a restart', async () => {
    const warden = row({ uuid: WARDEN, name: 'Warden', type: 'class', identifier: 'warden' });
    const embers = row({
      uuid: PATH,
      name: 'Path of Embers',
      type: 'subclass',
      classIdentifier: 'warden',
    });
    fake.packs = [packInfo(CLASSES, 'Item')];
    fake.rows = [warden];
    fake.docs = new Map([warden, embers].map(r => [r.uuid, doc(r)]));
    const sync = new LibrarySync(WORLD);
    await sync.refresh([CLASSES], deps());
    await sync.work(Date.now() + 10_000, deps());
    const note = path.join(dir, 'Campaigns', WORLD, 'AI Tool/Library/Classes/Other/Warden.md');
    expect(await fsp.readFile(note, 'utf8')).not.toContain('## Subclasses');
    // A subclass is added to the pack: the class note's lookups touched it, so it re-renders.
    fake.rows = [warden, embers];
    fake.documentCalls = [];
    expect((await sync.refresh([CLASSES], deps())).membershipChanged).toBe(true);
    await sync.work(Date.now() + 10_000, deps());
    expect(fake.documentCalls.flat().sort()).toEqual([WARDEN, PATH].sort());
    expect(await fsp.readFile(note, 'utf8')).toContain(
      '## Subclasses\n\n- [Path of Embers](../../Subclasses/Other/Path%20of%20Embers.md)'
    );
    // While the bridge is down the subclass goes away again: a fresh sync compares with the
    // membership the notes were written against (the state file) and re-renders the class.
    fake.rows = [warden];
    const restarted = new LibrarySync(WORLD);
    expect((await restarted.refresh([CLASSES], deps())).membershipChanged).toBe(true);
    expect(restarted.pending).toBe(1);
    await restarted.work(Date.now() + 10_000, deps());
    expect(await fsp.readFile(note, 'utf8')).not.toContain('## Subclasses');
  });

  it('continues a refresh at the next step instead of starting over, within the deadline', async () => {
    fake.pageSize = 1;
    let clock = 0;
    const slow = deps({ now: () => clock });
    const query = slow.foundry.query;
    const timeouts: number[] = [];
    slow.foundry = {
      query: (
        method: string,
        data?: unknown,
        options?: { timeoutMs?: number }
      ): Promise<unknown> => {
        timeouts.push(options?.timeoutMs ?? -1);
        clock += 5_000;
        return query(method, data);
      },
    };
    const sync = new LibrarySync(WORLD);
    const first = await sync.refreshStep([PACK, SPELLS], slow, clock + 6_000);
    expect(first.done).toBe(false);
    expect(sync.refreshing).toBe(true);
    expect(sync.ready).toBe(false);
    // The query timeout never runs past the deadline.
    expect(timeouts).toEqual([6_000]);
    let step = first;
    for (let i = 0; i < 5 && !step.done; i++) {
      step = await sync.refreshStep([PACK, SPELLS], slow, clock + 6_000);
    }
    expect(step.done).toBe(true);
    expect(fake.indexCalls).toBe(3); // one page per row, none fetched twice
    expect(sync.pending).toBe(3);
  });

  it('starts the index over when the module no longer knows the cursor', async () => {
    fake.pageSize = 2;
    fake.invalidCursorOnce = true;
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK, SPELLS], deps());
    expect(fake.indexCalls).toBe(4); // page 1, refused page 2, then pages 1 and 2 again
    expect(sync.pending).toBe(3);
  });

  it('leaves notes in place when git would see the vault trash', async () => {
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK, SPELLS], deps());
    await sync.work(Date.now() + 10_000, deps());
    await sync.refresh([PACK], deps({ trashBlocked: 'git does not ignore the trash' }));
    expect((await files()).filter(f => !f.includes('/Books/'))).toHaveLength(3);
    expect(
      sync
        .status([PACK])
        .errors.map(e => e.error)
        .join(' ')
    ).toContain('git does not ignore the trash');
  });
});

describe('LibrarySync by kind, then book (I-100)', () => {
  const MM = { book: 'TB 2024', bookTitle: 'Test Bestiary (2024)', page: '12' };
  const SP = { book: 'TS', bookTitle: 'Test Spellbook', page: null };
  const campaign = (rel: string): string => path.join(dir, 'Campaigns', WORLD, rel);
  const withBooks = (): void => {
    fake.rows = fake.rows.map(r => ({ ...r, ...(r.pack === PACK ? MM : SP) }));
  };

  it('writes notes into their book folder with book and page properties, and one base per book', async () => {
    withBooks();
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK, SPELLS], deps());
    await sync.work(Date.now() + 10_000, deps());
    expect(await files()).toEqual([
      'AI Tool/Library/Books/Test Bestiary (2024).base',
      'AI Tool/Library/Books/Test Bestiary (2024).md',
      'AI Tool/Library/Books/Test Spellbook.base',
      'AI Tool/Library/Books/Test Spellbook.md',
      'AI Tool/Library/Monsters/Test Bestiary (2024)/Snow Weasel.md',
      'AI Tool/Library/Spells/Test Spellbook/Frost Spark (2014).md',
      'AI Tool/Library/Spells/Test Spellbook/Frost Spark (2024).md',
    ]);
    const weasel = await fsp.readFile(
      campaign('AI Tool/Library/Monsters/Test Bestiary (2024)/Snow Weasel.md'),
      'utf8'
    );
    expect(weasel).toContain('book: "Test Bestiary (2024)"');
    expect(weasel).toContain('page: 12');
    expect(weasel).toContain('type: "library-monster"');
    expect(weasel).toContain('> [!statblock] Snow Weasel');
    // Every note links its book's hub note, so the graph groups a book around it.
    expect(weasel).toContain(
      'From [Test Bestiary (2024)](../../Books/Test%20Bestiary%20%282024%29.md), page 12.'
    );
    const spark = await fsp.readFile(
      campaign('AI Tool/Library/Spells/Test Spellbook/Frost Spark (2014).md'),
      'utf8'
    );
    expect(spark).toContain('book: "Test Spellbook"');
    expect(spark).not.toContain('page:');
    expect(spark).toContain('From [Test Spellbook](../../Books/Test%20Spellbook.md).');
    const hub = await fsp.readFile(campaign('AI Tool/Library/Books/Test Spellbook.md'), 'utf8');
    expect(hub).toContain('type: "library-book"');
    expect(hub).toContain('![[Test Spellbook.base]]');
    expect(hub).not.toMatch(/^book:/m); // the base does not list its own hub
    const base = await fsp.readFile(campaign('AI Tool/Library/Books/Test Spellbook.base'), 'utf8');
    expect(base).toContain(`file.inFolder("Campaigns/${WORLD}/AI Tool/Library")`);
    expect(base).toContain(`'book == "Test Spellbook"'`);
  });

  it('moves notes of the old flat layout into their book folder once, with no copy left behind', async () => {
    const first = new LibrarySync(WORLD);
    await first.refresh([PACK, SPELLS], deps());
    await first.work(Date.now() + 10_000, deps());
    // A note as an older bridge wrote it: straight in the kind folder.
    await fsp.rename(
      campaign('AI Tool/Library/Monsters/Other/Snow Weasel.md'),
      campaign('AI Tool/Library/Monsters/Snow Weasel.md')
    );
    await fsp.rmdir(campaign('AI Tool/Library/Monsters/Other'));
    withBooks();
    const restarted = new LibrarySync(WORLD);
    await restarted.refresh([PACK, SPELLS], deps());
    expect(restarted.links().byUuid(WEASEL)?.notePath).toBe(
      'AI Tool/Library/Monsters/Test Bestiary (2024)/Snow Weasel.md'
    );
    expect(restarted.pending).toBe(3);
    await restarted.work(Date.now() + 10_000, deps());
    expect((await files()).filter(f => f.endsWith('.md') && !f.includes('/Books/'))).toEqual([
      'AI Tool/Library/Monsters/Test Bestiary (2024)/Snow Weasel.md',
      'AI Tool/Library/Spells/Test Spellbook/Frost Spark (2014).md',
      'AI Tool/Library/Spells/Test Spellbook/Frost Spark (2024).md',
    ]);
    // Moved by rename: only the "Without a book" note went to the vault trash (every entry has a
    // book now), and the emptied folders are gone.
    const trashed = path.join(dir, '.trash', 'Campaigns', WORLD, 'AI Tool/Library');
    expect(await fsp.readdir(trashed)).toEqual(['Books']);
    expect(await fsp.readdir(path.join(trashed, 'Books'))).toEqual(['Without a book.md']);
    expect(await fsp.readdir(campaign('AI Tool/Library/Spells'))).toEqual(['Test Spellbook']);
    // The next refresh finds every note in place: nothing to move or fetch.
    restarted.requestRefresh();
    await restarted.refresh([PACK, SPELLS], deps());
    expect(restarted.pending).toBe(0);
  });

  it('keeps an edited note at its old path and says so in the status', async () => {
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK], deps());
    await sync.work(Date.now() + 10_000, deps());
    const old = 'AI Tool/Library/Monsters/Other/Snow Weasel.md';
    await fsp.appendFile(campaign(old), '\nMy own note.\n');
    withBooks();
    sync.requestRefresh();
    await sync.refresh([PACK], deps());
    expect(sync.links().byUuid(WEASEL)?.notePath).toBe(old);
    await sync.work(Date.now() + 10_000, deps());
    expect(await fsp.readFile(campaign(old), 'utf8')).toContain('My own note.');
    expect((await files()).filter(f => f.endsWith('.md') && !f.includes('/Books/'))).toEqual([old]);
    expect(sync.status([PACK]).skipped).toEqual([{ path: old, reason: KEPT_AT_OLD_PATH }]);
  });

  it('moves a note whose book changed, re-renders the notes that link to it, and trashes an empty book base', async () => {
    const warden = row({
      uuid: WARDEN,
      name: 'Warden',
      type: 'class',
      identifier: 'warden',
      ...SP,
    });
    const embers = row({
      uuid: PATH,
      name: 'Path of Embers',
      type: 'subclass',
      classIdentifier: 'warden',
      ...SP,
    });
    fake.packs = [packInfo(CLASSES, 'Item')];
    fake.rows = [warden, embers];
    fake.docs = new Map([warden, embers].map(r => [r.uuid, doc(r)]));
    const sync = new LibrarySync(WORLD);
    await sync.refresh([CLASSES], deps());
    await sync.work(Date.now() + 10_000, deps());
    const classNote = campaign('AI Tool/Library/Classes/Test Spellbook/Warden.md');
    expect(await fsp.readFile(classNote, 'utf8')).toContain(
      '- [Path of Embers](../../Subclasses/Test%20Spellbook/Path%20of%20Embers.md)'
    );
    // The subclass is reprinted in another book (its signature changes with it).
    fake.rows = [warden, { ...embers, ...MM, sig: 's2' }];
    fake.documentCalls = [];
    sync.requestRefresh();
    expect((await sync.refresh([CLASSES], deps())).membershipChanged).toBe(true);
    await sync.work(Date.now() + 10_000, deps());
    expect(fake.documentCalls.flat().sort()).toEqual([WARDEN, PATH].sort());
    expect(await fsp.readFile(classNote, 'utf8')).toContain(
      '- [Path of Embers](../../Subclasses/Test%20Bestiary%20%282024%29/Path%20of%20Embers.md)'
    );
    expect((await files()).filter(f => f.endsWith('.md') && !f.includes('/Books/'))).toEqual([
      'AI Tool/Library/Classes/Test Spellbook/Warden.md',
      'AI Tool/Library/Subclasses/Test Bestiary (2024)/Path of Embers.md',
    ]);
    // Both books still have notes, so both bases stay; then the class moves too and its base goes.
    expect((await files()).filter(f => f.endsWith('.base'))).toHaveLength(2);
    fake.rows = [
      { ...warden, ...MM, sig: 's3' },
      { ...embers, ...MM, sig: 's2' },
    ];
    sync.requestRefresh();
    await sync.refresh([CLASSES], deps());
    await sync.work(Date.now() + 10_000, deps());
    expect((await files()).filter(f => f.endsWith('.base'))).toEqual([
      'AI Tool/Library/Books/Test Bestiary (2024).base',
    ]);
    await expect(
      fsp.stat(
        path.join(dir, '.trash', 'Campaigns', WORLD, 'AI Tool/Library/Books/Test Spellbook.base')
      )
    ).resolves.toBeTruthy();
    // Its hub note goes with it.
    expect((await files()).filter(f => f.startsWith('AI Tool/Library/Books/'))).toEqual([
      'AI Tool/Library/Books/Test Bestiary (2024).base',
      'AI Tool/Library/Books/Test Bestiary (2024).md',
    ]);
  });

  it('leaves a book base the GM changed', async () => {
    withBooks();
    const sync = new LibrarySync(WORLD);
    await sync.refresh([PACK, SPELLS], deps());
    const basePath = campaign('AI Tool/Library/Books/Test Spellbook.base');
    await fsp.writeFile(basePath, `${await fsp.readFile(basePath, 'utf8')}    limit: 10\n`, 'utf8');
    fake.rows = fake.rows.filter(r => r.pack !== SPELLS);
    sync.requestRefresh();
    await sync.refresh([PACK], deps());
    expect(await fsp.readFile(basePath, 'utf8')).toContain('limit: 10');
  });
});
