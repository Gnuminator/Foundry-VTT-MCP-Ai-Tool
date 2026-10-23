// "Mine" on the player page: your turn, next up, your character card and the concentration
// reminder. Pure functions over data the page already holds: the projected combat and feed from the
// player stream, and the player's own sheets from /api/me (their private link, kept on this device
// by me.js). Nothing here widens what the server sends; it only picks out the player's own rows.

/** The sheets the player owns, reduced to what the card shows. */
export function mySheets(me) {
  const sheets = me && Array.isArray(me.sheets) ? me.sheets : [];
  return sheets
    .filter(s => s && typeof s.id === 'string' && typeof s.name === 'string')
    .map(s => ({
      id: s.id,
      name: s.name,
      hp: s.hp && typeof s.hp.value === 'number' && typeof s.hp.max === 'number' ? s.hp : null,
      conditions: Array.isArray(s.conditions)
        ? s.conditions.filter(c => typeof c === 'string')
        : [],
      // dnd5e names the effect "Concentrating: <spell>": keep the spell.
      concentration:
        typeof s.concentration === 'string' && s.concentration
          ? s.concentration.replace(/^concentrating:\s*/i, '') || null
          : null,
    }));
}

/**
 * Where the player's character stands in the combat order. `state` is `yours` (their turn),
 * `next` (they act right after the current one), `later` (with `turnsAway`), or `out` (not in the
 * combat, or defeated). The order is the projected list, so a creature players cannot see never
 * counts as "in between".
 */
export function turnStatus(combat, actorIds) {
  if (!combat || !combat.active || !Array.isArray(combat.combatants)) return null;
  const mine = new Set(actorIds);
  const order = combat.combatants.filter(c => !c.defeated);
  const currentIdx = order.findIndex(c => c.isCurrentTurn);
  const owned = order
    .map((c, i) => (c.isPC && c.actorId && mine.has(c.actorId) ? i : -1))
    .filter(i => i >= 0);
  if (owned.length === 0) return { state: 'out', round: combat.round };
  // With two characters in the fight, follow the one whose turn comes first.
  const me =
    currentIdx < 0 ? owned[0] : owned.reduce((best, i) => (dist(i) < dist(best) ? i : best));
  function dist(i) {
    return (i - currentIdx + order.length) % order.length;
  }
  if (currentIdx < 0)
    return { state: 'later', round: combat.round, turnsAway: null, name: order[me].name };
  const away = dist(me);
  const base = { round: combat.round, name: order[me].name };
  if (away === 0) return { ...base, state: 'yours' };
  if (away === 1) return { ...base, state: 'next' };
  return { ...base, state: 'later', turnsAway: away };
}

/**
 * The line for the turn banner, or null when there is nothing to say (no combat, or the
 * character is not in it).
 */
export function turnLine(status) {
  if (!status || status.state === 'out') return null;
  if (status.state === 'yours') return `Your turn, ${status.name}.`;
  if (status.state === 'next') return `You are up next, ${status.name}.`;
  return status.turnsAway ? `${status.turnsAway} turns until yours.` : 'Not your turn yet.';
}

/** The Constitution save DC for a damaged concentrating caster: 10 or half the damage, at most 30. */
export function concentrationDc(damage) {
  return Math.min(30, Math.max(10, Math.floor(damage / 2)));
}

/** "Brenna took 7 damage." -> { name, amount }; the feed's fixed template for a PC. */
export function parseDamageLine(text) {
  const m = /^(.+) took (\d+) damage\.$/.exec(String(text ?? ''));
  return m ? { name: m[1], amount: Number(m[2]) } : null;
}

/**
 * Concentration reminders for damage lines not seen yet. `sheets` come from a fresh /api/me read,
 * so a spell that has ended is not reminded. `seen` is a Set of event ids, updated here.
 */
export function concentrationReminders(events, sheets, seen) {
  const out = [];
  for (const e of Array.isArray(events) ? events : []) {
    if (!e || e.type !== 'damage' || seen.has(e.id)) continue;
    seen.add(e.id);
    const hit = parseDamageLine(e.text);
    if (!hit || hit.amount <= 0) continue;
    const sheet = sheets.find(s => s.name === hit.name && s.concentration);
    if (!sheet) continue;
    out.push({
      id: e.id,
      text: `${sheet.name} took ${hit.amount} damage while concentrating on ${sheet.concentration}. Roll a Constitution saving throw, DC ${concentrationDc(hit.amount)}.`,
    });
  }
  return out;
}
