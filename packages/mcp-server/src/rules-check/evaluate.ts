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
  /** Keyed `level1`..`level9` and `pact`, as `get-character-resources` reports them. */
  slots: Record<string, SlotFact> | undefined;
  /** The item's own uses, then the chosen activity's. */
  uses: UsesFact[];
}

const LIMITS = [
  'Foundry does not record which actions, bonus actions or reactions a creature has already spent this turn, so that part is never confirmed.',
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

function costCheck(f: RulesFacts, cost: Cost): RulesCheckLine {
  const label = f.activation ? `"${f.activation}"` : 'no activation';
  const inRound = f.combat.active && f.combat.inCombat;
  switch (cost) {
    case 'action':
    case 'bonus':
    case 'reaction': {
      const name =
        cost === 'action' ? 'an action' : cost === 'bonus' ? 'a bonus action' : 'a reaction';
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

function slotCheck(f: RulesFacts): RulesCheckLine | null {
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
  if (f.spellMethod === 'atwill' || f.spellMethod === 'innate') {
    return {
      check: 'slots',
      status: 'info',
      reason: `Cast ${f.spellMethod === 'atwill' ? 'at will' : 'innately'}, so it uses no spell slot (any uses are checked below).`,
    };
  }
  if (f.spellMethod === 'pact') {
    const pact = f.slots?.pact;
    if (!pact || pact.level == null) {
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

function verdictOf(checks: RulesCheckLine[]): RulesCheckVerdict {
  if (checks.some(c => c.status === 'fail')) return 'problem';
  if (checks.some(c => c.status === 'warn' || c.status === 'unknown')) return 'unclear';
  return 'legal';
}

/** The whole report for one actor, item and optional target. */
export function evaluateAction(f: RulesFacts): RulesCheckResult {
  const cost = classifyActivation(f.activation);
  const checks: RulesCheckLine[] = [turnCheck(f, cost), costCheck(f, cost), rangeCheck(f)];
  const slots = slotCheck(f);
  if (slots) checks.push(slots);
  const uses = usesCheck(f);
  if (uses) checks.push(uses);
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
    limits: LIMITS,
  };
}
