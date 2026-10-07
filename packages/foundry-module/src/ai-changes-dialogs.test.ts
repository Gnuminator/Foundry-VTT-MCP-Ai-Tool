/**
 * Tests for the Changes window's undo dialogs (I-109 part 4): reading a plan, and the wording,
 * buttons and escaping of each dialog.
 */
import { describe, expect, it } from 'vitest';
import {
  ACTION_CANCEL,
  ACTION_YES,
  everythingSinceDialog,
  laterChoiceDialog,
  parsePlan,
  redoDialog,
  rewindFirstDialog,
  rewindSecondDialog,
  undoPlanDialog,
  type UndoPlan,
} from './ai-changes-dialogs.js';
import { buildChangeRow, type ChangeEntry } from './ai-changes-model.js';

const at = new Date(2026, 9, 6, 9, 5).toISOString();

const row = buildChangeRow({
  id: 'act:a1',
  kind: 'human',
  at,
  by: 'Ireena',
  userId: 'u1',
  summary: 'Ireena: HP 10 -> 5',
  lines: [],
  feature: '',
  mode: 'apply',
  requestedBy: '',
  thing: 'Ireena',
  canUndo: true,
  undone: false,
  undoneBy: '',
} satisfies ChangeEntry);

function plan(over: Partial<UndoPlan> = {}): UndoPlan {
  return {
    planId: 'p1',
    summary: 'Undo: Ireena: HP 10 -> 5',
    count: 1,
    lines: ['Actor "Ireena": HP 5 -> 10'],
    notes: [],
    later: [],
    confirmDestructive: false,
    ...over,
  };
}

describe('parsePlan', () => {
  it('reads the plan id, the lines apart from the notes, the later changes and the confirm flag', () => {
    const p = parsePlan({
      planId: 'p9',
      summary: 'Rewind the table to 09:05: 3 changes',
      scope: 'world-since',
      diff: [
        { kind: 'update', text: 'Actor "Ireena": HP 5 -> 10' },
        { kind: 'note', text: 'Kept, changed later: Ireena: HP stays 8' },
        { kind: 'update', text: '   ' },
        null,
      ],
      later: [{ id: 'act:b', at, by: 'Danni', summary: 'Wolf: 2 damage' }, { summary: 'no id' }],
      requires: { confirm: true, confirmDestructive: true },
    });
    expect(p).toEqual({
      planId: 'p9',
      summary: 'Rewind the table to 09:05: 3 changes',
      count: 3,
      lines: ['Actor "Ireena": HP 5 -> 10'],
      notes: ['Kept, changed later: Ireena: HP stays 8'],
      later: [{ id: 'act:b', at, by: 'Danni', summary: 'Wolf: 2 damage' }],
      confirmDestructive: true,
    });
  });

  it('prefers the count the backend sends, and has none when it says nothing', () => {
    expect(parsePlan({ planId: 'p', count: 4, summary: 'x: 2 changes' }).count).toBe(4);
    expect(parsePlan({ planId: 'p', summary: 'Undo: one thing' }).count).toBeNull();
  });

  it('refuses an answer without a plan id', () => {
    expect(() => parsePlan({})).toThrow(/did not return an undo plan/);
    expect(() => parsePlan(null)).toThrow(/did not return an undo plan/);
  });
});

describe('the dialogs', () => {
  it('undo: names the change, lists its lines and notes, Undo and Cancel', () => {
    const d = undoPlanDialog(row, plan({ notes: ['Kept, changed later: HP stays 8'] }));
    expect(d.content).toContain('Ireena: HP 10 -&gt; 5');
    expect(d.content).toContain('<li>Actor &quot;Ireena&quot;: HP 5 -&gt; 10</li>');
    expect(d.content).toContain('Kept, changed later: HP stays 8');
    expect(d.buttons.map(b => [b.action, b.label])).toEqual([
      [ACTION_YES, 'Undo'],
      [ACTION_CANCEL, 'Cancel'],
    ]);
  });

  it('redo: says what comes back', () => {
    const d = redoDialog(row);
    expect(d.content).toContain('Bring this change back?');
    expect(d.content).toContain('Ireena: HP 10 -&gt; 5');
    expect(d.buttons.map(b => b.label)).toEqual(['Redo', 'Cancel']);
  });

  it('later changes: "not the latest", who and what came after, three buttons, rewind under Advanced', () => {
    const d = laterChoiceDialog(row, [
      { id: 'act:b', at, by: 'Danni', summary: 'Ireena: HP 5 -> 3' },
      { id: 'chg', at, by: 'AI', summary: '<b>Heal</b>' },
    ]);
    expect(d.content).toContain('This is not the latest change to Ireena.');
    expect(d.content).toContain('<li>Danni: Ireena: HP 5 -&gt; 3 (09:05)</li>');
    expect(d.content).toContain('&lt;b&gt;Heal&lt;/b&gt;');
    expect(d.buttons.map(b => b.label)).toEqual(['Just this', 'Everything since', 'Cancel']);
    // The fourth choice is a button inside a collapsed (no `open`) Advanced disclosure.
    expect(d.content).toMatch(
      /<details class="fmb-ai-advanced"><summary>Advanced<\/summary>[\s\S]*data-choice="rewind"[\s\S]*Rewind the whole table to here/
    );
    expect(d.content).not.toMatch(/<details[^>]* open/);
  });

  it('later changes: falls back to a plain name for the thing', () => {
    const d = laterChoiceDialog({ ...row, thing: '' }, [{ id: 'x', at, by: '', summary: 's' }]);
    expect(d.content).toContain('latest change to the same thing');
    expect(d.content).toContain('<li>Someone: s (09:05)</li>');
  });

  it('everything since: the count and the full list', () => {
    const d = everythingSinceDialog(row, plan({ count: 3, lines: ['a', 'b', 'c'] }));
    expect(d.content).toContain('This undoes 3 changes to Ireena');
    expect(d.content.match(/<li>/g)).toHaveLength(3);
    expect(d.buttons[0]).toMatchObject({ action: ACTION_YES, label: 'Undo everything since' });
  });

  it('rewind step 1: "N changes by everyone at the table since TIME", with Cancel as the default', () => {
    const d = rewindFirstDialog(row, plan({ count: 12, lines: ['a'] }));
    expect(d.content).toContain('This undoes 12 changes by everyone at the table since 09:05.');
    expect(d.buttons.find(b => b.default)?.action).toBe(ACTION_CANCEL);
  });

  it('rewind step 2: asks again and names the count on the button', () => {
    const d = rewindSecondDialog(plan({ count: 12 }));
    expect(d.content).toContain('Are you sure?');
    expect(d.buttons[0]).toMatchObject({ action: ACTION_YES, label: 'Undo all 12 changes' });
    expect(rewindSecondDialog(plan({ count: 1 })).buttons[0]?.label).toBe('Undo 1 change');
    expect(rewindSecondDialog(plan({ count: null })).buttons[0]?.label).toBe('Undo all changes');
  });
});
