/**
 * Recent Changes, Everyone tab (I-109): the rows, the person filter, the redo rule and the undo
 * choice (just this, everything since, rewind the table) as plain data. The helpers are the
 * browser module public/changes-everyone.js, loaded the way demo-scripts.test.ts loads scripts.
 * The page wiring is checked as text (GM page only, no spoilers on /player).
 */
import { readFileSync } from 'fs';
import * as path from 'path';
import { fileURLToPath, pathToFileURL } from 'url';

import { describe, expect, it } from 'vitest';

const publicDir = path.join(path.dirname(fileURLToPath(import.meta.url)), '..', 'public');

interface Change {
  kind: 'human' | 'ai';
  id: string;
  at: string;
  by: string;
  summary: string;
  lines: string[];
  canUndo: boolean;
  undone: boolean;
  undoneBy?: string;
  requestedBy?: string;
  mode?: string;
  feature?: string;
  things?: Array<{ uuid: string; name: string | null }>;
}

interface Plan {
  planId: string;
  summary: string;
  scope: string;
  risk: string;
  requires: { confirm: true; confirmDestructive: boolean };
  diff: Array<{ kind: string; text: string }>;
  later: Array<{ id: string; at: string; by: string; summary: string }>;
}

interface Button {
  key: string;
  label: string;
  primary?: boolean;
  danger?: boolean;
  needsCheck?: boolean;
}

interface Dialog {
  stage: string;
  title: string;
  intro: string;
  later?: Plan['later'];
  lines: Array<{ text: string; note: boolean }>;
  destructive: boolean;
  advanced?: { button: Button };
  buttons: Button[];
}

interface Step {
  stage?: string;
  plan?: { scope: string; rewindTable?: boolean };
  apply?: boolean;
  done?: boolean;
}

interface Helpers {
  filterOptions(changes: Change[]): Array<{ value: string; label: string }>;
  filterChanges(changes: Change[], filter: string): Change[];
  validFilter(changes: Change[], filter: string): string;
  personFilter(name: string): string;
  undoneLabel(change: Change, all: Change[]): string;
  redoTarget(change: Change, all: Change[]): Change | null;
  thingLabel(change: Change): string;
  rowView(change: Change, all: Change[]): Record<string, unknown> & { redoId: string | null };
  planLines(plan: Plan): Array<{ text: string; note: boolean }>;
  needsDestructive(plan: Plan): boolean;
  rewindCount(plan: Plan): number | null;
  rewindButtonLabel(count: number | null): string;
  dialogFor(stage: string, plan: Plan, change: { thing: string }): Dialog;
  firstStage(plan: Plan): string;
  nextStep(stage: string, key: string | null): Step;
  planArgs(id: string, scope: { scope: string; rewindTable?: boolean }): Record<string, unknown>;
}

const h = (await import(
  pathToFileURL(path.join(publicDir, 'changes-everyone.js')).href
)) as unknown as Helpers;

const human = (id: string, by: string, extra: Partial<Change> = {}): Change => ({
  kind: 'human',
  id,
  at: '2026-10-06T19:00:00Z',
  by,
  summary: `${by} did something`,
  lines: ['Ireena: HP 10 -> 5'],
  canUndo: true,
  undone: false,
  ...extra,
});
const ai = (id: string, extra: Partial<Change> = {}): Change => ({
  kind: 'ai',
  id,
  at: '2026-10-06T19:05:00Z',
  by: 'AI',
  summary: 'Damage Ireena',
  lines: [],
  canUndo: true,
  undone: false,
  ...extra,
});
const plan = (extra: Partial<Plan> = {}): Plan => ({
  planId: 'plan-1',
  summary: 'Undo: Anna did something',
  scope: 'just-this',
  risk: 'write',
  requires: { confirm: true, confirmDestructive: false },
  diff: [{ kind: 'update', text: 'Ireena: HP 5 -> 10' }],
  later: [],
  ...extra,
});

describe('person filter', () => {
  const all = [human('act:1', 'Zed'), human('act:2', 'anna'), human('act:3', 'Zed'), ai('c1')];

  it('lists Everyone, AI, then each person once, A to Z', () => {
    expect(h.filterOptions(all).map(o => o.label)).toEqual(['Everyone', 'AI', 'anna', 'Zed']);
    expect(h.filterOptions([]).map(o => o.label)).toEqual(['Everyone', 'AI']);
  });

  it('keeps everything, only the AI, or only one person', () => {
    expect(h.filterChanges(all, 'all')).toHaveLength(4);
    expect(h.filterChanges(all, 'ai').map(c => c.id)).toEqual(['c1']);
    expect(h.filterChanges(all, h.personFilter('Zed')).map(c => c.id)).toEqual(['act:1', 'act:3']);
  });

  it('counts an undo or redo a person asked for as theirs, not the AI', () => {
    const undo = ai('u1', { feature: 'change-undo', requestedBy: 'Danni', summary: 'Undo: x' });
    const redo = ai('u2', { mode: 'undo', requestedBy: 'Danni', summary: 'Undo: Undo: 4 damage' });
    const mine = [...all, undo, redo];
    expect(h.filterChanges(mine, 'ai').map(c => c.id)).toEqual(['c1']);
    expect(h.filterChanges(mine, h.personFilter('Danni')).map(c => c.id)).toEqual(['u1', 'u2']);
    expect(h.filterOptions(mine).map(o => o.label)).toContain('Danni');
    expect(h.rowView(undo, mine)).toMatchObject({ who: 'Danni', summary: 'Undo: x' });
    expect(h.rowView(redo, mine)).toMatchObject({ who: 'Danni', summary: 'Redo: 4 damage' });
    // Claude's own undo (no Foundry window, no dashboard) stays the AI's.
    expect(h.rowView(ai('u3', { mode: 'undo' }), mine).who).toBe('AI');
  });

  it('falls back to everyone when the chosen person is no longer in the list', () => {
    expect(h.validFilter(all, h.personFilter('Zed'))).toBe('person:Zed');
    expect(h.validFilter(all, h.personFilter('Gone'))).toBe('all');
  });
});

describe('rows, badge and redo', () => {
  it('shows Undo only while the change can be undone', () => {
    expect(h.rowView(human('act:1', 'Anna'), []).canUndo).toBe(true);
    expect(h.rowView(human('act:1', 'Anna', { canUndo: false }), []).canUndo).toBe(false);
    expect(h.rowView(human('act:1', 'Anna', { undone: true, canUndo: true }), []).canUndo).toBe(
      false
    );
  });

  it('says who undid it when the undo is in the list, else only "Undone"', () => {
    const undo = ai('u1', { requestedBy: 'Danni' });
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    expect(h.undoneLabel(row, [row, undo])).toBe('Undone by Danni');
    expect(h.undoneLabel(row, [row, ai('u1')])).toBe('Undone by the AI Tool');
    expect(h.undoneLabel(row, [row])).toBe('Undone');
    expect(h.undoneLabel(human('act:2', 'Anna'), [])).toBe('');
  });

  it('offers Redo only when the undo entry is a live, undoable AI change', () => {
    const row = human('act:1', 'Anna', { undone: true, undoneBy: 'u1' });
    expect(h.rowView(row, [row, ai('u1')]).redoId).toBe('u1');
    // The undo entry is not in the list (older than the list), was itself undone, or is blocked.
    expect(h.rowView(row, [row]).redoId).toBeNull();
    expect(h.redoTarget(row, [row, ai('u1', { undone: true })])).toBeNull();
    expect(h.redoTarget(row, [row, ai('u1', { canUndo: false })])).toBeNull();
    // A change that is not undone has no redo.
    expect(h.redoTarget(human('act:2', 'Anna'), [ai('u1')])).toBeNull();
  });

  it('names the thing a change touched', () => {
    expect(h.thingLabel(human('a', 'Anna'))).toBe('this thing');
    const one = human('a', 'Anna', { things: [{ uuid: 'Actor.1', name: 'Ireena' }] });
    expect(h.thingLabel(one)).toBe('Ireena');
    const two = human('a', 'Anna', {
      things: [
        { uuid: 'Actor.1', name: 'Ireena' },
        { uuid: 'Actor.2', name: null },
        { uuid: 'Actor.3', name: 'Strahd' },
      ],
    });
    expect(h.thingLabel(two)).toBe('Ireena and 1 more');
  });
});

describe('the undo choice', () => {
  const row = { thing: 'Ireena' };
  const later = [{ id: 'act:9', at: '2026-10-06T19:30:00Z', by: 'Anna', summary: 'HP 5 -> 3' }];

  it('asks the plan for just this first and arguments follow the scope', () => {
    expect(h.planArgs('act:1', { scope: 'just-this' })).toEqual({
      id: 'act:1',
      scope: 'just-this',
    });
    expect(h.planArgs('act:1', { scope: 'world-since', rewindTable: true })).toEqual({
      id: 'act:1',
      scope: 'world-since',
      rewindTable: true,
    });
  });

  it('goes straight to the confirm when nothing came after', () => {
    expect(h.firstStage(plan())).toBe('confirm');
    const d = h.dialogFor('confirm', plan(), row);
    expect(d.title).toBe('Undo this change?');
    expect(d.intro).toBe('Undo: Anna did something');
    expect(d.lines).toEqual([{ text: 'Ireena: HP 5 -> 10', note: false }]);
    expect(d.buttons.map(b => b.key)).toEqual(['cancel', 'apply']);
    expect(d.destructive).toBe(false);
    expect(d.buttons[1]?.needsCheck).toBe(false);
    expect(h.nextStep('confirm', 'apply')).toEqual({ apply: true });
    expect(h.nextStep('confirm', 'cancel')).toEqual({ done: true });
    expect(h.nextStep('confirm', null)).toEqual({ done: true });
  });

  it('flags the notes of a plan so they read as notes, not changes', () => {
    const p = plan({
      diff: [
        { kind: 'update', text: 'Ireena: HP 5 -> 10' },
        { kind: 'note', text: 'Kept as it is: Ireena: name (changed since)' },
      ],
    });
    expect(h.planLines(p).map(l => l.note)).toEqual([false, true]);
  });

  it('asks which way when the change is not the latest on its thing', () => {
    const p = plan({ later });
    expect(h.firstStage(p)).toBe('choose');
    const d = h.dialogFor('choose', p, row);
    expect(d.intro).toBe('This is not the latest change to Ireena.');
    expect(d.later).toEqual(later);
    expect(d.buttons.map(b => b.label)).toEqual(['Cancel', 'Just this', 'Everything since']);
    // The Advanced rewind is a separate, collapsed choice.
    expect(d.advanced?.button).toEqual({ key: 'rewind', label: 'Rewind the whole table to here' });
  });

  it('just this reuses the plan; everything since plans again with that scope', () => {
    expect(h.nextStep('choose', 'just-this')).toEqual({ stage: 'confirm' });
    expect(h.nextStep('choose', 'everything-since')).toEqual({
      plan: { scope: 'everything-since' },
      stage: 'confirm',
    });
    expect(h.nextStep('choose', 'cancel')).toEqual({ done: true });
    const since = plan({
      scope: 'everything-since',
      summary: 'Undo since 19:00: 2 changes on Ireena',
    });
    expect(h.dialogFor('confirm', since, row).title).toBe('Undo everything since?');
  });

  it('shows the destructive checkbox and gates the button for a destructive plan', () => {
    const p = plan({ risk: 'destructive', requires: { confirm: true, confirmDestructive: true } });
    expect(h.needsDestructive(p)).toBe(true);
    const d = h.dialogFor('confirm', p, row);
    expect(d.destructive).toBe(true);
    expect(d.buttons[1]?.needsCheck).toBe(true);
    expect(h.needsDestructive(plan())).toBe(false);
  });

  describe('rewind the whole table', () => {
    const rewind = plan({
      scope: 'world-since',
      risk: 'destructive',
      summary: 'Rewind the table to 19:00: 12 changes',
      requires: { confirm: true, confirmDestructive: true },
      diff: [
        { kind: 'update', text: 'Ireena: HP 5 -> 10' },
        { kind: 'delete', text: 'Delete Token "Wolf"' },
      ],
    });

    it('plans the rewind from the choice, then asks twice', () => {
      expect(h.nextStep('choose', 'rewind')).toEqual({
        plan: { scope: 'world-since', rewindTable: true },
        stage: 'rewind-1',
      });
      expect(h.nextStep('rewind-1', 'next')).toEqual({ stage: 'rewind-2' });
      expect(h.nextStep('rewind-1', 'apply')).toEqual({ done: true });
      expect(h.nextStep('rewind-2', 'apply')).toEqual({ apply: true });
      expect(h.nextStep('rewind-2', 'cancel')).toEqual({ done: true });
    });

    it('step 1 shows the count and the full list, with no way to apply yet', () => {
      const d = h.dialogFor('rewind-1', rewind, row);
      expect(d.intro).toContain('12 changes');
      expect(d.lines.map(l => l.text)).toEqual(['Ireena: HP 5 -> 10', 'Delete Token "Wolf"']);
      expect(d.buttons.map(b => b.key)).toEqual(['cancel', 'next']);
    });

    it('step 2 asks again with the count on the button and needs the checkbox', () => {
      const d = h.dialogFor('rewind-2', rewind, row);
      expect(d.destructive).toBe(true);
      const apply = d.buttons.find(b => b.key === 'apply');
      expect(apply?.label).toBe('Undo all 12 changes');
      expect(apply?.needsCheck).toBe(true);
      expect(apply?.danger).toBe(true);
    });

    it('reads the count from the plan summary and copes with a missing one', () => {
      expect(h.rewindCount(rewind)).toBe(12);
      expect(h.rewindCount(plan({ summary: 'Rewind the table to 19:00: 1 change' }))).toBe(1);
      expect(h.rewindCount(plan({ summary: 'Something else' }))).toBeNull();
      expect(h.rewindCount(plan({ summary: 'Something else', count: 7 }))).toBe(7);
      expect(h.rewindButtonLabel(1)).toBe('Undo 1 change');
      expect(h.rewindButtonLabel(null)).toBe('Undo all changes');
    });
  });
});

describe('page wiring', () => {
  const read = (file: string): string => readFileSync(path.join(publicDir, file), 'utf8');

  it('lives only on the GM page', () => {
    expect(read('app.js')).toContain("from './changes-everyone.js'");
    expect(read('index.html')).toContain('id="changes-tab-everyone"');
    expect(read('index.html')).toContain('id="undo-backdrop"');
    for (const file of ['player.html', 'player.js']) {
      const text = read(file);
      expect(text).not.toContain('list-changes');
      expect(text).not.toContain('plan-undo-changes');
      expect(text).not.toContain('changes-everyone');
    }
  });

  it('hides the tab unless the bridge has list-changes', () => {
    const app = read('app.js');
    expect(app).toContain("toolCatalog.some(t => t.name === 'list-changes')");
    expect(app).toContain('els.changesToolbar.hidden = !everyoneSupported');
  });

  it('applies through the same guarded apply-planned-change and plans with plan-undo-changes', () => {
    const app = read('app.js');
    expect(app).toContain("callReadTool('plan-undo-changes'");
    expect(app).toContain("'apply-planned-change',");
    expect(app).toContain("callReadTool('list-changes'");
  });
});
