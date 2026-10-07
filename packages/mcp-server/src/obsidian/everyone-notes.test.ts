import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { ChangeRecord } from '@gnuminator/shared';

import {
  ChangeHistory,
  type AiChangeItem,
  type ChangeDay,
  type HumanChangeItem,
} from '../change-history.js';
import { changeJournalFileName } from '../change-journal-pump.js';
import type { RecentChange } from '../guarded-write/service.js';
import type { UndoState } from '../guarded-write/undo-state.js';
import { VaultStore } from '../vault/store.js';

import {
  carriedBlocks,
  EveryoneNotes,
  EVERYONE_FOLDER,
  everyoneNotePath,
  renderEveryoneNote,
} from './everyone-notes.js';
import { checkMarkdownOwnership } from './ownership.js';

const AT = new Date(2026, 9, 7, 19, 42).toISOString();
const LATER = new Date(2026, 9, 7, 19, 50).toISOString();

function human(overrides: Partial<HumanChangeItem> = {}): HumanChangeItem {
  return {
    kind: 'human',
    id: 'act:a1',
    at: AT,
    by: 'Ireena',
    userId: 'u1',
    isGM: false,
    summary: 'Ireena: HP 10 -> 5',
    lines: ['Ireena: HP 10 -> 5'],
    things: [{ uuid: 'Actor.a1', name: 'Ireena' }],
    records: 1,
    canUndo: true,
    undone: false,
    ...overrides,
  };
}

function ai(overrides: Partial<AiChangeItem> = {}): AiChangeItem {
  return {
    kind: 'ai',
    id: 'chg-1',
    at: LATER,
    by: 'AI',
    summary: 'Strahd: HP 50 -> 40',
    lines: ['Strahd: HP 50 -> 40', 'Strahd: effect "Bloodied" added'],
    mode: 'apply',
    feature: 'live-play',
    canUndo: true,
    undone: false,
    ...overrides,
  };
}

describe('renderEveryoneNote', () => {
  it('lists the day oldest first with who, when and the lines, and marks what is undone', () => {
    const day: ChangeDay = {
      date: '2026-10-07',
      changes: [
        human(),
        ai({
          requestedBy: 'GM (dashboard)',
          undone: true,
          undoneBy: 'GM (dashboard)',
          undoneAt: LATER,
        }),
        human({
          id: 'act:a2:own',
          by: 'Gamemaster',
          isGM: true,
          summary: 'Token "Wolf 2" moved and 1 more change',
          lines: ['Token "Wolf 2" moved', 'Deleted Combatant "Wolf 2" from Combat'],
          undone: true,
          undoneBy: 'chg-9',
        }),
      ],
    };
    const text = renderEveryoneNote('w1', day);
    expect(text).toMatch(/^---\ntype: "everyone-changes"\n/);
    expect(text).toContain('date: "2026-10-07"');
    expect(text).toContain('changes: 3');
    expect(text).toContain('by_people: 2');
    expect(text).toContain('by_ai: 1');
    expect(text).toContain('undone: 2');
    expect(text).toContain(
      'people:\n  - "AI, asked by GM (dashboard)"\n  - "Gamemaster (GM)"\n  - "Ireena"'
    );
    expect(text).toContain("# Everyone's changes 2026-10-07");
    expect(text).toContain('- **19:42** Ireena · Ireena: HP 10 -> 5 ^act-a1');
    expect(text).toContain(
      '- **19:50** AI, asked by GM (dashboard) · Strahd: HP 50 -> 40 · undone 19:50 by GM (dashboard) ^chg-1'
    );
    expect(text).toContain('  - Strahd: HP 50 -> 40\n  - Strahd: effect "Bloodied" added');
    // The undo entry chg-9 is not among the day's changes: it lies on another day.
    expect(text).toContain(
      'Gamemaster (GM) · Token "Wolf 2" moved and 1 more change · undone later ^act-a2-own'
    );
    expect(text).toContain('  - Deleted Combatant "Wolf 2" from Combat');
    // A one-line change does not repeat its summary below.
    expect(text).not.toContain('  - Ireena: HP 10 -> 5');
    expect(checkMarkdownOwnership(text)).toEqual({ owned: true, legacy: false });
  });

  it('neutralizes Templater tags in names and lines', () => {
    const text = renderEveryoneNote('w1', {
      date: '2026-10-07',
      changes: [human({ by: '<% evil %>', summary: 'x <% y %>', lines: ['x <% y %>'] })],
    });
    expect(text).not.toContain('<%');
    expect(text).toContain('&lt;% evil %&gt;'.replace('&gt;', '>'));
  });

  it('escapes Markdown in names, summaries and lines (no wikilinks, tags, HTML or tables from Foundry)', () => {
    const nasty = '[[Strahd]] #tag <b>x</b> a|b';
    const text = renderEveryoneNote('w1', {
      date: '2026-10-07',
      changes: [
        human({ by: nasty, summary: nasty, lines: [nasty, '# not a heading', '- not a list'] }),
        ai({ undoneBy: nasty, undone: true, lines: [] }),
      ],
    });
    // The body is inert Markdown; the `people` property keeps the user name as the GM set it.
    const body = text.slice(text.indexOf("\n# Everyone's changes"));
    expect(body).not.toContain('[[Strahd]]');
    expect(body).not.toContain('<b>');
    expect(body).not.toMatch(/\s#tag/);
    expect(body).toContain('\\[\\[Strahd\\]\\] \\#tag &lt;b>x&lt;/b> a\\|b');
    expect(text).toContain('  - \\# not a heading');
    expect(text).toContain('  - \\- not a list');
    expect(text).toContain('undone by \\[\\[Strahd\\]\\]');
  });

  it('keeps a name with a newline on one line, and no link in the people property', () => {
    const text = renderEveryoneNote('w1', {
      date: '2026-10-07',
      changes: [human({ by: 'Ire\nena', summary: 'line one\r\nline two' })],
    });
    expect(text).toContain('- **19:42** Ire ena · line one line two ^act-a1');
    const linked = renderEveryoneNote('w1', {
      date: '2026-10-07',
      changes: [human({ by: '[[Strahd]]' })],
    });
    expect(linked).toContain('people:\n  - "Strahd"');
    expect(linked).not.toContain('[[Strahd]]');
  });

  it('reads the list items of a note back (carriedBlocks)', () => {
    const day: ChangeDay = {
      date: '2026-10-07',
      changes: [human({ by: '[[Strahd]] <b>' }), ai({ undone: true, undoneBy: 'GM' })],
    };
    const blocks = carriedBlocks(renderEveryoneNote('w1', day));
    expect(blocks.map(b => [b.id, b.time, b.who, b.isAi, b.undone, b.text.length])).toEqual([
      ['act-a1', '19:42', '[[Strahd]] <b>', false, false, 1],
      ['chg-1', '19:50', 'AI', true, true, 3],
    ]);
    expect(blocks[1].text[0]).toMatch(/^- \*\*19:50\*\* AI · .* \^chg-1$/);
  });

  it('tells who from the summary when a name or summary holds the separator, and a player named AI from the AI', () => {
    const day: ChangeDay = {
      date: '2026-10-07',
      changes: [
        human({ by: 'Ana · Bo', summary: 'Ireena: HP 10 -> 5 · undone?' }),
        human({ id: 'act:a2', by: 'AI' }),
        human({ id: 'act:a3', by: 'AI', isGM: true }),
        ai({ requestedBy: 'GM (dashboard)' }),
      ],
    };
    const text = renderEveryoneNote('w1', day);
    expect(text).toContain('Ana &middot; Bo · Ireena: HP 10 -> 5 &middot; undone? ^act-a1');
    expect(text).toContain(
      'people:\n  - "AI (GM)"\n  - "AI (player)"\n  - "AI, asked by GM (dashboard)"\n  - "Ana · Bo"'
    );
    const blocks = carriedBlocks(text);
    expect(blocks.map(b => [b.who, b.summary, b.isAi, b.undone])).toEqual([
      ['Ana · Bo', 'Ireena: HP 10 -> 5 &middot; undone?', false, false],
      ['AI (player)', 'Ireena: HP 10 -> 5', false, false],
      ['AI (GM)', 'Ireena: HP 10 -> 5', false, false],
      ['AI, asked by GM (dashboard)', 'Strahd: HP 50 -> 40', true, false],
    ]);
  });

  it("names who undid a person's change and when, from the undo entry in the same note", () => {
    const text = renderEveryoneNote('w1', {
      date: '2026-10-07',
      changes: [
        human({ undone: true, undoneBy: 'chg-9' }),
        ai({ id: 'chg-9', mode: 'undo', requestedBy: 'GM (dashboard)', summary: 'Undo: Ireena' }),
      ],
    });
    expect(text).toContain('Ireena · Ireena: HP 10 -> 5 · undone 19:50 by GM (dashboard) ^act-a1');
  });

  it('says from when a partial day is complete', () => {
    const text = renderEveryoneNote('w1', {
      date: '2026-10-07',
      changes: [human()],
      incompleteBefore: new Date(2026, 9, 7, 10, 5).getTime(),
    });
    expect(text).toContain('Changes before 10:05 may be missing');
    expect(renderEveryoneNote('w1', { date: '2026-10-07', changes: [human()] })).not.toContain(
      'may be missing'
    );
  });
});

describe('EveryoneNotes', () => {
  let vaultDir: string;
  let days: ChangeDay[];
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  function make(
    extra: { debounceMs?: number; maxWaitMs?: number; now?: () => number } = {}
  ): EveryoneNotes {
    return new EveryoneNotes({
      changeHistory: {
        byDay: (worldId: string): Promise<ChangeDay[] | null> =>
          Promise.resolve(worldId === 'w1' ? days : null),
      },
      vaultDir,
      logger,
      ...extra,
    });
  }

  async function note(date: string): Promise<string> {
    return fsp.readFile(path.join(vaultDir, 'Campaigns', 'w1', everyoneNotePath(date)), 'utf8');
  }

  beforeEach(async () => {
    vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'everyone-notes-'));
    logger = { info: vi.fn(), warn: vi.fn() };
    days = [
      {
        date: '2026-10-06',
        changes: [human({ id: 'act:a0', at: new Date(2026, 9, 6, 20).toISOString() })],
      },
      { date: '2026-10-07', changes: [human(), ai()] },
    ];
  });

  afterEach(async () => {
    vi.useRealTimers();
    await fsp.rm(vaultDir, { recursive: true, force: true });
  });

  it('writes one note per day under the Everyone folder, and rewrites only what changed', async () => {
    const notes = make();
    const first = await notes.renderNow('w1');
    expect(first.written.sort()).toEqual([
      everyoneNotePath('2026-10-06'),
      everyoneNotePath('2026-10-07'),
    ]);
    expect(first.errors).toEqual([]);
    expect(await fsp.readdir(path.join(vaultDir, 'Campaigns', 'w1', EVERYONE_FOLDER))).toEqual([
      '2026-10-06.md',
      '2026-10-07.md',
    ]);
    expect(await note('2026-10-07')).toContain('^chg-1');

    const second = await notes.renderNow('w1');
    expect(second.written).toEqual([]);
    expect(second.unchanged.length).toBe(2);

    days[1].changes.push(ai({ id: 'chg-2', summary: 'Strahd: HP 40 -> 30' }));
    const third = await notes.renderNow('w1');
    expect(third.written).toEqual([everyoneNotePath('2026-10-07')]);
    expect(await note('2026-10-07')).toContain('^chg-2');
  });

  it('leaves a note the GM edited in Obsidian alone, and says so once', async () => {
    const notes = make();
    await notes.renderNow('w1');
    const file = path.join(vaultDir, 'Campaigns', 'w1', everyoneNotePath('2026-10-06'));
    await fsp.appendFile(file, '\nMy own remark.\n');
    days[0].changes.push(human({ id: 'act:a9', at: new Date(2026, 9, 6, 21).toISOString() }));
    const fresh = make();
    const result = await fresh.renderNow('w1');
    expect(result.skipped).toEqual([
      { path: everyoneNotePath('2026-10-06'), reason: 'edited in Obsidian' },
    ]);
    expect(await note('2026-10-06')).toContain('My own remark.');
    expect(await note('2026-10-06')).not.toContain('^act-a9');
  });

  it('debounces schedule calls and renders once per quiet period', async () => {
    vi.useFakeTimers();
    const notes = make({ debounceMs: 1000, maxWaitMs: 5000 });
    notes.schedule('w1');
    await vi.advanceTimersByTimeAsync(600);
    notes.schedule('w1');
    await vi.advanceTimersByTimeAsync(600);
    // Not yet: the second call restarted the quiet period.
    await expect(note('2026-10-07')).rejects.toThrow();
    await vi.advanceTimersByTimeAsync(500);
    // The timer fired; the render itself does real file writes, so wait for it.
    await notes.flush();
    expect(await note('2026-10-07')).toContain('^chg-1');
    expect(logger.info).toHaveBeenCalledWith('Everyone notes updated', {
      worldId: 'w1',
      written: 2,
    });
    notes.stop();
    notes.schedule('w1');
    await vi.advanceTimersByTimeAsync(2000);
    expect(logger.info).toHaveBeenCalledTimes(1);
  });

  it('writes nothing for a world that is not the current one', async () => {
    const notes = make();
    const result = await notes.renderNow('w2');
    expect(result.written).toEqual([]);
    expect(logger.info).toHaveBeenCalledWith('Everyone notes skipped: not the current world', {
      worldId: 'w2',
    });
    await expect(fsp.stat(path.join(vaultDir, 'Campaigns', 'w2'))).rejects.toThrow();
  });

  it('reports a write failure (a file where the folder should be) and keeps going', async () => {
    await fsp.mkdir(path.join(vaultDir, 'Campaigns', 'w1', 'AI Tool'), { recursive: true });
    await fsp.writeFile(path.join(vaultDir, 'Campaigns', 'w1', EVERYONE_FOLDER), 'in the way');
    const result = await make().renderNow('w1');
    expect(result.written).toEqual([]);
    expect(result.errors.map(e => e.path).sort()).toEqual([
      everyoneNotePath('2026-10-06'),
      everyoneNotePath('2026-10-07'),
    ]);
  });

  it('carries the items of a partial day the history no longer holds over from its note', async () => {
    const notes = make();
    await notes.renderNow('w1');
    expect(await note('2026-10-07')).toContain('changes: 2');
    // The history lost the person's change (its buffer wrapped, the AI ring moved on): the note
    // keeps it, in its place, with the counts and the partial-day line.
    days[1] = {
      date: '2026-10-07',
      changes: [ai({ undone: true, undoneBy: 'GM (dashboard)', undoneAt: LATER })],
      incompleteBefore: new Date(2026, 9, 7, 19, 45).getTime(),
    };
    expect((await notes.renderNow('w1')).written).toEqual([everyoneNotePath('2026-10-07')]);
    let text = await note('2026-10-07');
    expect(text).toContain('Changes before 19:45 may be missing');
    expect(text).toContain('- **19:42** Ireena · Ireena: HP 10 -> 5 ^act-a1');
    expect(text).toContain('undone 19:50 by GM (dashboard) ^chg-1');
    expect(text.indexOf('^act-a1')).toBeLessThan(text.indexOf('^chg-1'));
    expect(text).toContain('changes: 2');
    expect(text).toContain('by_people: 1');
    expect(text).toContain('by_ai: 1');
    expect(text).toContain('undone: 1');
    expect(text).toContain('people:\n  - "AI"\n  - "Ireena"');
    // More changes later: the carried item survives every render, in order.
    days[1].changes.push(ai({ id: 'chg-2', at: new Date(2026, 9, 7, 19, 42).toISOString() }));
    expect((await notes.renderNow('w1')).written).toEqual([everyoneNotePath('2026-10-07')]);
    text = await note('2026-10-07');
    expect(text).toContain('changes: 3');
    expect(text).toContain('by_ai: 2');
    expect(text.indexOf('^act-a1')).toBeLessThan(text.indexOf('^chg-2'));
    expect(text.indexOf('^chg-2')).toBeLessThan(text.indexOf('^chg-1'));
    expect(text).toContain('  - Strahd: effect "Bloodied" added\n- **19:50**');
    expect(checkMarkdownOwnership(text)).toEqual({ owned: true, legacy: false });
    // The history regroups the lost change under a longer id (its records split from an AI
    // burst), then under a new id with the same minute and summary: the note holds it once.
    days[1].changes.push(human({ id: 'act:a1:own' }));
    await notes.renderNow('w1');
    text = await note('2026-10-07');
    expect(text).toContain('^act-a1-own');
    expect(text).not.toContain('^act-a1\n');
    expect(text).toContain('changes: 3');
    days[1].changes[days[1].changes.length - 1] = human({ id: 'act:b7' });
    await notes.renderNow('w1');
    text = await note('2026-10-07');
    expect(text).toContain('^act-b7');
    expect(text).not.toContain('^act-a1-own');
    expect(text).toContain('changes: 3');
    // A whole day carries nothing over: the history is the truth.
    delete days[1].incompleteBefore;
    days[1].changes = [ai()];
    await notes.renderNow('w1');
    expect(await note('2026-10-07')).not.toContain('^act-a1');
  });

  it('logs a failed render and keeps going', async () => {
    const notes = new EveryoneNotes({
      changeHistory: { byDay: (): Promise<ChangeDay[]> => Promise.reject(new Error('down')) },
      vaultDir,
      logger,
      debounceMs: 10,
    });
    notes.schedule('w1');
    await notes.flush();
    expect(logger.warn).toHaveBeenCalledWith('Everyone notes render failed', {
      worldId: 'w1',
      error: 'down',
    });
  });
});

describe('EveryoneNotes with the real history', () => {
  let dataDir: string;
  let vaultDir: string;

  beforeEach(async () => {
    dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'everyone-notes-data-'));
    vaultDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'everyone-notes-vault-'));
  });

  afterEach(async () => {
    await fsp.rm(dataDir, { recursive: true, force: true });
    await fsp.rm(vaultDir, { recursive: true, force: true });
  });

  function record(seq: number, t: number, actionId: string): ChangeRecord {
    return {
      v: 1,
      key: `update:Actor.a1:${seq}`,
      seq,
      t,
      actionId,
      op: 'update',
      userId: 'u1',
      userName: 'Ireena',
      userIsGM: false,
      documentName: 'Actor',
      uuid: 'Actor.a1',
      parentUuid: null,
      name: 'Ireena',
      rootUuid: 'Actor.a1',
      rootName: 'Ireena',
      sceneId: null,
      before: [{ path: 'system.attributes.hp.value', present: true, value: 10 + seq }],
      after: [{ path: 'system.attributes.hp.value', present: true, value: 9 + seq }],
    };
  }

  it('leaves the note of a day that left the kept span byte-identical (the cutoff moved past it)', async () => {
    const store = new VaultStore({ dataDir });
    const logger: any = { error: vi.fn(), warn: vi.fn(), info: vi.fn(), debug: vi.fn() };
    logger.child = (): unknown => logger;
    let now = new Date(2026, 9, 6, 23, 0).getTime();
    const history = new ChangeHistory({
      store,
      worldIds: { current: (): Promise<string> => Promise.resolve('w1') },
      guardedWrites: {
        listRecentChanges: (): Promise<RecentChange[]> => Promise.resolve([]),
        undoState: (): Promise<UndoState> => Promise.resolve(new Map()),
      },
      logger,
      now: (): number => now,
    });
    // Seven days back: a change in the morning and one in the afternoon.
    const day = new Date(2026, 8, 30);
    await store.appendLines('w1', 'gm', changeJournalFileName('2026-09-30'), [
      record(1, day.getTime() + 8 * 60 * 60_000, 'morning'),
      record(2, day.getTime() + 16 * 60 * 60_000, 'afternoon'),
    ]);
    const notes = new EveryoneNotes({ changeHistory: history, vaultDir, logger });
    expect((await notes.renderNow('w1')).written).toEqual([everyoneNotePath('2026-09-30')]);
    const file = path.join(vaultDir, 'Campaigns', 'w1', everyoneNotePath('2026-09-30'));
    const written = await fsp.readFile(file, 'utf8');
    expect(written).toContain('changes: 2');

    // Past midnight: the cutoff is now inside that day, the morning change left the index.
    now = new Date(2026, 9, 7, 3, 0).getTime();
    const again = new EveryoneNotes({ changeHistory: history, vaultDir, logger });
    const result = await again.renderNow('w1');
    expect(result.written).toEqual([]);
    expect(await fsp.readFile(file, 'utf8')).toBe(written);
    await store.flush();
  });
});
