import { describe, it, expect } from 'vitest';
import {
  redactCombatantForPlayer,
  redactCombatForPlayer,
  redactEventForPlayer,
  redactEventsForPlayer,
  redactWorldForPlayer,
  redactStatusForPlayer,
  PUBLIC_EVENT_TYPES,
} from './redact.js';
import type { PlayerViewConfig } from './config.js';
import type { Combatant, CombatState, SessionEvent } from './feed/types.js';

const VIEW: PlayerViewConfig = { showEnemyConditions: true, showEnemyHpBands: false };

function combatant(overrides: Partial<Combatant> = {}): Combatant {
  return {
    id: 'c1',
    name: 'Goblin',
    initiative: 12,
    isCurrentTurn: false,
    actedThisRound: false,
    hp: { value: 7, max: 10, temp: 0 },
    conditions: ['prone'],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
    ...overrides,
  };
}

describe('redactCombatantForPlayer — enemies', () => {
  it('nulls exact enemy HP and death saves', () => {
    const r = redactCombatantForPlayer(combatant(), VIEW);
    expect(r.hp).toBeNull();
    expect(r.deathSaves).toBeNull();
  });

  it('keeps the public combat-order fields', () => {
    const r = redactCombatantForPlayer(combatant({ initiative: 15, isCurrentTurn: true }), VIEW);
    expect(r.name).toBe('Goblin');
    expect(r.initiative).toBe(15);
    expect(r.isCurrentTurn).toBe(true);
    expect(r.category).toBe('enemy');
  });

  it('keeps enemy conditions only when enabled', () => {
    expect(redactCombatantForPlayer(combatant(), VIEW).conditions).toEqual(['prone']);
    const hidden = redactCombatantForPlayer(combatant(), { ...VIEW, showEnemyConditions: false });
    expect(hidden.conditions).toEqual([]);
  });

  it('exposes a coarse HP band only when enabled — never exact numbers', () => {
    const off = redactCombatantForPlayer(combatant({ hp: { value: 3, max: 10, temp: 0 } }), VIEW);
    expect(off.hpBand).toBeNull();
    const on = redactCombatantForPlayer(combatant({ hp: { value: 2, max: 10, temp: 0 } }), {
      ...VIEW,
      showEnemyHpBands: true,
    });
    expect(on.hpBand).toBe('critical');
    expect(on.hp).toBeNull();
  });

  it('bands: healthy / bloodied / critical / down', () => {
    const band = (value: number): string | null =>
      redactCombatantForPlayer(combatant({ hp: { value, max: 10, temp: 0 } }), {
        ...VIEW,
        showEnemyHpBands: true,
      }).hpBand;
    expect(band(10)).toBe('healthy');
    expect(band(5)).toBe('bloodied');
    expect(band(2)).toBe('critical');
    expect(band(0)).toBe('down');
  });
});

describe('redactCombatantForPlayer — PCs', () => {
  it('keeps full PC HP, conditions, and death saves (shared at the table)', () => {
    const pc = combatant({
      isPC: true,
      category: 'pc',
      name: 'Hero',
      hp: { value: 18, max: 24, temp: 2 },
      deathSaves: { successes: 1, failures: 0 },
    });
    const r = redactCombatantForPlayer(pc, VIEW);
    expect(r.hp).toEqual({ value: 18, max: 24, temp: 2 });
    expect(r.deathSaves).toEqual({ successes: 1, failures: 0 });
  });
});

describe('redactCombatForPlayer', () => {
  it('returns null for no combat', () => {
    expect(redactCombatForPlayer(null, VIEW)).toBeNull();
  });

  it('drops GM-hidden combatants', () => {
    const combat: CombatState = {
      active: true,
      round: 2,
      turn: 0,
      current: combatant({ id: 'pc', isPC: true }),
      combatants: [
        combatant({ id: 'pc', isPC: true, name: 'Hero' }),
        combatant({ id: 'ambush', name: 'Hidden Assassin', hidden: true }),
      ],
    };
    const r = redactCombatForPlayer(combat, VIEW)!;
    expect(r.combatants.map(c => c.id)).toEqual(['pc']);
  });

  it('nulls current when the active combatant is hidden', () => {
    const combat: CombatState = {
      active: true,
      round: 1,
      turn: 0,
      current: combatant({ id: 'lurker', hidden: true }),
      combatants: [combatant({ id: 'lurker', hidden: true })],
    };
    const r = redactCombatForPlayer(combat, VIEW)!;
    expect(r.current).toBeNull();
    expect(r.combatants).toEqual([]);
  });
});

describe('redactEventForPlayer', () => {
  function event(overrides: Partial<SessionEvent> = {}): SessionEvent {
    return {
      id: 'e1',
      timestamp: '2026-06-15T00:00:00.000Z',
      timestampMs: 1,
      eventType: 'damage',
      actorName: 'Goblin',
      actorId: 'a1',
      description: 'Goblin took 5 damage',
      details: { amount: 5, from: 12, to: 7, source: 'sword' },
      ...overrides,
    };
  }

  it('drops structured details (the exact HP from/to leak vector)', () => {
    const r = redactEventForPlayer(event())!;
    expect(r.details).toEqual({});
    expect(r.description).toBe('Goblin took 5 damage');
  });

  it('drops events whose type is not on the public allow-list', () => {
    expect(redactEventForPlayer(event({ eventType: 'gm-note' }))).toBeNull();
    expect(redactEventForPlayer(event({ eventType: 'whisper' }))).toBeNull();
  });

  it('every public type passes', () => {
    for (const t of PUBLIC_EVENT_TYPES) {
      expect(redactEventForPlayer(event({ eventType: t }))).not.toBeNull();
    }
  });

  it('redactEventsForPlayer filters + strips a mixed list', () => {
    const out = redactEventsForPlayer([
      event({ id: 'a', eventType: 'damage' }),
      event({ id: 'b', eventType: 'gm-note' }),
      event({ id: 'c', eventType: 'death', details: { secret: true } }),
    ]);
    expect(out.map(e => e.id)).toEqual(['a', 'c']);
    expect(out.every(e => Object.keys(e.details).length === 0)).toBe(true);
  });
});

describe('redactWorldForPlayer / redactStatusForPlayer', () => {
  it('strips GM names from world', () => {
    const r = redactWorldForPlayer({
      title: 'Frostmaiden',
      systemId: 'dnd5e',
      systemVersion: '3.3',
      foundryVersion: '12',
      gmNames: ['Alice'],
    })!;
    expect(r).not.toHaveProperty('gmNames');
    expect(r.title).toBe('Frostmaiden');
  });

  it('strips lastError from status', () => {
    const r = redactStatusForPlayer({
      controlChannel: 'connected',
      foundry: 'reachable',
      lastError: 'secret internal detail',
      lastPollAt: 'now',
    });
    expect(r).not.toHaveProperty('lastError');
    expect(r.foundry).toBe('reachable');
  });
});
