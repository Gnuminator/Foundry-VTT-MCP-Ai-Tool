import { describe, expect, it } from 'vitest';

import {
  COMMON_CARD_IDS,
  HIGH_CARD_IDS,
  POSITION_DECK,
  TAROKKA_POSITIONS,
  deckOf,
  defaultCardName,
  rollReading,
} from './deck.js';

describe('Tarokka deck', () => {
  it('has 40 common and 14 high cards with tarokka-reading ids', () => {
    expect(COMMON_CARD_IDS).toHaveLength(40);
    expect(HIGH_CARD_IDS).toHaveLength(14);
    expect(COMMON_CARD_IDS.slice(0, 2)).toEqual(['swords-1', 'swords-2']);
    expect(COMMON_CARD_IDS).toContain('glyphs-master');
    expect(new Set([...COMMON_CARD_IDS, ...HIGH_CARD_IDS]).size).toBe(54);
    expect(deckOf('coins-9')).toBe('common');
    expect(deckOf('broken-one')).toBe('high');
    expect(deckOf('swords-10')).toBeNull();
  });

  it('gives plain default names', () => {
    expect(defaultCardName('swords-7')).toBe('Seven of Swords');
    expect(defaultCardName('glyphs-master')).toBe('Master of Glyphs');
    expect(defaultCardName('broken-one')).toBe('Broken One');
    expect(defaultCardName('raven')).toBe('Raven');
  });
});

describe('rollReading', () => {
  it('deals 3 distinct common and 2 distinct high cards', () => {
    for (let i = 0; i < 200; i++) {
      const reading = rollReading();
      const cards = TAROKKA_POSITIONS.map(p => reading[p]);
      expect(new Set(cards).size).toBe(5);
      for (const p of TAROKKA_POSITIONS) expect(deckOf(reading[p])).toBe(POSITION_DECK[p]);
    }
  });

  it('draws from the cards still available', () => {
    // Always the first available card: the first three commons, the first two crowns.
    expect(rollReading(() => 0)).toEqual({
      tome: 'swords-1',
      holySymbol: 'swords-2',
      sunsword: 'swords-3',
      ally: 'artifact',
      strahdLocation: 'beast',
    });
    expect(rollReading(max => max - 1)).toMatchObject({
      tome: 'glyphs-master',
      holySymbol: 'glyphs-9',
      ally: 'tempter',
      strahdLocation: 'seer',
    });
    expect(() => rollReading(max => max)).toThrow(/out of range/);
  });
});
