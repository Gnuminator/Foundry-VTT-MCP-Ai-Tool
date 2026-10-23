/**
 * Pure rules check (I-126): turns facts gathered from Foundry into a list of checks with reasons.
 * No I/O, no Foundry globals; the tool in `tools/rules-check.ts` gathers the facts.
 */
import type { RulesCheckLine, RulesCheckResult, RulesCheckVerdict } from '@gnuminator/shared';

export interface SlotFact {
  current: number;
  max: number;
  /** Pact magic only: the level its slots cast at. */
  level?: number | null;
}

export interface UsesFact {
  value: number;
  max: number;
  recovery?: string | null;
}

export type CombatFact =
  | { active: false }
  | {
      active: true;
      round: number;
      /** The actor is a combatant of the encounter. */
      inCombat: boolean;
      /** Several combatants share the actor (unlinked tokens), so the turn cannot be told. */
      ambiguous?: boolean;
      /** Other combatants share the actor id, so the ledger (keyed by actor) is not this token's alone. */
      sharedActor?: boolean;
      isCurrentTurn: boolean;
      currentName: string | null;
    };

export interface RulesFacts {
  actor: string;
  item: string;
  /** Spell level (0 for a cantrip), null for anything that is not a spell. */
  spellLevel: number | null;
  /** The level the caller wants to cast at, if given. */
  castLevel: number | null;
  /** The activity's activation label ("Action", "Bonus Action"...) or the raw type. */
  activation: string | undefined;
  /** The activity's range label ("60 Feet", "Self", "Touch", "80/320 Feet"). */
  range: string | undefined;
  combat: CombatFact;
  target: string | undefined;
  /** Feet between actor and target; null when it could not be measured (with the reason). */
  distance: { feet: number | null; error?: string } | undefined;
  /** dnd5e 6 spell preparation method (`spell`, `pact`, `atwill`, `innate`, `ritual`), if a spell. */
  spellMethod?: string | null;
  /** The spell has the ritual property. */
  ritual?: boolean;
  /** The spell is not prepared (false); true or missing when ready, or when it never prepares. */
  prepared?: boolean;
  /** The actor is an NPC: its slots come from the world actor, not the token in the encounter. */
  npc?: boolean;
  /** Keyed `level1`..`level9` and `pact`, as `get-character-resources` reports them. */
  slots: Record<string, SlotFact> | undefined;
  /** The item's own uses, then the chosen activity's. */
  uses: UsesFact[];
  /** The spell needs concentration. */
  needsConcentration?: boolean;
  /** What the actor concentrates on now (from `get-character-resources`), if known. */
  concentration?: { active: boolean; spell: string | null } | undefined;
  /**
   * What the actor used since its own turn began, as the module's ledger of dnd5e usage messages
   * saw it. Missing when the module cannot say (old module, or turns not seen).
   */
  spent?: SpentFact | undefined;
  /** The check runs before the use, so the ledger does not hold the checked item's own use yet. */
  beforeUse?: boolean;
  /** Rules versions ("2014" / "2024"): the item's own tag, and the actor's with where it came from. */
  rules?:
    | {
        item: { version: string; source: string } | null;
        actor: { version: string; source: string } | null;
      }
    | undefined;
}

export interface SpentFact {
  uses: Array<{
    item: string;
    itemType: string;
    activation: string;
    /** Spell level (0 for a cantrip) when known. */
    itemLevel?: number | null;
  }>;
}

const LIMITS_UNTRACKED =
  'Foundry does not record which actions, bonus actions or reactions a creature has already spent this turn, so that part is never confirmed.';
const LIMITS_TRACKED =
  "Spent actions come from the activities used through Foundry since the creature's turn began. Dash, Dodge, Help, hand-rolled attacks and anything settled aloud are not seen (an opportunity attack rolled with a weapon counts as an action, not the reaction), and extra actions (Action Surge, haste) are not modelled.";

const LIMITS = [
  LIMITS_UNTRACKED,
  'Cover, conditions, spell components and special cases (for example a bonus action spell limiting the main action) are not checked yet.',
  'Ammunition and resources an item consumes are not checked, and distance is measured between token centres.',
];

/** The most a token size can add to a centre to centre distance in a melee reach check (feet). */
const SIZE_SLACK = 15;

export type Cost = 'action' | 'bonus' | 'reaction' | 'long' | 'other' | 'none';

/** Sort an activation label or raw type into the cost a creature pays on its turn. */
export function classifyActivation(label: string | undefined): Cost {
  const text = (label ?? '').toLowerCase().trim();
  if (!text || text === 'none' || text === 'passive') return 'none';
  if (/legendary|lair|mythic|special/.test(text)) return 'other';
  if (/bonus/.test(text)) return 'bonus';
  if (/reaction/.test(text)) return 'reaction';
  if (/minute|hour|day/.test(text)) return 'long';
  if (/action/.test(text)) return 'action';
  return 'other';
}

/** Feet from a range label: `{normal, long}` or a keyword; null when it cannot be read. */
export function parseRange(
  label: string | undefined
): { kind: 'self' | 'touch' | 'feet'; normal?: number; long?: number } | null {
  const text = (label ?? '').toLowerCase().trim();
  if (!text) return null;
  if (text.startsWith('self')) return { kind: 'self' };
  if (text.startsWith('touch')) return { kind: 'touch' };
  const match = /(\d+(?:\.\d+)?)(?:\s*\/\s*(\d+(?:\.\d+)?))?\s*(feet|foot|ft|miles?|mi)\b/.exec(
    text
  );
  if (!match) return null;
  const scale = /^(miles?|mi)$/.test(match[3] ?? '') ? 5280 : 1;
  const normal = Number(match[1]) * scale;
  return match[2]
    ? { kind: 'feet', normal, long: Number(match[2]) * scale }
    : { kind: 'feet', normal };
}

function turnCheck(f: RulesFacts, cost: Cost): RulesCheckLine {
  const c = f.combat;
  if (!c.active) {
    return {
      check: 'turn',
      status: 'info',
      reason: 'No combat is running, so turn order is not checked.',
    };
  }
  if (!c.inCombat) {
    return {
      check: 'turn',
      status: 'info',
      reason: `${f.actor} is not in the encounter, so turn order is not checked.`,
    };
  }
  if (c.ambiguous) {
    return {
      check: 'turn',
      status: 'unknown',
      reason: `Several tokens of ${f.actor} are in the encounter, so whose turn it is cannot be told.`,
    };
  }
  if (c.isCurrentTurn) {
    return { check: 'turn', status: 'pass', reason: `It is ${f.actor}'s turn (round ${c.round}).` };
  }
  if (cost === 'reaction') {
    return {
      check: 'turn',
      status: 'pass',
      reason: `It is ${c.currentName ?? 'someone else'}'s turn, and a reaction can happen on another creature's turn.`,
    };
  }
  if (cost === 'none' || cost === 'other') {
    return {
      check: 'turn',
      status: 'info',
      reason: `It is ${c.currentName ?? 'someone else'}'s turn; this does not cost an action or bonus action.`,
    };
  }
  return {
    check: 'turn',
    status: 'warn',
    reason: `It is ${c.currentName ?? 'someone else'}'s turn, not ${f.actor}'s.`,
  };
}

const names = (uses: Array<{ item: string }>): string =>
  [...new Set(uses.map(u => u.item))].join(', ');

/**
 * The cost line when the ledger saw this actor's turn. An action or bonus action only counts on
 * the actor's own turn; a reaction counts from the start of its last turn (it returns then).
 * Null when nothing is known, so the plain "confirm it is still free" line stands.
 */
function spentLine(
  f: RulesFacts,
  cost: 'action' | 'bonus' | 'reaction',
  name: string,
  label: string
): RulesCheckLine | null {
  const c = f.combat;
  if (!f.spent || !c.active || !c.inCombat || c.ambiguous || c.sharedActor) return null;
  if (cost !== 'reaction' && !c.isCurrentTurn) return null;
  const same = f.spent.uses.filter(u => classifyActivation(u.activation) === cost);
  // Asked after the fact ("was that Healing Word fine?"): the use being checked is already in the
  // ledger, so it does not count against itself.
  // A pre-check runs before the use, so there is nothing of its own to drop.
  const own = f.beforeUse ? -1 : same.map(u => u.item).lastIndexOf(f.item);
  if (own >= 0) same.splice(own, 1);
  const base = `Costs ${name} (${label}).`;
  if (same.length === 0 && own >= 0) {
    return {
      check: 'action-cost',
      status: 'info',
      reason: `${base} Only ${f.item} itself was seen this turn; fine if this check is about that use.`,
    };
  }
  if (same.length === 0) {
    return {
      check: 'action-cost',
      status: 'info',
      reason: `${base} Nothing used through Foundry has spent ${cost === 'reaction' ? `${f.actor}'s reaction` : `${f.actor}'s ${cost === 'bonus' ? 'bonus action' : 'action'}`} yet${cost === 'reaction' ? ' since its turn began' : ' this turn'}.`,
    };
  }
  const used = names(same);
  if (cost === 'action') {
    // Several weapon attacks are one Attack action (Extra Attack); spells and other items are not.
    // A cantrip beside a weapon attack is a legal pairing (Booming Blade, True Strike, an attack
    // swapped for a cantrip); two spells, or a levelled spell and anything else, are not.
    const cantrip = (level: number | null | undefined): boolean => level === 0;
    const spells = same.filter(u => u.itemType === 'spell');
    const now = f.spellLevel !== null;
    const levelled = (now && !cantrip(f.spellLevel)) || spells.some(u => !cantrip(u.itemLevel));
    const twoSpells = now && spells.length > 0;
    if (!levelled && !twoSpells) {
      return {
        check: 'action-cost',
        status: 'info',
        reason: `${base} ${f.actor} already used ${used} as an action this turn; that is fine if it is the same Attack action (Extra Attack) or a cantrip paired with a weapon attack.`,
      };
    }
    return {
      check: 'action-cost',
      status: 'warn',
      reason: `${base} ${f.actor} already used ${used} as an action this turn, and a spell and another action do not mix unless an extra action (Action Surge, haste) or a cantrip in place of an attack applies.`,
    };
  }
  return {
    check: 'action-cost',
    status: 'warn',
    reason:
      cost === 'bonus'
        ? `${base} ${f.actor} already used ${used} as a bonus action this turn, and there is only one per turn.`
        : `${base} ${f.actor} already used ${used} as a reaction since its turn began, and a reaction comes back only at the start of its next turn.`,
  };
}

/** Rules version of the item against the actor: a mismatch plays by different rules. */
function rulesCheck(f: RulesFacts): RulesCheckLine | null {
  const r = f.rules;
  // The world's default is a guess, not a statement: compare only versions the documents carry,
  // and say nothing when either side is unknown.
  const stated = (v: { source: string } | null | undefined): boolean =>
    v != null && v.source !== 'world-setting';
  if (!r?.item || !r.actor || !stated(r.item) || !stated(r.actor)) return null;
  if (r.actor.version === r.item.version) {
    return {
      check: 'rules-version',
      status: 'info',
      reason: `${f.item} and ${f.actor} both follow the ${r.item.version} rules.`,
    };
  }
  return {
    check: 'rules-version',
    status: 'warn',
    reason: `${f.item} follows the ${r.item.version} rules but ${f.actor} follows the ${r.actor.version} rules; the two rule sets differ (for example in features, weapon mastery and spell details), so check the item's text.`,
  };
}

function costCheck(f: RulesFacts, cost: Cost): RulesCheckLine {
  const label = f.activation ? `"${f.activation}"` : 'no activation';
  const inRound = f.combat.active && f.combat.inCombat;
  switch (cost) {
    case 'action':
    case 'bonus':
    case 'reaction': {
      const name =
        cost === 'action' ? 'an action' : cost === 'bonus' ? 'a bonus action' : 'a reaction';
      const spent = spentLine(f, cost, name, label);
      if (spent) return spent;
      return {
        check: 'action-cost',
        status: 'info',
        reason: `Costs ${name} (${label}). Foundry does not track what ${f.actor} has already spent, so confirm it is still free.`,
      };
    }
    case 'long':
      return {
        check: 'action-cost',
        status: inRound ? 'warn' : 'info',
        reason: `Takes longer than a turn (${label})${inRound ? ', so it cannot be done in a combat round' : ''}.`,
      };
    case 'other':
      return {
        check: 'action-cost',
        status: 'info',
        reason: `Has a special activation (${label}) that is not checked.`,
      };
    default:
      return {
        check: 'action-cost',
        status: 'info',
        reason: 'Has no activation cost (passive or always on).',
      };
  }
}

function rangeCheck(f: RulesFacts): RulesCheckLine {
  const range = parseRange(f.range);
  if (!f.target) {
    return {
      check: 'range',
      status: 'info',
      reason: `No target given, so range is not checked${f.range ? ` (range: ${f.range})` : ''}.`,
    };
  }
  if (!range) {
    return {
      check: 'range',
      status: 'unknown',
      reason: `The range ${f.range ? `"${f.range}" ` : ''}could not be read, so distance to ${f.target} is not checked.`,
    };
  }
  if (range.kind === 'self') {
    return { check: 'range', status: 'info', reason: 'Range is self; the target is not measured.' };
  }
  if (f.distance?.feet == null) {
    return {
      check: 'range',
      status: 'unknown',
      reason: `Could not measure the distance to ${f.target}${f.distance?.error ? `: ${f.distance.error}` : ''}.`,
    };
  }
  const feet = f.distance.feet;
  const normal = range.kind === 'touch' ? 5 : (range.normal ?? 0);
  if (feet <= normal) {
    return {
      check: 'range',
      status: 'pass',
      reason: `${f.target} is ${feet} ft away, within ${range.kind === 'touch' ? 'touch (5 ft)' : `${normal} ft`}.`,
    };
  }
  if (range.long !== undefined && feet <= range.long) {
    return {
      check: 'range',
      status: 'warn',
      reason: `${f.target} is ${feet} ft away: past the normal ${normal} ft but within the long range of ${range.long} ft (attacks at long range have disadvantage).`,
    };
  }
  const limit = range.long ?? normal;
  if (limit <= 10 && feet <= limit + SIZE_SLACK) {
    return {
      check: 'range',
      status: 'warn',
      reason: `${f.target} is ${feet} ft away centre to centre, past ${limit} ft. A large token can still be within reach; check the edges.`,
    };
  }
  return {
    check: 'range',
    status: 'fail',
    reason: `${f.target} is ${feet} ft away, beyond ${limit} ft.`,
  };
}

/** The slot line; an NPC's slots are read from the world actor, which its token may have outrun. */
function slotCheck(f: RulesFacts): RulesCheckLine | null {
  const line = slotCheckCore(f);
  if (line && f.npc && (line.status === 'pass' || line.status === 'fail')) {
    return {
      ...line,
      status: 'unknown',
      reason: `${line.reason} (Read from the world actor; an NPC token keeps its own slots, so this may be out of date.)`,
    };
  }
  return line;
}

function slotCheckCore(f: RulesFacts): RulesCheckLine | null {
  if (f.spellLevel === null) return null;
  if (f.spellLevel === 0)
    return { check: 'slots', status: 'info', reason: 'A cantrip needs no spell slot.' };
  const wanted = f.castLevel ?? f.spellLevel;
  if (wanted < f.spellLevel) {
    return {
      check: 'slots',
      status: 'fail',
      reason: `A level ${f.spellLevel} spell cannot be cast at level ${wanted}.`,
    };
  }
  if (f.prepared === false && f.spellLevel > 0) {
    const ritual = f.ritual || f.spellMethod === 'ritual';
    return {
      check: 'slots',
      status: ritual ? 'warn' : 'fail',
      reason: `${f.item} is not prepared${ritual ? ', but it can be cast as a ritual (longer, and not in a combat round)' : ''}.`,
    };
  }
  if (f.spellMethod === 'atwill' || f.spellMethod === 'innate') {
    return {
      check: 'slots',
      status: 'info',
      reason: `Cast ${f.spellMethod === 'atwill' ? 'at will' : 'innately'}, so it uses no spell slot (any uses are checked below).`,
    };
  }
  if (f.spellMethod === 'pact') {
    const pact = f.slots?.pact;
    if (pact?.level == null) {
      return {
        check: 'slots',
        status: 'unknown',
        reason: 'A pact magic spell, but the pact slot level could not be read.',
      };
    }
    if (pact.level < f.spellLevel || (f.castLevel !== null && f.castLevel !== pact.level)) {
      return {
        check: 'slots',
        status: 'fail',
        reason: `Pact slots are level ${pact.level}; they cannot cast this at level ${wanted}.`,
      };
    }
    return pact.current > 0
      ? {
          check: 'slots',
          status: 'pass',
          reason: `${pact.current} of ${pact.max} pact slots left (level ${pact.level}).`,
        }
      : { check: 'slots', status: 'fail', reason: 'No pact slot left.' };
  }
  if (!f.slots || Object.keys(f.slots).length === 0) {
    return {
      check: 'slots',
      status: 'unknown',
      reason: `${f.actor} has no spell slots on the sheet (innate or item casting uses charges instead).`,
    };
  }
  const slot = f.slots[`level${wanted}`];
  if (slot && slot.current > 0) {
    return {
      check: 'slots',
      status: 'pass',
      reason: `${slot.current} of ${slot.max} level ${wanted} slots left.`,
    };
  }
  const pact = f.slots.pact;
  if (
    pact &&
    pact.current > 0 &&
    pact.level != null &&
    pact.level >= wanted &&
    (f.castLevel === null || f.castLevel === pact.level)
  ) {
    return {
      check: 'slots',
      status: 'pass',
      reason: `${pact.current} of ${pact.max} pact slots left (level ${pact.level}).`,
    };
  }
  if (f.castLevel === null) {
    for (let level = wanted + 1; level <= 9; level++) {
      const higher = f.slots[`level${level}`];
      if (higher && higher.current > 0) {
        return {
          check: 'slots',
          status: 'pass',
          reason: `No level ${wanted} slot left, but a level ${level} slot is (${higher.current} of ${higher.max}); it can be cast at that level.`,
        };
      }
    }
  }
  const none = `No level ${wanted}${f.castLevel === null ? ' or higher' : ''} spell slot left`;
  if (f.ritual || f.spellMethod === 'ritual') {
    return {
      check: 'slots',
      status: 'warn',
      reason: `${none}, but it can be cast as a ritual (longer, and not in a combat round).`,
    };
  }
  return { check: 'slots', status: 'fail', reason: `${none}.` };
}

function usesCheck(f: RulesFacts): RulesCheckLine | null {
  const limited = f.uses.filter(u => u.max > 0);
  if (limited.length === 0) return null;
  const empty = limited.find(u => u.value <= 0);
  if (empty) {
    return {
      check: 'uses',
      status: 'fail',
      reason: `No uses left (0 of ${empty.max}${empty.recovery ? `, recovers on ${empty.recovery}` : ''}).`,
    };
  }
  const first = limited[0];
  return { check: 'uses', status: 'pass', reason: `${first.value} of ${first.max} uses left.` };
}

/** Only for a concentration spell: casting it ends the concentration the actor already holds. */
function concentrationCheck(f: RulesFacts): RulesCheckLine | null {
  if (!f.needsConcentration || !f.concentration) return null;
  if (!f.concentration.active) {
    return {
      check: 'concentration',
      status: 'info',
      reason: `${f.item} needs concentration; ${f.actor} is not concentrating on anything else.`,
    };
  }
  const held = f.concentration.spell;
  return {
    check: 'concentration',
    status: 'warn',
    reason: `${f.item} needs concentration, and ${f.actor} is already concentrating${held ? ` on ${held}` : ''}: casting it drops that${held ? ` (${held})` : ''}.`,
  };
}

function verdictOf(checks: RulesCheckLine[]): RulesCheckVerdict {
  if (checks.some(c => c.status === 'fail')) return 'problem';
  if (checks.some(c => c.status === 'warn' || c.status === 'unknown')) return 'unclear';
  return 'legal';
}

export interface MoveFact {
  /** The token that moves (also the combatant's name). */
  name: string;
  distance: number;
  units: string;
  speed: number | null;
  speedUnits: string | null;
  combat: CombatFact;
}

const MOVE_LIMITS = [
  'The distance is a straight line between the squares; the route, difficult terrain, walls and the movement already used this turn are not counted.',
  'Foundry places the token, so only the creature walking speed (or its best other speed) is compared.',
];

const unitOf = (u: string | null): string => {
  const text = (u ?? 'ft').trim().toLowerCase();
  return /^(ft|feet|foot)/.test(text) ? 'ft' : /^(m|meters?|metres?)$/.test(text) ? 'm' : text;
};

function moveLine(f: MoveFact): RulesCheckLine | null {
  const c = f.combat;
  // Moving a token outside a fight is the table's business, not a rules question.
  if (!c.active || !c.inCombat || c.ambiguous) return null;
  const check = 'movement' as const;
  const unit = unitOf(f.units);
  if (unit !== unitOf(f.speedUnits)) {
    return {
      check,
      status: 'unknown',
      reason: `${f.name}: the scene and the speed use different units, so the move is not compared with speed.`,
    };
  }
  if (f.speed === null) {
    return {
      check,
      status: 'unknown',
      reason: `${f.name} has no speed on the sheet, so a ${f.distance} ${unit} move is not compared with it.`,
    };
  }
  const where = c.isCurrentTurn
    ? ''
    : ` It is ${c.currentName ?? 'someone else'}'s turn, not ${f.name}'s.`;
  if (f.distance <= f.speed) {
    return {
      check,
      status: c.isCurrentTurn ? 'pass' : 'info',
      reason: `${f.name} moves ${f.distance} ${unit}, within its speed of ${f.speed} ${unit}.${where}`,
    };
  }
  if (f.distance <= f.speed * 2) {
    return {
      check,
      status: 'warn',
      reason: `${f.name} moves ${f.distance} ${unit}, past its speed of ${f.speed} ${unit}: only possible with the Dash action.${where}`,
    };
  }
  return {
    check,
    status: 'fail',
    reason: `${f.name} moves ${f.distance} ${unit}, more than twice its speed of ${f.speed} ${unit}, so not even a Dash covers it.${where}`,
  };
}

/** The advisory movement check for a token move; null when there is nothing to say (no fight). */
export function evaluateMovement(facts: MoveFact[]): RulesCheckResult | null {
  const checks = facts.map(moveLine).filter((l): l is RulesCheckLine => l !== null);
  if (checks.length === 0) return null;
  const verdict = verdictOf(checks);
  const names = facts.map(f => f.name).join(', ');
  const reasons = (status: RulesCheckLine['status'][]): string =>
    checks
      .filter(c => status.includes(c.status))
      .map(c => c.reason)
      .join(' ');
  const summary =
    verdict === 'problem'
      ? `Move ${names}: not legal. ${reasons(['fail'])}`
      : verdict === 'unclear'
        ? `Move ${names}: nothing rules it out, but check this. ${reasons(['warn', 'unknown'])}`
        : `Move ${names}: looks legal.`;
  return { verdict, actor: names, item: 'Move', checks, summary, limits: MOVE_LIMITS };
}

/** The whole report for one actor, item and optional target. */
export function evaluateAction(f: RulesFacts): RulesCheckResult {
  const cost = classifyActivation(f.activation);
  const checks: RulesCheckLine[] = [turnCheck(f, cost), costCheck(f, cost), rangeCheck(f)];
  const slots = slotCheck(f);
  if (slots) checks.push(slots);
  const uses = usesCheck(f);
  if (uses) checks.push(uses);
  const concentration = concentrationCheck(f);
  if (concentration) checks.push(concentration);
  const version = rulesCheck(f);
  if (version) checks.push(version);
  const verdict = verdictOf(checks);
  const about = `${f.actor} using ${f.item}${f.target ? ` on ${f.target}` : ''}`;
  const reasons = (status: RulesCheckLine['status'][]): string =>
    checks
      .filter(c => status.includes(c.status))
      .map(c => c.reason)
      .join(' ');
  const summary =
    verdict === 'problem'
      ? `${about}: not legal. ${reasons(['fail'])}`
      : verdict === 'unclear'
        ? `${about}: nothing rules it out, but check this. ${reasons(['warn', 'unknown'])}`
        : `${about}: looks legal.`;
  return {
    verdict,
    actor: f.actor,
    item: f.item,
    ...(f.target ? { target: f.target } : {}),
    checks,
    summary,
    limits: f.spent ? [LIMITS_TRACKED, ...LIMITS.slice(1)] : LIMITS,
  };
}
