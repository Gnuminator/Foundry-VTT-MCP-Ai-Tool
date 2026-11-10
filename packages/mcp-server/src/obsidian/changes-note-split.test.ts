import { describe, expect, it } from 'vitest';

import type { ChangeEntry } from './audit-merge.js';
import {
  CHANGES_NOTE_MAX_DIFF_LINES,
  CHANGES_NOTE_MAX_ENTRIES,
  renderChangesNote,
  splitChangeNotes,
} from './render.js';

function entry(i: number, diffLines = 3): ChangeEntry {
  const sec = String(i % 60).padStart(2, '0');
  const min = String(Math.floor(i / 60) % 60).padStart(2, '0');
  const hour = String(Math.floor(i / 3600) % 24).padStart(2, '0');
  return {
    changeId: `chg-${i}`,
    feature: 'actor',
    summary: `Change number ${i}`,
    risk: 'low',
    target: 'Actor.abc',
    mode: 'apply',
    appliedAt: `2026-10-05T${hour}:${min}:${sec}.000Z`,
    diff: Array.from({ length: diffLines }, (_, n) => `field ${n}: a -> b`),
  };
}

describe('Changes notes are capped', () => {
  it('splits thousands of changes into notes that stay small, oldest first and stable', () => {
    const entries = Array.from({ length: 7000 }, (_, i) => entry(i));
    const parts = splitChangeNotes('2026-10', entries);
    expect(parts.map(p => p.name).slice(0, 3)).toEqual(['2026-10', '2026-10-p2', '2026-10-p3']);
    expect(parts.reduce((n, p) => n + p.entries.length, 0)).toBe(7000);
    const all = parts.map(p => p.name);
    let biggest = 0;
    for (const p of parts) {
      expect(p.entries.length).toBeLessThanOrEqual(CHANGES_NOTE_MAX_ENTRIES);
      const text = renderChangesNote('w', '2026-10', p.entries, { name: p.name, all });
      biggest = Math.max(biggest, text.length);
    }
    expect(biggest).toBeLessThan(300_000);
    // The first note keeps the oldest changes, so it does not change when newer ones arrive.
    const more = splitChangeNotes('2026-10', [...entries, entry(7001)]);
    expect(more[0]?.entries.map(e => e.changeId)).toEqual(parts[0]?.entries.map(e => e.changeId));
  });

  it('links the parts and keeps a small month in one note', () => {
    expect(splitChangeNotes('2026-11', [entry(1), entry(2)]).map(p => p.name)).toEqual(['2026-11']);
    const parts = splitChangeNotes(
      '2026-10',
      Array.from({ length: 401 }, (_, i) => entry(i))
    );
    const all = parts.map(p => p.name);
    const first = renderChangesNote('w', '2026-10', parts[0].entries, { name: all[0], all });
    expect(first).toContain('[[2026-10-p2]]');
    expect(first).toContain('^chg-0');
  });

  it('shortens one change with a very long diff', () => {
    const text = renderChangesNote('w', '2026-10', [entry(1, 500)]);
    expect(text).toContain(`${500 - CHANGES_NOTE_MAX_DIFF_LINES} more line(s) not shown`);
    expect(text.split('\n').length).toBeLessThan(120);
  });
});
