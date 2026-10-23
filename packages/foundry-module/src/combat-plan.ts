/**
 * Combat plans (David's GM test): the module's read-only `planCombatChange` query turns one
 * `plan-combat-change` request into guarded ops, so ending a fight shows in Recent Changes with
 * Undo like damage and scene dressing do. Nothing is written here; the bridge stores the ops as a
 * plan and `apply-planned-change` runs them.
 *
 * - end: one `delete` of the Combat. Undo re-creates it from the stored source data with its id,
 *   so the round, the turn and the combatants (with their initiative) come back.
 *
 * The wire contract is `shared/src/combat-change.ts`; only its types are imported (the browser
 * cannot resolve `@gnuminator/shared` at runtime). The query name is mirrored here and pinned by
 * `combat-plan.test.ts`.
 */
import type { CombatChangePlan, CombatChangeRequest, CombatEndRequest } from '@gnuminator/shared';

import * as shared from './data-access/shared.js';

/** Query name (mirror of the shared `COMBAT_PLAN_QUERY`). */
export const COMBAT_PLAN_QUERY = 'planCombatChange';

interface CombatDoc {
  id?: string;
  uuid?: string;
  round?: number;
  scene?: { name?: string | null } | null;
  combatants?: { size?: number; contents?: unknown[] } | unknown[];
}

function combatantCount(combat: CombatDoc): number {
  const c = combat.combatants;
  if (Array.isArray(c)) return c.length;
  return c?.size ?? c?.contents?.length ?? 0;
}

function planEnd(request: CombatEndRequest): CombatChangePlan {
  shared.validateFoundryState();
  const wanted = typeof request.combatId === 'string' && request.combatId ? request.combatId : null;
  const combat = (wanted ? game.combats?.get(wanted) : game.combat) as CombatDoc | null | undefined;
  if (!combat?.id) {
    throw new Error(wanted ? `Combat not found: ${wanted}` : 'No active combat encounter.');
  }
  const round = combat.round ?? 0;
  const count = combatantCount(combat);
  const where = combat.scene?.name ? ` on "${combat.scene.name}"` : '';
  const summary = `End combat${where} (round ${round}, ${count} combatant${count === 1 ? '' : 's'})`;
  return {
    summary,
    ops: [{ kind: 'delete', uuid: combat.uuid ?? `Combat.${combat.id}` }],
    combatId: combat.id,
  };
}

/** Build the plan for one request. Throws when nothing would change. */
export async function planCombatChange(data: unknown): Promise<CombatChangePlan> {
  const request = data as CombatChangeRequest | null | undefined;
  switch (request?.action) {
    case 'end':
      return planEnd(request);
    default:
      throw new Error(`Unknown action "${String((data as { action?: unknown } | null)?.action)}"`);
  }
}
