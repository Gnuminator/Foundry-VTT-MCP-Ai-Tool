/**
 * Bridge handlers about combat and live play: the tracker, initiative, saves, NPC activities,
 * rests, and the plans for damage, conditions, combat changes, NPC turns, paper sync and
 * player-character creation.
 */
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { COMBAT_PLAN_QUERY, planCombatChange } from '../combat-plan.js';
import { LIVE_PLAN_QUERY, planLiveChange } from '../live-plan.js';
import { NPC_TURN_QUERY } from '../npc-turn.js';
import { planNpcTurnWithDamage } from '../npc-turn-damage.js';
import { PAPER_SYNC_QUERY, planPaperSync } from '../paper-sync-plan.js';
import { planPcCreation, PC_CREATION_QUERY } from '../pc-creation.js';
import { withCtx, type DataArg, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerCombatHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Combat tracker
  table.set(`${MODULE_ID}.getCombatState`, 'read', () => getCombatState(ctx));
  table.set(`${MODULE_ID}.advanceCombatTurn`, 'write', withCtx(ctx, advanceCombatTurn));
  table.set(`${MODULE_ID}.setInitiative`, 'write', withCtx(ctx, setInitiative));

  // Combat resolution
  table.set(`${MODULE_ID}.rollInitiativeForNpcs`, 'write', withCtx(ctx, rollInitiativeForNpcs));
  table.set(`${MODULE_ID}.rollSavingThrows`, 'recordless-write', withCtx(ctx, rollSavingThrows));
  table.set(`${MODULE_ID}.useNpcActivity`, 'write', withCtx(ctx, useNpcActivity));
  table.set(`${MODULE_ID}.manageRest`, 'write', withCtx(ctx, manageRest));

  // Live play plans (F5, D-082, read-only): damage, healing, conditions and resources
  // as guarded ops, built with a dnd5e dry run. GM client only.
  table.set(`${MODULE_ID}.${LIVE_PLAN_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to plan the change', () => planLiveChange(data))
  );

  // Combat plans (David's GM test, read-only): end a fight as a guarded delete. GM client only.
  table.set(`${MODULE_ID}.${COMBAT_PLAN_QUERY}`, 'read', (data: unknown) =>
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

async function getCombatState(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get combat state', async () => {
    return await ctx.dataAccess.getCombatState();
  });
}

async function advanceCombatTurn(ctx: QueryContext, data: { skipTo?: string }): Promise<unknown> {
  return ctx.withGmGate('Failed to advance combat turn', async () => {
    return await ctx.dataAccess.advanceCombatTurn(data || {});
  });
}

async function setInitiative(
  ctx: QueryContext,
  data: { combatantName: string; initiative: number }
): Promise<unknown> {
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
  data: {
    scope?: 'npcs' | 'all' | 'missing';
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to roll initiative', async () => {
    return await ctx.dataAccess.rollInitiativeForNpcs(data || {});
  });
}

async function rollSavingThrows(
  ctx: QueryContext,
  data: DataArg<'rollSavingThrows'>
): Promise<unknown> {
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
  data: DataArg<'useNpcActivity'>
): Promise<unknown> {
  return ctx.withGmGate('Failed to use NPC activity', async () => {
    if (!data?.actorName) throw new Error('actorName is required');
    if (!data?.itemName) throw new Error('itemName is required');
    return await ctx.dataAccess.useNpcActivity(data);
  });
}

async function manageRest(ctx: QueryContext, data: DataArg<'manageRest'>): Promise<unknown> {
  return ctx.withGmGate('Failed to manage rest', async () => {
    if (!Array.isArray(data?.targets) || data.targets.length === 0) {
      throw new Error('targets array is required');
    }
    if (!data?.restType) throw new Error('restType is required');
    return await ctx.dataAccess.manageRest(data);
  });
}
