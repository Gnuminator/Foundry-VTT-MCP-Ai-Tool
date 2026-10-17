// Recent Changes: reading the bridge answers, the AI row state, the Everyone rows, the person
// filter, the redo rule and the undo choice (just this, everything since, rewind the table) as
// plain data. Pure functions, no DOM. Ported from the old changes-everyone.test.ts.
import { describe, expect, it } from 'vitest';

import {
  AI_LIMIT,
  EVERYONE_LIMIT,
  EVERYONE_TOOL,
  changeState,
  coversSeveral,
  dialogFor,
  filterChanges,
  filterOptions,
  firstStage,
  needsDestructive,
  nextStep,
  obsidianChangePath,
  personFilter,
  planArgs,
  planLines,
  readAiChanges,
  readEveryoneChanges,
  readUndoPlan,
  redoConfirm,
  redoTarget,
  rewindButtonLabel,
  rewindCount,
  rowView,
  thingLabel,
  undoEntryOf,
  undoneLabel,
  validFilter,
  type EveryoneChange,
  type LaterChange,
  type UndoPlan,
} from './changes';

const human = (id: string, by: string, extra: Partial<EveryoneChange> = {}): EveryoneChange => ({
  kind: 'human',
  id,
  at: '2026-10-06T19:00:00Z',
  by,
  summary: `${by} did something`,
  lines: ['Ireena: HP 10 -> 5'],
  canUndo: true,
  ownData: false,
  undone: false,
  undoneBy: '',
  requestedBy: '',
  mode: '',
  feature: '',
  covers: null,
  things: [],
  ...extra,
});

const ai = (id: string, extra: Partial<EveryoneChange> = {}): EveryoneChange => ({
  kind: 'ai',
  id,
  at: '2026-10-06T19:05:00Z',
  by: 'AI',
  summary: 'Damage Ireena',
  lines: [],
  canUndo: true,
  ownData: false,
  undone: false,
  undoneBy: '',
  requestedBy: '',
  mode: '',
  feature: '',
  covers: null,
  things: [],
  ...extra,
});

const plan = (extra: Partial<UndoPlan> = {}): UndoPlan => ({
  planId: 'plan-1',
  summary: 'Undo: Anna did something',
  scope: 'just-this',
  risk: 'write',
  requires: { confirmDestructive: false },
  diff: [{ kind: 'update', text: 'Ireena: HP 5 -> 10' }],
  later: [],
  count: null,
  ...extra,
});

describe('constants', () => {
  it('names the limits and the tool the Everyone tab needs', () => {
    expect(AI_LIMIT).toBe(20);
    expect(EVERYONE_LIMIT).toBe(100);
    expect(EVERYONE_TOOL).toBe('list-changes');
  });
});

describe('readAiChanges', () => {
  it('reads a full entry', () => {
    const raw = {
      changes: [
        {
          changeId: 'c1',
          summary: 'Damage Ireena',
          feature: 'actor-change',
          target: 'Actor.1',
          appliedAt: '2026-10-06T19:05:00Z',
          mode: 'undo',
          undoneBy: 'c2',
          risk: 'destructive',
          canUndo: true,
          diff: ['Ireena: HP 10 -> 5', 7, 'more'],
          requestedBy: 'Danni',
        },
      ],
    };
    expect(readAiChanges(raw)).toEqual([
      {
        changeId: 'c1',
        summary: 'Damage Ireena',
        feature: 'actor-change',
        target: 'Actor.1',
        appliedAt: '2026-10-06T19:05:00Z',
        mode: 'undo',
        undoneBy: 'c2',
        risk: 'destructive',
        canUndo: true,
        diff: ['Ireena: HP 10 -> 5', 'more'],
        requestedBy: 'Danni',
      },
    ]);
  });

  it('drops entries without a change id and anything that is not an object', () => {
    const raw = {
      changes: [
        { summary: 'no id' },
        { changeId: '', summary: 'empty id' },
        { changeId: 42, summary: 'number id' },
        null,
        'text',
        ['list'],
        { changeId: 'keep' },
      ],
    };
    expect(readAiChanges(raw).map(c => c.changeId)).toEqual(['keep']);
  });

  it('defaults the missing fields', () => {
    expect(readAiChanges({ changes: [{ changeId: 'c1' }] })).toEqual([
      {
        changeId: 'c1',
        summary: '',
        feature: '',
        target: '',
        appliedAt: '',
        mode: '',
        undoneBy: '',
        risk: '',
        canUndo: false,
        diff: [],
        requestedBy: '',
      },
    ]);
  });

  it('only counts canUndo when it is exactly true', () => {
    const raw = {
      changes: [
        { changeId: 'a', canUndo: 'yes' },
        { changeId: 'b', canUndo: true },
      ],
    };
    expect(readAiChanges(raw).map(c => c.canUndo)).toEqual([false, true]);
  });

  it('copes with an answer that is not a list', () => {
    expect(readAiChanges(null)).toEqual([]);
    expect(readAiChanges(undefined)).toEqual([]);
    expect(readAiChanges('nope')).toEqual([]);
    expect(readAiChanges([])).toEqual([]);
    expect(readAiChanges({})).toEqual([]);
    expect(readAiChanges({ changes: 'x' })).toEqual([]);
  });
});

describe('changeState', () => {
  it('says undo for the entry an undo left, whatever else is set', () => {
    expect(changeState({ mode: 'undo', undoneBy: 'c2', risk: 'destructive' })).toBe('undo');
  });

  it('says undone for a change that has been undone', () => {
    expect(changeState({ mode: '', undoneBy: 'c2', risk: 'destructive' })).toBe('undone');
    expect(changeState({ mode: 'apply', undoneBy: 'c2', risk: '' })).toBe('undone');
  });

  it('says destructive for a delete that is still in place', () => {
    expect(changeState({ mode: '', undoneBy: '', risk: 'destructive' })).toBe('destructive');
  });

  it('says applied for any other change', () => {
    expect(changeState({ mode: '', undoneBy: '', risk: 'write' })).toBe('applied');
    expect(changeState({ mode: '', undoneBy: '', risk: '' })).toBe('applied');
  });
});

describe('obsidianChangePath', () => {
  it('files a change under the UTC month of appliedAt', () => {
    expect(obsidianChangePath({ appliedAt: '2026-10-06T19:05:00Z' })).toBe(
      'AI Tool/Changes/2026-10'
    );
    expect(obsidianChangePath({ appliedAt: '2026-01-31T23:59:59.999Z' })).toBe(
      'AI Tool/Changes/2026-01'
    );
  });

  it('is null for a missing or bad date', () => {
    expect(obsidianChangePath({ appliedAt: '' })).toBeNull();
    expect(obsidianChangePath({ appliedAt: 'yesterday' })).toBeNull();
    expect(obsidianChangePath({ appliedAt: '26-10-06' })).toBeNull();
    expect(obsidianChangePath({ appliedAt: '2026/10/06' })).toBeNull();
    expect(obsidianChangePath({ appliedAt: '2026-1' })).toBeNull();
  });
});

describe('readEveryoneChanges', () => {
  it('reads an entry and the note', () => {
    const raw = {
      note: 'Older changes are not kept.',
      changes: [
        {
          kind: 'human',
          id: 'act:1',
          at: '2026-10-06T19:00:00Z',
          by: 'Anna',
          summary: 'Anna did something',
          lines: ['Ireena: HP 10 -> 5', 3],
          canUndo: true,
          ownData: true,
          undone: true,
          undoneBy: 'u1',
          requestedBy: 'Danni',
          mode: 'undo',
          feature: 'change-undo',
          covers: 3,
          things: [{ uuid: 'Actor.1', name: 'Ireena' }, { uuid: 'Actor.2', name: null }, 'junk'],
        },
      ],
    };
    expect(readEveryoneChanges(raw)).toEqual({
      note: 'Older changes are not kept.',
      changes: [
        {
          kind: 'human',
          id: 'act:1',
          at: '2026-10-06T19:00:00Z',
          by: 'Anna',
          summary: 'Anna did something',
          lines: ['Ireena: HP 10 -> 5'],
          canUndo: true,
          ownData: true,
          undone: true,
          undoneBy: 'u1',
          requestedBy: 'Danni',
          mode: 'undo',
          feature: 'change-undo',
          covers: 3,
          things: [
            { uuid: 'Actor.1', name: 'Ireena' },
            { uuid: 'Actor.2', name: null },
          ],
        },
      ],
    });
  });

  it('defaults the missing fields and reads an unknown kind as the AI', () => {
    const { changes, note } = readEveryoneChanges({
      changes: [{ id: 'x' }, { id: 'y', kind: 'ghost' }],
    });
    expect(note).toBe('');
    expect(changes).toHaveLength(2);
    expect(changes[0]).toEqual({
      kind: 'ai',
      id: 'x',
      at: '',
      by: '',
      summary: '',
      lines: [],
      canUndo: false,
      ownData: false,
      undone: false,
      undoneBy: '',
      requestedBy: '',
      mode: '',
      feature: '',
      covers: null,
      things: [],
    });
    expect(changes[1]?.kind).toBe('ai');
  });

  it('reads both kinds', () => {
    const raw = {
      changes: [
        { id: 'a', kind: 'human' },
        { id: 'b', kind: 'ai' },
      ],
    };
    expect(readEveryoneChanges(raw).changes.map(c => c.kind)).toEqual(['human', 'ai']);
  });

  it('keeps covers only when it is a number', () => {
    const raw = {
      changes: [
        { id: 'a', covers: 0 },
        { id: 'b', covers: '3' },
        { id: 'c', covers: 2 },
      ],
    };
    expect(readEveryoneChanges(raw).changes.map(c => c.covers)).toEqual([0, null, 2]);
  });

  it('drops entries without an id and copes with a bad answer', () => {
    expect(
      readEveryoneChanges({ changes: [{ kind: 'human' }, null, 'x', { id: 'k' }] }).changes
    ).toHaveLength(1);
    for (const bad of [null, undefined, 'x', 5, [], {}]) {
      expect(readEveryoneChanges(bad)).toEqual({ changes: [], note: '' });
    }
    expect(readEveryoneChanges({ changes: 'x', note: 'Only a note' })).toEqual({
      changes: [],
      note: 'Only a note',
    });
  });
});

describe('readUndoPlan', () => {
  const raw = {
    planId: 'plan-1',
    summary: 'Rewind the table to 19:00: 12 changes',
    scope: 'world-since',
    risk: 'destructive',
    requires: { confirm: true, confirmDestructive: true },
    diff: [{ kind: 'update', text: 'Ireena: HP 5 -> 10' }, { kind: 'note' }, 'junk'],
    later: [{ id: 'act:9', at: '2026-10-06T19:30:00Z', by: 'Anna', summary: 'HP 5 -> 3' }, null],
    count: 12,
  };

  it('reads a full plan', () => {
    expect(readUndoPlan(raw)).toEqual({
      planId: 'plan-1',
      summary: 'Rewind the table to 19:00: 12 changes',
      scope: 'world-since',
      risk: 'destructive',
      requires: { confirmDestructive: true },
      diff: [
        { kind: 'update', text: 'Ireena: HP 5 -> 10' },
        { kind: 'note', text: '' },
      ],
      later: [{ id: 'act:9', at: '2026-10-06T19:30:00Z', by: 'Anna', summary: 'HP 5 -> 3' }],
      count: 12,
    });
  });

  it('is null without a plan id or a plan at all', () => {
    expect(readUndoPlan({ ...raw, planId: '' })).toBeNull();
    expect(readUndoPlan({ ...raw, planId: undefined })).toBeNull();
    expect(readUndoPlan({ ...raw, planId: 7 })).toBeNull();
    expect(readUndoPlan({})).toBeNull();
    expect(readUndoPlan(null)).toBeNull();
    expect(readUndoPlan('plan-1')).toBeNull();
    expect(readUndoPlan([raw])).toBeNull();
  });

  it('defaults the missing fields', () => {
    expect(readUndoPlan({ planId: 'p' })).toEqual({
      planId: 'p',
      summary: '',
      scope: '',
      risk: '',
      requires: { confirmDestructive: false },
      diff: [],
      later: [],
      count: null,
    });
  });

  it('only keeps a count that is a whole number of zero or more', () => {
    const count = (c: unknown): number | null => {
      const read = readUndoPlan({ planId: 'p', count: c });
      if (!read) throw new Error('plan not read');
      return read.count;
    };
    expect(count(0)).toBe(0);
    expect(count(1)).toBe(1);
    expect(count(12)).toBe(12);
    expect(count(-1)).toBeNull();
    expect(count(1.5)).toBeNull();
    expect(count(Number.NaN)).toBeNull();
    expect(count(Number.POSITIVE_INFINITY)).toBeNull();
    expect(count('3')).toBeNull();
    expect(count(null)).toBeNull();
    expect(count(undefined)).toBeNull();
  });

  it('only needs the destructive confirmation when the flag is exactly true', () => {
    const flag = (v: unknown): boolean | undefined =>
      readUndoPlan({ planId: 'p', requires: { confirmDestructive: v } })?.requires
        .confirmDestructive;
    expect(flag(true)).toBe(true);
    expect(flag('true')).toBe(false);
    expect(flag(1)).toBe(false);
    expect(readUndoPlan({ planId: 'p', requires: 'x' })?.requires.confirmDestructive).toBe(false);
  });
});

describe('person filter', () => {
  const all = [human('act:1', 'Zed'), human('act:2', 'anna'), human('act:3', 'Zed'), ai('c1')];

  it('lists Everyone, AI, then each person once, A to Z', () => {
    expect(filterOptions(all).map(o => o.label)).toEqual(['Everyone', 'AI', 'anna', 'Zed']);
    expect(filterOptions([]).map(o => o.label)).toEqual(['Everyone', 'AI']);
  });

  it('gives each option a value, the person ones by name', () => {
    expect(filterOptions(all).map(o => o.value)).toEqual([
      'all',
      'ai',
      'person:anna',
      'person:Zed',
    ]);
    expect(personFilter('Zed')).toBe('person:Zed');
  });

  it('keeps everything, only the AI, or only one person', () => {
    expect(filterChanges(all, 'all')).toHaveLength(4);
    expect(filterChanges(all, 'ai').map(c => c.id)).toEqual(['c1']);
    expect(filterChanges(all, personFilter('Zed')).map(c => c.id)).toEqual(['act:1', 'act:3']);
  });

  it('keeps everything for a filter it does not know, as a copy', () => {
    const kept = filterChanges(all, 'nonsense');
    expect(kept).toEqual(all);
    expect(kept).not.toBe(all);
  });

  it('counts an undo or redo a person asked for as theirs, not the AI', () => {
    const undo = ai('u1', { feature: 'change-undo', requestedBy: 'Danni', summary: 'Undo: x' });
    const redo = ai('u2', { mode: 'undo', requestedBy: 'Danni', summary: 'Undo: Undo: 4 damage' });
    const mine = [...all, undo, redo];
    expect(filterChanges(mine, 'ai').map(c => c.id)).toEqual(['c1']);
    expect(filterChanges(mine, personFilter('Danni')).map(c => c.id)).toEqual(['u1', 'u2']);
    expect(filterOptions(mine).map(o => o.label)).toContain('Danni');
    expect(rowView(undo, mine)).toMatchObject({ who: 'Danni', summary: 'Undo: x' });
    expect(rowView(redo, mine)).toMatchObject({ who: 'Danni', summary: 'Redo: 4 damage' });
    // Claude's own undo (no Foundry window, no dashboard) stays the AI's.
    expect(rowView(ai('u3', { mode: 'undo' }), mine).who).toBe('AI');
    expect(filterChanges([...mine, ai('u3', { mode: 'undo' })], 'ai').map(c => c.id)).toEqual([
      'c1',
      'u3',
    ]);
  });

  it('marks a change that also wrote the AI Tool own data, so its Undo is the plain one', () => {
    const reveal = ai('r1', { ownData: true });
    expect(rowView(reveal, [reveal])).toMatchObject({ canUndo: true, ownData: true });
    expect(rowView(ai('c9'), [ai('c9')])).toMatchObject({ ownData: false });
  });

  it('falls back to everyone when the chosen person is no longer in the list', () => {
    expect(validFilter(all, personFilter('Zed'))).toBe('person:Zed');
    expect(validFilter(all, personFilter('Gone'))).toBe('all');
    expect(validFilter(all, 'ai')).toBe('ai');
    expect(validFilter(all, 'all')).toBe('all');
    expect(validFilter(all, 'nonsense')).toBe('all');
  });
});

describe('rows, badge and redo', () => {
  it('shows Undo only while the change can be undone', () => {
    expect(rowView(human('act:1', 'Anna'), []).canUndo).toBe(true);
    expect(rowView(human('act:1', 'Anna', { canUndo: false }), []).canUndo).toBe(false);
    expect(rowView(human('act:1', 'Anna', { undone: true, canUndo: true }), []).canUndo).toBe(
      false
    );
  });

  it('names the person, or "Someone" when the bridge has no name', () => {
    expect(rowView(human('act:1', 'Anna'), []).who).toBe('Anna');
    expect(rowView(human('act:1', ''), []).who).toBe('Someone');
  });

  it('carries the time, the lines and the thing through', () => {
    const row = rowView(
      human('act:1', 'Anna', { things: [{ uuid: 'Actor.1', name: 'Ireena' }] }),
      []
    );
    expect(row).toMatchObject({
      id: 'act:1',
      at: '2026-10-06T19:00:00Z',
      summary: 'Anna did something',
      lines: ['Ireena: HP 10 -> 5'],
      thing: 'Ireena',
      undone: false,
      undoneText: '',
      redoId: null,
    });
  });

  it('turns an undo of an undo into a redo, once', () => {
    const redo = ai('u2', { summary: 'Undo: Undo: 4 damage' });
    expect(rowView(redo, [redo]).summary).toBe('Redo: 4 damage');
    const undo = ai('u1', { summary: 'Undo: 4 damage' });
    expect(rowView(undo, [undo]).summary).toBe('Undo: 4 damage');
  });

  it('says who undid it when the undo is in the list, else only "Undone"', () => {
    const undo = ai('u1', { requestedBy: 'Danni' });
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    expect(undoneLabel(row, [row, undo])).toBe('Undone by Danni');
    expect(undoneLabel(row, [row, ai('u1')])).toBe('Undone by the AI Tool');
    expect(undoneLabel(row, [row])).toBe('Undone');
    expect(undoneLabel(human('act:2', 'Anna'), [])).toBe('');
  });

  it('names a human undo entry by its own person', () => {
    const undo = human('u1', 'Bea');
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    expect(undoneLabel(row, [row, undo])).toBe('Undone by Bea');
  });

  it('finds the undo entry only for an undone change that names it', () => {
    const undo = ai('u1');
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    expect(undoEntryOf(row, [row, undo])).toBe(undo);
    expect(undoEntryOf(row, [row])).toBeNull();
    expect(undoEntryOf(human('act:1', 'Anna', { undone: true }), [undo])).toBeNull();
    expect(undoEntryOf(human('act:1', 'Anna', { undoneBy: 'u1' }), [undo])).toBeNull();
  });

  it('offers Redo only when the undo entry is a live, undoable AI change', () => {
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    expect(rowView(row, [row, ai('u1')]).redoId).toBe('u1');
    // The undo entry is not in the list (older than the list), was itself undone, or is blocked.
    expect(rowView(row, [row]).redoId).toBeNull();
    expect(redoTarget(row, [row, ai('u1', { undone: true })])).toBeNull();
    expect(redoTarget(row, [row, ai('u1', { canUndo: false })])).toBeNull();
    // An undo entry that is not an AI change cannot be redone.
    expect(redoTarget(row, [row, human('u1', 'Bea')])).toBeNull();
    // A change that is not undone has no redo.
    expect(redoTarget(human('act:2', 'Anna'), [ai('u1')])).toBeNull();
  });

  it('knows when an undo covered several changes', () => {
    expect(coversSeveral(null)).toBe(false);
    expect(coversSeveral(ai('u1', { covers: 3 }))).toBe(true);
    expect(coversSeveral(ai('u1', { covers: 2 }))).toBe(true);
    expect(coversSeveral(ai('u1', { covers: 1 }))).toBe(false);
    expect(coversSeveral(ai('u1', { covers: 0 }))).toBe(false);
    // The count wins over the lines.
    expect(coversSeveral(ai('u1', { covers: 1, lines: ['a', 'b'] }))).toBe(false);
    // An older bridge sends no count: more than one line is the hint.
    expect(coversSeveral(ai('u1', { lines: ['a', 'b'] }))).toBe(true);
    expect(coversSeveral(ai('u1', { lines: ['a'] }))).toBe(false);
    expect(coversSeveral(ai('u1'))).toBe(false);
  });

  it('Redo confirms with what really comes back: all the changes one undo covered', () => {
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    const single = ai('u1', { summary: 'Undo: Anna did something', lines: ['Ireena: HP 5 -> 10'] });
    expect(redoConfirm(row, [row, single])).toEqual({
      summary: 'Redo: Anna did something',
      lines: ['Ireena: HP 10 -> 5'],
    });
    const lines = ['Ireena: HP 5 -> 10', 'Ireena: Poisoned removed', 'Wolf: moved back'];
    const since = ai('u1', { summary: 'Undo since 19:00: 3 changes', lines, covers: 3 });
    const many = redoConfirm(row, [row, since]);
    expect(many.summary).toContain('brings all of them back');
    expect(many.summary).toContain('"Undo since 19:00: 3 changes"');
    expect(many.lines).toEqual(lines);
    // A plain undo of one change with two lines (HP and Bloodied) is not "several changes".
    const two = ai('u1', { summary: 'Undo: 4 damage', lines: lines.slice(0, 2), covers: 1 });
    expect(redoConfirm(row, [row, two]).summary).toBe('Redo: Anna did something');
    // An older bridge sends no count: more than one line is the hint.
    const old = ai('u1', { summary: 'Undo since 19:00: 3 changes', lines });
    expect(redoConfirm(row, [row, old]).summary).toContain('brings all of them back');
  });

  it('Redo confirms plainly when there is no undo entry to read', () => {
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    expect(redoConfirm(row, [row])).toEqual({
      summary: 'Redo: Anna did something',
      lines: ['Ireena: HP 10 -> 5'],
    });
  });

  it('names the thing a change touched', () => {
    expect(thingLabel(human('a', 'Anna'))).toBe('this thing');
    const one = human('a', 'Anna', { things: [{ uuid: 'Actor.1', name: 'Ireena' }] });
    expect(thingLabel(one)).toBe('Ireena');
    const two = human('a', 'Anna', {
      things: [
        { uuid: 'Actor.1', name: 'Ireena' },
        { uuid: 'Actor.2', name: null },
        { uuid: 'Actor.3', name: 'Strahd' },
      ],
    });
    expect(thingLabel(two)).toBe('Ireena and 1 more');
    const nameless = human('a', 'Anna', { things: [{ uuid: 'Actor.2', name: null }] });
    expect(thingLabel(nameless)).toBe('this thing');
  });
});

describe('the undo choice', () => {
  const thing = 'Ireena';
  const later: LaterChange[] = [
    { id: 'act:9', at: '2026-10-06T19:30:00Z', by: 'Anna', summary: 'HP 5 -> 3' },
  ];

  it('asks the plan for just this first and arguments follow the scope', () => {
    expect(planArgs('act:1', { scope: 'just-this' })).toEqual({ id: 'act:1', scope: 'just-this' });
    expect(planArgs('act:1', { scope: 'world-since', rewindTable: true })).toEqual({
      id: 'act:1',
      scope: 'world-since',
      rewindTable: true,
    });
  });

  it('goes straight to the confirm when nothing came after', () => {
    expect(firstStage(plan())).toBe('confirm');
    const d = dialogFor('confirm', plan(), thing);
    expect(d.stage).toBe('confirm');
    expect(d.title).toBe('Undo this change?');
    expect(d.intro).toBe('Undo: Anna did something');
    expect(d.lines).toEqual([{ text: 'Ireena: HP 5 -> 10', note: false }]);
    expect(d.buttons.map(b => b.key)).toEqual(['cancel', 'apply']);
    expect(d.destructive).toBe(false);
    expect(d.buttons[1]?.needsCheck).toBe(false);
    expect(d.buttons[1]).toMatchObject({ label: 'Undo', primary: true, danger: false });
    expect(nextStep('confirm', 'apply')).toEqual({ apply: true });
    expect(nextStep('confirm', 'cancel')).toEqual({ done: true });
    expect(nextStep('confirm', null)).toEqual({ done: true });
    // The rewind is under Advanced in the plain confirm too, as in the Foundry window.
    expect(d.advanced?.button).toMatchObject({
      key: 'rewind',
      label: 'Rewind the whole table to here',
    });
    expect(nextStep('confirm', 'rewind')).toEqual({
      plan: { scope: 'world-since', rewindTable: true },
      stage: 'rewind-1',
    });
  });

  it('offers the rewind only in the first dialog, not after Just this or Everything since', () => {
    expect(dialogFor('confirm', plan({ later }), thing).advanced).toBeUndefined();
    expect(
      dialogFor('confirm', plan({ scope: 'everything-since' }), thing).advanced
    ).toBeUndefined();
  });

  it('flags the notes of a plan so they read as notes, not changes', () => {
    const p = plan({
      diff: [
        { kind: 'update', text: 'Ireena: HP 5 -> 10' },
        { kind: 'note', text: 'Kept as it is: Ireena: name (changed since)' },
        { kind: 'update', text: '' },
      ],
    });
    // A line with no text is left out.
    expect(planLines(p).map(l => l.note)).toEqual([false, true]);
    expect(planLines(p)).toHaveLength(2);
  });

  it('asks which way when the change is not the latest on its thing', () => {
    const p = plan({ later });
    expect(firstStage(p)).toBe('choose');
    const d = dialogFor('choose', p, thing);
    expect(d.title).toBe('Undo this change?');
    expect(d.intro).toBe('This is not the latest change to Ireena.');
    expect(d.laterTitle).toBe('Changed since then:');
    expect(d.later).toEqual(later);
    expect(d.lines).toEqual([]);
    expect(d.destructive).toBe(false);
    expect(d.buttons.map(b => b.label)).toEqual(['Cancel', 'Just this', 'Everything since']);
    expect(d.buttons.map(b => b.key)).toEqual(['cancel', 'just-this', 'everything-since']);
    // The Advanced rewind is a separate, collapsed choice.
    expect(d.advanced?.button).toMatchObject({
      key: 'rewind',
      label: 'Rewind the whole table to here',
    });
  });

  it('uses the thing label the caller gives for a multi-thing change', () => {
    const d = dialogFor('choose', plan({ later }), 'Ireena and 1 more');
    expect(d.intro).toBe('This is not the latest change to Ireena and 1 more.');
  });

  it('just this reuses the plan; everything since plans again with that scope', () => {
    expect(nextStep('choose', 'just-this')).toEqual({ stage: 'confirm' });
    expect(nextStep('choose', 'everything-since')).toEqual({
      plan: { scope: 'everything-since' },
      stage: 'confirm',
    });
    expect(nextStep('choose', 'cancel')).toEqual({ done: true });
    const since = plan({
      scope: 'everything-since',
      summary: 'Undo since 19:00: 2 changes on Ireena',
    });
    expect(dialogFor('confirm', since, thing).title).toBe('Undo everything since?');
  });

  it('keys that make no sense at a stage end the flow', () => {
    expect(nextStep('choose', 'apply')).toEqual({ done: true });
    expect(nextStep('choose', 'next')).toEqual({ done: true });
    expect(nextStep('confirm', 'just-this')).toEqual({ done: true });
    expect(nextStep('confirm', 'next')).toEqual({ done: true });
    expect(nextStep('rewind-1', 'rewind')).toEqual({ done: true });
    expect(nextStep('rewind-2', 'next')).toEqual({ done: true });
    expect(nextStep('rewind-1', null)).toEqual({ done: true });
  });

  it('shows the destructive checkbox and gates the button for a destructive plan', () => {
    const p = plan({ risk: 'destructive', requires: { confirmDestructive: true } });
    expect(needsDestructive(p)).toBe(true);
    const d = dialogFor('confirm', p, thing);
    expect(d.destructive).toBe(true);
    expect(d.buttons[1]?.needsCheck).toBe(true);
    expect(needsDestructive(plan())).toBe(false);
  });

  it('treats either destructive signal as enough', () => {
    expect(needsDestructive(plan({ risk: 'destructive' }))).toBe(true);
    expect(needsDestructive(plan({ requires: { confirmDestructive: true } }))).toBe(true);
  });

  describe('rewind the whole table', () => {
    const rewind = plan({
      scope: 'world-since',
      risk: 'destructive',
      summary: 'Rewind the table to 19:00: 12 changes',
      requires: { confirmDestructive: true },
      diff: [
        { kind: 'update', text: 'Ireena: HP 5 -> 10' },
        { kind: 'delete', text: 'Delete Token "Wolf"' },
      ],
    });

    it('plans the rewind from the choice, then asks twice', () => {
      expect(nextStep('choose', 'rewind')).toEqual({
        plan: { scope: 'world-since', rewindTable: true },
        stage: 'rewind-1',
      });
      expect(nextStep('rewind-1', 'next')).toEqual({ stage: 'rewind-2' });
      expect(nextStep('rewind-1', 'apply')).toEqual({ done: true });
      expect(nextStep('rewind-2', 'apply')).toEqual({ apply: true });
      expect(nextStep('rewind-2', 'cancel')).toEqual({ done: true });
    });

    it('step 1 shows the count and the full list, with no way to apply yet', () => {
      const d = dialogFor('rewind-1', rewind, thing);
      expect(d.title).toBe('Rewind the whole table?');
      expect(d.intro).toContain('12 changes');
      expect(d.lines.map(l => l.text)).toEqual(['Ireena: HP 5 -> 10', 'Delete Token "Wolf"']);
      expect(d.buttons.map(b => b.key)).toEqual(['cancel', 'next']);
      expect(d.destructive).toBe(false);
    });

    it('step 1 still reads when the count is unknown', () => {
      const d = dialogFor('rewind-1', plan({ summary: 'Something else' }), thing);
      expect(d.intro).not.toContain('NaN');
      expect(d.intro).not.toContain('null');
      expect(d.intro).toContain('every change at the table');
    });

    it('step 1 says "1 change" for a single one', () => {
      const d = dialogFor('rewind-1', plan({ count: 1 }), thing);
      expect(d.intro).toContain('1 change,');
    });

    it('step 2 asks again with the count on the button and needs the checkbox', () => {
      const d = dialogFor('rewind-2', rewind, thing);
      expect(d.title).toBe('Are you sure?');
      expect(d.destructive).toBe(true);
      expect(d.lines).toEqual([]);
      expect(d.intro).toContain('12 changes will be undone');
      const apply = d.buttons.find(b => b.key === 'apply');
      expect(apply?.label).toBe('Undo all 12 changes');
      expect(apply?.needsCheck).toBe(true);
      expect(apply?.danger).toBe(true);
      expect(apply?.primary).toBe(true);
    });

    it('step 2 gates the button even when the plan does not say destructive', () => {
      const d = dialogFor('rewind-2', plan({ scope: 'world-since' }), thing);
      expect(d.destructive).toBe(true);
      expect(d.buttons.find(b => b.key === 'apply')).toMatchObject({
        needsCheck: false,
        danger: true,
      });
    });

    it('reads the count from the plan count or its summary and copes with a missing one', () => {
      expect(rewindCount(rewind)).toBe(12);
      expect(rewindCount(plan({ summary: 'Rewind the table to 19:00: 1 change' }))).toBe(1);
      expect(rewindCount(plan({ summary: 'Something else' }))).toBeNull();
      expect(rewindCount(plan({ summary: 'Something else', count: 7 }))).toBe(7);
      // The plan's own count wins over the summary.
      expect(
        rewindCount(plan({ summary: 'Rewind the table to 19:00: 12 changes', count: 3 }))
      ).toBe(3);
      expect(rewindCount(plan({ summary: 'Rewind: 0 changes' }))).toBe(0);
      expect(rewindButtonLabel(1)).toBe('Undo 1 change');
      expect(rewindButtonLabel(12)).toBe('Undo all 12 changes');
      expect(rewindButtonLabel(null)).toBe('Undo all changes');
    });
  });
});
