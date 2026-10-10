// get-party: the lantern crew. `partyOf(n)` gives a party of n characters (up to eight) for the
// "eight PCs" and phone-width stories; the first two are the ones with something to show (a
// condition, a character down).
const NAMES = [
  'Aldric',
  'Brenna',
  'Cormac',
  'Delphine',
  'Eilis',
  'Fenwick',
  'Galen',
  'Hestia',
] as const;

const member = (i: number): Record<string, unknown> => {
  const name = NAMES[i] ?? `Crew member ${i + 1}`;
  const max = 20 + i * 2;
  return {
    actorId: `a${i + 1}`,
    uuid: `Actor.a${i + 1}`,
    name,
    type: 'character',
    level: 3,
    hp: { value: i === 1 ? 0 : max - i * 3, max, temp: i === 2 ? 5 : 0 },
    ac: 13 + (i % 4),
    passivePerception: 10 + (i % 5),
    exhaustion: i === 1 ? 1 : 0,
    hitDice: i === 0 ? { value: 2, max: 3 } : null,
    deathSaves: i === 1 ? { success: 1, failure: 1 } : null,
    conditions: i === 0 ? ['Poisoned'] : i === 3 ? ['Frightened', 'Prone'] : [],
    inspiration: i === 0 || i === 4,
    tokens: [{ tokenId: `t${i + 1}`, name, hidden: false, inCombat: i < 3 }],
  };
};

export function partyOf(count: number, groupName = 'The Lantern Crew'): unknown {
  return {
    groups: [
      {
        actorId: 'g1',
        uuid: 'Actor.g1',
        name: groupName,
        primary: true,
        level: 3,
        pace: { value: 'normal', label: 'Normal', slowed: false },
        members: Array.from({ length: count }, (_, i) => member(i)),
        restCards: { short: { type: 'request' } },
      },
    ],
    paceOptions: [
      { value: 'slow', label: 'Slow' },
      { value: 'normal', label: 'Normal' },
      { value: 'fast', label: 'Fast' },
    ],
    scene: { sceneId: 's1', name: 'Harbor Market' },
    encounter: { combatId: 'c1', uuid: 'Combat.c1', round: 2, started: true },
    warnings: [],
  };
}

export const PARTY = partyOf(2);
export const PARTY_OF_EIGHT = partyOf(8);

/** A name and a scene that do not fit a line. */
export const PARTY_LONG_NAMES: unknown = ((): unknown => {
  const party = partyOf(3, 'The Brightwater Harbor Lantern-Keepers and Allied Free Companies') as {
    groups: { members: { name: string }[] }[];
    scene: { name: string };
    warnings: string[];
  };
  const first = party.groups[0]?.members[0];
  if (first) first.name = 'Aldric Thornwood-Brightwater the Third of Harbor Row';
  party.scene.name = 'The Old Mill Road Below the Salt Warehouses (night, fog)';
  party.warnings = ['One actor could not be read.'];
  return party;
})();

export const PARTY_EMPTY: unknown = {
  groups: [],
  paceOptions: [],
  scene: null,
  encounter: null,
  warnings: [],
};
