/**
 * Bridge handlers about chat and rolls: the chat log, combat play-by-play, in-character chat
 * and the roll requests and NPC rolls (all of them new chat messages players see).
 */
import type { BridgeAnswer, BridgeMethod, BridgeRequest } from '@gnuminator/shared';
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { setNpcOnStage } from '../npc-on-stage.js';
import type { QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerChatRollHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Chat log / combat play-by-play / in-character chat
  table.on(`${MODULE_ID}.getChatLog`, 'read', data => getChatLog(ctx, data));
  table.on(`${MODULE_ID}.getCombatPlayByPlay`, 'read', () => getCombatPlayByPlay(ctx));
  table.on(`${MODULE_ID}.sendChatMessage`, 'recordless-write', data => sendChatMessage(ctx, data));

  // NPC on stage: the Table TV shows who the GM speaks as (a world setting, no chat message)
  table.on(`${MODULE_ID}.setNpcOnStage`, 'recordless-write', data =>
    ctx.withGmGate('Failed to set NPC on stage', () => setNpcOnStage(data ?? {}))
  );

  // Roll requests (interactive roll buttons in chat) and NPC rolls
  table.on(`${MODULE_ID}.request-player-rolls`, 'recordless-write', data =>
    requestPlayerRolls(ctx, data)
  );
  table.on(`${MODULE_ID}.rollNpcCheck`, 'recordless-write', data => rollNpcCheck(ctx, data));
}

type Answer<M extends BridgeMethod> = Promise<BridgeAnswer<M>>;
type Req<M extends BridgeMethod> = BridgeRequest<M>;

async function getChatLog(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.getChatLog`>
): Answer<`${typeof MODULE_ID}.getChatLog`> {
  return ctx.withGmGate('Failed to get chat log', async () => {
    return await ctx.dataAccess.getChatLog(data || {});
  });
}

async function getCombatPlayByPlay(
  ctx: QueryContext
): Answer<`${typeof MODULE_ID}.getCombatPlayByPlay`> {
  return ctx.withGmGate('Failed to get combat play-by-play', async () => {
    return await ctx.dataAccess.getCombatPlayByPlay();
  });
}

async function sendChatMessage(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.sendChatMessage`>
): Answer<`${typeof MODULE_ID}.sendChatMessage`> {
  return ctx.withGmGate('Failed to send chat message', async () => {
    if (!data?.message) {
      throw new Error('message is required');
    }
    return await ctx.dataAccess.sendChatMessage(data);
  });
}

/**
 * Handle request player rolls - creates interactive roll buttons in chat
 */
async function requestPlayerRolls(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.request-player-rolls`>
): Answer<`${typeof MODULE_ID}.request-player-rolls`> {
  return ctx.withGmGate('Failed to request player rolls', async () => {
    if (!data.rollType || !data.rollTarget || !data.targetPlayer) {
      throw new Error('rollType, rollTarget, and targetPlayer are required');
    }

    return await ctx.dataAccess.requestPlayerRolls(data);
  });
}

async function rollNpcCheck(
  ctx: QueryContext,
  data: Req<`${typeof MODULE_ID}.rollNpcCheck`>
): Answer<`${typeof MODULE_ID}.rollNpcCheck`> {
  return ctx.withGmGate('Failed to roll NPC check', async () => {
    if (!data?.actorName) throw new Error('actorName is required');
    if (!data?.rollType) throw new Error('rollType is required');
    if (!data?.rollTarget) throw new Error('rollTarget is required');
    return await ctx.dataAccess.rollNpcCheck(data);
  });
}
