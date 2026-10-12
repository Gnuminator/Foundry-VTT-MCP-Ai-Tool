// Fixtures for the combat strip stories: fights as the stream's `combat` event leaves them in the
// cache (lib/combat.ts), and the bridge link in the states the strip cares about. Made up, like
// every fixture here: no campaign names.
import type { Combatant, CombatState } from '../../lib/combat';
import type { BridgeStatus } from '../../lib/stream';

/** A combatant with sensible defaults; `over` sets what a story is about. */
export function combatant(id: string, name: string, over: Partial<Combatant> = {}): Combatant {
  return {
    id,
    name,
    initiative: 10,
    isCurrentTurn: false,
    hp: { value: 20, max: 20, temp: 0 },
    conditions: [],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
    boss: null,
    ...over,
  };
}

const BRANNOC = combatant('pc-brannoc', 'Brannoc', {
  initiative: 19,
  isCurrentTurn: true,
  isPC: true,
  category: 'pc',
  hp: { value: 38, max: 44, temp: 0 },
});
const OGRE = combatant('en-ogre', 'Ogre Brute', {
  initiative: 15,
  hp: { value: 31, max: 59, temp: 0 },
  conditions: ['Prone', 'Poisoned'],
});
const MIRA = combatant('pc-mira', 'Mira', {
  initiative: 13,
  isPC: true,
  category: 'pc',
  hp: { value: 12, max: 27, temp: 5 },
});
const GOBLIN = combatant('en-goblin', 'Goblin Archer', {
  initiative: 9,
  hp: { value: 3, max: 7, temp: 0 },
});
const TAMSIN = combatant('np-tamsin', 'Tamsin', {
  initiative: 6,
  category: 'npc',
  hp: { value: 9, max: 9, temp: 0 },
});

/** Five combatants, round 3, Brannoc up: no boss, nobody down. */
export const FIGHT: CombatState = {
  active: true,
  round: 3,
  turn: 0,
  current: BRANNOC,
  combatants: [BRANNOC, OGRE, MIRA, GOBLIN, TAMSIN],
};

/** Mira is at zero hit points with two failed death saves and one success. */
export const FIGHT_DEATH_SAVES: CombatState = {
  ...FIGHT,
  combatants: [
    BRANNOC,
    OGRE,
    {
      ...MIRA,
      hp: { value: 0, max: 27, temp: 0 },
      conditions: ['Unconscious'],
      deathSaves: { successes: 1, failures: 2 },
    },
    { ...GOBLIN, defeated: true, hp: { value: 0, max: 7, temp: 0 } },
    TAMSIN,
  ],
};

/** A wyrm with legendary actions, resistances and a lair joins; Brannoc is up, so both prompts show. */
const WYRM = combatant('en-wyrm', 'Ancient Wyrm', {
  initiative: 24,
  hp: { value: 310, max: 367, temp: 0 },
  boss: {
    legendary: { max: 3, spent: 1, remaining: 2 },
    resistances: { max: 3, spent: 2, remaining: 1 },
    lair: { inside: true, initiative: 20 },
  },
});

export const FIGHT_BOSS: CombatState = {
  active: true,
  round: 2,
  turn: 1,
  current: BRANNOC,
  combatants: [WYRM, BRANNOC, MIRA, TAMSIN],
};

/** A fight with nobody in it (the bridge sent an active fight with an empty list). */
export const FIGHT_EMPTY: CombatState = {
  active: true,
  round: 1,
  turn: 0,
  current: null,
  combatants: [],
};

/** The bridge link as the stream reports it. */
const LINK: BridgeStatus = {
  controlChannel: 'connected',
  foundry: 'reachable',
  lastError: null,
  lastPollAt: null,
  foundryDownSince: null,
};

export const BRIDGE_UP: BridgeStatus = LINK;

/** Foundry's module is not connected to the bridge: the fight on screen may be old. */
export const BRIDGE_AWAY: BridgeStatus = {
  ...LINK,
  foundry: 'unreachable',
  lastError: 'Foundry module not connected',
  foundryDownSince: '2026-10-08T19:10:00.000Z',
};
