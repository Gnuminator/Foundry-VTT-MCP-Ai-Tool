/**
 * Bridge handlers about chat and rolls: the chat log, combat play-by-play, in-character chat
 * and the roll requests and NPC rolls (all of them new chat messages players see).
 */
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { withCtx, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerChatRollHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Chat log / combat play-by-play / in-character chat
  table.set(`${MODULE_ID}.getChatLog`, 'read', withCtx(ctx, getChatLog));
  table.set(`${MODULE_ID}.getCombatPlayByPlay`, 'read', () => getCombatPlayByPlay(ctx));
  table.set(`${MODULE_ID}.sendChatMessage`, 'recordless-write', withCtx(ctx, sendChatMessage));

  // Roll requests (interactive roll buttons in chat) and NPC rolls
  table.set(
    `${MODULE_ID}.request-player-rolls`,
    'recordless-write',
    withCtx(ctx, requestPlayerRolls)
  );
  table.set(`${MODULE_ID}.rollNpcCheck`, 'recordless-write', withCtx(ctx, rollNpcCheck));
}

async function getChatLog(
  ctx: QueryContext,
  data: {
    limit?: number;
    speakerName?: string;
    messageType?: string;
    sinceTimestamp?: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get chat log', async () => {
    return await ctx.dataAccess.getChatLog(data || {});
  });
}

async function getCombatPlayByPlay(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get combat play-by-play', async () => {
    return await ctx.dataAccess.getCombatPlayByPlay();
  });
}

async function sendChatMessage(
  ctx: QueryContext,
  data: {
    message: string;
    speakerActorId?: string;
    speakerActorName?: string;
    messageType?: string;
    whisperTargets?: string[];
  }
): Promise<unknown> {
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
  data: {
    rollType: string;
    rollTarget: string;
    targetPlayer: string;
    isPublic: boolean;
    rollModifier: string;
    flavor: string;
    dc?: number;
    advantage?: 'advantage' | 'disadvantage';
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to request player rolls', async () => {
    if (!data.rollType || !data.rollTarget || !data.targetPlayer) {
      throw new Error('rollType, rollTarget, and targetPlayer are required');
    }

    return await ctx.dataAccess.requestPlayerRolls(data);
  });
}

async function rollNpcCheck(
  ctx: QueryContext,
  data: {
    actorName: string;
    rollType: string;
    rollTarget: string;
    isPublic: boolean;
    advantage?: 'advantage' | 'disadvantage';
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to roll NPC check', async () => {
    if (!data?.actorName) throw new Error('actorName is required');
    if (!data?.rollType) throw new Error('rollType is required');
    if (!data?.rollTarget) throw new Error('rollTarget is required');
    return await ctx.dataAccess.rollNpcCheck(data);
  });
}
