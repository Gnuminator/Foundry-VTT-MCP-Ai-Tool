import { describe, expect, it } from 'vitest';

import { normalizeFoundryUrl, portraitUrl, withPortraitUrls } from './combat-images.js';
import type { CombatState, Combatant } from './feed/types.js';

const BASE = 'https://play.example.org';

const who = (id: string, img?: string | null): Combatant => ({
  id,
  name: id,
  initiative: 10,
  isCurrentTurn: false,
  actedThisRound: false,
  hp: { value: 5, max: 5, temp: 0 },
  conditions: [],
  isPC: false,
  category: 'npc',
  defeated: false,
  deathSaves: null,
  ...(img === undefined ? {} : { img }),
});

describe('normalizeFoundryUrl', () => {
  it('drops trailing slashes and anything that is not an http(s) address', () => {
    expect(normalizeFoundryUrl(' https://play.example.org/ ')).toBe(BASE);
    expect(normalizeFoundryUrl('http://localhost:30001')).toBe('http://localhost:30001');
    expect(normalizeFoundryUrl('')).toBe('');
    expect(normalizeFoundryUrl('play.example.org')).toBe('');
    expect(normalizeFoundryUrl('javascript:alert(1)')).toBe('');
  });
});

describe('portraitUrl', () => {
  it('joins a Foundry path to the address and encodes it once', () => {
    expect(portraitUrl('tokens/ogre.webp', BASE)).toBe(`${BASE}/tokens/ogre.webp`);
    expect(portraitUrl('/tokens/a b#1.webp', BASE)).toBe(`${BASE}/tokens/a%20b%231.webp`);
    expect(portraitUrl('tokens/a%20b.webp', BASE)).toBe(`${BASE}/tokens/a%20b.webp`);
  });

  it('keeps an absolute http(s) address and drops a relative path with no Foundry address', () => {
    expect(portraitUrl('https://cdn.example/a.png', BASE)).toBe('https://cdn.example/a.png');
    expect(portraitUrl('tokens/a.webp', '')).toBeNull();
  });

  it('refuses other schemes, protocol-relative addresses and non-strings', () => {
    expect(portraitUrl('javascript:alert(1)', BASE)).toBeNull();
    expect(portraitUrl('data:image/png;base64,AAAA', BASE)).toBeNull();
    expect(portraitUrl('//evil.example/a.png', BASE)).toBeNull();
    expect(portraitUrl(undefined, BASE)).toBeNull();
    expect(portraitUrl('', BASE)).toBeNull();
  });
});

describe('withPortraitUrls', () => {
  it('rewrites every combatant and the current one, and passes null through', () => {
    const combat: CombatState = {
      active: true,
      round: 1,
      turn: 0,
      current: who('a', 'tokens/a.webp'),
      combatants: [who('a', 'tokens/a.webp'), who('b'), who('c', null)],
    };
    const out = withPortraitUrls(combat, BASE);
    expect(out?.current?.img).toBe(`${BASE}/tokens/a.webp`);
    expect(out?.combatants.map(c => c.img)).toEqual([`${BASE}/tokens/a.webp`, null, null]);
    expect(combat.combatants[0]?.img).toBe('tokens/a.webp');
    expect(withPortraitUrls(null, BASE)).toBeNull();
  });
});
