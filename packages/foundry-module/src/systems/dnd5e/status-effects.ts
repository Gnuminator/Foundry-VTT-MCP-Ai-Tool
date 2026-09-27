/**
 * `CONFIG.statusEffects` across dnd5e versions (plan step 0.4).
 *
 * Core and dnd5e 5.x keep an array of `{id, name, img, ...}`; dnd5e 6.0
 * replaces it with an object keyed by id. Read it only through these helpers.
 * To apply or remove a condition, use `actor.toggleStatusEffect(id, {active})`
 * (both versions; dnd5e 6 adds `levels` for exhaustion) rather than creating
 * raw effects: dnd5e 6 conditions are typed effects (`type: 'condition'`).
 */

/** Every configured status effect as a list, whatever the storage shape. */
export function statusEffectList(): FoundryStatusEffect[] {
  const configured: unknown = CONFIG.statusEffects;
  if (Array.isArray(configured)) return configured as FoundryStatusEffect[];
  if (configured && typeof configured === 'object') {
    return Object.entries(configured as Record<string, FoundryStatusEffect>).map(
      ([id, effect]) => ({ ...effect, id: effect.id ?? id })
    );
  }
  return [];
}

/** A status effect by id, or by name (case-insensitive). */
export function findStatusEffect(idOrName: string): FoundryStatusEffect | undefined {
  const needle = idOrName.toLowerCase();
  const list = statusEffectList();
  return (
    list.find(effect => effect.id === idOrName) ??
    list.find(effect => typeof effect.name === 'string' && effect.name.toLowerCase() === needle)
  );
}
