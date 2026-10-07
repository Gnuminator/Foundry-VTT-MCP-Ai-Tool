import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import type { AiChangeItem, ChangeDay, HumanChangeItem } from '../change-history.js';

import {
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
    expect(text).toContain(
      'Gamemaster (GM) · Token "Wolf 2" moved and 1 more change · undone by chg-9 ^act-a2-own'
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
});

describe('EveryoneNotes', () => {
  let vaultDir: string;
  let days: ChangeDay[];
  let logger: { info: ReturnType<typeof vi.fn>; warn: ReturnType<typeof vi.fn> };

  function make(
    extra: { debounceMs?: number; maxWaitMs?: number; now?: () => number } = {}
  ): EveryoneNotes {
    return new EveryoneNotes({
      changeHistory: { byDay: (): Promise<ChangeDay[]> => Promise.resolve(days) },
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
