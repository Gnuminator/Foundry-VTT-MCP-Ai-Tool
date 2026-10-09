/**
 * The pump with licensed content (design 13): the Library and image copies run after the git
 * guard, world notes link into the Library from the first cycle, NPC notes carry their stat
 * block and portrait, and a vault inside a git repository that would track licensed files gets
 * no Library and no images at all (the world mirror keeps working). Made-up data only.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ExportStatBlock, LibraryDocument, LibraryIndexRow } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import {
  fid,
  FakeExportIndex,
  journalEntry,
  npcEntry,
  pageEntry,
  sceneEntry,
} from '../test-support/fake-export-index.js';
import { VaultStore } from '../vault/store.js';

import type { GitRunner } from './licensed-guard.js';
import { ObsidianMirrorPump } from './mirror-pump.js';
import { MIRROR_SETTINGS_FILE } from './mirror-settings.js';

const WORLD = 'test-world';
const PACK = 'world.test-bestiary';
const WEASEL_ID = 'weasel0000000001';
const WEASEL = `Compendium.${PACK}.Actor.${WEASEL_ID}`;

const BLOCK: ExportStatBlock = {
  rules: '2014',
  tag: 'Tiny beast, unaligned',
  upper: [{ label: 'Armor Class', value: '13' }],
  abilities: [],
  lower: [{ label: 'Challenge', value: '0 (10 XP)' }],
  sections: [
    {
      key: 'action',
      label: 'Actions',
      intro: null,
      entries: [{ name: 'Nip', html: '<p>[[/roll 1d20 + 4]] to hit.</p>' }],
    },
  ],
  spells: [],
  description: null,
  truncated: false,
};

const ROW: LibraryIndexRow = {
  uuid: WEASEL,
  pack: PACK,
  id: WEASEL_ID,
  name: 'Snow Weasel',
  type: 'npc',
  subtype: null,
  group: null,
  identifier: null,
  classIdentifier: null,
  rules: '2014',
  book: 'TB',
  bookTitle: 'Test Bestiary',
  page: '7',
  sig: 'w1',
};

const DOC: LibraryDocument = {
  uuid: WEASEL,
  pack: PACK,
  id: WEASEL_ID,
  name: 'Snow Weasel',
  documentName: 'Actor',
  type: 'npc',
  subtype: null,
  img: 'beasts/weasel.png',
  source: null,
  rules: '2014',
  facts: [],
  description: null,
  statBlock: BLOCK,
  links: [],
  truncated: false,
};

let tmp: string;
let vault: string;
let store: VaultStore;
let fake: FakeExportIndex;
let fetched: string[];

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirror-pump-library-'));
  vault = path.join(tmp, 'vault');
  await fsp.mkdir(vault, { recursive: true });
  store = new VaultStore({ dataDir: path.join(tmp, 'bridge') });
  fake = new FakeExportIndex();
  fake.worldId = WORLD;
  fake.put(npcEntry('wolf', 'Wolf', { img: 'beasts/wolf.png', statBlock: BLOCK }));
  fake.put(sceneEntry('arena', 'Test Arena', { map: 'maps/arena.webp' }));
  fake.put(
    journalEntry('lore', 'Lore', [
      pageEntry(
        'lore',
        'den',
        'Den',
        `<p>A @Compendium[${PACK}.${WEASEL_ID}]{snow weasel} sleeps here.</p><p><img src="maps/den.png"></p>`
      ),
    ])
  );
  fake.library = (method, data): unknown => {
    if (method.endsWith('.getLibraryIndex')) {
      const packs = ((data as { packs?: string[] }).packs ?? []).filter(p => p === PACK);
      return {
        success: true,
        schema: 1,
        worldId: WORLD,
        origin: 'http://localhost:30001',
        packs: packs.map(id => ({
          id,
          label: 'Test Bestiary',
          documentName: 'Actor',
          packageType: 'world',
          packageName: 'w',
          total: 1,
        })),
        missing: [],
        allPacks: [{ id: PACK, documentName: 'Actor' }],
        entries: packs.length ? [ROW] : [],
        next: null,
      };
    }
    return {
      success: true,
      schema: 1,
      worldId: WORLD,
      documents: [DOC],
      missing: [],
      deferred: [],
    };
  };
  fetched = [];
  await store.write(WORLD, 'gm', MIRROR_SETTINGS_FILE, {
    settings: {
      enabled: true,
      text: { folderIds: [], journalIds: [fid('lore')] },
      libraryPacks: [PACK],
    },
  });
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

function newPump(git?: GitRunner, now?: () => number): ObsidianMirrorPump {
  return new ObsidianMirrorPump({
    ...(now ? { now } : {}),
    foundryClient: fake,
    worldIds: { current: () => Promise.resolve(WORLD) },
    store,
    vaultDir: vault,
    logger: { info: vi.fn(), warn: vi.fn() },
    pollMs: 10_000,
    openBase: 'http://localhost:3000',
    ...(git ? { git } : {}),
    fetcher: (url): Promise<Response> => {
      fetched.push(url);
      return Promise.resolve(
        new Response('png bytes', { status: 200, headers: { 'content-type': 'image/png' } })
      );
    },
  });
}

async function read(rel: string): Promise<string | null> {
  return fsp
    .readFile(path.join(vault, 'Campaigns', WORLD, ...rel.split('/')), 'utf8')
    .catch(() => null);
}

describe('ObsidianMirrorPump with the Library and images', () => {
  it('writes Library notes, links world notes to them and copies the images', async () => {
    const pump = newPump();
    await pump.tick();
    const library = await read('AI Tool/Library/Monsters/Test Bestiary/Snow Weasel.md');
    expect(library).toContain('> [!statblock] Snow Weasel');
    expect(library).toContain('> ***Nip.*** 1d20 + 4 to hit.');
    const page = await read('AI Tool/Foundry/Journals/Lore/Den.md');
    expect(page).toContain(
      'A [snow weasel](../../../Library/Monsters/Test%20Bestiary/Snow%20Weasel.md) sleeps here.'
    );
    expect(page).toContain(`![[Campaigns/${WORLD}/AI Tool/Attachments/maps/den.png]]`);
    const wolf = await read('AI Tool/Foundry/NPCs/Wolf.md');
    expect(wolf).toContain(`![[Campaigns/${WORLD}/AI Tool/Attachments/beasts/wolf.png|250]]`);
    expect(wolf).toContain('> [!statblock] Wolf');
    expect(await read('AI Tool/Foundry/Scenes/Test Arena.md')).toContain(
      `## Map\n\n![[Campaigns/${WORLD}/AI Tool/Attachments/maps/arena.webp]]`
    );
    expect(fetched.sort()).toEqual([
      'http://localhost:30001/beasts/weasel.png',
      'http://localhost:30001/beasts/wolf.png',
      'http://localhost:30001/maps/arena.webp',
      'http://localhost:30001/maps/den.png',
    ]);
    expect(await read('AI Tool/.gitignore')).toContain('/Library/');
    const status = pump.status();
    expect(status.library?.counts).toEqual({ monster: 1 });
    expect(status.images).toMatchObject({ copied: 4, blocked: null });
    const note = await read('AI Tool/Foundry/_status.md');
    expect(note).toContain('## Library (compendium notes)');
    expect(note).toContain('4 image(s) copied');
  });

  it('writes no Library and no images when git would track them, and says so', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    const tracked: GitRunner = args =>
      Promise.resolve(
        args[0] === 'ls-files'
          ? { code: 0, stdout: 'Library/Monsters/Old.md\n', stderr: '' }
          : { code: 0, stdout: '', stderr: '' }
      );
    const pump = newPump(tracked);
    await pump.tick();
    expect(await read('AI Tool/Library/Monsters/Test Bestiary/Snow Weasel.md')).toBeNull();
    expect(fetched).toEqual([]);
    // The world mirror keeps working; the page text (and its image) waits for git to ignore it.
    const page = await read('AI Tool/Foundry/Journals/Lore/Den.md');
    expect(page).toContain('Book text and images are left out of this note');
    expect(page).not.toContain('sleeps here');
    expect(page).not.toContain('![[');
    const status = pump.status();
    expect(status.library?.blocked).toContain('already tracked');
    expect(status.images?.blocked).toContain('already tracked');
    expect(await read('AI Tool/Foundry/_status.md')).toContain('The Library is off');
  });

  it('withholds stat blocks and images in world notes when only the Library folders are ignored', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    const pump = newPump(onlyLibraryIgnored);
    await pump.tick();
    expect(await read('AI Tool/Library/Monsters/Test Bestiary/Snow Weasel.md')).toContain(
      '> [!statblock]'
    );
    const wolf = (await read('AI Tool/Foundry/NPCs/Wolf.md')) ?? '';
    expect(wolf).toContain('Book text and images are left out of this note');
    expect(wolf).toContain('(../_status.md)');
    expect(wolf).not.toContain('[!statblock]');
    expect(wolf).not.toContain('![[');
    expect(wolf).toContain('- Bite'); // names stay
    const status = (await read('AI Tool/Foundry/_status.md')) ?? '';
    expect(status).toContain('## Book text in world notes');
    expect(status).toContain('move the vault out of the git repository');
    expect(pump.status().licensedText).toMatchObject({ allowed: false });
  });

  it('withholds book text in world notes in nested Foundry folders too (I-100)', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    fake.edit(`Actor.${fid('wolf')}`, e => {
      e.folder = { id: fid('wild'), path: ['Beasts', 'Wild'] };
    });
    const pump = newPump(onlyLibraryIgnored);
    await pump.tick();
    const wolf = (await read('AI Tool/Foundry/NPCs/Beasts/Wild/Wolf.md')) ?? '';
    expect(wolf).toContain('Book text and images are left out of this note');
    expect(wolf).toContain('(../../../_status.md)');
    expect(wolf).not.toContain('[!statblock]');
    expect(await read('AI Tool/Library/Monsters/Test Bestiary/Snow Weasel.md')).toContain(
      '> [!statblock]'
    );
  });

  it('re-renders world notes when the guard flips', async () => {
    await fsp.mkdir(path.join(vault, '.git'));
    let runner: GitRunner = onlyLibraryIgnored;
    let clock = 1_000_000;
    const pump = newPump(
      (args, cwd) => runner(args, cwd),
      () => clock
    );
    await pump.tick();
    expect(await read('AI Tool/Foundry/NPCs/Wolf.md')).not.toContain('[!statblock]');
    // The GM ignores the whole mirror folder; the guard looks again after its cache expires.
    runner = (): ReturnType<GitRunner> => Promise.resolve({ code: 0, stdout: '', stderr: '' });
    clock += 6 * 60_000;
    await pump.tick();
    const wolf = (await read('AI Tool/Foundry/NPCs/Wolf.md')) ?? '';
    expect(wolf).toContain('> [!statblock] Wolf');
    expect(wolf).toContain(`![[Campaigns/${WORLD}/AI Tool/Attachments/beasts/wolf.png|250]]`);
    expect(await read('AI Tool/Foundry/Journals/Lore/Den.md')).toContain('sleeps here');
  });

  it('re-renders world notes after a restart when the Library packs changed meanwhile, and only then', async () => {
    const wolfPath = path.join(vault, 'Campaigns', WORLD, 'AI Tool', 'Foundry', 'NPCs', 'Wolf.md');
    await newPump().tick();
    const before = (await read('AI Tool/Foundry/NPCs/Wolf.md')) ?? '';
    const mtime = (await fsp.stat(wolfPath)).mtimeMs;
    // A restart with nothing changed writes nothing again.
    await newPump().tick();
    expect((await fsp.stat(wolfPath)).mtimeMs).toBe(mtime);
    expect(await read('AI Tool/Foundry/NPCs/Wolf.md')).toBe(before);
    // The packs change while the bridge is down.
    await store.write(WORLD, 'gm', MIRROR_SETTINGS_FILE, {
      settings: {
        enabled: true,
        text: { folderIds: [], journalIds: [fid('lore')] },
        libraryPacks: [],
      },
    });
    await newPump().tick();
    const sig = (text: string): string | undefined => /fvtt_sig: "([^"]*)"/.exec(text)?.[1];
    const after = (await read('AI Tool/Foundry/NPCs/Wolf.md')) ?? '';
    expect(sig(after)).toBeDefined();
    expect(sig(after)).not.toBe(sig(before));
    expect(await read('AI Tool/Foundry/Journals/Lore/Den.md')).not.toContain('Library/Monsters');
  });

  it('moves an image no note uses any more to the vault trash after a complete reconcile', async () => {
    let clock = 1_000_000;
    const pump = newPump(undefined, () => clock);
    await pump.tick();
    const copy = path.join(
      vault,
      'Campaigns',
      WORLD,
      'AI Tool',
      'Attachments',
      'maps',
      'arena.webp'
    );
    await expect(fsp.stat(copy)).resolves.toBeTruthy();
    // The scene loses its map; the next reconcile re-renders it and collects the copy.
    fake.put(sceneEntry('arena', 'Test Arena', { map: null }));
    clock += 61_000;
    pump.requestReconcile();
    await pump.tick();
    expect(await read('AI Tool/Foundry/Scenes/Test Arena.md')).not.toContain('## Map');
    await expect(fsp.stat(copy)).rejects.toThrow();
    const trashed = path.join(
      vault,
      '.trash',
      'Campaigns',
      WORLD,
      'AI Tool',
      'Attachments',
      'maps',
      'arena.webp'
    );
    await expect(fsp.stat(trashed)).resolves.toBeTruthy();
    // Images other notes still use stay.
    await expect(
      fsp.stat(path.join(vault, 'Campaigns', WORLD, 'AI Tool', 'Attachments', 'beasts', 'wolf.png'))
    ).resolves.toBeTruthy();
  });
});

/** Git ignores AI Tool/Library/ and AI Tool/Attachments/, nothing else; nothing is tracked. */
const onlyLibraryIgnored: GitRunner = args => {
  if (args[0] !== 'check-ignore') return Promise.resolve({ code: 0, stdout: '', stderr: '' });
  const target = args[args.length - 1] ?? '';
  return Promise.resolve({
    code: target === 'Library/' || target === 'Attachments/' ? 0 : 1,
    stdout: '',
    stderr: '',
  });
};
