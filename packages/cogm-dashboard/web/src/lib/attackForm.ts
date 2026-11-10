// The Attack form on the combat strip (item dashboard-attack): which combatant attacks, with which
// weapon, against whom. The words and the use-item arguments live here; nothing here sends.
import type { Combatant } from './combat';

/** The "Foundry targets" choice in the target list: the tokens targeted in Foundry when you press Attack. */
export const FOUNDRY_TARGETS = 'foundry';

export interface Weapon {
  id: string;
  name: string;
  /** What the dropdown shows: the name, with "(cantrip)" or "(level N)" on a spell. */
  label: string;
}

/** Combatants that can attack: they need a token. */
export const attackers = (combatants: ReadonlyArray<Combatant>): Combatant[] =>
  combatants.filter(c => c.tokenId !== null && !c.defeated);

/** The attacker to start with: the one whose turn it is, else the first. */
export function defaultAttacker(combatants: ReadonlyArray<Combatant>): string {
  const list = attackers(combatants);
  return (list.find(c => c.isCurrentTurn) ?? list[0])?.id ?? '';
}

/** One picked combatant (not the attacker) is the target; anything else reads Foundry's targets. */
export function defaultTarget(picked: ReadonlyArray<string>, attacker: string): string {
  const others = picked.filter(id => id !== attacker);
  return others.length === 1 && others[0] ? others[0] : FOUNDRY_TARGETS;
}

/** The weapons from search-character-items; anything else in the answer is ignored. */
export function weaponsOf(result: unknown): Weapon[] {
  const matches = (result as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((m: unknown) => {
    const r = (m ?? {}) as Record<string, unknown>;
    return typeof r['id'] === 'string' && typeof r['name'] === 'string'
      ? [{ id: r['id'], name: r['name'], label: r['name'] }]
      : [];
  });
}

/**
 * The spells from search-character-items that have an attack activity: cantrips and prepared
 * spells (an unprepared one cannot be cast). The module marks them `hasAttack`.
 */
export function spellAttacksOf(result: unknown): Weapon[] {
  const matches = (result as { matches?: unknown } | null)?.matches;
  if (!Array.isArray(matches)) return [];
  return matches.flatMap((m: unknown) => {
    const r = (m ?? {}) as Record<string, unknown>;
    if (typeof r['id'] !== 'string' || typeof r['name'] !== 'string') return [];
    if (r['hasAttack'] !== true || r['prepared'] === false) return [];
    const level = typeof r['level'] === 'number' ? r['level'] : 0;
    const label = `${r['name']} (${level === 0 ? 'cantrip' : `level ${level}`})`;
    return [{ id: r['id'], name: r['name'], label }];
  });
}

/** use-item arguments, or null while something is missing. `targets` are token ids. */
export function attackArgs(
  attackerToken: string | null,
  weaponId: string,
  targets: string[]
): Record<string, unknown> | null {
  if (!attackerToken || !weaponId || targets.length === 0) return null;
  return {
    actorIdentifier: attackerToken,
    itemIdentifier: weaponId,
    targets,
    rollAttack: true,
  };
}

export const NO_TARGET_NOTE =
  'Nothing is targeted in Foundry. Target a token there or pick one in the list.';

export const LANDED_NOTE = 'It may have landed. Check the feed before you attack again.';

export function attackLabel(attacker: string, weapon: string, target: string): string {
  return weapon ? `${attacker} attacks ${target} with ${weapon}` : 'Pick a weapon';
}
