import { describe, expect, it } from 'vitest';

import type { Combatant, CombatState } from './combat';
import { GLANCE_HREF, ageText, combatRows, isOld, partyRows, sceneName, turnLine } from './glance';
import { optInScreen } from './liveScreen';

describe('ageText', () => {
  it('says how old data is', () => {
    expect(ageText(null, 1000)).toBe('not loaded yet');
    expect(ageText(1000, 2000)).toBe('just now');
    expect(ageText(0, 12_000)).toBe('12 s ago');
    expect(ageText(0, 180_000)).toBe('3 min ago');
    expect(ageText(0, 7_200_000)).toBe('2 h ago');
  });
  it('marks data older than 45 s as old', () => {
    expect(isOld(0, 40_000)).toBe(false);
    expect(isOld(0, 46_000)).toBe(true);
    expect(isOld(null, 0)).toBe(true);
  });
});

describe('partyRows', () => {
  const party = {
    groups: [
      {
        members: [
          {
            actorId: 'a1',
            name: 'Aldric',
            hp: { value: 5, max: 20, temp: 2 },
            conditions: ['Poisoned'],
            exhaustion: 1,
          },
          {
            actorId: 'a2',
            name: 'Brenna',
            hp: { value: 0, max: 18, temp: 0 },
            conditions: [],
            exhaustion: 0,
          },
          { name: 'No hp' },
          'junk',
        ],
      },
    ],
  };
  it('reads hit points, conditions and exhaustion', () => {
    const rows = partyRows(party);
    expect(rows.map(r => r.name)).toEqual(['Aldric', 'Brenna', 'No hp']);
    expect(rows[0]).toMatchObject({ hp: '5/20 +2', tone: 'low', down: false });
    expect(rows[0]?.conditions).toEqual(['Poisoned', 'Exhaustion 1']);
    expect(rows[1]?.down).toBe(true);
    expect(rows[2]?.hp).toBe('–');
  });
  it('gives nothing for a shape it does not know', () => {
    expect(partyRows(null)).toEqual([]);
    expect(partyRows({ groups: [] })).toEqual([]);
    expect(partyRows({ groups: [{}] })).toEqual([]);
  });
});

const combatant = (id: string, over: Partial<Combatant> = {}): Combatant => ({
  id,
  name: id,
  initiative: 10,
  isCurrentTurn: false,
  hp: { value: 10, max: 10, temp: 0 },
  conditions: [],
  isPC: false,
  category: 'enemy',
  defeated: false,
  deathSaves: null,
  boss: null,
  tokenId: null,
  tokenUuid: null,
  img: null,
  ...over,
});

describe('combatRows and turnLine', () => {
  const combat: CombatState = {
    active: true,
    round: 2,
    turn: 1,
    current: null,
    combatants: [
      combatant('Goblin'),
      combatant('Brenna', { isPC: true, category: 'pc', isCurrentTurn: true }),
    ],
  };
  it('keeps the order and marks the current turn', () => {
    const rows = combatRows(combat);
    expect(rows?.map(r => [r.name, r.current, r.side])).toEqual([
      ['Goblin', false, 'enemy'],
      ['Brenna', true, 'pc'],
    ]);
    expect(turnLine(combat)).toBe("Round 2, Brenna's turn");
  });
  it('is null with no fight', () => {
    expect(combatRows(null)).toBeNull();
    expect(combatRows({ ...combat, active: false })).toBeNull();
    expect(turnLine(null)).toBe('');
  });
});

describe('sceneName', () => {
  it('reads the name', () => {
    expect(sceneName({ name: 'Castle gate' })).toBe('Castle gate');
    expect(sceneName({ name: '' })).toBeNull();
    expect(sceneName(null)).toBeNull();
  });
});

describe('the glance address', () => {
  it('is picked by ?glance=1 and not by anything else', () => {
    expect(optInScreen('/', new URL(GLANCE_HREF, 'http://x/').search)).toBe('glance');
    expect(optInScreen('/', '?glance=0')).toBeNull();
    expect(optInScreen('/', '?live=1&glance=1')).toBe('live');
  });
});
