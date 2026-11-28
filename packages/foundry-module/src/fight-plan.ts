/**
 * The plan stamped on a `combat-start` play record (encounter afterglow): the party's levels and
 * max HP, the foes' summed XP and the XP budget of a low, moderate and high fight of this party.
 * The stats builder later joins it with what the fight cost.
 */
import { asRecord } from '@gnuminator/shared/browser';
import { encounterBudgets } from './encounter-budget.js';

const num = (v: unknown): number | undefined =>
  typeof v === 'number' && Number.isFinite(v) ? v : undefined;

/** `null` when no combatant is a player character or anything throws. */
export function fightPlanOf(
  combatants: { actor?: unknown; name?: unknown; token?: unknown }[]
): Record<string, unknown> | null {
  try {
    const party: { name: string; level: number; hpMax: number }[] = [];
    let foeXp = 0;
    let foes = 0;
    const seen = new Set<string>();
    for (const combatant of combatants) {
      const actor = asRecord(combatant.actor);
      if (!actor) continue;
      const system = asRecord(actor.system);
      if (actor.type === 'character') {
        const id = typeof actor.uuid === 'string' ? actor.uuid : '';
        if (id && seen.has(id)) continue; // two combatants of one character count once
        seen.add(id);
        party.push({
          name:
            typeof actor.name === 'string'
              ? actor.name
              : typeof combatant.name === 'string'
                ? combatant.name
                : 'PC',
          level: num(asRecord(system?.details)?.level) ?? 1,
          hpMax: num(asRecord(asRecord(system?.attributes)?.hp)?.max) ?? 0,
        });
      } else {
        // A friendly or neutral token (an ally, a summon) is not part of the opposition.
        const disposition = num(asRecord(combatant.token)?.disposition);
        if (disposition !== undefined && disposition >= 0) continue;
        foes++;
        foeXp += num(asRecord(asRecord(system?.details)?.xp)?.value) ?? 0;
      }
    }
    if (party.length === 0) return null;
    const cfg = asRecord((globalThis as { CONFIG?: { DND5E?: unknown } }).CONFIG?.DND5E);
    return {
      party,
      foes,
      foeXp,
      budgets: encounterBudgets(
        cfg?.ENCOUNTER_DIFFICULTY,
        party.map(p => p.level)
      ),
    };
  } catch {
    return null;
  }
}
