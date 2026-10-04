/**
 * The Foundry mirror pump (docs/design/OBSIDIAN-O4-DESIGN.md section 2): cycles,
 * reconcile, deletes, fences and status, against the in-memory fake of the
 * module query and temp vaults. The converter is mocked here (a page whose
 * HTML contains `BOOM` fails); the canary suite runs the real one.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import type { ExportFolderRef, ExportIndexRequest } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { REVEALS_FILE } from '../tarokka/service.js';
import {
  FakeExportIndex,
  fid,
  itemEntry,
  journalEntry,
  npcEntry,
  pageEntry,
  pcEntry,
  sceneEntry,
} from '../test-support/fake-export-index.js';
import { VaultStore } from '../vault/store.js';

import { versionedSig, type LinkContext, type MirrorSettings } from './mirror-common.js';
import {
  ObsidianMirrorPump,
  RECONCILE_EVERY_MS,
  RECONCILE_MIN_INTERVAL_MS,
} from './mirror-pump.js';
import { shortSuffix } from './mirror-paths.js';
import { MIRROR_SETTINGS_FILE } from './mirror-settings.js';

const converter = vi.hoisted(() => ({
  html: vi.fn<(html: string, ctx: LinkContext) => string>(),
  markdown: vi.fn<(markdown: string, ctx: LinkContext) => string>(),
}));

vi.mock('./html-to-md.js', () => ({
  htmlToMarkdown: converter.html,
  markdownPageText: converter.markdown,
}));

const WORLD = 'test-world';
const T0 = 1_000_000;

const HERO = pcEntry('hero', 'Test Hero');
const WOLF = npcEntry('wolf', 'Wolf');
const ARENA = sceneEntry('arena', 'Test Arena', { navigation: true });
const LORE = journalEntry('lore', 'Lore', [
  pageEntry('lore', 'village', 'Village', '<p>Village text</p>', { sort: 1 }),
  pageEntry('lore', 'castle', 'Castle', '<p>Castle text</p>', { sort: 2 }),
]);
const SWORD = itemEntry('sword', 'Sun Blade');
/** The newest document: it keeps the watermark above the others (50,000). */
const CLOCK = itemEntry('clock', 'Pocket Watch', { modified: 50_000 });

const P = {
  hero: 'AI Tool/Foundry/PCs/Test Hero.md',
  wolf: 'AI Tool/Foundry/NPCs/Wolf.md',
  arena: 'AI Tool/Foundry/Scenes/Test Arena.md',
  lore: 'AI Tool/Foundry/Journals/Lore.md',
  village: 'AI Tool/Foundry/Journals/Lore/Village.md',
  castle: 'AI Tool/Foundry/Journals/Lore/Castle.md',
  sword: 'AI Tool/Foundry/Items/Sun Blade.md',
  clock: 'AI Tool/Foundry/Items/Pocket Watch.md',
  status: 'AI Tool/Foundry/_status.md',
};

let tmp: string;
let vault: string;
let store: VaultStore;
let fake: FakeExportIndex;
let clock: { t: number };
let currentWorld: string;
let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

beforeEach(async () => {
  tmp = await fsp.mkdtemp(path.join(os.tmpdir(), 'mirror-pump-'));
  vault = path.join(tmp, 'vault');
  await fsp.mkdir(vault, { recursive: true });
  store = new VaultStore({ dataDir: path.join(tmp, 'bridge') });
  fake = new FakeExportIndex();
  fake.worldId = WORLD;
  for (const entry of [HERO, WOLF, ARENA, LORE, SWORD, CLOCK]) fake.put(entry);
  clock = { t: T0 };
  currentWorld = WORLD;
  logger = { info: vi.fn(), warn: vi.fn() };
  converter.html.mockReset();
  converter.markdown.mockReset();
  converter.html.mockImplementation(html => {
    if (html.includes('BOOM')) throw new Error('converter failed on this page');
    return html.replace(/<[^>]+>/g, '');
  });
  converter.markdown.mockImplementation(markdown => markdown);
});

afterEach(async () => {
  await fsp.rm(tmp, { recursive: true, force: true });
});

function newPump(): ObsidianMirrorPump {
  return new ObsidianMirrorPump({
    foundryClient: fake,
    worldIds: { current: () => Promise.resolve(currentWorld) },
    store,
    vaultDir: vault,
    logger,
    pollMs: 10_000,
    openBase: 'http://localhost:3000',
    now: () => clock.t,
  });
}

async function setSettings(
  settings: Partial<MirrorSettings> & { text?: MirrorSettings['text'] },
  worldId = WORLD
): Promise<void> {
  await store.write(worldId, 'gm', MIRROR_SETTINGS_FILE, {
    settings: { enabled: true, ...settings },
  });
}

/** Mirror on, the Lore journal's page text opted in. */
async function enableWithText(): Promise<void> {
  await setSettings({ text: { folderIds: [], journalIds: [fid('lore')] } });
}

function full(rel: string, worldId = WORLD): string {
  return path.join(vault, 'Campaigns', worldId, ...rel.split('/'));
}

function trashed(rel: string, worldId = WORLD): string {
  return path.join(vault, '.trash', 'Campaigns', worldId, ...rel.split('/'));
}

async function read(rel: string, worldId = WORLD): Promise<string | null> {
  return fsp.readFile(full(rel, worldId), 'utf8').catch(() => null);
}

async function exists(target: string): Promise<boolean> {
  return fsp.lstat(target).then(
    () => true,
    () => false
  );
}

/** Every file under `dir`, relative, POSIX separators. */
async function listFiles(dir: string, rel = ''): Promise<string[]> {
  const out: string[] = [];
  const names = await fsp.readdir(dir).catch(() => [] as string[]);
  for (const name of names.sort()) {
    const childRel = rel ? `${rel}/${name}` : name;
    const stat = await fsp.lstat(path.join(dir, name));
    if (stat.isDirectory()) out.push(...(await listFiles(path.join(dir, name), childRel)));
    else out.push(childRel);
  }
  return out;
}

/** mtime and text of every file under the campaign folder. */
async function snapshot(): Promise<Map<string, string>> {
  const root = path.join(vault, 'Campaigns', WORLD);
  const files = await listFiles(root);
  const out = new Map<string, string>();
  for (const file of files) {
    const target = path.join(root, file);
    const [stat, text] = await Promise.all([fsp.stat(target), fsp.readFile(target, 'utf8')]);
    out.set(file, `${stat.mtimeMs}\n${text}`);
  }
  return out;
}

const idsOnlyCount = (): number => fake.requests.filter(r => r.idsOnly).length;
const lastRequest = (): ExportIndexRequest | undefined => fake.requests[fake.requests.length - 1];
const updatedLogs = (): unknown[] =>
  logger.info.mock.calls.filter(call => call[0] === 'Obsidian mirror updated');

/** Advance the fake clock, then run one cycle. */
async function tickAfter(pump: ObsidianMirrorPump, ms: number): Promise<void> {
  clock.t += ms;
  await pump.tick();
}

/** A first cycle (the start reconcile) with the Lore text opted in. */
async function started(): Promise<ObsidianMirrorPump> {
  await enableWithText();
  const pump = newPump();
  await pump.tick();
  return pump;
}

/** Force the next cycle to be a reconcile (past the 60 s throttle). */
async function reconcileNow(pump: ObsidianMirrorPump): Promise<void> {
  pump.requestReconcile();
  await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS + 1);
}

// ---------------------------------------------------------------------------
// Writing
// ---------------------------------------------------------------------------

describe('ObsidianMirrorPump: first run and incremental cycles', () => {
  it('creates one note per document, the text pages, the bases and the status note', async () => {
    const pump = await started();
    const files = await listFiles(path.join(vault, 'Campaigns', WORLD));
    expect([...files].sort()).toEqual(
      [
        P.status,
        P.lore,
        P.castle,
        P.village,
        P.clock,
        P.sword,
        P.wolf,
        P.hero,
        P.arena,
        'AI Tool/Bases/Journals.base',
        'AI Tool/Bases/NPCs.base',
        'AI Tool/Bases/PCs.base',
        'AI Tool/Bases/Player visible.base',
        'AI Tool/Bases/Scenes.base',
        'AI Tool/Bases/Story items.base',
        // The git guard's ignore file for the Library and image copies (licensed content).
        'AI Tool/.gitignore',
      ].sort()
    );
    const wolf = await read(P.wolf);
    expect(wolf).toContain(`fvtt_uuid: "${WOLF.uuid}"`);
    // Notes keep the module's signature with the renderer version.
    // The signature, then a hash of the other inputs (guard, Library).
    expect(wolf).toContain(`fvtt_sig: "${versionedSig(fake.sigOf(WOLF.uuid))}.`);
    expect(await read(P.village)).toContain('Village text');
    expect(await read(P.status)).toContain('notes_journal_page: 2');
    expect(await read(P.status)).toContain('The mirror is on');

    const status = pump.status();
    expect(status.enabled).toBe(true);
    expect(status.worldId).toBe(WORLD);
    expect(status.counts).toEqual({
      pc: 1,
      npc: 1,
      scene: 1,
      journal: 1,
      'journal-page': 2,
      'story-item': 2,
    });
    expect(status.lastReconcileAt).toBe(new Date(T0).toISOString());
    expect(status.lastCycleAt).toBe(new Date(T0).toISOString());
    expect(status.lastError).toBeNull();
    expect(status.errors).toEqual([]);
    expect(updatedLogs()).toHaveLength(1);
    // The start reconcile: ids for every kind, then the documents by uuid.
    expect(fake.requests[0]).toMatchObject({
      idsOnly: true,
      kinds: ['actor', 'scene', 'journal', 'item'],
      includeText: { folderIds: [], journalIds: [fid('lore')] },
    });
    expect(fake.requests[1]?.uuids).toHaveLength(6);
  });

  it('writes nothing on a second run with no change', async () => {
    const pump = await started();
    const before = await snapshot();
    await tickAfter(pump, 10_000);
    expect(lastRequest()).toMatchObject({ sinceModifiedTime: 48_000 });
    expect(await snapshot()).toEqual(before);
    expect(updatedLogs()).toHaveLength(1);
    expect(pump.status().lastCycleAt).toBe(new Date(T0 + 10_000).toISOString());
  });

  it('does not rewrite a note whose only change is the modified time (HP churn)', async () => {
    const pump = await started();
    const before = await read(P.wolf);
    fake.edit(WOLF.uuid, () => undefined, 60_000);
    await tickAfter(pump, 10_000);
    expect(lastRequest()?.sinceModifiedTime).toBe(48_000);
    expect(await read(P.wolf)).toBe(before);
    expect(updatedLogs()).toHaveLength(1);
    // Next cycle: the watermark moved to the wolf's time.
    await tickAfter(pump, 10_000);
    expect(lastRequest()?.sinceModifiedTime).toBe(58_000);
  });

  it('keeps the path on a rename; the title, name and aliases change', async () => {
    const pump = await started();
    fake.edit(WOLF.uuid, e => (e.name = 'Dire Wolf'), 60_000);
    await tickAfter(pump, 10_000);
    const text = await read(P.wolf);
    expect(text).toContain('# Dire Wolf');
    expect(text).toContain('name: "Dire Wolf"');
    expect(text).toContain('aliases:\n  - "Dire Wolf"');
    expect(await exists(full('AI Tool/Foundry/NPCs/Dire Wolf.md'))).toBe(false);
    expect(updatedLogs()).toHaveLength(2);
  });

  it('catches a document modified during a cycle at the next cycle (watermark overlap)', async () => {
    const pump = await started();
    // Changed right after the first page of the next cycle was built, with a
    // time equal to that page's watermark.
    fake.afterQuery = (request, response): void => {
      if (request.sinceModifiedTime === undefined || request.after) return;
      fake.afterQuery = null;
      fake.edit(HERO.uuid, e => (e.name = 'Hero Renamed'), response.watermark);
    };
    await tickAfter(pump, 10_000);
    expect(await read(P.hero)).toContain('# Test Hero');
    await tickAfter(pump, 10_000);
    expect(lastRequest()?.sinceModifiedTime).toBe(48_000);
    expect(await read(P.hero)).toContain('# Hero Renamed');
  });

  it('pages through large answers and keeps the first page watermark', async () => {
    await enableWithText();
    fake.pageLimit = 2;
    const pump = newPump();
    await pump.tick();
    expect(pump.status().counts.npc).toBe(1);
    expect(fake.requests.filter(r => r.idsOnly).map(r => r.after ?? null)).toEqual([
      null,
      'actor:wolf000000000000',
      'journal:lore000000000000',
    ]);
    fake.edit(ARENA.uuid, e => (e.navName = 'The Pit'), 70_000);
    await tickAfter(pump, 10_000);
    expect(await read(P.arena)).toContain('nav_name: "The Pit"');
    await tickAfter(pump, 10_000);
    expect(lastRequest()?.sinceModifiedTime).toBe(68_000);
  });

  it('re-renders a journal whose page was revealed or hidden (gm/reveals.json)', async () => {
    const pump = await started();
    const village = LORE.pages[0];
    expect(await read(P.lore)).toContain('pages_revealed: 0');
    await store.write(WORLD, 'gm', REVEALS_FILE, {
      pages: { [village.id]: { uuid: village.uuid, feature: 'handouts', at: 'x' } },
    });
    await tickAfter(pump, 10_000);
    expect(fake.requests.some(r => r.uuids?.includes(LORE.uuid) && !r.idsOnly)).toBe(true);
    expect(await read(P.lore)).toContain('pages_revealed: 1');
    expect(await read(P.village)).toContain('revealed: true');
  });

  it('links notes created in the same cycle to each other', async () => {
    fake.put(
      pcEntry('hero', 'Test Hero', {
        notableItems: [{ name: 'Sun Blade', sourceUuid: SWORD.uuid }],
      })
    );
    await started();
    expect(await read(P.hero)).toContain('[Sun Blade](../Items/Sun%20Blade.md)');
  });
});

// ---------------------------------------------------------------------------
// Reconcile and deletes
// ---------------------------------------------------------------------------

describe('ObsidianMirrorPump: reconcile and deletes', () => {
  it('trashes the note of a deleted document together with its page notes', async () => {
    const pump = await started();
    fake.remove(LORE.uuid);
    await tickAfter(pump, 10_000); // incremental: deletes need a reconcile
    expect(await exists(full(P.lore))).toBe(true);
    await reconcileNow(pump);
    for (const rel of [P.lore, P.village, P.castle]) {
      expect(await exists(full(rel))).toBe(false);
      expect(await exists(trashed(rel))).toBe(true);
    }
    expect(pump.status().counts.journal).toBe(0);
    expect(pump.status().counts['journal-page']).toBe(0);
    expect(pump.status().keptDeleted).toEqual([]);
    expect(updatedLogs().at(-1)).toEqual([
      'Obsidian mirror updated',
      expect.objectContaining({ trashed: 3 }),
    ]);
  });

  it('keeps a deleted document whose note the GM edited, and lists it', async () => {
    const pump = await started();
    const edited = `${await read(P.wolf)}\nMy own notes about the wolf.\n`;
    await fsp.writeFile(full(P.wolf), edited, 'utf8');
    fake.remove(WOLF.uuid);
    await reconcileNow(pump);
    expect(await read(P.wolf)).toBe(edited);
    const status = pump.status();
    expect(status.keptDeleted).toEqual([{ path: P.wolf, uuid: WOLF.uuid }]);
    expect(status.skipped).toEqual([]);
    expect(await read(P.status)).toContain('Deleted in Foundry, kept because you edited the note');
    expect(await read(P.status)).toContain(P.wolf);
  });

  it('trashes a page note when its page is gone from a freshly fetched journal', async () => {
    const pump = await started();
    fake.edit(
      LORE.uuid,
      e => {
        if (e.kind !== 'journal') return;
        e.pages = e.pages.filter(p => p.id !== fid('castle'));
        e.pagesTotal = 1;
      },
      60_000
    );
    await tickAfter(pump, 10_000);
    expect(await exists(full(P.castle))).toBe(false);
    expect(await exists(trashed(P.castle))).toBe(true);
    expect(await exists(full(P.village))).toBe(true);
  });

  it('keeps page notes beyond a cut page list (pagesTotal above the pages sent)', async () => {
    const pump = await started();
    fake.edit(
      LORE.uuid,
      e => {
        if (e.kind !== 'journal') return;
        e.pages = e.pages.filter(p => p.id !== fid('castle'));
        e.pagesTotal = 2;
      },
      60_000
    );
    await tickAfter(pump, 10_000);
    expect(await exists(full(P.castle))).toBe(true);
  });

  it('trashes the page notes when the journal loses its text opt-in', async () => {
    const pump = await started();
    await setSettings({});
    await tickAfter(pump, 10_000); // a settings change reconciles at once
    expect(await exists(full(P.village))).toBe(false);
    expect(await exists(full(P.castle))).toBe(false);
    expect(await read(P.lore)).toContain('text_mirrored: false');
  });

  it('refetches a document whose sig differs from its note (no modified time moved)', async () => {
    const pump = await started();
    fake.edit(WOLF.uuid, e => {
      e.playerAccess = 'observer';
      e.playerVisible = true;
    });
    await tickAfter(pump, 10_000);
    expect(await read(P.wolf)).toContain('player_visible: false');
    await reconcileNow(pump);
    const fetches = fake.requests.filter(r => r.uuids && !r.idsOnly);
    expect(fetches.at(-1)?.uuids).toEqual([WOLF.uuid]);
    expect(await read(P.wolf)).toContain('player_visible: true');
  });

  it('a settings change fetches every row and trashes the kinds that are now off', async () => {
    const pump = await started();
    await setSettings({
      kinds: ['pc', 'npc', 'scene', 'journal'],
      text: { folderIds: [], journalIds: [fid('lore')] },
    });
    await tickAfter(pump, 10_000); // not throttled: right after a settings change
    const lastIds = fake.requests.filter(r => r.idsOnly).at(-1);
    expect(lastIds?.kinds).toEqual(['actor', 'scene', 'journal']);
    const fetched = fake.requests
      .slice(fake.requests.indexOf(lastIds as ExportIndexRequest))
      .flatMap(r => r.uuids ?? []);
    expect(fetched.sort()).toEqual([HERO.uuid, WOLF.uuid, ARENA.uuid, LORE.uuid].sort());
    expect(await exists(full(P.sword))).toBe(false);
    expect(await exists(trashed(P.sword))).toBe(true);
    expect(await exists(trashed(P.clock))).toBe(true);
    expect(pump.status().counts['story-item']).toBe(0);
    expect(pump.status().keptDeleted).toEqual([]);
  });

  it('trashes a PC note when the actor is no longer a PC and NPCs are off', async () => {
    await setSettings({ kinds: ['pc', 'scene', 'journal', 'item'] });
    const pump = newPump();
    await pump.tick();
    expect(await exists(full(P.hero))).toBe(true);
    expect(await exists(full(P.wolf))).toBe(false);
    fake.edit(
      HERO.uuid,
      e => {
        if (e.kind !== 'actor') return;
        e.pc = false;
        e.owners = [];
      },
      60_000
    );
    await tickAfter(pump, 10_000);
    expect(await exists(full(P.hero))).toBe(false);
    expect(await exists(trashed(P.hero))).toBe(true);
    // Not fetched again at the next reconcile while its sig is unchanged.
    await reconcileNow(pump);
    const fetched = fake.requests.filter(r => r.uuids && !r.idsOnly).flatMap(r => r.uuids ?? []);
    expect(fetched.filter(uuid => uuid === HERO.uuid)).toHaveLength(1);
  });

  it('never trashes a note of a kind whose world cap was hit', async () => {
    const pump = await started();
    fake.truncated = [{ kind: 'actor', total: 5001, cap: 5000 }];
    fake.remove(WOLF.uuid);
    fake.remove(ARENA.uuid);
    await reconcileNow(pump);
    expect(await exists(full(P.wolf))).toBe(true);
    expect(await exists(full(P.arena))).toBe(false);
    expect(pump.status().truncated).toEqual([{ kind: 'actor', total: 5001, cap: 5000 }]);
  });

  it('brings back a note the GM deleted, at the next reconcile', async () => {
    const pump = await started();
    await fsp.rm(full(P.wolf));
    await fsp.rm(full(P.village));
    fake.edit(WOLF.uuid, e => (e.hpMax = 12), 60_000);
    await tickAfter(pump, 10_000); // the incremental cycle does not recreate it
    expect(await exists(full(P.wolf))).toBe(false);
    await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS); // the gone note asked for a reconcile
    expect(await read(P.wolf)).toContain('hp_max: 12');
    // The page note comes back too: its journal is fetched again for it.
    expect(await exists(full(P.village))).toBe(true);
  });
});

// ---------------------------------------------------------------------------
// The GM's notes: edits, moves, duplicates, incomplete scans
// ---------------------------------------------------------------------------

describe('ObsidianMirrorPump: the GM owns what the GM touched', () => {
  it('skips and lists a mirror note the GM edited', async () => {
    const pump = await started();
    const edited =
      (await read(P.wolf))?.replace('Players see this creature', 'My wolf, players see') ?? '';
    await fsp.writeFile(full(P.wolf), edited, 'utf8');
    fake.edit(WOLF.uuid, e => (e.name = 'Dire Wolf'), 60_000);
    await tickAfter(pump, 10_000);
    expect(await read(P.wolf)).toBe(edited);
    expect(pump.status().skipped).toEqual([{ path: P.wolf, reason: 'edited in Obsidian' }]);
    expect(await read(P.status)).toContain('notes_skipped: 1');
    // Lasting: still listed after a cycle that does not touch it.
    await tickAfter(pump, 10_000);
    expect(pump.status().skipped).toHaveLength(1);
  });

  it('never writes or duplicates a note the GM moved outside the mirror folder', async () => {
    const pump = await started();
    const moved = 'Prep/NPCs/Wolf.md';
    const text = (await read(P.wolf)) ?? '';
    await fsp.mkdir(path.dirname(full(moved)), { recursive: true });
    await fsp.rename(full(P.wolf), full(moved));
    fake.edit(WOLF.uuid, e => (e.name = 'Dire Wolf'), 60_000);
    await tickAfter(pump, 10_000);
    await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS);
    expect(idsOnlyCount()).toBe(2);
    expect(await read(moved)).toBe(text);
    expect(await exists(full(P.wolf))).toBe(false);
    expect(await exists(full('AI Tool/Foundry/NPCs/Dire Wolf.md'))).toBe(false);
    expect(pump.status().movedByGm).toEqual([{ path: moved, uuid: WOLF.uuid }]);
    expect(pump.status().counts.npc).toBe(0);
    // A later cycle leaves it alone too.
    fake.edit(WOLF.uuid, e => (e.name = 'Grey Wolf'), 70_000);
    await tickAfter(pump, 10_000);
    expect(await read(moved)).toBe(text);
    expect(await listFiles(full('AI Tool/Foundry/NPCs'))).toEqual([]);
  });

  it('reports a second note with the same uuid as a duplicate', async () => {
    const pump = await started();
    const copy = 'AI Tool/Foundry/NPCs/Wolf2.md';
    await fsp.copyFile(full(P.wolf), full(copy));
    await reconcileNow(pump);
    expect(pump.status().duplicates).toEqual([{ path: copy, uuid: WOLF.uuid }]);
    expect(await read(P.status)).toContain(copy);
  });

  it('creates and trashes nothing while the vault scan is incomplete', async () => {
    const pump = await started();
    const deep = path.join(full('Prep'), ...Array.from({ length: 15 }, () => 'd'));
    await fsp.mkdir(deep, { recursive: true });
    await fsp.writeFile(path.join(deep, 'deep.md'), 'deep', 'utf8');
    fake.remove(WOLF.uuid);
    fake.put(npcEntry('bat', 'Bat'));
    fake.edit(HERO.uuid, e => (e.name = 'Hero Renamed'));
    await reconcileNow(pump);
    expect(await exists(full(P.wolf))).toBe(true); // not trashed
    expect(await exists(full('AI Tool/Foundry/NPCs/Bat.md'))).toBe(false); // not created
    expect(await read(P.hero)).toContain('# Hero Renamed'); // known notes still update
    expect(pump.status().errors).toEqual([
      { path: '.', error: expect.stringMatching(/scan stopped at the depth limit/) },
    ]);
    expect(logger.warn).toHaveBeenCalledWith(
      'Obsidian mirror: the vault scan was incomplete, no notes created or trashed',
      expect.objectContaining({ limitsHit: ['depth'] })
    );
    // An incremental cycle after it creates nothing either.
    fake.put(npcEntry('rat', 'Rat', { modified: 90_000 }));
    await tickAfter(pump, 10_000);
    expect(await exists(full('AI Tool/Foundry/NPCs/Rat.md'))).toBe(false);
    // Once the scan completes again, both happen.
    await fsp.rm(full('Prep/d'), { recursive: true, force: true });
    await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS);
    expect(await exists(full(P.wolf))).toBe(false);
    expect(await exists(full('AI Tool/Foundry/NPCs/Bat.md'))).toBe(true);
    expect(await exists(full('AI Tool/Foundry/NPCs/Rat.md'))).toBe(true);
  });

  it('a failing page conversion does not stop the other pages or notes', async () => {
    fake.put(
      journalEntry('lore', 'Lore', [
        pageEntry('lore', 'village', 'Village', '<p>Village text</p>', { sort: 1 }),
        pageEntry('lore', 'castle', 'Castle', '<p>BOOM</p>', { sort: 2 }),
      ])
    );
    const pump = await started();
    expect(await exists(full(P.lore))).toBe(true);
    expect(await read(P.village)).toContain('Village text');
    expect(await exists(full(P.castle))).toBe(false);
    expect(await exists(full(P.wolf))).toBe(true);
    expect(pump.status().errors).toEqual([
      { path: P.castle, error: 'converter failed on this page' },
    ]);
    // The index note does not link to the missing page note.
    expect(await read(P.lore)).not.toContain('Lore/Castle.md');
  });
});

// ---------------------------------------------------------------------------
// Scheduling: off, one cycle at a time, reconcile triggers, failures
// ---------------------------------------------------------------------------

describe('ObsidianMirrorPump: scheduling and failures', () => {
  it('asks and writes nothing while the mirror is off or Foundry is away', async () => {
    const pump = newPump();
    await pump.tick(); // no settings file: off
    await setSettings({ enabled: false });
    await tickAfter(pump, 10_000);
    expect(fake.requests).toEqual([]);
    expect(await listFiles(vault)).toEqual([]);
    expect(pump.status()).toMatchObject({ enabled: false, worldId: WORLD, lastError: null });

    fake.connected = false;
    await enableWithText();
    await tickAfter(pump, 10_000);
    expect(fake.requests).toEqual([]);
  });

  it('reconciles at once when the mirror is switched on', async () => {
    const pump = newPump();
    await setSettings({ enabled: false });
    await pump.tick();
    await enableWithText();
    await tickAfter(pump, 1); // inside any throttle: a settings change is not throttled
    expect(idsOnlyCount()).toBe(1);
    expect(await exists(full(P.wolf))).toBe(true);
    expect(pump.status().enabled).toBe(true);
  });

  it('runs one cycle at a time: a tick during a cycle returns the running one', async () => {
    await enableWithText();
    const pump = newPump();
    let release: () => void = () => undefined;
    const gate = new Promise<void>(resolve => (release = resolve));
    fake.beforeQuery = (): Promise<void> => gate;
    const first = pump.tick();
    const second = pump.tick();
    expect(second).toBe(first);
    await vi.waitFor(() => expect(fake.requests).toHaveLength(1));
    fake.beforeQuery = null;
    release();
    await first;
    expect(idsOnlyCount()).toBe(1);
    // The next tick is a new cycle.
    await tickAfter(pump, 10_000);
    expect(lastRequest()?.sinceModifiedTime).toBe(48_000);
  });

  it('reconciles every 10 minutes; incremental cycles in between never trash', async () => {
    const pump = await started();
    fake.remove(SWORD.uuid);
    await tickAfter(pump, 10_000);
    await tickAfter(pump, RECONCILE_EVERY_MS - 10_001);
    expect(idsOnlyCount()).toBe(1);
    expect(await exists(full(P.sword))).toBe(true);
    await tickAfter(pump, 1); // 10 minutes after the start reconcile
    expect(idsOnlyCount()).toBe(2);
    expect(await exists(full(P.sword))).toBe(false);
    expect(await exists(trashed(P.sword))).toBe(true);
  });

  it('a Foundry reload or a user change asks for a reconcile, at most once a minute', async () => {
    const pump = await started();
    fake.clientId = 'client-2'; // the GM reloaded Foundry
    await tickAfter(pump, 10_000); // incremental: notices the new client
    await tickAfter(pump, 10_000); // due, but inside the 60 s throttle
    expect(idsOnlyCount()).toBe(1);
    await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS);
    expect(idsOnlyCount()).toBe(2);

    fake.usersSignature = 'users-2'; // a user was added or changed role
    await tickAfter(pump, 10_000);
    expect(idsOnlyCount()).toBe(2);
    await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS);
    expect(idsOnlyCount()).toBe(3);
    // Nothing new after that: back to incremental cycles.
    await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS);
    expect(idsOnlyCount()).toBe(3);
  });

  it('a failed query keeps the watermark, is logged once and recovers', async () => {
    const pump = await started();
    const failures = (): unknown[] =>
      logger.warn.mock.calls.filter(call => call[0] === 'Obsidian mirror cycle failed');
    fake.failNext = 'Foundry is busy';
    await tickAfter(pump, 10_000);
    fake.failNext = 'Foundry is busy';
    await tickAfter(pump, 10_000);
    expect(failures()).toHaveLength(1);
    expect(pump.status().lastError).toMatch(/Foundry is busy/);
    expect(pump.status().lastCycleAt).toBe(new Date(T0).toISOString());
    fake.edit(WOLF.uuid, e => (e.hpMax = 30), 60_000);
    await tickAfter(pump, 10_000);
    expect(lastRequest()?.sinceModifiedTime).toBe(48_000);
    expect(await read(P.wolf)).toContain('hp_max: 30');
    expect(pump.status().lastError).toBeNull();
    expect(logger.info).toHaveBeenCalledWith('Obsidian mirror recovered');
  });

  it('an answer for another world writes nothing and resets the state', async () => {
    const pump = await started();
    const before = await snapshot();
    fake.worldId = 'other-world';
    fake.edit(WOLF.uuid, e => (e.name = 'Dire Wolf'), 60_000);
    await tickAfter(pump, 10_000);
    expect(await snapshot()).toEqual(before);
    expect(await exists(path.join(vault, 'Campaigns', 'other-world'))).toBe(false);
    expect(pump.status().lastError).toMatch(/world "other-world"/);
    // The world is back: a fresh start (a reconcile), then the rename lands.
    fake.worldId = WORLD;
    await tickAfter(pump, 10_000);
    expect(idsOnlyCount()).toBe(2);
    expect(await read(P.wolf)).toContain('# Dire Wolf');
  });
});

// ---------------------------------------------------------------------------
// Real-path fences: links and junctions must not lead out of the vault
// ---------------------------------------------------------------------------

/** A directory link (a junction on Windows: no admin rights needed). */
async function tryDirLink(target: string, link: string): Promise<boolean> {
  try {
    await fsp.mkdir(path.dirname(link), { recursive: true });
    await fsp.symlink(target, link, 'junction');
    return true;
  } catch {
    return false;
  }
}

describe('ObsidianMirrorPump: junctions out of the vault', () => {
  let outside: string;

  beforeEach(async () => {
    outside = path.join(tmp, 'outside');
    await fsp.mkdir(outside, { recursive: true });
  });

  it('writes nothing when AI Tool/Foundry is a junction out of the vault', async ctx => {
    if (!(await tryDirLink(outside, full('AI Tool/Foundry')))) return ctx.skip();
    const pump = await started();
    expect(await listFiles(outside)).toEqual([]);
    expect(await exists(full('AI Tool/Bases'))).toBe(false);
    expect(pump.status().lastError).toMatch(/leads outside/);
    expect(logger.warn).toHaveBeenCalledWith(
      'Obsidian mirror cycle failed',
      expect.objectContaining({ error: expect.stringMatching(/leads outside/) })
    );
  });

  it('writes nothing when AI Tool/Bases is a junction out of the vault', async ctx => {
    if (!(await tryDirLink(outside, full('AI Tool/Bases')))) return ctx.skip();
    const pump = await started();
    expect(await listFiles(outside)).toEqual([]);
    expect(await exists(full(P.wolf))).toBe(false);
    expect(pump.status().lastError).toMatch(/leads outside/);
  });

  it('trashes nothing when the vault .trash folder is a junction out of the vault', async ctx => {
    const pump = await started();
    if (!(await tryDirLink(outside, path.join(vault, '.trash')))) return ctx.skip();
    fake.remove(WOLF.uuid);
    await reconcileNow(pump);
    expect(await exists(full(P.wolf))).toBe(true);
    expect(await listFiles(outside)).toEqual([]);
    expect(pump.status().lastError).toMatch(/Refusing to trash/);
  });
});

// ---------------------------------------------------------------------------
// Foundry folders (I-100)
// ---------------------------------------------------------------------------

describe('ObsidianMirrorPump: notes follow the Foundry folder tree (I-100)', () => {
  const inFolder = (folderSeed: string, ...names: string[]): ExportFolderRef => ({
    id: fid(folderSeed),
    path: names,
  });
  const MAP = journalEntry('map', 'Map', [], { folder: inFolder('lorefolder', 'Lore') });

  it('places notes in their Foundry folders, page notes beside their journal', async () => {
    fake.edit(WOLF.uuid, e => (e.folder = inFolder('barovia', 'Villains', 'Barovia')));
    fake.edit(LORE.uuid, e => (e.folder = inFolder('campaign', 'Campaign')));
    fake.edit(SWORD.uuid, e => (e.folder = inFolder('odd', 'CON', '.hidden', 'a:b?')));
    const pump = await started();
    expect(await read('AI Tool/Foundry/NPCs/Villains/Barovia/Wolf.md')).toContain(WOLF.uuid);
    expect(await read('AI Tool/Foundry/Journals/Campaign/Lore.md')).toContain(LORE.uuid);
    expect(await read('AI Tool/Foundry/Journals/Campaign/Lore/Village.md')).toContain(
      'Village text'
    );
    expect(await read('AI Tool/Foundry/Items/_CON/_hidden/a b/Sun Blade.md')).toContain(SWORD.uuid);
    expect(await read(P.hero)).toContain(HERO.uuid); // no folder: the kind folder itself
    expect(pump.status().counts.npc).toBe(1);
    expect(pump.status().errors).toEqual([]);
  });

  it('moves a note once when its document moves in Foundry, and re-renders the links to it', async () => {
    fake.put(
      pcEntry('hero', 'Test Hero', {
        notableItems: [{ name: 'Sun Blade', sourceUuid: SWORD.uuid }],
      })
    );
    const pump = await started();
    expect(await read(P.hero)).toContain('[Sun Blade](../Items/Sun%20Blade.md)');
    fake.edit(SWORD.uuid, e => (e.folder = inFolder('treasure', 'Treasure')), 60_000);
    fake.edit(LORE.uuid, e => (e.folder = inFolder('campaign', 'Campaign')), 60_000);
    await tickAfter(pump, 10_000);
    const moved = {
      sword: 'AI Tool/Foundry/Items/Treasure/Sun Blade.md',
      lore: 'AI Tool/Foundry/Journals/Campaign/Lore.md',
      village: 'AI Tool/Foundry/Journals/Campaign/Lore/Village.md',
      castle: 'AI Tool/Foundry/Journals/Campaign/Lore/Castle.md',
    };
    for (const rel of Object.values(moved)) expect(await exists(full(rel))).toBe(true);
    for (const rel of [P.sword, P.lore, P.village, P.castle]) {
      expect(await exists(full(rel))).toBe(false);
    }
    // Moved by rename: no copy in the trash, the emptied page folder is gone.
    expect(await listFiles(path.join(vault, '.trash'))).toEqual([]);
    expect(await exists(full('AI Tool/Foundry/Journals/Lore'))).toBe(false);
    expect(await read(moved.lore)).toContain('(Lore/Village.md)');
    expect(pump.status().counts).toMatchObject({ journal: 1, 'journal-page': 2, 'story-item': 2 });
    expect(logger.info).toHaveBeenCalledWith(
      'Obsidian mirror updated',
      expect.objectContaining({ moved: 4 })
    );
    // The hero note was not part of the move: the forced re-render after it fixes its link.
    await tickAfter(pump, RECONCILE_MIN_INTERVAL_MS);
    expect(await read(P.hero)).toContain('[Sun Blade](../Items/Treasure/Sun%20Blade.md)');
    // Settled: a later reconcile moves and writes nothing.
    const before = await snapshot();
    await reconcileNow(pump);
    expect(await snapshot()).toEqual(before);
  });

  it('keeps an edited note at its old path, and says so in the status', async () => {
    const pump = await started();
    const edited = `${(await read(P.wolf)) ?? ''}\nMy own wolf notes.\n`;
    await fsp.writeFile(full(P.wolf), edited, 'utf8');
    fake.edit(WOLF.uuid, e => (e.folder = inFolder('beasts', 'Beasts')), 60_000);
    await tickAfter(pump, 10_000);
    expect(await read(P.wolf)).toBe(edited);
    expect(await exists(full('AI Tool/Foundry/NPCs/Beasts'))).toBe(false);
    const kept = { path: P.wolf, reason: 'kept at its old path because it was edited' };
    expect(pump.status().skipped).toEqual([kept]);
    // Still listed that way after a reconcile with a fresh scan.
    await reconcileNow(pump);
    expect(pump.status().skipped).toEqual([kept]);
    expect(await read(P.status)).toContain('kept at its old path because it was edited');
  });

  it('never lets a journal page folder take the name of a Foundry folder beside it', async () => {
    fake.put(MAP);
    await started();
    const suffix = shortSuffix(LORE.uuid);
    expect(await read(`AI Tool/Foundry/Journals/Lore (${suffix}).md`)).toContain(LORE.uuid);
    expect(await read(`AI Tool/Foundry/Journals/Lore (${suffix})/Village.md`)).toContain(
      'Village text'
    );
    expect(await listFiles(full('AI Tool/Foundry/Journals/Lore'))).toEqual(['Map.md']);
  });

  it('moves a journal out of the way when a Foundry folder of its name appears later', async () => {
    const pump = await started();
    expect(await read(P.village)).toContain('Village text');
    fake.put({ ...MAP, modified: 60_000 });
    await tickAfter(pump, 10_000);
    const suffix = shortSuffix(LORE.uuid);
    expect(await read(`AI Tool/Foundry/Journals/Lore (${suffix}).md`)).toContain(LORE.uuid);
    expect(await listFiles(full(`AI Tool/Foundry/Journals/Lore (${suffix})`))).toEqual([
      'Castle.md',
      'Village.md',
    ]);
    expect(await listFiles(full('AI Tool/Foundry/Journals/Lore'))).toEqual(['Map.md']);
    expect(await exists(full(P.lore))).toBe(false);
  });

  it('keeps a PC note in PCs when the actor loses its player, inside its Foundry folder', async () => {
    const pump = await started();
    fake.edit(
      HERO.uuid,
      e => {
        if (e.kind !== 'actor') return;
        e.pc = false;
        e.owners = [];
        e.folder = inFolder('party', 'Party');
      },
      60_000
    );
    await tickAfter(pump, 10_000);
    const moved = 'AI Tool/Foundry/PCs/Party/Test Hero.md';
    expect(await read(moved)).toContain('type: "npc"');
    expect(await exists(full(P.hero))).toBe(false);
    expect(await exists(full('AI Tool/Foundry/NPCs/Party'))).toBe(false);
  });

  it('moves the notes of the flat layout of earlier versions into their folders once', async () => {
    const pump = await started();
    // Earlier versions wrote every note flat; the documents sit in Foundry folders.
    fake.edit(WOLF.uuid, e => (e.folder = inFolder('beasts', 'Beasts')));
    fake.edit(HERO.uuid, e => (e.folder = inFolder('party', 'Party')));
    // A restart: the folder is part of the signature, so both documents are fetched again.
    const restarted = newPump();
    await restarted.tick();
    expect(await read('AI Tool/Foundry/NPCs/Beasts/Wolf.md')).toContain(WOLF.uuid);
    expect(await read('AI Tool/Foundry/PCs/Party/Test Hero.md')).toContain(HERO.uuid);
    expect(await exists(full(P.wolf))).toBe(false);
    expect(await exists(full(P.hero))).toBe(false);
    expect(restarted.status().duplicates).toEqual([]);
    expect(pump.status().lastError).toBeNull();
  });
});
