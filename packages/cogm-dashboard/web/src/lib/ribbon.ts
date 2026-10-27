// The initiative ribbon's rules (UI-07): the turn order as one strip, the creature up now first,
// then the next two, then the rest fading out, with the round break where the order wraps and the
// lair action's place at its count. Pure functions over the stream's fight (lib/combat.ts), so
// they have unit tests; components/InitiativeRibbon.tsx draws it. It reads the fight the strip
// already has: no second poll and nothing written.

import { sideOf, type Combatant, type CombatState, type Side } from './combat';

/** Who stands out: `current` is up now, `next` are the two after, `later` fade, `down` are out. */
export type RibbonRole = 'current' | 'next' | 'later' | 'down';

export interface RibbonCreature {
  kind: 'creature';
  id: string;
  name: string;
  initials: string;
  initiative: number | null;
  side: Side;
  role: RibbonRole;
  hpPercent: number;
  /** The condition names to show, concentration first. */
  conditions: string[];
  concentrating: boolean;
}

/** Where the order wraps: everything after it is the next round. */
export interface RibbonRoundBreak {
  kind: 'round';
  round: number;
}

/** The lair action, at its count (20 unless the boss says otherwise). */
export interface RibbonLair {
  kind: 'lair';
  count: number;
}

export type RibbonItem = RibbonCreature | RibbonRoundBreak | RibbonLair;

/** How many creatures after the current one read clearly before the rest fade. */
export const NEXT_COUNT = 2;

/** Up to two letters: the first letters of the first two words, or the first two of one word. */
export function initialsOf(name: string): string {
  const words = name.trim().split(/\s+/).filter(Boolean);
  if (words.length === 0) return '?';
  const first = words[0] ?? '';
  const second = words[1] ?? '';
  const letters = words.length > 1 ? first.charAt(0) + second.charAt(0) : first.slice(0, 2);
  return letters.toLocaleUpperCase();
}

const isConcentration = (condition: string): boolean => /concentrat/i.test(condition);

/** The lair count of the first boss with a lair, or null when no creature in the fight has one. */
export function lairCount(combatants: readonly Combatant[]): number | null {
  for (const c of combatants) {
    const lair = c.boss?.lair;
    if (!lair || c.defeated) continue;
    if (lair.inside || typeof lair.initiative === 'number') return lair.initiative ?? 20;
  }
  return null;
}

function creatureOf(c: Combatant, role: RibbonRole): RibbonCreature {
  const concentrating = c.conditions.some(isConcentration);
  const max = c.hp.max;
  return {
    kind: 'creature',
    id: c.id,
    name: c.name,
    initials: initialsOf(c.name),
    initiative: c.initiative,
    side: sideOf(c),
    role,
    hpPercent: max > 0 ? Math.max(0, Math.min(100, (c.hp.value / max) * 100)) : 0,
    conditions: [
      ...c.conditions.filter(isConcentration),
      ...c.conditions.filter(cond => !isConcentration(cond)),
    ],
    concentrating,
  };
}

/**
 * The strip for one fight, starting at the creature whose turn it is and running one full lap:
 * the rest of this round, the round break, then the creatures already gone this round (and the
 * lair marker wherever its count falls). The two after the current one that are still standing
 * are `next`; defeated creatures are `down` and never count as next. Null for no fight, nobody
 * in it, or a turn that points outside the list.
 */
export function ribbonItems(combat: CombatState | null): RibbonItem[] | null {
  if (!combat || combat.combatants.length === 0) return null;
  const list = combat.combatants;
  const turn = combat.turn;
  if (turn < 0 || turn >= list.length) return null;

  const count = lairCount(list);
  // Round order with the lair marker in its place: before the first creature under its count.
  const order: Array<Combatant | RibbonLair> = [...list];
  let lairAt = -1;
  if (count !== null) {
    // Nobody under the count: the lair acts after everyone, at the end of the round.
    const idx = list.findIndex(c => c.initiative === null || c.initiative < count);
    lairAt = idx < 0 ? list.length : idx;
    order.splice(lairAt, 0, { kind: 'lair', count });
  }
  // Where the current creature sits in that order (the marker shifted everything after it).
  const start = lairAt >= 0 && lairAt <= turn ? turn + 1 : turn;

  const out: RibbonItem[] = [];
  let nextLeft = NEXT_COUNT;
  const push = (entry: Combatant | RibbonLair, isCurrent: boolean): void => {
    if ('kind' in entry) {
      out.push(entry);
      return;
    }
    if (isCurrent) {
      out.push(creatureOf(entry, 'current'));
    } else if (entry.defeated) {
      out.push(creatureOf(entry, 'down'));
    } else if (nextLeft > 0) {
      nextLeft -= 1;
      out.push(creatureOf(entry, 'next'));
    } else {
      out.push(creatureOf(entry, 'later'));
    }
  };

  order.slice(start).forEach((entry, i) => push(entry, i === 0));
  if (start > 0) {
    out.push({ kind: 'round', round: combat.round + 1 });
    order.slice(0, start).forEach(entry => push(entry, false));
  }
  return out;
}

/** The ribbon in words, for a screen reader: whose turn it is and who is next. */
export function ribbonSummary(items: readonly RibbonItem[]): string {
  const creatures = items.filter((i): i is RibbonCreature => i.kind === 'creature');
  const current = creatures.find(c => c.role === 'current');
  const next = creatures.filter(c => c.role === 'next').map(c => c.name);
  if (!current) return 'Turn order';
  if (next.length === 0) return `${current.name} is up`;
  return `${current.name} is up, then ${next.join(' and ')}`;
}
