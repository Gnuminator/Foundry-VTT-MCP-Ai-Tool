/**
 * Obsidian export (O1): notes rendered from a temp bridge vault into a temp
 * Obsidian vault. Checks the ownership rules (AI Tool/ rebuilt, Home.md and
 * Prep/ created once and never touched), idempotence, and that card names
 * sit inside collapsed callouts.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { AuditLog } from '../vault/audit.js';
import { VaultStore } from '../vault/store.js';

import { runObsidianCli } from './cli.js';
import { campaignDir, exportWorldToObsidian } from './export.js';
import { cell, frontmatter, safeFileName } from './render.js';

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
  await store.appendLines(WORLD, 'sessions', '2026-09-28.jsonl', [
    {
      id: 'e1',
      timestamp: '2026-09-28T09:52:27.310Z',
      eventType: 'gm-change',
      actorName: null,
      description: 'Applied: Store a new Tarokka reading | built-in',
      details: { changeId: 'chg-1' },
    },
    {
      id: 'e0',
      timestamp: '2026-09-28T09:40:00.000Z',
      eventType: 'journal-created',
      actorName: 'Ireena',
      description: 'Journal entry created: "Tarokka reading"',
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
        appliedAt: '2026-09-28T09:52:27.308Z',
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
          gmNote: 'behind the altar',
          revealed: false,
        },
        sunsword: { cardName: 'Five of Glyphs', cardId: 'glyphs-5', gmNote: null, revealed: false },
        ally: { cardName: 'Tempter', cardId: 'tempter', gmNote: null, revealed: false },
        strahdLocation: { cardName: 'Beast', cardId: 'beast', gmNote: null, revealed: false },
      },
    },
    archive: { 'roll-old': {} },
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

describe('exportWorldToObsidian', () => {
  it('writes session, change and Tarokka notes plus the GM-owned Home and Prep', async () => {
    await seed();
    const result = await run();
    expect(result.created.sort()).toEqual(['Home.md', 'Prep', 'Prep/README.md']);
    expect(result.written.sort()).toEqual([
      'AI Tool/Changes/2026-09.md',
      'AI Tool/Sessions/2026-09-28.md',
      'AI Tool/Tarokka/Current reading.md',
    ]);

    const session = await note('AI Tool/Sessions/2026-09-28.md');
    expect(session).toMatch(/^---\ntype: "session-log"\n/);
    expect(session).toContain('events: 2');
    // Sorted by time, pipes escaped, change id shown.
    expect(session.indexOf('journal-created')).toBeLessThan(session.indexOf('| gm-change'));
    expect(session).toContain('Tarokka reading \\| built-in (chg-1)');

    const changes = await note('AI Tool/Changes/2026-09.md');
    expect(changes).toContain('undone by `chg-2`');
    expect(changes).toContain('undo of `chg-1`');
    // Diffs (which can contain card names) are collapsed.
    expect(changes).toMatch(/> \[!note\]- Diff \(1 line\(s\), GM only\)\n> - gm\/tarokka\.json/);

    const tarokka = await note('AI Tool/Tarokka/Current reading.md');
    expect(tarokka).toContain('reading_id: "roll-abc"');
    expect(tarokka).toContain('revealed_count: 1');
    expect(tarokka).toContain('linked_count: 1');
    expect(tarokka).toContain('> [!danger]- Card (GM secret)\n> **Seven of Swords** (`swords-7`)');
    expect(tarokka).toContain('**The Tempter**');
    expect(tarokka).toContain('GM note: behind the altar');
    expect(tarokka).toContain('- `roll-old`');
    // No card name outside a callout line.
    for (const line of tarokka.split('\n')) {
      if (line.includes('Seven of Swords')) expect(line.startsWith('>')).toBe(true);
    }
  });

  it('rewrites nothing when nothing changed, and never touches the GM-owned files', async () => {
    await seed();
    await run();
    await fsp.writeFile(path.join(campaignDir(vaultDir, WORLD), 'Home.md'), 'my own home');
    await fsp.writeFile(path.join(campaignDir(vaultDir, WORLD), 'Prep/README.md'), 'mine');
    const again = await run();
    expect(again.written).toEqual([]);
    expect(again.created).toEqual([]);
    expect(again.unchanged).toHaveLength(3);
    expect(await note('Home.md')).toBe('my own home');
    expect(await note('Prep/README.md')).toBe('mine');
  });

  it('shows "no reading" after the first import was undone, and skips Tarokka when unused', async () => {
    await store.write(WORLD, 'gm', 'tarokka.json', { current: { positions: {} } });
    await run();
    expect(await note('AI Tool/Tarokka/Current reading.md')).toContain('No reading is stored yet');

    const other = 'no-tarokka';
    const r = await exportWorldToObsidian({
      store,
      audit: new AuditLog(store),
      worldId: other,
      vaultDir,
    });
    expect(r.written).toEqual([]);
  });

  it('refuses a world id that could escape the vault', async () => {
    await expect(
      exportWorldToObsidian({ store, audit: new AuditLog(store), worldId: '../x', vaultDir })
    ).rejects.toThrow(/Bad world id/);
  });
});

describe('render helpers', () => {
  it('quotes text properties and writes lists', () => {
    expect(
      frontmatter({ a: 'x: y', b: 2, c: true, d: ['p', 'q'], e: [], f: null, g: undefined })
    ).toBe('---\na: "x: y"\nb: 2\nc: true\nd:\n  - "p"\n  - "q"\ne: []\nf: null\n---');
  });

  it('makes table cells and file names safe', () => {
    expect(cell('a|b\nc')).toBe('a\\|b c');
    expect(safeFileName('Castle Ravenloft: K1 #2')).toBe('Castle Ravenloft K1 2');
    expect(safeFileName('con')).toBe('_con');
    expect(safeFileName('  ')).toBe('_untitled');
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
    expect(out[0]).toMatch(/^strahd-test: 3 written, 0 unchanged, 3 created/);
    expect(await runObsidianCli(['nope'], io)).toBe(2);
  });
});
