/**
 * Bridge handlers about combat and live play: the tracker, initiative, saves, NPC activities,
 * rests, and the plans for damage, conditions, combat changes, NPC turns, paper sync and
 * player-character creation.
 */
import type { BridgeAnswer, BridgeMethod, BridgeRequest } from '@gnuminator/shared';
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { COMBAT_PLAN_QUERY, planCombatChange } from '../combat-plan.js';
import { LIVE_PLAN_QUERY, planLiveChange } from '../live-plan.js';
import { NPC_TURN_QUERY } from '../npc-turn.js';
import { planNpcTurnWithDamage } from '../npc-turn-damage.js';
import { PAPER_SYNC_QUERY, planPaperSync } from '../paper-sync-plan.js';
import { planPcCreation, PC_CREATION_QUERY } from '../pc-creation.js';
import type { QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerCombatHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Combat tracker
  table.on(`${MODULE_ID}.getCombatState`, 'read', () => getCombatState(ctx));
  table.on(`${MODULE_ID}.advanceCombatTurn`, 'write', data => advanceCombatTurn(ctx, data));
  table.on(`${MODULE_ID}.setInitiative`, 'write', data => setInitiative(ctx, data));

  // Combat resolution
  table.on(`${MODULE_ID}.rollInitiativeForNpcs`, 'write', data => rollInitiativeForNpcs(ctx, data));
  table.on(`${MODULE_ID}.rollSavingThrows`, 'recordless-write', data =>
    rollSavingThrows(ctx, data)
  );
  table.on(`${MODULE_ID}.useNpcActivity`, 'write', data => useNpcActivity(ctx, data));
  table.on(`${MODULE_ID}.manageRest`, 'write', data => manageRest(ctx, data));

  // Live play plans (F5, D-082, read-only): damage, healing, conditions and resources
  // as guarded ops, built with a dnd5e dry run. GM client only.
  table.on(`${MODULE_ID}.${LIVE_PLAN_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the change', () => planLiveChange(data))
  );

  // Combat plans (David's GM test, read-only): end a fight as a guarded delete. GM client only.
  table.on(`${MODULE_ID}.${COMBAT_PLAN_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the combat change', () => planCombatChange(data))
  );

  // NPC turn assistant (I-125, read-only): the fight, the NPC's actions and targets, and the
  // ops of a validated move. GM client only.
  table.on(`${MODULE_ID}.${NPC_TURN_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the NPC turn', () => planNpcTurnWithDamage(data))
  );

  // Paper sync (Paper nights A, read-only): the numbers on one paper sheet as guarded ops for
  // one character. GM client only.
  table.on(`${MODULE_ID}.${PAPER_SYNC_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the paper sync', () => planPaperSync(data))
  );

  // Player-character creation (pc-creation-tool, read-only): one Actor create op with items. GM only.
  table.on(`${MODULE_ID}.${PC_CREATION_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the character', () => planPcCreation(data))
  );
}

type Answer<M extends BridgeMethod> = Promise<BridgeAnswer<M>>;
type Req<M extends BridgeMethod> = BridgeRequest<M>;

async function getCombatState(ctx: QueryContext): Answer<`${typeof MODULE_ID}.getCombatState`> {
  return ctx.withGmGate('Failed to get combat state', async () => {
    return await ctx.dataAccess.getCombatState();
  });
}

async function advanceCombatTurn(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.advanceCombatTurn`>
): Answer<`${typeof MODULE_ID}.advanceCombatTurn`> {
  return ctx.withGmGate('Failed to advance combat turn', async () => {
    return await ctx.dataAccess.advanceCombatTurn(data || {});
  });
}

async function setInitiative(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.setInitiative`>
): Answer<`${typeof MODULE_ID}.setInitiative`> {
  return ctx.withGmGate('Failed to set initiative', async () => {
    if (!data?.combatantName) throw new Error('combatantName is required');
    if (data?.initiative === undefined || data?.initiative === null) {
      throw new Error('initiative is required');
    }
    return await ctx.dataAccess.setInitiative(data);
  });
}

async function rollInitiativeForNpcs(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.rollInitiativeForNpcs`>
): Answer<`${typeof MODULE_ID}.rollInitiativeForNpcs`> {
  return ctx.withGmGate('Failed to roll initiative', async () => {
    return await ctx.dataAccess.rollInitiativeForNpcs(data || {});
  });
}

async function rollSavingThrows(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.rollSavingThrows`>
): Answer<`${typeof MODULE_ID}.rollSavingThrows`> {
  return ctx.withGmGate('Failed to roll saving throws', async () => {
    if (!Array.isArray(data?.targets) || data.targets.length === 0) {
      throw new Error('targets array is required');
    }
    if (!data?.rollType) throw new Error('rollType is required');
    return await ctx.dataAccess.rollSavingThrows(data);
  });
}

async function useNpcActivity(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.useNpcActivity`>
): Answer<`${typeof MODULE_ID}.useNpcActivity`> {
  return ctx.withGmGate('Failed to use NPC activity', async () => {
    if (!data?.actorName) throw new Error('actorName is required');
    if (!data?.itemName) throw new Error('itemName is required');
    return await ctx.dataAccess.useNpcActivity(data);
  });
}

async function manageRest(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.manageRest`>
): Answer<`${typeof MODULE_ID}.manageRest`> {
  return ctx.withGmGate('Failed to manage rest', async () => {
    if (!Array.isArray(data?.targets) || data.targets.length === 0) {
      throw new Error('targets array is required');
    }
    if (!data?.restType) throw new Error('restType is required');
    return await ctx.dataAccess.manageRest(data);
  });
}
