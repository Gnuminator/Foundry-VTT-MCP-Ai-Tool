/**
 * The Tarokka deck as neutral ids (no card meanings, no adventure text).
 *
 * Ids match the `tarokka-reading` module (deck.js in 1.0.3): 40 common cards
 * `<suit>-<1..9|master>` for the suits swords, stars, coins and glyphs, and 14
 * high cards ("crowns"). A reading is 3 distinct common cards (tome, holy
 * symbol, sunsword) and 2 distinct high cards (ally, Strahd's location).
 */
import { randomInt } from 'crypto';

export const COMMON_SUITS = ['swords', 'stars', 'coins', 'glyphs'] as const;
export const COMMON_VALUES = ['1', '2', '3', '4', '5', '6', '7', '8', '9', 'master'] as const;
export const HIGH_CARD_IDS = [
  'artifact',
  'beast',
  'broken-one',
  'dark-lord',
  'donjon',
  'executioner',
  'ghost',
  'horseman',
  'innocent',
  'marionette',
  'mists',
  'raven',
  'seer',
  'tempter',
] as const;

export const COMMON_CARD_IDS: readonly string[] = COMMON_SUITS.flatMap(suit =>
  COMMON_VALUES.map(value => `${suit}-${value}`)
);

export const TAROKKA_POSITIONS = [
  'tome',
  'holySymbol',
  'sunsword',
  'ally',
  'strahdLocation',
] as const;
export type TarokkaPosition = (typeof TAROKKA_POSITIONS)[number];

/** Which deck each position draws from. */
export const POSITION_DECK: Record<TarokkaPosition, 'common' | 'high'> = {
  tome: 'common',
  holySymbol: 'common',
  sunsword: 'common',
  ally: 'high',
  strahdLocation: 'high',
};

/** Neutral labels for the positions. */
export const POSITION_LABELS: Record<TarokkaPosition, string> = {
  tome: 'Tome',
  holySymbol: 'Holy symbol',
  sunsword: 'Sunsword',
  ally: 'Ally',
  strahdLocation: "Strahd's location",
};

export function isTarokkaPosition(value: unknown): value is TarokkaPosition {
  return (TAROKKA_POSITIONS as readonly unknown[]).includes(value);
}

export function deckOf(cardId: string): 'common' | 'high' | null {
  if (COMMON_CARD_IDS.includes(cardId)) return 'common';
  if ((HIGH_CARD_IDS as readonly string[]).includes(cardId)) return 'high';
  return null;
}

const VALUE_WORDS: Record<string, string> = {
  '1': 'One',
  '2': 'Two',
  '3': 'Three',
  '4': 'Four',
  '5': 'Five',
  '6': 'Six',
  '7': 'Seven',
  '8': 'Eight',
  '9': 'Nine',
  master: 'Master',
};

function titleCase(words: string): string {
  return words
    .split('-')
    .map(w => (w ? w[0].toUpperCase() + w.slice(1) : w))
    .join(' ');
}

/**
 * A plain default name from the id ("Seven of Swords", "Broken One"). The GM's
 * own names (vault overrides or the provider module's localization) win.
 */
export function defaultCardName(cardId: string): string {
  const dash = cardId.lastIndexOf('-');
  const suit = cardId.slice(0, dash);
  const value = cardId.slice(dash + 1);
  if ((COMMON_SUITS as readonly string[]).includes(suit) && VALUE_WORDS[value]) {
    return `${VALUE_WORDS[value]} of ${titleCase(suit)}`;
  }
  return titleCase(cardId);
}

/** Uniform integer in [0, max) (crypto RNG by default; injectable for tests). */
export type RandomIndex = (max: number) => number;

/** Deal a reading: distinct cards, each position from its own deck. */
export function rollReading(
  random: RandomIndex = (max): number => randomInt(max)
): Record<TarokkaPosition, string> {
  const used = new Set<string>();
  const draw = (deck: readonly string[]): string => {
    const available = deck.filter(id => !used.has(id));
    const index = random(available.length);
    const card = available[index];
    if (card === undefined) throw new Error('Random index out of range');
    used.add(card);
    return card;
  };
  const out = {} as Record<TarokkaPosition, string>;
  for (const position of TAROKKA_POSITIONS) {
    out[position] = draw(POSITION_DECK[position] === 'common' ? COMMON_CARD_IDS : HIGH_CARD_IDS);
  }
  return out;
}
