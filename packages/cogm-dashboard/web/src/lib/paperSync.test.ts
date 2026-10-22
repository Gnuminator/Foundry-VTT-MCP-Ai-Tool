// The "After a paper night" form's request logic: only what the GM changed is sent, and a number
// the sheet cannot hold is a problem before anything is planned. Pure functions, no DOM.
import { describe, expect, it } from 'vitest';

import {
  buildRequest,
  initialDraft,
  isEdited,
  localDate,
  planLines,
  resourceRows,
  sheetConditions,
  wholeNumber,
  type SheetLike,
} from './paperSync';

function sheet(overrides: Partial<SheetLike> = {}): SheetLike {
  return {
    id: 'a1',
    name: 'Aldric',
    classes: [{ name: 'Cleric', levels: 5, hitDie: 'd8' }],
    hp: { value: 31, max: 40, temp: 0 },
    hitDice: { value: 3, max: 5 },
    exhaustion: 0,
    inspiration: false,
    deathSaves: { success: 0, failure: 0 },
    conditions: ['Poisoned'],
    slots: [
      { level: 1, value: 4, max: 4, pact: false },
      { level: 2, value: 3, max: 3, pact: false },
    ],
    features: [
      { id: 'f1', name: 'Channel Divinity', uses: { value: 1, max: 2 } },
      { id: 'f2', name: 'Darkvision', uses: null },
    ],
    inventory: [
      { id: 'i1', name: 'Rope', quantity: 1, uses: null },
      { id: 'i2', name: 'Wand of Fireballs', quantity: 1, uses: { value: 5, max: 7 } },
    ],
    currency: { pp: 0, gp: 112, ep: 0, sp: 4, cp: 0 },
    ...overrides,
  };
}

describe('wholeNumber', () => {
  it('takes digits only', () => {
    expect(wholeNumber(' 18 ')).toBe(18);
    expect(wholeNumber('0')).toBe(0);
    for (const bad of ['', ' ', '-1', '1.5', '1e3', 'ten', '12 gp']) {
      expect(wholeNumber(bad), bad).toBeNull();
    }
  });
});

describe('initialDraft', () => {
  it('shows what Foundry has now, with nothing to send', () => {
    const s = sheet();
    const draft = initialDraft(s);
    expect(draft.hp).toBe('31');
    expect(draft.slots).toEqual({ '1': '4', '2': '3' });
    expect(draft.hitDice).toEqual({ '': '3' });
    expect(draft.resources).toEqual({ 'Channel Divinity': '1', 'Wand of Fireballs': '5' });
    expect(draft.coins['gp']).toBe('112');
    expect(draft.conditions).toEqual(['poisoned']);
    expect(draft.inventory).toEqual({ i1: '1', i2: '1' });
    expect(isEdited(s, draft)).toBe(false);
    expect(buildRequest(s, draft)).toEqual({ ok: true, request: { actor: 'a1' }, changed: 0 });
  });

  it('leaves hit dice empty per class for a multiclass character', () => {
    const s = sheet({
      classes: [
        { name: 'Cleric', levels: 3 },
        { name: 'Rogue', levels: 2 },
      ],
    });
    expect(initialDraft(s).hitDice).toEqual({ Cleric: '', Rogue: '' });
  });

  it('keeps only the conditions a paper sheet can carry', () => {
    expect(sheetConditions(sheet({ conditions: ['Poisoned', 'Concentrating', 'Prone'] }))).toEqual([
      'poisoned',
      'prone',
    ]);
  });
});

describe('resourceRows', () => {
  it('lists features and items with charges once each', () => {
    const s = sheet({
      features: [{ id: 'f1', name: 'Wand of Fireballs', uses: { value: 5, max: 7 } }],
    });
    expect(resourceRows(s).map(r => r.name)).toEqual(['Wand of Fireballs']);
  });
});

describe('buildRequest', () => {
  it('sends only the fields the GM changed', () => {
    const s = sheet();
    const draft = initialDraft(s);
    draft.hp = '18';
    draft.slots = { ...draft.slots, '2': '1' };
    draft.coins = { ...draft.coins, gp: '87' };
    draft.inventory = { ...draft.inventory, i1: '0' };
    draft.resources = { ...draft.resources, 'Channel Divinity': '0' };
    draft.hitDice = { '': '2' };
    draft.conditions = [];
    draft.inspiration = true;
    draft.exhaustion = '1';
    draft.resetDeathSaves = true;
    draft.added = [{ key: 1, uuid: 'Compendium.dnd5e.items.Item.abc', quantity: '2' }];
    expect(buildRequest(s, draft)).toEqual({
      ok: true,
      changed: 11,
      request: {
        actor: 'a1',
        hp: 18,
        slots: { '2': 1 },
        hitDice: [{ left: 2 }],
        resources: [{ name: 'Channel Divinity', value: 0 }],
        coins: { gp: 87 },
        exhaustion: 1,
        conditions: [],
        inspiration: true,
        resetDeathSaves: true,
        inventory: [
          { item: 'i1', quantity: 0 },
          { uuid: 'Compendium.dnd5e.items.Item.abc', quantity: 2 },
        ],
      },
    });
  });

  it('names an added condition set exactly', () => {
    const s = sheet();
    const draft = initialDraft(s);
    draft.conditions = ['prone', 'poisoned'];
    const built = buildRequest(s, draft);
    expect(built.ok && built.request.conditions).toEqual(['poisoned', 'prone']);
  });

  it('sends a typed class for a multiclass character, and nothing for an empty one', () => {
    const s = sheet({
      classes: [
        { name: 'Cleric', levels: 3 },
        { name: 'Rogue', levels: 2 },
      ],
    });
    const draft = initialDraft(s);
    draft.hitDice = { Cleric: '1', Rogue: '' };
    const built = buildRequest(s, draft);
    expect(built.ok && built.request.hitDice).toEqual([{ class: 'Cleric', left: 1 }]);
  });

  it('refuses numbers the sheet cannot hold, listing every one', () => {
    const s = sheet();
    const draft = initialDraft(s);
    draft.hp = '41';
    draft.slots = { ...draft.slots, '1': '5' };
    draft.coins = { ...draft.coins, gp: '-3' };
    draft.exhaustion = '7';
    draft.resources = { ...draft.resources, 'Channel Divinity': '3' };
    draft.tempHp = 'x';
    const built = buildRequest(s, draft);
    expect(built.ok).toBe(false);
    if (!built.ok) {
      expect(built.problems).toEqual([
        'HP: 41 is more than the maximum 40',
        'Temp HP: type a whole number, 0 or more',
        'Level 1 slots: 5 is more than the maximum 4',
        'Channel Divinity: 3 is more than the maximum 2',
        'GP: type a whole number, 0 or more',
        'Exhaustion: 7 is more than the maximum 6',
      ]);
    }
    expect(isEdited(s, draft)).toBe(true);
  });

  it('refuses a new item without a quantity', () => {
    const s = sheet();
    const draft = initialDraft(s);
    draft.added = [
      { key: 1, uuid: 'Item.x', quantity: '0' },
      { key: 2, uuid: '  ', quantity: '' },
    ];
    const built = buildRequest(s, draft);
    expect(built).toEqual({
      ok: false,
      problems: ['New item Item.x: type how many, 1 or more'],
    });
  });

  it('uses the pact key for pact slots', () => {
    const s = sheet({ slots: [{ level: 3, value: 2, max: 2, pact: true }] });
    const draft = initialDraft(s);
    expect(draft.slots).toEqual({ pact: '2' });
    draft.slots = { pact: '0' };
    const built = buildRequest(s, draft);
    expect(built.ok && built.request.slots).toEqual({ pact: 0 });
  });
});

describe('planLines', () => {
  it('lists the changes, then what to check', () => {
    expect(
      planLines({
        changes: [{ line: 'HP 31 to 18 of 40' }, { label: 'Rope' }],
        warnings: ['Rope matched twice'],
      })
    ).toEqual(['HP 31 to 18 of 40', 'Rope', 'Check: Rope matched twice']);
    expect(planLines({})).toEqual([]);
  });
});

describe('localDate', () => {
  it('is the local calendar day', () => {
    expect(localDate(new Date(2026, 10, 29, 23, 30))).toBe('2026-11-29');
    expect(localDate(new Date(2026, 0, 5, 0, 5))).toBe('2026-01-05');
  });
});
