import { describe, expect, it } from 'vitest';
import {
  cooldownOver,
  naturalD20,
  parseStingerMode,
  STINGER_COOLDOWN_MS,
  stingerFor,
  stingerText,
} from './stinger-model.js';

const d20 = (...results: Array<number | { result: number; active: boolean }>): unknown[] => [
  {
    dice: [
      {
        faces: 20,
        results: results.map(r => (typeof r === 'number' ? { result: r, active: true } : r)),
      },
    ],
  },
];

describe('stinger model', () => {
  it('reads the kept natural d20 and ignores a dropped die', () => {
    expect(naturalD20(d20(20))).toBe(20);
    expect(naturalD20(d20({ result: 1, active: false }, 14))).toBe(14);
    expect(naturalD20([{ dice: [{ faces: 6, results: [{ result: 6 }] }] }])).toBeNull();
    expect(naturalD20(undefined)).toBeNull();
  });

  it('picks the stinger by mode and roll type', () => {
    expect(stingerFor('both', 'attack', d20(20))).toBe('crit');
    expect(stingerFor('both', 'save', d20(1))).toBe('fumble');
    expect(stingerFor('crits', 'attack', d20(1))).toBeNull();
    expect(stingerFor('crits', 'attack', d20(20))).toBe('crit');
    expect(stingerFor('off', 'attack', d20(20))).toBeNull();
    expect(stingerFor('both', 'check', d20(20))).toBeNull();
    expect(stingerFor('both', 'damage', d20(20))).toBeNull();
    expect(stingerFor('both', 'attack', d20(12))).toBeNull();
  });

  it('allows one stinger per cool-down', () => {
    expect(cooldownOver(1000, null)).toBe(true);
    expect(cooldownOver(1000 + STINGER_COOLDOWN_MS - 1, 1000)).toBe(false);
    expect(cooldownOver(1000 + STINGER_COOLDOWN_MS, 1000)).toBe(true);
  });

  it('falls back to the default mode and words the text', () => {
    expect(parseStingerMode('crits')).toBe('crits');
    expect(parseStingerMode('nonsense')).toBe('both');
    expect(stingerText('crit', 'Ebbe').small).toContain('Ebbe');
    expect(stingerText('fumble', '').big).toBe('FUMBLE!');
  });
});
