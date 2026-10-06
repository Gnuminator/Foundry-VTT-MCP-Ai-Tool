/**
 * The fake's player screen: what /api/player/state and /player serve. The projection is the
 * real one in spirit: no hidden combatants, no true names, no HP numbers for non-player
 * combatants, and only a few event kinds with fixed texts.
 */

/** @typedef {import('./state.mjs').World} World */

/**
 * Whether a player owns the actor (the real rule: `hasPlayerOwner`, a non-GM user with the owner
 * level). The kit's GM user does not count.
 * @param {World} w
 * @param {string} actorId
 */
function isPlayerCharacter(w, actorId) {
  const ownership = w.actors.get(actorId)?.ownership ?? {};
  return Object.entries(ownership).some(
    ([user, level]) => user !== 'default' && user !== 'Kit GM' && level >= 3
  );
}

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
          // A player character shows its name and HP numbers, everyone else stays hidden.
          combatants: visible.map(c => {
            const pc = isPlayerCharacter(w, c.actorId);
            const hp = w.tokens.get(c.tokenId)?.hp;
            return {
              id: c.id,
              name: pc ? c.name : 'Unknown creature',
              initiative: c.initiative,
              isCurrentTurn: combat.combatants[combat.turn] === c,
              isPC: pc,
              side: pc ? 'pc' : c.category === 'enemy' ? 'enemy' : 'npc',
              defeated: false,
              hp: pc && hp ? { value: hp.value, max: hp.max, temp: hp.temp } : null,
              hpBand: null,
              conditions: [],
              deathSaves: null,
            };
          }),
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
