/**
 * The fake's combat and play-log tools: combat state, initiative, turns, an NPC attack, the
 * play-by-play, the session log, play stats, play session marks and the player visibility list.
 */
import { ToolFailure, addEvent, currentSession, roll, tick } from './state.mjs';

/** @typedef {import('./state.mjs').World} World */

/**
 * Sorts a combat by initiative (highest first, then name) and keeps the current combatant.
 * @param {NonNullable<World['combat']>} combat
 */
export function sortCombat(combat) {
  const current = combat.combatants[combat.turn];
  combat.combatants.sort((a, b) => b.initiative - a.initiative || a.name.localeCompare(b.name));
  if (current) combat.turn = Math.max(0, combat.combatants.indexOf(current));
}

/** @param {World} w */
function needCombat(w) {
  if (!w.combat) throw new ToolFailure('No active combat encounter.');
  return w.combat;
}

/** The play-by-play keeps who had the turn in each round. @param {World} w */
export function markTurn(w) {
  const combat = needCombat(w);
  const who = combat.combatants[combat.turn];
  combat.timeline.push({ round: combat.round, combatant: who ? who.name : 'Unknown', actions: [] });
}

/** @param {World} w @param {number} index @param {import('./state.mjs').FakeCombatant} c */
function view(w, index, c) {
  const combat = needCombat(w);
  const hp = w.tokens.get(c.tokenId)?.hp ?? { value: 0, max: 0, temp: 0 };
  return {
    id: c.id,
    name: c.name,
    initiative: c.initiative,
    isCurrentTurn: index === combat.turn,
    actedThisRound: index < combat.turn,
    tokenId: c.tokenId,
    actorId: c.actorId,
    sceneId: combat.sceneId,
    hp: { value: hp.value, max: hp.max, temp: hp.temp },
    conditions: [],
    statuses: [],
    isPC: false,
    category: c.category,
    defeated: hp.value <= 0,
    deathSaves: null,
    hidden: c.hidden,
    boss: null,
  };
}

/** @param {World} w */
function combatState(w) {
  if (!w.combat)
    return { success: true, active: false, message: 'No active or recent combat encounter.' };
  const combat = w.combat;
  const rows = combat.combatants.map((c, i) => view(w, i, c));
  return {
    success: true,
    active: true,
    round: combat.round,
    turn: combat.turn,
    current: rows[combat.turn] ?? null,
    combatants: rows,
    downed: [],
  };
}

/** @param {World} w @param {any} args */
function advanceTurn(w, args) {
  const combat = needCombat(w);
  if (args.skipTo) {
    const at = combat.combatants.findIndex(
      c => c.name === args.skipTo || c.actorId === args.skipTo
    );
    if (at < 0) throw new ToolFailure(`No combatant "${args.skipTo}"`);
    combat.turn = at;
  } else {
    combat.turn += 1;
    if (combat.turn >= combat.combatants.length) {
      combat.turn = 0;
      combat.round += 1;
    }
  }
  markTurn(w);
  return {
    success: true,
    round: combat.round,
    turn: combat.turn,
    current: combat.combatants[combat.turn]?.name,
  };
}

/** @param {World} w @param {any} args */
function useNpcActivity(w, args) {
  const actor = [...w.actors.values()].find(
    a => a.name === args.actorName || a.id === args.actorName
  );
  if (!actor) throw new ToolFailure(`Failed to use the activity: no actor "${args.actorName}"`);
  const item = actor.items.find(i => i.name === args.itemName || i.id === args.itemName);
  if (!item)
    throw new ToolFailure(`Failed to use the activity: ${actor.name} has no "${args.itemName}"`);
  const natural = roll(w, 20);
  const attackTotal = natural + 5;
  const damageTotal = roll(w, 4) + 3;
  const d = { rollType: 'attack', total: attackTotal, natural };
  const attackText = `${actor.name}, ${item.name} attack: 1d20 (${natural}) +5 = ${attackTotal}`;
  addEvent(w, 'roll', { actor, description: attackText, details: { ...d, breakdown: attackText } });
  const damageText = `${actor.name}, ${item.name} damage: ${damageTotal} bludgeoning`;
  addEvent(w, 'damage-roll', {
    actor,
    description: damageText,
    details: {
      rollType: 'damage',
      total: damageTotal,
      breakdown: damageText,
      types: ['bludgeoning'],
    },
  });
  const turn = w.combat?.timeline[w.combat.timeline.length - 1];
  if (turn) {
    const at = new Date(tick(w)).toISOString();
    turn.actions.push({
      actor: actor.name,
      summary: `${item.name} - Attack Roll`,
      timestamp: at,
      rollTotal: attackTotal,
      damage: null,
    });
    turn.actions.push({
      actor: actor.name,
      summary: `${item.name} - Damage Roll`,
      timestamp: at,
      rollTotal: damageTotal,
      damage: damageTotal,
    });
  }
  return {
    success: true,
    actor: actor.name,
    item: item.name,
    hadAttack: true,
    attackTotal,
    targetName: null,
    targetAC: args.targetAC ?? null,
    hit: args.targetAC === undefined ? null : attackTotal >= args.targetAC,
    isCritical: natural === 20,
    damageTotal,
    formula: '1d20 + 5',
  };
}

/** @param {World} w */
function playByPlay(w) {
  const record = w.combats[w.combats.length - 1];
  const combat = w.combat ?? w.lastCombat;
  if (!combat || !record)
    return {
      success: true,
      combatActive: false,
      totalRounds: 0,
      rounds: [],
      significantEvents: [],
      summary: { totalRounds: 0, damageByActor: {}, note: 'No combat.' },
    };
  /** @type {Array<{round: number, turns: any[]}>} */
  const rounds = [];
  for (const entry of combat.timeline) {
    let round = rounds.find(r => r.round === entry.round);
    if (!round) rounds.push((round = { round: entry.round, turns: [] }));
    round.turns.push({ combatant: entry.combatant, actions: entry.actions });
  }
  return {
    success: true,
    combatActive: Boolean(w.combat),
    totalRounds: combat.round,
    rounds,
    significantEvents: [],
    summary: { totalRounds: combat.round, damageByActor: { ...record.damageTaken }, note: null },
  };
}

/** @param {World} w */
function playStats(w) {
  const session = currentSession(w);
  for (const record of w.combats)
    if (w.combat && record.combatId === w.combat.id) record.rounds = w.combat.round;
  const combats = w.combats.filter(c => c.startedAt >= session.startedAt);
  const index = w.sessions.indexOf(session);
  return {
    success: true,
    worldId: w.worldId,
    campaign: { sessions: w.sessions.length, combats: w.combats.length },
    dice: { d20: new Array(20).fill(0), byUser: {} },
    sessionCount: w.sessions.length,
    session: {
      number: index + 1,
      label: `fake S${String(index + 1).padStart(2, '0')}`,
      startedAt: session.startedAt,
      endedAt: session.endedAt ?? new Date().toISOString(),
      combats: combats.map(c => ({
        ...c,
        damageTaken: { ...c.damageTaken },
        healing: { ...c.healing },
      })),
      gmChanges: w.changes.filter(c => c.mode === 'apply').length,
    },
    pcs: [],
  };
}

/** @type {Record<string, (w: World, args: any, flags: any) => any>} */
export const COMBAT_TOOLS = {
  'get-combat-state': w => combatState(w),
  'advance-combat-turn': advanceTurn,
  'use-npc-activity': useNpcActivity,
  'get-combat-play-by-play': w => playByPlay(w),
  'get-play-stats': w => playStats(w),

  'set-initiative': (w, args) => {
    const combat = needCombat(w);
    const c = combat.combatants.find(x => x.name === args.combatantName);
    if (!c) throw new ToolFailure(`No combatant "${args.combatantName}" in the combat`);
    c.initiative = Number(args.initiative);
    sortCombat(combat);
    return { success: true, combatant: c.name, initiative: c.initiative };
  },

  'roll-initiative-for-npcs': (w, args) => {
    const combat = needCombat(w);
    for (const c of combat.combatants) c.initiative = roll(w, 20) + 2;
    sortCombat(combat);
    return {
      success: true,
      scope: args.scope ?? 'npcs',
      round: combat.round,
      order: combat.combatants.map(c => ({ name: c.name, initiative: c.initiative, isPC: false })),
    };
  },

  'get-session-log': (w, args) => {
    const events = w.log
      .filter(e => !args.eventType || e.eventType === args.eventType)
      .filter(e => !args.actorName || (e.actorName ?? '').includes(args.actorName))
      .slice(-(args.limit ?? 100));
    return { success: true, count: events.length, events };
  },

  'mark-play-session': (w, args) => {
    const markedAt = new Date(tick(w)).toISOString();
    if (args.action === 'start') w.sessions.push({ startedAt: markedAt, endedAt: null });
    else if (w.sessions.length) w.sessions[w.sessions.length - 1].endedAt = markedAt;
    return { success: true, worldId: w.worldId, action: args.action, markedAt };
  },

  'get-player-visibility': w => ({
    schema: 1,
    computedAt: Date.now(),
    pcActorIds: [],
    scene: { id: w.activeSceneId, name: 'Current scene' },
    tokens: [...w.tokens.values()]
      .filter(t => t.sceneId === w.activeSceneId && !t.hidden)
      .map(t => ({ tokenId: t.id, actorId: t.actorId, name: 'Unknown creature', pc: false })),
  }),
};
