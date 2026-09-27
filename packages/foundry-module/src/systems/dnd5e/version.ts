/**
 * dnd5e system version detection (plan step 0.4).
 *
 * dnd5e 5.3.x runs on Foundry 13 and 14; dnd5e 6.0.x needs Foundry 14.367+.
 * The switch is feature-detected, not version-compared: dnd5e 6 registers an
 * ActiveEffect subtype `condition` (conditions become typed effects with
 * `system.type` and `system.level`).
 */

/** Whether the running game system is dnd5e. */
export function isDnd5e(): boolean {
  return game.system?.id === 'dnd5e';
}

/** Whether dnd5e 6-style data is in use (typed `condition` ActiveEffects). */
export function isDnd5eV6(): boolean {
  if (!isDnd5e()) return false;
  const effectTypes = game.system.documentTypes?.ActiveEffect;
  return (
    effectTypes !== undefined && Object.prototype.hasOwnProperty.call(effectTypes, 'condition')
  );
}
