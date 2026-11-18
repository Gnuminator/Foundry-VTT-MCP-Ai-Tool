import { describe, expect, it } from 'vitest';
import {
  cooldownOver,
  naturalD20,
  parseStingerMode,
  planStinger,
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

  it('plans a stinger for the Table user only, never for a whisper, with the alias as name', () => {
    const base = {
      isTableUser: true,
      mode: 'both' as const,
      rollType: 'attack',
      now: 50000,
      lastAt: null,
    };
    const msg = { rolls: d20(20), alias: 'Mysterious figure', speakerActor: { name: 'Strahd' } };
    expect(planStinger(msg, base)).toEqual({ kind: 'crit', who: 'Mysterious figure' });
    expect(planStinger({ ...msg, alias: '' }, base)?.who).toBe('Strahd');
    expect(planStinger(msg, { ...base, isTableUser: false })).toBeNull();
    expect(planStinger({ ...msg, whisper: ['u1'] }, base)).toBeNull();
    expect(planStinger({ ...msg, blind: true }, base)).toBeNull();
    expect(planStinger(msg, { ...base, mode: 'off' })).toBeNull();
    expect(planStinger(msg, { ...base, lastAt: 40000 })).toBeNull();
    expect(planStinger(msg, { ...base, lastAt: 20000 })).not.toBeNull();
  });

  it('falls back to the default mode and words the text', () => {
    expect(parseStingerMode('crits')).toBe('crits');
    expect(parseStingerMode('nonsense')).toBe('both');
    expect(stingerText('crit', 'Ebbe').small).toContain('Ebbe');
    expect(stingerText('fumble', '').big).toBe('FUMBLE!');
  });
});
