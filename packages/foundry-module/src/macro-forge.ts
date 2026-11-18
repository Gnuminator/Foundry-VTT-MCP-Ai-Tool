/**
 * Macro forge (I-189): the module's rule for changing a Macro through a guarded write. A Macro is
 * created only by `plan-macro` (checked by `assertMacroCreateData` in the shared package) and is
 * never edited by a plan: changing its script, type or who owns it would get around the source
 * check. Undo and rollback put back what Foundry recorded, so they may write any field.
 */

const RESTORE_FEATURES = new Set(['change-undo', 'rollback']);

/** Throws unless the update only touches harmless fields (or is an undo or rollback). */
export function assertMacroUpdateAllowed(feature: string, paths: readonly string[]): void {
  if (RESTORE_FEATURES.has(feature)) return;
  const field = (path: string): string => path.replace(/^[-=]=/, '').split('.')[0] ?? '';
  const refused = paths.find(path =>
    ['command', 'type', 'ownership', 'author', 'flags', 'scope'].includes(field(path))
  );
  if (refused !== undefined) {
    throw new Error(
      `A Macro's ${field(refused)} cannot be changed through a guarded write (got "${refused}"); plan a new macro instead`
    );
  }
}
