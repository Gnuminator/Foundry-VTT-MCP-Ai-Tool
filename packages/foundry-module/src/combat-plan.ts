/**
 * Combat plans (David's GM test): the module's read-only `planCombatChange` query turns one
 * `plan-combat-change` request into guarded ops, so starting and ending a fight show in Recent
 * Changes with Undo like damage and scene dressing do. Nothing is written here; the bridge stores the ops as a
 * plan and `apply-planned-change` runs them.
 *
 * - start: one `create` of a Combat on the viewed scene with a combatant per token (the given
 *   ids, else the player characters and the Hostile tokens), already at round 1, turn 0.
 *   Initiative is not rolled. Undo deletes the Combat.
 * - end: one `delete` of the Combat. Undo re-creates it from the stored source data with its id,
 *   so the round, the turn and the combatants (with their initiative) come back.
 *
 * The wire contract is `shared/src/combat-change.ts`; only its types are imported (the browser
 * cannot resolve `@gnuminator/shared` at runtime). The query name is mirrored here and pinned by
 * `combat-plan.test.ts`.
 */
import type {
  CombatChangePlan,
  CombatChangeRequest,
  CombatEndRequest,
  CombatStartRequest,
} from '@gnuminator/shared';

import * as shared from './data-access/shared.js';
import { requireCurrentScene, type SceneDoc } from './scene-plan-geometry.js';

/** Query name (mirror of the shared `COMBAT_PLAN_QUERY`). */
export const COMBAT_PLAN_QUERY = 'planCombatChange';

/** Foundry removes these when a fight ends; Undo re-creates the Combat only. */
const END_WARNING =
  'Ending the fight also removes effects that end with combat (expired or special-duration ones) and clears token movement history. Undo brings the fight back with its round, turn and initiative, but not those.';

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

/** The tokens a fight starts with when the caller names none: player characters and Hostiles. */
function isDefaultCombatToken(token: SceneDoc): boolean {
  const actor = token.actor;
  const isPC = !!actor?.hasPlayerOwner && actor?.type === 'character';
  return isPC || token.disposition === -1;
}

function planStart(request: CombatStartRequest): CombatChangePlan {
  shared.validateFoundryState();
  const scene = request.sceneId ? game.scenes?.get(request.sceneId) : requireCurrentScene();
  if (!scene) throw new Error('Scene not found: ' + String(request.sceneId));
  const running = (game.combats?.contents ?? []).find(
    (c: { scene?: { id?: string } | null }) => c.scene?.id === scene.id
  );
  if (running) {
    throw new Error(
      `A combat already runs on "${String(scene.name)}". End it first, or add to it in Foundry.`
    );
  }
  const all: SceneDoc[] = scene.tokens?.contents ?? [];
  const wanted = Array.isArray(request.tokenIds) ? request.tokenIds.map(String) : null;
  const skipped: string[] = [];
  let picked: SceneDoc[];
  if (wanted) {
    picked = [];
    for (const id of new Set(wanted)) {
      const token = all.find(t => t.id === id);
      if (token) picked.push(token);
      else skipped.push(`${id} (not on this scene)`);
    }
  } else {
    picked = all.filter(isDefaultCombatToken);
  }
  const combatants: Record<string, unknown>[] = [];
  const names: string[] = [];
  for (const token of picked) {
    const name = String(token.name ?? token.id);
    if (!token.actorId && !token.actor) {
      skipped.push(`${name} (no actor)`);
      continue;
    }
    combatants.push({
      tokenId: token.id,
      sceneId: scene.id,
      actorId: token.actorId ?? token.actor?.id,
      hidden: token.hidden === true,
    });
    names.push(name);
  }
  if (combatants.length === 0) {
    throw new Error(
      wanted
        ? 'None of the chosen tokens can fight.'
        : 'No player character or Hostile token on this scene.'
    );
  }
  const count = names.length;
  return {
    summary: `Start combat on "${String(scene.name)}" with ${count} token${count === 1 ? '' : 's'}`,
    ops: [
      {
        kind: 'create',
        documentName: 'Combat',
        // Already begun (round 1, turn 0): the dashboard shows a fight only once it has begun, and
        // a create op cannot call Combat#startCombat. The recorder logs the start on createCombat.
        data: { scene: scene.id, active: true, round: 1, turn: 0, combatants },
      },
    ],
    combatants: names,
    ...(skipped.length > 0 ? { skipped } : {}),
  };
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
    warning: END_WARNING,
  };
}

/** Build the plan for one request. Throws when nothing would change. */
export async function planCombatChange(data: unknown): Promise<CombatChangePlan> {
  const request = data as CombatChangeRequest | null | undefined;
  switch (request?.action) {
    case 'start':
      return planStart(request);
    case 'end':
      return planEnd(request);
    default:
      throw new Error(`Unknown action "${String((data as { action?: unknown } | null)?.action)}"`);
  }
}
