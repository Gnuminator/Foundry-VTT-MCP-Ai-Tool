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

/** The largest picture the page sends, in bytes (the server checks again, by the bytes). */
export const PORTRAIT_MAX_BYTES = 5 * 1024 * 1024;

/**
 * A quick check before a picture is sent: a line telling the player what is wrong, or null. The
 * server decides in the end (it reads the type from the bytes, not from the name).
 */
export function portraitProblem(file) {
  if (!file) return 'Pick a picture first.';
  if (!['image/png', 'image/jpeg', 'image/webp'].includes(file.type)) {
    return 'Only PNG, JPG or WebP pictures work.';
  }
  if (file.size > PORTRAIT_MAX_BYTES) return 'That picture is too big. The limit is 5 MB.';
  if (file.size === 0) return 'That file is empty.';
  return null;
}

/** The line shown after a failed upload: the server's own words for a refusal, else a fixed one. */
export function portraitFailure(status, body) {
  if (status >= 500) return 'Could not save your picture. Ask your GM.';
  return (body && body.error) || 'Could not save your picture. Ask your GM.';
}

/** The roll requests waiting for the player: a button id and its text, nothing else. */
export function myRollRequests(me) {
  const list = me && Array.isArray(me.rollRequests) ? me.rollRequests : [];
  return list
    .filter(r => r && typeof r.buttonId === 'string' && typeof r.label === 'string')
    .map(r => ({ buttonId: r.buttonId, label: r.label }));
}

/**
 * The roll banner for the player who picked their name: the title ("The GM asked you for
 * Perception.") and a hint on where to roll, or null when nothing is open for them. `open` is the
 * player stream's list ({ id, sentAt, label, userId }); a request older than half an hour no
 * longer shows.
 */
export function rollBannerLines(open, userId, now, hasKey) {
  if (!userId || !Array.isArray(open)) return null;
  const mine = open.filter(
    r => r && r.userId === userId && typeof r.label === 'string' && now - r.sentAt < 30 * 60 * 1000
  );
  if (mine.length === 0) return null;
  const names = mine.map(r => r.label.replace(/\s*\((?:Private|Public)\)\s*$/i, ''));
  return {
    title: `The GM asked you to roll: ${names.join(', ')}`,
    hint: hasKey
      ? 'Press Roll under "You" below, or roll it in Foundry.'
      : 'Roll it in Foundry, or open your own link (pinned in Discord) to roll here.',
  };
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

// "What can I do on my turn" card (I-170): the character's options grouped by action cost. Built
// from the sheet the page already holds; features carry no action cost in the sheet, so known
// class features come from a name table and spells from their casting time.

export const TURN_GROUPS = [
  { id: 'action', label: 'Action' },
  { id: 'bonus', label: 'Bonus action' },
  { id: 'reaction', label: 'Reaction' },
  { id: 'free', label: 'Free' },
];

const BASIC_ACTIONS = [
  ['Dodge', 'Attacks against you have disadvantage until your next turn.'],
  ['Dash', 'Gain extra movement equal to your Speed.'],
  ['Disengage', 'Your movement does not provoke opportunity attacks.'],
  ['Help', 'Give an ally advantage on their next check or attack.'],
  ['Hide', 'Make a Stealth check to hide.'],
  ['Search', 'Look for something with Perception, Insight or the like.'],
];

/** Known class features: [name pattern, group, one short line]. */
const FEATURE_COSTS = [
  [/^channel divinity/i, 'action', 'Spend a use: Divine Spark or Turn Undead.'],
  [/^(divine spark|turn undead)/i, 'action', 'Channel Divinity option.'],
  [/^second wind/i, 'bonus', 'Heal 1d10 + your level.'],
  [/^action surge/i, 'free', 'Take one extra action this turn.'],
  [/^(rage|barbarian rage)$/i, 'bonus', 'Enter a rage.'],
  [/^bardic inspiration/i, 'bonus', 'Give an ally a die to add to a roll.'],
  [/^lay on hands/i, 'bonus', 'Heal from your pool of points.'],
  [/^wild shape/i, 'bonus', 'Turn into a beast.'],
  [/^cunning action/i, 'bonus', 'Dash, Disengage or Hide.'],
  [/^flurry of blows/i, 'bonus', 'Two unarmed strikes after Attack (Focus Point).'],
  [/^patient defense/i, 'bonus', 'Dodge as a bonus action.'],
  [/^step of the wind/i, 'bonus', 'Dash or Disengage as a bonus action.'],
  [/^uncanny dodge/i, 'reaction', 'Halve the damage of an attack you can see.'],
  [/^deflect attacks?/i, 'reaction', 'Reduce damage from an attack.'],
  [/^hellish rebuke/i, 'reaction', 'Burn the creature that hit you.'],
  [/^sneak attack/i, 'free', 'Extra damage once per turn.'],
  [/^preserve life/i, 'action', 'Channel Divinity: heal creatures near you.'],
];

const CASTING_GROUP = [
  // dnd5e's label is "Action", "Bonus Action" or "Reaction" (older data may say "1 Action").
  [/^(1 )?bonus action/i, 'bonus'],
  [/^(1 )?reaction/i, 'reaction'],
  [/action/i, 'action'], // "Action", "Magic action", "Utilize action" and the like
];

/** The shortest text that still says it: at most `max` characters, cut at a word. */
function brief(text, max = 70) {
  const t = String(text ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  if (t.length <= max) return t;
  return `${t.slice(0, max - 1).replace(/\s+\S*$/, '')}…`;
}

function usesText(u) {
  return u && typeof u.max === 'number' && u.max > 0 ? `${u.value}/${u.max} left` : '';
}

/**
 * Options for one sheet (the shape /api/me gives), as `[{ id, label, options: [{ name, note }] }]`
 * with empty groups left out. Spare the Dying is a cantrip with a 1 action casting time and so
 * lands under Action; unprepared leveled spells are left out.
 */
export function turnOptions(sheet) {
  const by = { action: [], bonus: [], reaction: [], free: [] };
  if (!sheet) return [];
  const seen = new Set();
  const add = (group, name, note) => {
    const k = `${group}:${name.toLowerCase()}`;
    if (seen.has(k)) return;
    seen.add(k);
    by[group].push({ name, note: brief(note) });
  };
  const inventory = Array.isArray(sheet.inventory) ? sheet.inventory : [];
  const attacks = inventory.filter(i => i && i.equipped && i.attack);
  if (attacks.length) {
    add(
      'action',
      'Attack',
      attacks.map(i => `${i.name} ${i.attack}${i.damage ? `, ${i.damage}` : ''}`).join('; ')
    );
  }
  for (const [name, note] of BASIC_ACTIONS) add('action', name, note);
  add('reaction', 'Opportunity attack', 'Strike a creature that leaves your reach.');
  for (const f of Array.isArray(sheet.features) ? sheet.features : []) {
    if (!f || typeof f.name !== 'string') continue;
    const hit = FEATURE_COSTS.find(([re]) => re.test(f.name));
    if (!hit) continue;
    add(hit[1], f.name, [hit[2], usesText(f.uses)].filter(Boolean).join(' '));
  }
  for (const sp of Array.isArray(sheet.spells) ? sheet.spells : []) {
    if (!sp || typeof sp.name !== 'string') continue;
    if (sp.level > 0 && !sp.prepared) continue;
    const g = CASTING_GROUP.find(([re]) => re.test(sp.castingTime ?? ''));
    if (!g) continue;
    const bits = [sp.level === 0 ? 'Cantrip' : `Level ${sp.level}`, sp.range, sp.duration];
    add(g[1], sp.name, bits.filter(Boolean).join(', '));
  }
  return TURN_GROUPS.filter(g => by[g.id].length).map(g => ({ ...g, options: by[g.id] }));
}
