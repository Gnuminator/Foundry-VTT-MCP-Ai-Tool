/**
 * The fake's player screen: what /api/player/state and /player serve. The projection is the
 * real one in spirit: no hidden combatants, no true names, no HP numbers for non-player
 * combatants, and only a few event kinds with fixed texts.
 */

/** @typedef {import('./state.mjs').World} World */

/** @param {World} w */
export function playerState(w) {
  const combat = w.combat;
  const visible = combat
    ? combat.combatants.filter(c => {
        const token = w.tokens.get(c.tokenId);
        return !c.hidden && token && !token.hidden;
      })
    : [];
  return {
    status: 'live',
    world: { title: w.title, systemId: 'dnd5e' },
    scene: 'Current scene',
    combat: combat
      ? {
          active: true,
          round: combat.round,
          combatants: visible.map(c => ({
            id: c.id,
            name: 'Unknown creature',
            initiative: c.initiative,
            isCurrentTurn: combat.combatants[combat.turn] === c,
            isPC: false,
            side: c.category === 'enemy' ? 'enemy' : 'npc',
            defeated: false,
            hp: null,
            hpBand: null,
            conditions: [],
            deathSaves: null,
          })),
        }
      : null,
    events: w.log
      .filter(e => e.eventType === 'combat-start' || e.eventType === 'combat-end')
      .map(e => ({
        id: e.id,
        timestampMs: e.timestampMs,
        type: e.eventType,
        text: e.eventType === 'combat-start' ? 'Combat started.' : 'Combat ended.',
      })),
    handouts: [],
  };
}

/** The player page (the real one is a static file; the kit only checks what it must not hold). */
export const PLAYER_HTML =
  '<!doctype html>\n<html lang="en"><head><meta charset="utf-8" /><title>Players</title></head>' +
  '<body><main id="app">The table</main></body></html>\n';
