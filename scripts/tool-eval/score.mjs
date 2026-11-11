/**
 * Scoring for `npm run tool-eval`. Pure: takes the calls Claude made in one turn (tool names in
 * order, with their inputs) and its final text, and says whether the turn passed its path and its
 * hard gates.
 *
 * - A path is a list of tool names that must appear in that order (other calls may sit between
 *   them). A turn lists one or more alternative paths; matching any one passes. Calls that are not
 *   on the matched path count as extras: at most two are allowed, and none may be a write tool the
 *   turn forbids.
 * - Hard gates must hold in every turn that carries them; they decide the "gates 100%" line.
 */

/** Tools that change the game at once or confirm a plan; a turn marked noWrite may call none. */
export const WRITE_TOOLS = new Set([
  'apply-planned-change',
  'undo-change',
  'plan-undo-changes',
  'send-chat-message',
  'switch-scene',
  'play-playlist',
  'create-actor-from-compendium',
  'dnd5e-add-feature',
  'dnd5e-add-features-from-compendium',
  'dnd5e-create-npc',
  'use-item',
  'use-npc-activity',
  'advance-combat-turn',
  'set-initiative',
  'roll-initiative-for-npcs',
  'roll-npc-check',
  'roll-saving-throws',
  'request-player-rolls',
  'request-ability-check',
  'request-attack-roll',
  'manage-rest',
  'manage-world-items',
  'mark-play-session',
  'create-quest-journal',
  'update-quest-journal',
  'link-quest-to-npc',
  'create-campaign-dashboard',
]);

export const MAX_EXTRA_CALLS = 2;

/** Is `path` a subsequence of `names`? Returns the matched indexes or undefined. */
export function matchPath(path, names) {
  const used = [];
  let from = 0;
  for (const want of path) {
    const at = names.indexOf(want, from);
    if (at === -1) return undefined;
    used.push(at);
    from = at + 1;
  }
  return used;
}

// JS `\b` is ASCII only, so it never matches next to å, æ, ø: use Unicode-aware lookarounds.
const DANISH = /(?<![\p{L}\p{N}_])(har|hvor|er|og|af|ikke|han|hans|lige nu|aktuelle|nuværende)(?![\p{L}\p{N}_])/iu;
const NORWEGIAN = /(?<![\p{L}\p{N}_])(av|nå|hvor mye|også|ikke noe|dessverre|treffpoeng|livspoeng)(?![\p{L}\p{N}_])/iu;

/** The reply names the Play set: "Play" within about 60 characters of "connector", "switch" or "set". */
export function namesPlaySet(text) {
  return (
    /\bplay\b[^.\n]{0,60}\b(connector|switch|set|toggle|menu)\b/i.test(text) ||
    /\b(connector|switch|set|toggle|turn on|enable)\b[^.\n]{0,60}\bplay\b/i.test(text)
  );
}

/** The language gate of case 22: Danish, English game terms kept, not Norwegian, not English. */
export function danishWithGameTerms(text) {
  return DANISH.test(text) && !NORWEGIAN.test(text) && /hit points/i.test(text);
}

/**
 * @param turn  {paths: string[][], noWrite?: boolean, gates?: string[], fail?: (calls, text) => boolean}
 * @param calls [{name, input}] in call order
 * @param text  the final assistant text of the turn
 * @returns {{path: boolean, gates: Record<string, boolean>, why: string[]}}
 */
export function scoreTurn(turn, calls, text) {
  const names = calls.map(c => c.name);
  const why = [];
  const gates = {};

  if (turn.gates?.includes('no-write')) {
    const bad = names.filter(n => WRITE_TOOLS.has(n));
    gates['no-write'] = bad.length === 0;
    if (bad.length) why.push(`gate no-write: called ${bad.join(', ')}`);
  }
  if (turn.gates?.includes('set-off')) {
    // Case 21: the tool is in a set that is off; no call at all, and the reply names the set.
    gates['set-off'] = names.length === 0 && namesPlaySet(text);
    if (names.length) why.push(`gate set-off: stood in with ${names.join(', ')}`);
    else if (!gates['set-off']) why.push('gate set-off: reply does not name the Play set');
  }
  if (turn.gates?.includes('language')) {
    gates.language = danishWithGameTerms(text);
    if (!gates.language) why.push('gate language: reply is not Danish with "hit points" kept');
  }

  let matched;
  for (const path of turn.paths) {
    const hit = matchPath(path, names);
    if (hit) {
      matched = hit;
      break;
    }
  }
  if (!matched && turn.paths.some(p => p.length > 0)) {
    why.push(`path: none of ${turn.paths.map(p => p.join('>')).join(' | ')} in [${names.join(', ')}]`);
  }
  let path = turn.paths.some(p => p.length === 0) || Boolean(matched);
  if (path && matched) {
    const extras = calls.filter((_, i) => !matched.includes(i));
    if (extras.length > MAX_EXTRA_CALLS) {
      path = false;
      why.push(`path: ${extras.length} extra calls (${extras.map(c => c.name).join(', ')})`);
    }
  }
  if (path && turn.fail?.(calls, text)) {
    path = false;
    why.push('path: a fail condition of the case holds');
  }
  return { path, gates, why };
}

/** Summary over scored turns: path share and whether every gate held. */
export function summarize(scored) {
  const turns = scored.length;
  const pathPass = scored.filter(s => s.path).length;
  const gateEntries = scored.flatMap(s => Object.entries(s.gates));
  const gatesHeld = gateEntries.filter(([, ok]) => ok).length;
  return {
    turns,
    pathPass,
    pathPct: turns === 0 ? 0 : (100 * pathPass) / turns,
    gateChecks: gateEntries.length,
    gatesHeld,
    gatesAll: gatesHeld === gateEntries.length,
  };
}

/** Targets from the Backlog item: gates 100%, Sonnet >= 90% path, Haiku >= 85%. */
export const TARGETS = { sonnet: 90, haiku: 85 };

export function verdict(model, summary) {
  const target = TARGETS[model];
  return {
    ok: summary.gatesAll && (target === undefined || summary.pathPct >= target),
    target,
  };
}
