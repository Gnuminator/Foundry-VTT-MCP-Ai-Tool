import type { PlayerVisibility } from '@gnuminator/shared';
import { describe, expect, it } from 'vitest';

import type { PlayerViewConfig } from '../config.js';
import type { Combatant, CombatState, SessionEvent } from '../feed/types.js';

import { buildPlayerState, projectCombat, projectEvent, projectEvents } from './projection.js';

const SECRET = 'CANARY-GM-SECRET';
const opts: PlayerViewConfig = { showEnemyHpBands: true, showEnemyConditions: true };

function event(over: Partial<SessionEvent>): SessionEvent {
  return {
    id: 'e1',
    timestamp: '2026-09-28T20:00:00.000Z',
    timestampMs: 1000,
    eventType: 'damage',
    actorName: SECRET,
    actorId: 'a1',
    description: `${SECRET} took 7 damage`,
    details: { amount: 7, from: 20, to: 13, source: SECRET },
    ...over,
  };
}

const pc = { subject: 'pc', tokenVisible: true, playerName: 'Ireena' } as const;
const seenNpc = { subject: 'npc', tokenVisible: true, playerName: 'Hooded figure' } as const;
const unseenNpc = { subject: 'npc', tokenVisible: false, playerName: null } as const;

describe('projectEvent', () => {
  it('drops unknown and GM-only types, and events without a visibility stamp (older modules)', () => {
    for (const eventType of ['gm-roll', 'gm-change', 'journal-created', 'journal-updated', 'x']) {
      expect(projectEvent(event({ eventType, visibility: pc }))).toBeNull();
    }
    expect(projectEvent(event({ eventType: 'damage' }))).toBeNull(); // no visibility
  });

  it('copies no GM fields: only id, time, type and a template text', () => {
    const out = projectEvent(event({ visibility: pc }));
    expect(out).toEqual({
      id: 'e1',
      timestampMs: 1000,
      type: 'damage',
      text: 'Ireena took 7 damage.',
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('gives numbers for PCs only, and names an NPC only when its token is visible', () => {
    expect(projectEvent(event({ visibility: seenNpc }))?.text).toBe('Hooded figure was hit.');
    expect(projectEvent(event({ visibility: unseenNpc }))).toBeNull();
    expect(
      projectEvent(event({ visibility: { subject: 'npc', tokenVisible: true, playerName: null } }))
    ).toBeNull();
    expect(projectEvent(event({ eventType: 'healing', visibility: seenNpc }))?.text).toBe(
      'Hooded figure was healed.'
    );
    expect(projectEvent(event({ eventType: 'death', visibility: seenNpc }))?.text).toBe(
      'Hooded figure went down.'
    );
    expect(projectEvent(event({ eventType: 'stabilize', visibility: seenNpc }))).toBeNull();
  });

  it('shows conditions only by core status id, never the effect name', () => {
    const custom = event({
      eventType: 'condition-applied',
      description: `Ireena gained "${SECRET}"`,
      details: { effectName: SECRET },
      visibility: { ...pc, statuses: [] },
    });
    expect(projectEvent(custom)).toBeNull();
    const core = projectEvent({
      ...custom,
      visibility: { ...pc, statuses: ['prone', 'strahd-mark', 'poisoned'] },
    });
    expect(core?.text).toBe('Ireena is now Prone, Poisoned.');
    expect(JSON.stringify(core)).not.toContain(SECRET);
  });

  it("names a scene by the module's player-facing name, never the event text", () => {
    const scene = event({
      eventType: 'scene-change',
      description: `Scene changed to "${SECRET}"`,
      details: { sceneName: SECRET },
      visibility: { subject: null, tokenVisible: false, playerName: null, sceneName: 'Village' },
    });
    expect(projectEvent(scene)?.text).toBe('Scene: Village.');
  });

  it('keeps the player-safe line of public rolls; resource use for PC spell slots only', () => {
    const roll = event({
      eventType: 'roll',
      description: 'Wolf 1, Bite attack: 1d20 (15) +4 modifier = 19',
      details: { breakdown: `${SECRET} vs AC 12: hit` },
      visibility: seenNpc,
    });
    expect(projectEvent(roll)?.text).toBe('Wolf 1, Bite attack: 1d20 (15) +4 modifier = 19');
    const slot = event({
      eventType: 'resource-spent',
      details: { resource: 'spell3' },
      visibility: pc,
    });
    expect(projectEvent(slot)?.text).toBe('Ireena used a level 3 spell slot.');
    const legendary = event({
      eventType: 'resource-spent',
      details: { resource: 'legact' },
      visibility: seenNpc,
    });
    expect(projectEvent(legendary)).toBeNull();
  });

  it('keeps the newest events up to the limit', () => {
    const many = Array.from({ length: 5 }, (_, i) => event({ id: `e${i}`, visibility: pc }));
    expect(projectEvents(many, 3).map(e => e.id)).toEqual(['e2', 'e3', 'e4']);
  });
});

function combatant(over: Partial<Combatant>): Combatant {
  return {
    id: 'c1',
    name: SECRET,
    initiative: 12,
    isCurrentTurn: false,
    actedThisRound: false,
    hp: { value: 5, max: 20, temp: 0 },
    conditions: [SECRET],
    isPC: false,
    category: 'enemy',
    defeated: false,
    deathSaves: null,
    tokenId: 't1',
    actorId: 'a-npc',
    statuses: ['prone', SECRET],
    ...over,
  };
}

const visibility: PlayerVisibility = {
  schema: 1,
  computedAt: 0,
  pcActorIds: ['a-pc'],
  scene: { id: 's1', name: 'Village' },
  tokens: [
    { tokenId: 't1', actorId: 'a-npc', name: 'Hooded figure', pc: false },
    { tokenId: 't-pc', actorId: 'a-pc', name: 'Ireena', pc: true },
  ],
};

describe('projectCombat', () => {
  const combat: CombatState = {
    active: true,
    round: 2,
    turn: 0,
    current: null,
    combatants: [
      combatant({}),
      combatant({ id: 'c2', tokenId: 't-hidden-token' }), // not visible to players
      combatant({ id: 'c3', tokenId: 't1', hidden: true }), // GM-hidden combatant
      combatant({
        id: 'c4',
        name: 'Ireena',
        tokenId: 't-pc',
        actorId: 'a-pc',
        isPC: true,
        category: 'pc',
        hp: { value: 0, max: 18, temp: 0 },
        deathSaves: { successes: 1, failures: 2 },
      }),
    ],
  };

  it('keeps only visible combatants, named as players see them, with core statuses only', () => {
    const out = projectCombat(combat, visibility, opts);
    expect(out?.combatants.map(c => [c.id, c.name])).toEqual([
      ['c1', 'Hooded figure'],
      ['c4', 'Ireena'],
    ]);
    const npc = out?.combatants[0];
    expect(npc).toMatchObject({
      hp: null,
      hpBand: 'critical',
      conditions: ['Prone'],
      deathSaves: null,
    });
    const hero = out?.combatants[1];
    expect(hero).toMatchObject({
      hp: { value: 0, max: 18, temp: 0 },
      deathSaves: { successes: 1, failures: 2 },
    });
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('without a visibility context names every non-PC "Unknown creature"', () => {
    const out = projectCombat(combat, null, opts);
    expect(out?.combatants.map(c => c.name)).toEqual([
      'Unknown creature',
      'Unknown creature',
      'Ireena',
    ]);
    expect(JSON.stringify(out)).not.toContain(SECRET);
  });

  it('respects the GM switches for enemy HP bands and conditions', () => {
    const out = projectCombat(combat, visibility, {
      showEnemyHpBands: false,
      showEnemyConditions: false,
    });
    expect(out?.combatants[0]).toMatchObject({ hpBand: null, conditions: [] });
  });
});

describe('buildPlayerState', () => {
  it('projects the world and scene to their player-facing fields only', () => {
    const state = buildPlayerState({
      status: {
        controlChannel: 'connected',
        foundry: 'reachable',
        lastError: SECRET,
        lastPollAt: null,
      },
      world: {
        id: SECRET,
        title: 'Barovia',
        systemId: 'dnd5e',
        systemVersion: '6.0.5',
        foundryVersion: '14.368',
        gmNames: [SECRET],
      },
      visibility,
      combat: null,
      events: [event({ visibility: pc })],
      handouts: [],
      opts,
    });
    expect(state).toEqual({
      status: 'live',
      world: { title: 'Barovia', systemId: 'dnd5e' },
      scene: 'Village',
      combat: null,
      events: [{ id: 'e1', timestampMs: 1000, type: 'damage', text: 'Ireena took 7 damage.' }],
      handouts: [],
    });
  });
});
