import { describe, expect, it } from 'vitest';

import { renderPlayerVault } from './render.js';
import { projectPlayStats } from './stats.js';

const OWN = [{ id: 'abc', name: 'Ilvara' }];

function raw(over: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    worldId: 'w1',
    campaign: {
      sessions: 2,
      playMinutes: 120,
      combats: 3,
      rounds: 9,
      pcDowns: 1,
      npcKills: 4,
      spellsCast: 6,
      rolls: 99,
      crits: 8,
    },
    dice: { d20: [1, 2], byUser: { Danni: { rolls: 1 } } },
    session: { highestRoll: { total: 27, name: 'Ilvara', label: 'Perception' }, gmChanges: 5 },
    pcs: [
      {
        uuid: 'Actor.abc',
        name: 'Ilvara',
        sessions: [1, 2],
        damageTaken: 12,
        damageDealt: 40,
        healingReceived: 3,
        downs: 1,
        kills: 2,
        rolls: 20,
        crits: 2,
        fumbles: 1,
        d20: [1],
        spellsCast: 2,
        slotsSpent: { spell1: 2, pact: 0 },
        resourcesSpent: { 'Secret Wand': 2, Rage: 1 },
        itemsUsed: 1,
        lootGained: { 'Secret Wand': 1 },
        currencyDelta: { gp: -5 },
        xpGained: 50,
      },
      { uuid: 'Actor.other', name: 'Other', damageTaken: 777 },
    ],
    ...over,
  };
}

describe('projectPlayStats', () => {
  it('keeps the allowlist and only the own characters', () => {
    const stats = projectPlayStats(raw(), 'w1', OWN);
    expect(stats).toEqual({
      campaign: {
        sessions: 2,
        playMinutes: 120,
        combats: 3,
        rounds: 9,
        pcDowns: 1,
        npcKills: 4,
        spellsCast: 6,
      },
      pcs: [
        {
          name: 'Ilvara',
          sessions: 2,
          damageTaken: 12,
          healingReceived: 3,
          downs: 1,
          kills: 2,
          spellsCast: 2,
          slotsSpent: { spell1: 2 },
          resourcesSpent: 3,
          itemsUsed: 1,
          currencyDelta: { gp: -5 },
          xpGained: 50,
        },
      ],
    });
    const text = JSON.stringify(stats);
    for (const banned of [
      'highestRoll',
      'Perception',
      'Secret Wand',
      'Other',
      'Danni',
      'w1',
      '777',
      'crits',
      'rolls',
    ]) {
      expect(text).not.toContain(banned);
    }
  });

  it('is null for another world or a malformed answer', () => {
    expect(projectPlayStats(raw(), 'w2', OWN)).toBeNull();
    expect(projectPlayStats(null, 'w1', OWN)).toBeNull();
    expect(projectPlayStats({ worldId: 'w1' }, 'w1', OWN)).toBeNull();
  });

  it('gives campaign totals alone to a player with no character', () => {
    expect(projectPlayStats(raw(), 'w1', [])?.pcs).toEqual([]);
  });
});

describe('stats note', () => {
  const base = {
    worldTitle: 'W',
    player: { userId: 'u1', name: 'Alice' },
    handouts: [],
    sheets: [],
    sessions: [],
    theme: { id: 'default' as never, css: null },
  };

  it('is written and linked only when stats exist', () => {
    expect([...renderPlayerVault(base).keys()]).not.toContain('My stats.md');
    const files = renderPlayerVault({ ...base, stats: projectPlayStats(raw(), 'w1', OWN) });
    const note = files.get('My stats.md') ?? '';
    expect(note).toContain('Damage taken: 12');
    expect(note).toContain('Level 1 slots');
    expect(files.get('Home.md')).toContain('(My%20stats.md)');
  });

  it('labels a level 0 slot key as pact slots, not "Level 0"', () => {
    const answer = raw() as { pcs: Array<Record<string, unknown>> };
    const pcs = answer.pcs.map(pc => ({ ...pc, slotsSpent: { spell0: 1 } }));
    const note =
      renderPlayerVault({
        ...base,
        stats: projectPlayStats({ ...answer, pcs }, 'w1', OWN),
      }).get('My stats.md') ?? '';
    expect(note).toContain('Pact slots');
    expect(note).not.toContain('Level 0');
  });
});
