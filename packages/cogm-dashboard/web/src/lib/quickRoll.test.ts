import { describe, expect, it } from 'vitest';

import {
  DEFAULT_PICK,
  cleanPick,
  pickLabel,
  rollArgs,
  rollOptions,
  sentSummary,
} from './quickRoll';

describe('rollArgs', () => {
  it('asks for an ability check as an ability roll', () => {
    expect(rollArgs({ ...DEFAULT_PICK, what: 'check:str' }, 'Ilvara')).toEqual({
      rollType: 'ability',
      rollTarget: 'str',
      targetPlayer: 'Ilvara',
      isPublic: false,
      userConfirmedVisibility: true,
    });
  });

  it('sends a save, a lower-case skill, the DC and an advantage choice', () => {
    const pick = { what: 'save:dex', dc: '15', isPublic: true, advantage: 'advantage' } as const;
    expect(rollArgs(pick, 'Ivarro')).toMatchObject({
      rollType: 'save',
      rollTarget: 'dex',
      isPublic: true,
      dc: 15,
      flavor: 'DC 15',
      advantage: 'advantage',
    });
    expect(rollArgs({ ...DEFAULT_PICK, what: 'skill:Sleight of Hand' }, 'x')).toMatchObject({
      rollType: 'skill',
      rollTarget: 'sleight of hand',
    });
  });

  it('leaves out an empty or zero DC', () => {
    expect(rollArgs({ ...DEFAULT_PICK, dc: '' }, 'x')).not.toHaveProperty('dc');
    expect(rollArgs({ ...DEFAULT_PICK, dc: '0' }, 'x')).not.toHaveProperty('dc');
  });
});

describe('cleanPick', () => {
  it('repairs anything unknown', () => {
    expect(cleanPick(null)).toEqual(DEFAULT_PICK);
    expect(cleanPick({ what: 'bogus', dc: 'abc', advantage: 'x' })).toEqual(DEFAULT_PICK);
    expect(cleanPick({ what: 'save:wis', dc: '12', isPublic: true })).toMatchObject({
      what: 'save:wis',
      dc: '12',
      isPublic: true,
    });
  });
});

describe('labels', () => {
  it('names every option once', () => {
    const values = rollOptions().flatMap(g => g.options.map(o => o.value));
    expect(new Set(values).size).toBe(values.length);
    expect(values).toHaveLength(30);
  });

  it('words the toast', () => {
    const pick = { ...DEFAULT_PICK, what: 'save:dex', dc: '14' };
    expect(pickLabel(pick)).toBe('Dexterity save');
    expect(sentSummary(pick, ['Ilvara'], [])).toBe('✓ Sent: Dexterity save DC 14 to Ilvara');
    expect(sentSummary(pick, ['A', 'B'], [{ name: 'C', error: 'offline' }])).toBe(
      '✓ Sent: Dexterity save DC 14 to 2 characters. Not sent: C: offline'
    );
    expect(sentSummary(pick, [], [{ name: 'C', error: 'offline' }])).toBe(
      '✗ Dexterity save DC 14 not sent. C: offline'
    );
  });

  it('says a request with no answer may have been sent', () => {
    const pick = { ...DEFAULT_PICK, what: 'save:dex', dc: '14' };
    const late = { name: 'C', error: 'no answer from Foundry', maybeSent: true };
    expect(sentSummary(pick, [], [late])).toBe(
      '✗ Dexterity save DC 14 not confirmed. C: no answer from Foundry. It may have been sent, check chat.'
    );
    expect(sentSummary(pick, ['A'], [late, { name: 'D', error: 'offline' }])).toBe(
      '✓ Sent: Dexterity save DC 14 to A. Not sent: C: no answer from Foundry. It may have been sent, check chat.; D: offline'
    );
  });
});
