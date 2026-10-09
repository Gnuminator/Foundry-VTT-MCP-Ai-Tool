/**
 * Obsidian export (O1+O2): notes rendered from a temp bridge vault into a temp
 * Obsidian vault. Checks the ownership rules (AI Tool/ rebuilt, edited or
 * foreign notes skipped, legacy O1 notes migrated once, notes no longer
 * produced pruned to `.trash/`, Home.md and Prep/ created once and never
 * touched), session grouping into play sessions, the change-history merge,
 * Tarokka archive + canvas, Bases, `_status.md`, the log cache, the path
 * fence, and that no generated file ever carries a literal Templater tag.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { PlayActorRef, PlayRecord } from '@gnuminator/shared';
import { playLogFileName } from '@gnuminator/shared';

import { localDateKey as localDateKeyOf } from '../event-pump.js';
import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';

import { runObsidianCli } from './cli.js';
import { LEGACY_CAMPAIGN_HOMES } from './campaign-home-legacy.js';
import { campaignDir, exportWorldToObsidian, newExportCache } from './export.js';
import { pathKey } from './mirror-common.js';
import { allocateNotePaths } from './mirror-paths.js';
import { SEEN_INDEX_FILE, type SeenIndex } from './seen-in.js';
import { cell, frontmatter, renderCampaignHome, safeFileName } from './render.js';

const WORLD = 'strahd-test';
let dataDir: string;
let vaultDir: string;
let store: VaultStore;

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'obs-data-'));
  vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'obs-vault-'));
  store = new VaultStore({ dataDir });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
  await fsp.rm(vaultDir, { recursive: true, force: true });
});

async function seed(): Promise<void> {
  // Session log: an explicit marker-bound group (S01), then a second group
  // opened by a 3-hour gap (S02) whose event carries a Templater-tag attack
  // in data the exporter did not write itself.
  await store.appendLines(WORLD, 'sessions', '2026-09-28.jsonl', [
    {
      id: 'e0',
      timestamp: '2026-09-28T09:00:00.000Z',
      eventType: 'session-start',
      actorName: null,
      description: 'Play session started',
      details: { source: 'mark-play-session' },
    },
    {
      id: 'e1',
      timestamp: '2026-09-28T09:10:00.000Z',
      eventType: 'journal-created',
      actorName: 'Ireena',
      description: 'Journal entry created: "Tarokka reading"',
    },
    {
      id: 'e2',
      timestamp: '2026-09-28T09:20:00.000Z',
      eventType: 'scene-change',
      actorName: null,
      description: 'Scene changed to "Village of Barovia"',
      details: { sceneId: 's1', sceneName: 'Village of Barovia' },
    },
    {
      id: 'e3',
      timestamp: '2026-09-28T09:30:00.000Z',
      eventType: 'gm-change',
      actorName: null,
      description: 'Applied: Store a new Tarokka reading | built-in',
      details: { changeId: 'chg-1' },
    },
    {
      id: 'e4',
      timestamp: '2026-09-28T10:00:00.000Z',
      eventType: 'session-end',
      actorName: null,
      description: 'Play session ended',
      details: { source: 'mark-play-session' },
    },
    {
      id: 'e5',
      timestamp: '2026-09-28T14:00:00.000Z',
      eventType: 'note',
      actorName: '<%* app.vault.delete() %>',
      description: 'A player did something: <% tp.file.title %>',
      details: { changeId: 'chg-3' },
    },
  ]);
  await store.write(WORLD, 'gm', 'audit.json', {
    entries: [
      {
        changeId: 'chg-1',
        planId: 'plan-1',
        feature: 'tarokka',
        summary: 'Store a new Tarokka reading (built-in roll)',
        risk: 'write',
        target: 'vault',
        mode: 'apply',
        appliedAt: '2026-09-28T09:30:00.000Z',
        diff: ['gm/tarokka.json: current.positions.tome: (unset) → {"cardName":"Seven of Swords"}'],
        undoneBy: 'chg-2',
        undoneAt: '2026-09-28T09:53:00.000Z',
      },
      {
        changeId: 'chg-2',
        planId: null,
        feature: 'tarokka',
        summary: 'Undo: Store a new Tarokka reading (built-in roll)',
        risk: 'write',
        target: 'vault',
        mode: 'undo',
        appliedAt: '2026-09-28T09:53:00.000Z',
        diff: ['undone: ...'],
        undoOf: 'chg-1',
      },
    ],
  });
  // The append-only history file (contract 2): the same two lines, plus a
  // jsonl-only apply this world's ring never saw, with a Templater tag in
  // its own summary.
  await store.appendLines(WORLD, 'gm', 'audit-log.jsonl', [
    {
      v: 1,
      changeId: 'chg-1',
      planId: 'plan-1',
      feature: 'tarokka',
      summary: 'Store a new Tarokka reading (built-in roll)',
      risk: 'write',
      target: 'vault',
      mode: 'apply',
      appliedAt: '2026-09-28T09:30:00.000Z',
      diff: ['gm/tarokka.json: current.positions.tome: (unset) → {"cardName":"Seven of Swords"}'],
    },
    {
      v: 1,
      changeId: 'chg-2',
      planId: null,
      feature: 'tarokka',
      summary: 'Undo: Store a new Tarokka reading (built-in roll)',
      risk: 'write',
      target: 'vault',
      mode: 'undo',
      appliedAt: '2026-09-28T09:53:00.000Z',
      diff: ['undone: ...'],
      undoOf: 'chg-1',
    },
    {
      v: 1,
      changeId: 'chg-3',
      planId: 'plan-3',
      feature: 'session-log',
      summary: 'Recorded a note <% tp.file.title %>',
      risk: 'read',
      target: 'vault',
      mode: 'apply',
      appliedAt: '2026-09-28T14:00:00.000Z',
      diff: ['no diff'],
    },
  ]);
  await store.write(WORLD, 'gm', 'tarokka.json', {
    current: {
      readingId: 'roll-abc',
      source: 'builtin-roll',
      readAt: '2026-09-28T09:57:03.000Z',
      providerVersion: null,
      positions: {
        tome: {
          cardName: 'Seven of Swords',
          cardId: 'swords-7',
          gmNote: null,
          revealed: true,
          revealPageUuid: 'JournalEntry.a.JournalEntryPage.b',
        },
        holySymbol: {
          cardName: 'Master of Stars',
          cardId: 'stars-master',
          gmNote: 'behind the altar: <% tp.file.title %>',
          revealed: false,
        },
        sunsword: { cardName: 'Five of Glyphs', cardId: 'glyphs-5', gmNote: null, revealed: false },
        ally: { cardName: 'Tempter', cardId: 'tempter', gmNote: null, revealed: false },
        strahdLocation: { cardName: 'Beast', cardId: 'beast', gmNote: null, revealed: false },
      },
    },
    archive: {
      'roll-old': {
        readingId: 'roll-old',
        source: 'builtin-roll',
        readAt: '2026-09-20T09:00:00.000Z',
        positions: {
          tome: { cardName: 'Anvil', cardId: 'anvil', gmNote: null, revealed: false },
        },
      },
      'roll-incomplete': {},
    },
  });
  await store.write(WORLD, 'gm', 'tarokka-config.json', {
    links: { sunsword: { 'glyphs-5': { journalPageUuid: 'JournalEntry.x.JournalEntryPage.y' } } },
    cardNames: { tempter: 'The Tempter' },
  });
}

async function run(): Promise<ReturnType<typeof exportWorldToObsidian>> {
  return exportWorldToObsidian({ store, audit: new AuditLog(store), worldId: WORLD, vaultDir });
}

async function note(rel: string): Promise<string> {
  return fsp.readFile(path.join(campaignDir(vaultDir, WORLD), rel), 'utf8');
}

async function listFilesRecursive(dir: string): Promise<string[]> {
  const entries = await fsp.readdir(dir, { withFileTypes: true }).catch(() => []);
  const out: string[] = [];
  for (const entry of entries) {
    const full = path.join(dir, entry.name);
    if (entry.isDirectory()) out.push(...(await listFilesRecursive(full)));
    else out.push(full);
  }
  return out;
}

describe('exportWorldToObsidian', () => {
  it('writes session, change, Tarokka and Bases notes plus the GM-owned Home and Prep', async () => {
    await seed();
    const result = await run();
    expect(result.created.sort()).toEqual([
      'Home.md',
      'Prep',
      'Prep/README.md',
      'Prep/Templates/Location.md',
      'Prep/Templates/NPC.md',
      'Prep/Templates/Quest.md',
      'Prep/Templates/Session plan.md',
    ]);
    expect(result.written.sort()).toEqual(
      [
        'AI Tool/Bases/Changes.base',
        'AI Tool/Bases/PC stats.base',
        'AI Tool/Bases/Sessions.base',
        'AI Tool/Bases/Tarokka readings.base',
        'AI Tool/Changes/2026-09.md',
        'AI Tool/Sessions/2026-09-28 S01.md',
        'AI Tool/Sessions/2026-09-28 S02.md',
        'AI Tool/Stats/Campaign.md',
        'AI Tool/Tarokka/Archive/roll-old.md',
        'AI Tool/Tarokka/Current reading.md',
        'AI Tool/Tarokka/Spread.canvas',
        'AI Tool/_status.md',
      ].sort()
    );
    expect(result.skipped).toEqual([]);
    expect(result.trashed).toEqual([]);
    expect(result.errors).toEqual([]);

    const s1 = await note('AI Tool/Sessions/2026-09-28 S01.md');
    expect(s1).toMatch(/^---\ntype: "session"\n/);
    expect(s1).toContain('session_number: 1');
    expect(s1).toContain('started_by: "marker"');
    expect(s1).toContain('ended_by: "marker"');
    expect(s1).toContain('events: 5');
    expect(s1).toContain('scenes:\n  - "Village of Barovia"');
    expect(s1).toContain('[chg-1](../Changes/2026-09.md#^chg-1)');
    // O3: no play records were seeded, so every play-log property is zero and
    // the Stats section says so plainly, but the properties are still there.
    expect(s1).toContain('play_records: 0');
    expect(s1).toContain('combats: 0');
    expect(s1).toContain('gm_changes: 1'); // the seeded gm-change event falls in S01
    expect(s1).toContain('## Stats');
    expect(s1).toContain('(no combats this session)');
    expect(s1).not.toContain('Highest roll'); // no PC d20 roll recorded

    const s2 = await note('AI Tool/Sessions/2026-09-28 S02.md');
    expect(s2).toContain('session_number: 2');
    expect(s2).toContain('started_by: "gap"');
    expect(s2).toContain('ended_by: "open"');
    // The malicious actor name and description are neutralized, never literal.
    expect(s2).not.toContain('<%');
    expect(s2).toContain('&lt;%');

    const changes = await note('AI Tool/Changes/2026-09.md');
    expect(changes).toContain('undone by `chg-2`');
    expect(changes).toContain('undo of `chg-1`');
    expect(changes).toContain('^chg-1');
    expect(changes).toContain('^chg-2');
    // The jsonl-only entry (no ring counterpart) is included too.
    expect(changes).toContain('^chg-3');
    expect(changes).not.toContain('<%');
    expect(changes).toContain('&lt;%');

    const tarokka = await note('AI Tool/Tarokka/Current reading.md');
    expect(tarokka).toContain('reading_id: "roll-abc"');
    expect(tarokka).toContain('> [!danger]- Card (GM secret)\n> **Seven of Swords** (`swords-7`)');
    expect(tarokka).toContain('**The Tempter**');
    expect(tarokka).toContain('[roll-old](Archive/roll-old.md)');
    expect(tarokka).not.toContain('<%');
    expect(tarokka).toContain('&lt;%');
    for (const line of tarokka.split('\n')) {
      if (line.includes('Seven of Swords')) expect(line.startsWith('>')).toBe(true);
    }

    const archived = await note('AI Tool/Tarokka/Archive/roll-old.md');
    expect(archived).toContain('archived: true');
    expect(archived).toContain('Anvil');

    const canvas = await note('AI Tool/Tarokka/Spread.canvas');
    const parsedCanvas = JSON.parse(canvas) as { nodes: Array<{ id: string; text?: string }> };
    expect(parsedCanvas.nodes.map(n => n.id).sort()).toEqual(
      ['ally', 'generated', 'holySymbol', 'strahdLocation', 'sunsword', 'tome'].sort()
    );
    const tomeNode = parsedCanvas.nodes.find(n => n.id === 'tome');
    expect(tomeNode?.text).toContain('Seven of Swords');
    expect(tomeNode?.color).toBe('4'); // revealed
    expect(canvas).not.toContain('<%');

    const status = await note('AI Tool/_status.md');
    expect(status).toContain('notes_managed:');
    expect(status).not.toContain('notes_written');
    expect(status).toContain('- (none)');

    const campaignStats = await note('AI Tool/Stats/Campaign.md');
    expect(campaignStats).toMatch(/^---\ntype: "campaign-stats"\n/);
    expect(campaignStats).toContain('sessions: 2');
    expect(campaignStats).toContain('## d20 spread (1-20)');
    expect(campaignStats).toContain('## Per-user dice');

    for (const base of [
      'Sessions.base',
      'Changes.base',
      'Tarokka readings.base',
      'PC stats.base',
    ]) {
      const text = await note(`AI Tool/Bases/${base}`);
      expect(text.startsWith('filters:')).toBe(true);
    }

    // No generated file anywhere carries a literal Templater tag.
    const allFiles = await listFilesRecursive(campaignDir(vaultDir, WORLD));
    for (const file of allFiles) {
      const text = await fsp.readFile(file, 'utf8');
      expect(text, file).not.toContain('<%');
    }
  });

  it('rewrites nothing when nothing changed (mtime kept), and never touches GM-owned files', async () => {
    await seed();
    await run(); // first run: everything created
    await fsp.writeFile(path.join(campaignDir(vaultDir, WORLD), 'Home.md'), 'my own home');
    await fsp.writeFile(path.join(campaignDir(vaultDir, WORLD), 'Prep/README.md'), 'mine');
    await run(); // second run: _status.md settles (its counts, and the edited Home it lists)
    const statusPath = path.join(campaignDir(vaultDir, WORLD), 'AI Tool/_status.md');
    const before = await fsp.stat(statusPath);
    const again = await run();
    expect(again.written).toEqual([]);
    expect(again.created).toEqual([]);
    expect(again.unchanged.length).toBeGreaterThan(0);
    expect(await note('Home.md')).toBe('my own home');
    expect(await note('Prep/README.md')).toBe('mine');
    const after = await fsp.stat(statusPath);
    expect(after.mtimeMs).toBe(before.mtimeMs);
  });

  it('upgrades an untouched old Home to the current template, CRLF or not', async () => {
    await seed();
    const homePath = path.join(campaignDir(vaultDir, WORLD), 'Home.md');
    for (const eol of ['\n', '\r\n']) {
      const old = LEGACY_CAMPAIGN_HOMES[0](WORLD).replace(/\n/g, eol);
      await fsp.mkdir(path.dirname(homePath), { recursive: true });
      await fsp.writeFile(homePath, old);
      const result = await run();
      expect(result.written).toContain('Home.md');
      expect(result.created).not.toContain('Home.md');
      expect(await note('Home.md')).toBe(renderCampaignHome(WORLD));
      expect(result.skipped).toEqual([]);
      const again = await run();
      expect(again.written).not.toContain('Home.md');
    }
  });

  it('leaves an edited old Home alone and says so in _status.md', async () => {
    await seed();
    const homePath = path.join(campaignDir(vaultDir, WORLD), 'Home.md');
    const edited = `${LEGACY_CAMPAIGN_HOMES[0](WORLD)}\nMy own line.\n`;
    await fsp.mkdir(path.dirname(homePath), { recursive: true });
    await fsp.writeFile(homePath, edited);
    const result = await run();
    expect(await note('Home.md')).toBe(edited);
    expect(result.written).not.toContain('Home.md');
    expect(result.skipped).toEqual([]);
    expect(result.kept.map(s => s.path)).toEqual(['Home.md']);
    const status = await note('AI Tool/_status.md');
    expect(status).toContain('## Your own notes (kept as you edited them)');
    expect(status).toMatch(
      /- `Home\.md`: your own Home \(edited in Obsidian\).*Adventures section/
    );
    expect(status).toContain('notes_skipped: 0');
    expect(status).toMatch(/## Skipped[^\n]*\n\n- \(none\)/);
  });

  it('writes the prep templates only while their folder is missing (R2)', async () => {
    await seed();
    await run();
    const templates = path.join(campaignDir(vaultDir, WORLD), 'Prep/Templates');
    await fsp.rm(path.join(templates, 'Quest.md'));
    await fsp.writeFile(path.join(templates, 'NPC.md'), 'my own NPC template');
    expect((await run()).created).toEqual([]);
    expect(await note('Prep/Templates/NPC.md')).toBe('my own NPC template');
    expect((await fsp.readdir(templates)).sort()).toEqual([
      'Location.md',
      'NPC.md',
      'Session plan.md',
    ]);
    await fsp.rm(templates, { recursive: true });
    expect((await run()).created).toHaveLength(4);
    expect(await note('Prep/Templates/NPC.md')).toMatch(/^---\ntype: npc-prep\nfvtt_uuid:\n/);
  });

  it('leaves a templates folder renamed in another letter case alone (R2 review)', async () => {
    await seed();
    await run();
    const prep = path.join(campaignDir(vaultDir, WORLD), 'Prep');
    await fsp.rename(path.join(prep, 'Templates'), path.join(prep, 'templates'));
    expect((await run()).created).toEqual([]);
    expect((await fsp.readdir(prep)).sort()).toEqual(['README.md', 'templates']);
  });

  it('an empty world still gets Bases and a status note, but no Tarokka files', async () => {
    const r = await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: 'no-tarokka',
      vaultDir,
    });
    expect(r.written.sort()).toEqual(
      [
        'AI Tool/Bases/Changes.base',
        'AI Tool/Bases/PC stats.base',
        'AI Tool/Bases/Sessions.base',
        'AI Tool/Bases/Tarokka readings.base',
        'AI Tool/Stats/Campaign.md',
        'AI Tool/_status.md',
      ].sort()
    );
  });

  it('shows "no reading" and an empty canvas when Tarokka has no complete reading', async () => {
    await store.write(WORLD, 'gm', 'tarokka.json', { current: { positions: {} } });
    await run();
    expect(await note('AI Tool/Tarokka/Current reading.md')).toContain('No reading is stored yet');
    const canvas = JSON.parse(await note('AI Tool/Tarokka/Spread.canvas')) as {
      nodes: Array<{ id: string; text?: string }>;
    };
    expect(canvas.nodes.map(n => n.id).sort()).toEqual(['generated', 'no-reading']);
  });

  it('refuses a world id that could escape the vault', async () => {
    await expect(
      exportWorldToObsidian({ store, audit: new AuditLog(store), worldId: '../x', vaultDir })
    ).rejects.toThrow(/Bad world id/);
  });

  it('skips a note the GM edited, and lists it in _status.md, without touching its text', async () => {
    await seed();
    await run();
    const changesPath = path.join(campaignDir(vaultDir, WORLD), 'AI Tool/Changes/2026-09.md');
    // Keep the marker (frontmatter + hash) but change body text, like a GM
    // typing a note under the generated content: the hash no longer matches.
    const original = await fsp.readFile(changesPath, 'utf8');
    await fsp.writeFile(changesPath, `${original}\nMy own GM note added at the bottom.\n`, 'utf8');
    const again = await run();
    expect(again.skipped).toEqual([
      { path: 'AI Tool/Changes/2026-09.md', reason: 'edited in Obsidian' },
    ]);
    expect(await fsp.readFile(changesPath, 'utf8')).toContain(
      'My own GM note added at the bottom.'
    );
    const status = await note('AI Tool/_status.md');
    expect(status).toContain('AI Tool/Changes/2026-09.md`: edited in Obsidian');
  });

  it('migrates a legacy O1 note in place (generated: true + the O1 banner, no hash)', async () => {
    const dir = path.join(campaignDir(vaultDir, WORLD), 'AI Tool/Tarokka');
    await fsp.mkdir(dir, { recursive: true });
    const legacy = [
      '---',
      'type: "tarokka-reading"',
      'world: "strahd-test"',
      'generated: true',
      '---',
      '# Tarokka reading',
      '',
      '> [!info] Generated by the Foundry AI Tool',
      '> old body',
      '',
    ].join('\n');
    await fsp.writeFile(path.join(dir, 'Current reading.md'), legacy, 'utf8');
    await seed();
    const result = await run();
    expect(result.written).toContain('AI Tool/Tarokka/Current reading.md');
    expect(result.skipped).toEqual([]);
    const migrated = await note('AI Tool/Tarokka/Current reading.md');
    expect(migrated).toContain('generated_by: "foundry-ai-tool"');
  });

  it('leaves a foreign note in AI Tool/ untouched and lists it as skipped', async () => {
    const dir = path.join(campaignDir(vaultDir, WORLD), 'AI Tool/Tarokka');
    await fsp.mkdir(dir, { recursive: true });
    await fsp.writeFile(
      path.join(dir, 'Current reading.md'),
      '# My own prep, not generated',
      'utf8'
    );
    await seed();
    const result = await run();
    expect(result.skipped).toEqual([
      { path: 'AI Tool/Tarokka/Current reading.md', reason: 'not written by the AI Tool' },
    ]);
    expect(await note('AI Tool/Tarokka/Current reading.md')).toBe('# My own prep, not generated');
  });

  it('prunes a session note this run no longer produces to .trash/, but leaves an edited one in place', async () => {
    await seed();
    await run();
    const sessionsDir = path.join(campaignDir(vaultDir, WORLD), 'AI Tool/Sessions');
    // A stale note from an old export (a different date, not reproduced).
    await fsp.writeFile(path.join(sessionsDir, 'stale.md'), 'not ours at all', 'utf8');
    // An old O2 note that IS ours (round-trips the ownership hash) but this
    // run will not reproduce because the underlying event is gone.
    const staleOwned = path.join(sessionsDir, '2026-09-01 S01.md');
    const { withGeneratedHash } = await import('./ownership.js');
    await fsp.writeFile(
      staleOwned,
      withGeneratedHash(
        [
          '---',
          'type: "session"',
          'fvtt_world: "strahd-test"',
          'generated_by: "foundry-ai-tool"',
          'generated_hash: ""',
          '---',
          '# old session',
        ].join('\n')
      ),
      'utf8'
    );
    const again = await run();
    expect(again.trashed).toContain('AI Tool/Sessions/2026-09-01 S01.md');
    expect(
      await fsp
        .stat(
          path.join(vaultDir, '.trash', 'Campaigns', WORLD, 'AI Tool/Sessions/2026-09-01 S01.md')
        )
        .then(
          () => true,
          () => false
        )
    ).toBe(true);
    expect(
      await fsp.stat(staleOwned).then(
        () => true,
        () => false
      )
    ).toBe(false);
    // The foreign note is left alone and listed as skipped, not trashed.
    expect(again.trashed).not.toContain('AI Tool/Sessions/stale.md');
    expect(again.skipped).toContainEqual({
      path: 'AI Tool/Sessions/stale.md',
      reason: 'not written by the AI Tool',
    });
    expect(await fsp.readFile(path.join(sessionsDir, 'stale.md'), 'utf8')).toBe('not ours at all');
  });

  it('reuses the session-log cache when a file is unchanged, and re-reads it when it changes', async () => {
    await seed();
    const cache = newExportCache();
    const readLinesSpy = vi.spyOn(store, 'readLines');
    await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: WORLD,
      vaultDir,
      cache,
    });
    const firstCallCount = readLinesSpy.mock.calls.filter(
      c => c[1] === 'sessions' && c[2] === '2026-09-28.jsonl'
    ).length;
    expect(firstCallCount).toBe(1);

    await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: WORLD,
      vaultDir,
      cache,
    });
    const secondCallCount = readLinesSpy.mock.calls.filter(
      c => c[1] === 'sessions' && c[2] === '2026-09-28.jsonl'
    ).length;
    expect(secondCallCount).toBe(1); // still just the one call from before: not re-read.

    await store.appendLines(WORLD, 'sessions', '2026-09-28.jsonl', [
      {
        id: 'e6',
        timestamp: '2026-09-28T14:05:00.000Z',
        eventType: 'note',
        actorName: null,
        description: 'one more event',
      },
    ]);
    await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: WORLD,
      vaultDir,
      cache,
    });
    const thirdCallCount = readLinesSpy.mock.calls.filter(
      c => c[1] === 'sessions' && c[2] === '2026-09-28.jsonl'
    ).length;
    expect(thirdCallCount).toBe(2); // the changed file was re-read.
    readLinesSpy.mockRestore();
  });
});

describe('session notes in Foundry (D-087)', () => {
  const JOURNAL = 'JournalEntry.jjjjjjjjjjjjjjjj';

  async function stageInFoundry(date: string): Promise<void> {
    await store.write(WORLD, 'gm', 'session-notes.rec-1.json', {
      sessionId: 'rec-1',
      date,
      title: 'Vejen til Barovia',
      languages: ['da', 'en'],
      pages: [],
      stagedAt: '2026-09-29T06:00:00.000Z',
      autoPut: true,
      put: {
        changeId: 'chg-9',
        putAt: '2026-09-29T07:00:00.000Z',
        journalUuid: JOURNAL,
        recapPageUuid: `${JOURNAL}.JournalEntryPage.pppppppppppppppp`,
        pageUuids: {},
        pageTimes: {},
        auto: true,
      },
    });
  }

  it('links the mirrored journal from the session note of the same day', async () => {
    await seed();
    await run();
    const date = /\ndate: "([^"]+)"/.exec(await note('AI Tool/Sessions/2026-09-28 S01.md'))![1];
    await stageInFoundry(date);

    await run();
    expect(await note('AI Tool/Sessions/2026-09-28 S01.md')).toContain(
      `## Session notes\n\n- Vejen til Barovia: in Foundry, journal "${date}: Vejen til Barovia" (no mirror note yet)`
    );

    // The mirror follows Foundry's folders (I-100): the journal sits in the "Session notes"
    // folder. Another journal there already holds the plain name, so ours got the hash suffix.
    const folder = 'AI Tool/Foundry/Journals/Session notes';
    const journals = path.join(campaignDir(vaultDir, WORLD), folder);
    await fsp.mkdir(journals, { recursive: true });
    const stem = safeFileName(`${date}: Vejen til Barovia`);
    await fsp.writeFile(
      path.join(journals, `${stem}.md`),
      '---\nfvtt_uuid: "JournalEntry.other"\n---\n'
    );
    const ours = allocateNotePaths(
      [
        {
          uuid: JOURNAL,
          id: 'jjjjjjjjjjjjjjjj',
          folder,
          name: `${date}: Vejen til Barovia`,
          created: null,
        },
      ],
      new Map(),
      new Set([pathKey(`${folder}/${stem}.md`)])
    ).get(JOURNAL)!;
    await fsp.writeFile(
      path.join(campaignDir(vaultDir, WORLD), ours),
      `---\nfvtt_uuid: "${JOURNAL}"\n---\n`
    );

    await run();
    const s1 = await note('AI Tool/Sessions/2026-09-28 S01.md');
    const rel = path.posix
      .relative('AI Tool/Sessions', ours)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    expect(s1).toContain(`- [Vejen til Barovia](${rel})`);
    expect(rel).toMatch(/^\.\.\/Foundry\/Journals\/Session%20notes\/.+%20\([a-z0-9]{6}\)\.md$/);
  });

  it('still finds a mirror note at the flat journal folder of earlier versions', async () => {
    await seed();
    await run();
    const date = /\ndate: "([^"]+)"/.exec(await note('AI Tool/Sessions/2026-09-28 S01.md'))![1];
    await stageInFoundry(date);
    const flat = `AI Tool/Foundry/Journals/${safeFileName(`${date}: Vejen til Barovia`)}.md`;
    await fsp.mkdir(path.dirname(path.join(campaignDir(vaultDir, WORLD), flat)), {
      recursive: true,
    });
    await fsp.writeFile(
      path.join(campaignDir(vaultDir, WORLD), flat),
      `---\nfvtt_uuid: "${JOURNAL}"\n---\n`
    );

    await run();
    const rel = path.posix
      .relative('AI Tool/Sessions', flat)
      .split('/')
      .map(encodeURIComponent)
      .join('/');
    expect(await note('AI Tool/Sessions/2026-09-28 S01.md')).toContain(
      `- [Vejen til Barovia](${rel})`
    );
    expect(rel).toMatch(/^\.\.\/Foundry\/Journals\/[^/]+\.md$/);
  });
});

describe('render helpers', () => {
  it('quotes text properties and writes lists', () => {
    expect(
      frontmatter({ a: 'x: y', b: 2, c: true, d: ['p', 'q'], e: [], f: null, g: undefined })
    ).toBe('---\na: "x: y"\nb: 2\nc: true\nd:\n  - "p"\n  - "q"\ne: []\nf: null\n---');
  });

  it('neutralizes a Templater tag in a frontmatter string value', () => {
    expect(frontmatter({ a: '<%* app.vault.delete() %>' })).toBe(
      '---\na: "&lt;%* app.vault.delete() %>"\n---'
    );
  });

  it('makes table cells safe, and neutralizes a Templater tag', () => {
    expect(cell('a|b\nc')).toBe('a\\|b c');
    expect(cell('<% tp.file.title %>')).toBe('&lt;% tp.file.title %>');
    // A trailing backslash in the data cannot cancel the pipe's escape.
    expect(cell('a\\|b')).toBe('a\\\\\\|b');
    expect(cell('C:\\Foundry')).toBe('C:\\\\Foundry');
  });

  it('makes file names safe (reserved names, link-breaking characters, collisions handled by callers)', () => {
    expect(safeFileName('Castle Ravenloft: K1 #2')).toBe('Castle Ravenloft K1 2');
    expect(safeFileName('con')).toBe('_con');
    expect(safeFileName('  ')).toBe('_untitled');
    expect(safeFileName('a/b\\c|d?e*f<g>h"i')).toBe('a b c d e f g h i');
  });
});

describe('obsidian CLI', () => {
  it('exports all worlds into --vault, and needs a vault', async () => {
    await seed();
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      out: (t: string): void => void out.push(t),
      err: (t: string): void => void err.push(t),
      env: { FOUNDRY_AI_DATA_DIR: dataDir },
    };
    expect(await runObsidianCli(['export'], io)).toBe(2);
    expect(err[0]).toMatch(/No Obsidian vault/);
    expect(await runObsidianCli(['export', '--vault', vaultDir], io)).toBe(0);
    expect(out[0]).toMatch(/^strahd-test: 12 written, 0 unchanged, 7 created/);
    expect(await runObsidianCli(['nope'], io)).toBe(2);
  });

  it('exits 1 and still reports the other worlds when one note fails to write', async () => {
    await seed();
    // A plain file where the exporter needs to create the Sessions directory:
    // its note writes fail (caught), everything else still runs.
    await fsp.mkdir(path.join(campaignDir(vaultDir, WORLD), 'AI Tool'), { recursive: true });
    await fsp.writeFile(
      path.join(campaignDir(vaultDir, WORLD), 'AI Tool', 'Sessions'),
      'not a dir',
      'utf8'
    );
    const out: string[] = [];
    const err: string[] = [];
    const io = {
      out: (t: string): void => void out.push(t),
      err: (t: string): void => void err.push(t),
      env: { FOUNDRY_AI_DATA_DIR: dataDir },
    };
    expect(await runObsidianCli(['export', '--vault', vaultDir], io)).toBe(1);
    expect(err.some(l => l.includes('AI Tool/Sessions/2026-09-28 S01.md'))).toBe(true);
    // Unrelated notes still got written despite the session-note failures.
    expect(await note('AI Tool/Tarokka/Current reading.md')).toContain('reading_id: "roll-abc"');
    expect(await note('AI Tool/Bases/Sessions.base')).toContain('file.hasTag("session")');
  });
});

describe('O3 play-log export (Stats/, session Stats section)', () => {
  const PLAY_WORLD = 'strahd-play';
  const T0 = Date.parse('2026-10-01T12:00:00.000Z');
  const IREENA: PlayActorRef = { uuid: 'Actor.pc1', isPC: true, name: 'Ireena Kolyana' };
  const RAHADIN: PlayActorRef = { uuid: 'Actor.npc1', isPC: false, name: 'Rahadin' };

  function richPlayLog(): PlayRecord[] {
    return [
      {
        v: 2,
        key: 'user-join:user1',
        t: T0 - 1000,
        seq: 1,
        kind: 'user-join',
        userId: 'user1',
        sceneId: null,
        data: { name: 'Alice', isGM: false },
      },
      {
        v: 2,
        key: 'scene:scene1',
        t: T0 - 500,
        seq: 2,
        kind: 'scene',
        userId: null,
        sceneId: 'scene1',
        data: { sceneName: 'Village of Barovia', active: true },
      },
      {
        v: 2,
        key: 'combat-start:combat1',
        t: T0,
        seq: 3,
        kind: 'combat-start',
        userId: null,
        sceneId: 'scene1',
        combat: { id: 'combat1', round: 1, turn: 0 },
      },
      {
        v: 2,
        key: 'combat-turn:combat1:1:0',
        t: T0 + 1000,
        seq: 4,
        kind: 'combat-turn',
        userId: null,
        sceneId: 'scene1',
        actor: IREENA,
        combat: { id: 'combat1', round: 1, turn: 0 },
      },
      {
        v: 2,
        key: 'roll:msg-atk-1:0',
        t: T0 + 2000,
        seq: 5,
        kind: 'roll',
        userId: 'user1',
        sceneId: 'scene1',
        actor: IREENA,
        combat: { id: 'combat1', round: 1, turn: 0 },
        roll: {
          formula: '1d20+5',
          total: 25,
          dice: [{ faces: 20, results: [20] }],
          crit: true,
          fumble: false,
          advantage: null,
          rollType: 'attack',
          dc: 15,
          outcome: 'success',
        },
        source: { messageId: 'msg-atk-1' },
      },
      {
        v: 2,
        key: 'roll:msg-dmg-1:0',
        t: T0 + 2500,
        seq: 6,
        kind: 'roll',
        userId: 'user1',
        sceneId: 'scene1',
        actor: IREENA,
        combat: { id: 'combat1', round: 1, turn: 0 },
        roll: {
          formula: '2d6+3',
          total: 13,
          dice: [{ faces: 6, results: [5, 5] }],
          crit: false,
          fumble: false,
          advantage: null,
          rollType: 'damage',
          damageTypes: ['slashing'],
        },
        source: { messageId: 'msg-dmg-1' },
      },
      {
        v: 2,
        key: `hp:Actor.npc1:system.attributes.hp.value:${T0 + 3000}`,
        t: T0 + 3000,
        seq: 7,
        kind: 'hp',
        userId: null,
        sceneId: 'scene1',
        actor: RAHADIN,
        combat: { id: 'combat1', round: 1, turn: 0 },
        path: 'system.attributes.hp.value',
        before: 13,
        after: 0,
        delta: -13,
        source: { messageId: 'msg-dmg-1', attributed: true },
      },
      {
        v: 2,
        key: 'combat-turn:combat1:1:1',
        t: T0 + 3500,
        seq: 8,
        kind: 'combat-turn',
        userId: null,
        sceneId: 'scene1',
        actor: RAHADIN,
        combat: { id: 'combat1', round: 1, turn: 1 },
      },
      {
        v: 2,
        key: 'combat-turn:combat1:2:0',
        t: T0 + 4000,
        seq: 9,
        kind: 'combat-turn',
        userId: null,
        sceneId: 'scene1',
        actor: IREENA,
        combat: { id: 'combat1', round: 2, turn: 0 },
      },
      {
        v: 2,
        key: 'combat-end:combat1',
        t: T0 + 5000,
        seq: 10,
        kind: 'combat-end',
        userId: null,
        sceneId: 'scene1',
        combat: { id: 'combat1', round: 2, turn: 0 },
      },
      {
        v: 2,
        key: 'roll:msg-heal-1:0',
        t: T0 + 6000,
        seq: 11,
        kind: 'roll',
        userId: 'user1',
        sceneId: 'scene1',
        actor: IREENA,
        roll: {
          formula: '1d8+3',
          total: 7,
          dice: [{ faces: 8, results: [4] }],
          crit: false,
          fumble: false,
          advantage: null,
          rollType: 'healing',
        },
        source: { messageId: 'msg-heal-1' },
      },
      {
        v: 2,
        key: `hp:Actor.pc1:system.attributes.hp.value:${T0 + 6200}`,
        t: T0 + 6200,
        seq: 12,
        kind: 'hp',
        userId: null,
        sceneId: 'scene1',
        actor: IREENA,
        path: 'system.attributes.hp.value',
        before: 5,
        after: 12,
        delta: 7,
        source: { messageId: 'msg-heal-1', attributed: true },
      },
      {
        v: 2,
        key: 'item-use:msg-spell-1',
        t: T0 + 7000,
        seq: 13,
        kind: 'item-use',
        userId: 'user1',
        sceneId: 'scene1',
        actor: IREENA,
        item: { uuid: 'Item.spell1', name: 'Cure Wounds', type: 'spell' },
        data: { spellLevel: 1 },
        source: { messageId: 'msg-spell-1' },
      },
      {
        v: 2,
        key: `slot:Actor.pc1:system.spells.spell1.value:${T0 + 7100}`,
        t: T0 + 7100,
        seq: 14,
        kind: 'slot',
        userId: null,
        sceneId: 'scene1',
        actor: IREENA,
        path: 'system.spells.spell1.value',
        before: 4,
        after: 3,
        delta: -1,
      },
      {
        v: 2,
        key: `currency:Actor.pc1:system.currency.gp:${T0 + 8000}`,
        t: T0 + 8000,
        seq: 15,
        kind: 'currency',
        userId: null,
        sceneId: 'scene1',
        actor: IREENA,
        path: 'system.currency.gp',
        before: 10,
        after: 25,
        delta: 15,
      },
      {
        v: 2,
        key: `xp:Actor.pc1:${T0 + 8100}`,
        t: T0 + 8100,
        seq: 16,
        kind: 'xp',
        userId: null,
        sceneId: 'scene1',
        actor: IREENA,
        path: 'system.details.xp.value',
        before: 100,
        after: 250,
        delta: 150,
      },
      {
        v: 2,
        key: 'item-create:Item.loot1',
        t: T0 + 8200,
        seq: 17,
        kind: 'item-create',
        userId: null,
        sceneId: 'scene1',
        actor: IREENA,
        item: { uuid: 'Item.loot1', name: 'Ring of <%* app.vault.delete() %>', type: 'loot' },
        after: 1,
      },
    ];
  }

  async function seedPlayLog(records: PlayRecord[]): Promise<void> {
    await store.appendLines(PLAY_WORLD, 'sessions', '2026-10-01.play.jsonl', records);
  }

  it('builds campaign and PC stats from the play log, and adds them to the session note', async () => {
    await seedPlayLog(richPlayLog());
    const result = await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: PLAY_WORLD,
      vaultDir,
    });
    expect(result.errors).toEqual([]);

    const sessionPath = result.written.find(p => p.startsWith('AI Tool/Sessions/'));
    expect(sessionPath).toBeDefined();
    const session = await fsp.readFile(
      path.join(campaignDir(vaultDir, PLAY_WORLD), sessionPath as string),
      'utf8'
    );
    expect(session).toContain('play_records: 17');
    expect(session).toContain('combats: 1');
    expect(session).toContain('combat_rounds: 2');
    expect(session).toContain('party_damage_dealt: 13');
    expect(session).toContain('party_healing: 7');
    expect(session).toContain('npc_kills: 1');
    expect(session).toContain('spells_cast: 1');
    expect(session).toContain('spell_slots_spent: 1');
    expect(session).toContain('### Combat 1 (Village of Barovia)');
    expect(session).toContain('Rounds: 2');
    expect(session).toContain('Kills: Rahadin');

    const campaign = await fsp.readFile(
      path.join(campaignDir(vaultDir, PLAY_WORLD), 'AI Tool/Stats/Campaign.md'),
      'utf8'
    );
    expect(campaign).toMatch(/^---\ntype: "campaign-stats"\n/);
    expect(campaign).toContain('sessions: 1');
    expect(campaign).toContain('npc_kills: 1');
    expect(campaign).toContain('Ireena Kolyana');
    // Each row links its note, so the stats, session and PC notes are not loose in the graph.
    expect(campaign).toContain('| [Ireena Kolyana](PCs/Ireena%20Kolyana.md) |');
    const sessionLink = campaign.match(/\| \[(\S+) (S\d+)\]\(\.\.\/Sessions\/\1%20\2\.md\) \|/);
    expect(sessionLink).not.toBeNull();
    expect(result.written).toContain(`AI Tool/Sessions/${sessionLink?.[1]} ${sessionLink?.[2]}.md`);

    const pc = await fsp.readFile(
      path.join(campaignDir(vaultDir, PLAY_WORLD), 'AI Tool/Stats/PCs/Ireena Kolyana.md'),
      'utf8'
    );
    expect(pc).toMatch(/^---\ntype: "pc-stats"\n/);
    expect(pc).toContain('fvtt_uuid: "Actor.pc1"');
    expect(pc).toContain('damage_dealt: 13');
    expect(pc).toContain('healing_received: 7');
    expect(pc).toContain('kills: 1');
    expect(pc).toContain('spells_cast: 1');
    expect(pc).toContain('xp_gained: 150');
    // The malicious item name is neutralized, never a literal Templater tag.
    expect(pc).not.toContain('<%');
    expect(pc).toContain('&lt;%');
    expect(pc).toContain('gp | 15');
    expect(pc).toContain('spell1 | 1');

    expect(result.written).toContain('AI Tool/Bases/PC stats.base');
  });

  it('writes the "Seen in" index for the mirror (R4), and only when it changed', async () => {
    await seedPlayLog(richPlayLog());
    const run = (): ReturnType<typeof exportWorldToObsidian> =>
      exportWorldToObsidian({ store, audit: new AuditLog(store), worldId: PLAY_WORLD, vaultDir });
    const result = await run();
    const label = result.written
      .find(p => p.startsWith('AI Tool/Sessions/'))
      ?.slice('AI Tool/Sessions/'.length, -'.md'.length);
    expect(label).toBeDefined();
    const first = await store.read<SeenIndex>(PLAY_WORLD, 'gm', SEEN_INDEX_FILE);
    expect(first?.data.v).toBe(1);
    expect(first?.data.actors[RAHADIN.uuid]).toEqual([label]);
    expect(first?.data.scenes['Scene.scene1']).toEqual([label]);
    // Every world actor is indexed (the mirror shows no list on PC notes).
    expect(first?.data.actors[IREENA.uuid]).toEqual([label]);

    const write = vi.spyOn(store, 'write');
    await run();
    expect(write.mock.calls.filter(call => call[2] === SEEN_INDEX_FILE)).toHaveLength(0);
    write.mockRestore();
  });

  it('gives the same stats from a warm cache (appended lines) as a cold export', async () => {
    await seedPlayLog(richPlayLog().slice(0, 10));
    const cache = newExportCache();
    await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: PLAY_WORLD,
      vaultDir,
      cache,
    });
    await seedPlayLog(richPlayLog().slice(10));
    await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: PLAY_WORLD,
      vaultDir,
      cache,
    });
    const warm = await fsp.readFile(
      path.join(campaignDir(vaultDir, PLAY_WORLD), 'AI Tool/Stats/Campaign.md'),
      'utf8'
    );

    const coldVault = await fsp.mkdtemp(path.join(os.tmpdir(), 'obs-vault-cold-'));
    try {
      await exportWorldToObsidian({
        store,
        audit: new AuditLog(store),
        worldId: PLAY_WORLD,
        vaultDir: coldVault,
      });
      const cold = await fsp.readFile(
        path.join(campaignDir(coldVault, PLAY_WORLD), 'AI Tool/Stats/Campaign.md'),
        'utf8'
      );
      expect(warm).toBe(cold);
    } finally {
      await fsp.rm(coldVault, { recursive: true, force: true });
    }
  });

  it('prunes a PC-stats note for a PC no longer in the play log', async () => {
    await seedPlayLog([
      {
        v: 2,
        key: 'item-create:Item.loot1',
        t: T0,
        seq: 1,
        kind: 'item-create',
        userId: null,
        sceneId: null,
        actor: IREENA,
        item: { uuid: 'Item.loot1', name: 'A Torch', type: 'loot' },
        after: 1,
      },
    ]);
    await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: PLAY_WORLD,
      vaultDir,
    });
    expect(
      await fsp
        .stat(path.join(campaignDir(vaultDir, PLAY_WORLD), 'AI Tool/Stats/PCs/Ireena Kolyana.md'))
        .then(
          () => true,
          () => false
        )
    ).toBe(true);

    // The play log now names a different PC; Ireena's own note is pruned.
    await fsp.writeFile(
      store.filePath(PLAY_WORLD, 'sessions', '2026-10-01.play.jsonl'),
      `${JSON.stringify({
        v: 2,
        key: 'item-create:Item.loot2',
        t: T0 + 100000,
        seq: 2,
        kind: 'item-create',
        userId: null,
        sceneId: null,
        actor: { uuid: 'Actor.pc2', isPC: true, name: 'Someone Else' },
        item: { uuid: 'Item.loot2', name: 'A Lantern', type: 'loot' },
        after: 1,
      })}\n`,
      'utf8'
    );
    const again = await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: PLAY_WORLD,
      vaultDir,
    });
    expect(again.trashed).toContain('AI Tool/Stats/PCs/Ireena Kolyana.md');
    expect(
      await fsp
        .stat(
          path.join(
            vaultDir,
            '.trash',
            'Campaigns',
            PLAY_WORLD,
            'AI Tool/Stats/PCs/Ireena Kolyana.md'
          )
        )
        .then(
          () => true,
          () => false
        )
    ).toBe(true);
  });

  it('sanitizes a Templater-malicious PC name in both the file name and the note content', async () => {
    const evilPc: PlayActorRef = {
      uuid: 'Actor.pc-evil',
      isPC: true,
      name: 'Vasili<%* app.vault.delete() %>li',
    };
    await seedPlayLog([
      {
        v: 2,
        key: 'item-create:Item.loot1',
        t: T0,
        seq: 1,
        kind: 'item-create',
        userId: null,
        sceneId: null,
        actor: evilPc,
        item: { uuid: 'Item.loot1', name: 'A Torch', type: 'loot' },
        after: 1,
      },
    ]);
    const result = await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: PLAY_WORLD,
      vaultDir,
    });
    const pcPath = result.written.find(p => p.startsWith('AI Tool/Stats/PCs/'));
    expect(pcPath).toBeDefined();
    expect(pcPath).not.toContain('<%');
    const text = await fsp.readFile(
      path.join(campaignDir(vaultDir, PLAY_WORLD), pcPath as string),
      'utf8'
    );
    expect(text).not.toContain('<%');
    expect(text).toContain('&lt;%');
    const campaign = await fsp.readFile(
      path.join(campaignDir(vaultDir, PLAY_WORLD), 'AI Tool/Stats/Campaign.md'),
      'utf8'
    );
    expect(campaign).not.toContain('<%');
    const file = path.posix.basename(pcPath as string);
    expect(campaign).toContain(
      `](PCs/${encodeURIComponent(file).replace(/\(/g, '%28').replace(/\)/g, '%29')})`
    );
  });

  it('a session spanning local midnight is one session note, built from records in two play-log files', async () => {
    // The pump writes one file per local date (play-log-pump.test.ts: "splits a
    // batch across local dates (midnight)"), so a session that runs past
    // midnight has its records split across two `<date>.play.jsonl` files. The
    // exporter loads every play-log file (`loadPlayRecords`) before grouping,
    // so the two records here (5 minutes apart, well under the 3h session gap)
    // must still land in the same session group and the same session note.
    const MIDNIGHT_WORLD = 'strahd-midnight';
    const midnightLocal = new Date(2026, 8, 29, 0, 0, 0).getTime(); // local midnight
    const beforeMidnight = midnightLocal - 5 * 60 * 1000; // 23:55, local Sep 28
    const afterMidnight = midnightLocal + 5 * 60 * 1000; // 00:05, local Sep 29
    const dateBefore = localDateKeyOf(beforeMidnight);
    const dateAfter = localDateKeyOf(afterMidnight);
    expect(dateBefore).not.toBe(dateAfter); // sanity: the two records really are on different dates

    await store.appendLines(MIDNIGHT_WORLD, 'sessions', playLogFileName(dateBefore), [
      {
        v: 2,
        key: 'chat:before-midnight',
        t: beforeMidnight,
        seq: 1,
        kind: 'chat',
        userId: 'user1',
        sceneId: null,
        data: { text: 'Last thing before midnight' },
      } satisfies PlayRecord,
    ]);
    await store.appendLines(MIDNIGHT_WORLD, 'sessions', playLogFileName(dateAfter), [
      {
        v: 2,
        key: 'chat:after-midnight',
        t: afterMidnight,
        seq: 1,
        kind: 'chat',
        userId: 'user1',
        sceneId: null,
        data: { text: 'First thing after midnight' },
      } satisfies PlayRecord,
    ]);

    const result = await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: MIDNIGHT_WORLD,
      vaultDir,
    });
    const sessionPaths = result.written.filter(p => p.startsWith('AI Tool/Sessions/'));
    expect(sessionPaths).toHaveLength(1); // one session note, not two

    const session = await fsp.readFile(
      path.join(campaignDir(vaultDir, MIDNIGHT_WORLD), sessionPaths[0]),
      'utf8'
    );
    expect(session).toContain('play_records: 2');
    expect(session).toContain('session_number: 1');

    const campaign = await fsp.readFile(
      path.join(campaignDir(vaultDir, MIDNIGHT_WORLD), 'AI Tool/Stats/Campaign.md'),
      'utf8'
    );
    expect(campaign).toContain('sessions: 1'); // still one session in the campaign stats too
  });
});
