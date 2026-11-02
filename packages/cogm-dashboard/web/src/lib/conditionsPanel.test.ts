import { describe, expect, it } from 'vitest';

import { conditionButtonLabel, conditionChoices, conditionPlanArgs } from './conditionsPanel';

const PAGE =
  'Compendium.dnd5e.content24.JournalEntry.phbAppendixCRule.JournalEntryPage.QxCrRcgMdUd3gfzz';

describe('the conditions list', () => {
  it('sorts by name and keeps only a real rules-page uuid', () => {
    const choices = conditionChoices({
      conditions: [
        { id: 'prone', name: 'Prone', reference: PAGE },
        { id: 'blinded', name: 'Blinded' },
        { id: 'weird', name: 'Weird', reference: 'javascript:alert(1)' },
        { id: 'other', reference: 'Compendium.x.y.Actor.abcdefghijklmnop' },
        { name: 'no id' },
      ],
    });
    expect(choices.map(c => c.id)).toEqual(['blinded', 'other', 'prone', 'weird']);
    expect(choices.find(c => c.id === 'prone')?.reference).toBe(PAGE);
    expect(choices.find(c => c.id === 'blinded')?.reference).toBeNull();
    expect(choices.find(c => c.id === 'weird')?.reference).toBeNull();
    expect(choices.find(c => c.id === 'other')?.reference).toBeNull();
    expect(choices.find(c => c.id === 'other')?.name).toBe('other');
  });

  it('is empty for an answer it cannot read', () => {
    expect(conditionChoices(null)).toEqual([]);
    expect(conditionChoices({ conditions: 'x' })).toEqual([]);
  });
});

describe('the condition request', () => {
  it('adds or removes on the picked tokens', () => {
    expect(conditionPlanArgs(['t1', 't2'], 'prone', true)).toEqual({
      action: 'condition',
      targets: ['t1', 't2'],
      condition: 'prone',
      active: true,
    });
    expect(conditionPlanArgs(['t1'], 'prone', false).active).toBe(false);
  });

  it('says what the button does', () => {
    const prone = { id: 'prone', name: 'Prone', reference: null };
    expect(conditionButtonLabel(prone, 1, true)).toBe('Add Prone to 1 token');
    expect(conditionButtonLabel(prone, 3, false)).toBe('Remove Prone from 3 tokens');
    expect(conditionButtonLabel(undefined, 2, true)).toBe('Add a condition to 2 tokens');
  });
});
