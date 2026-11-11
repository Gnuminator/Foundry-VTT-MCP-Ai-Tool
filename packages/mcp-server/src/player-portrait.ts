/**
 * `player_portrait` (control method; never an MCP tool, the stdio wrapper never forwards it):
 * a player put their own art on a character they own, from the dashboard's player page.
 *
 * 1. The bytes are checked here (type by content, size cap), whatever the dashboard did.
 * 2. The module query `uploadPlayerPortrait` checks the player owns the character and stores the
 *    file in `assets/players/<slug>-<user id>/` under a name it makes (a write behind the write gate).
 * 3. The actor change (`img`, and the prototype token's picture when the player picked it) is a
 *    guarded write under the `player-portrait` feature: it shows in Recent Changes and Undo puts
 *    the old picture path back. The file stays in the player's folder.
 */
import {
  PLAYER_PORTRAIT_FEATURE_ID,
  PORTRAIT_MAX_BYTES,
  sniffPortraitType,
  type GuardedFeatureState,
  type GuardedOp,
  type PlayerPortraitResult,
  type PortraitTarget,
  type UploadPlayerPortraitReply,
} from '@gnuminator/shared';

import type { GuardedWriteService } from './guarded-write/service.js';

export interface PortraitFoundry {
  query(method: string, data?: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
}

const ID = /^[A-Za-z0-9]{16}$/;
const UPLOAD_TIMEOUT_MS = 60_000;

/** Errors a player may read as they are; the dashboard shows `message` as it is. */
export class PortraitError extends Error {}

function decodeBase64(data: string): Uint8Array {
  return new Uint8Array(Buffer.from(data, 'base64'));
}

export async function handlePlayerPortrait(
  foundry: PortraitFoundry,
  guardedWrites: Pick<GuardedWriteService, 'createPlan' | 'applyPlan'>,
  params: unknown
): Promise<PlayerPortraitResult> {
  const p = (params ?? {}) as {
    userId?: unknown;
    actorId?: unknown;
    target?: unknown;
    data?: unknown;
  };
  if (typeof p.userId !== 'string' || !ID.test(p.userId))
    throw new PortraitError('A player is required.');
  if (typeof p.actorId !== 'string' || !ID.test(p.actorId)) {
    throw new PortraitError('A character is required.');
  }
  const target: PortraitTarget = p.target === 'both' ? 'both' : 'portrait';
  if (typeof p.data !== 'string' || p.data === '')
    throw new PortraitError('A picture is required.');
  const bytes = decodeBase64(p.data);
  if (bytes.length > PORTRAIT_MAX_BYTES)
    throw new PortraitError('That picture is too big. The limit is 5 MB.');
  const type = sniffPortraitType(bytes);
  if (!type) throw new PortraitError('Only PNG, JPG or WebP pictures work.');

  // The switches first, so a refused write does not leave a stray file behind.
  const features = (await foundry.query('foundry-mcp-bridge.listGuardedFeatures')) as
    | GuardedFeatureState[]
    | { error?: unknown };
  const list = Array.isArray(features) ? features : [];
  if (list.length === 0 || list.some(f => f.writesAllowed === false)) {
    throw new PortraitError('Pictures cannot be changed from this page right now. Ask your GM.');
  }
  if (list.find(f => f.id === PLAYER_PORTRAIT_FEATURE_ID)?.enabled !== true) {
    throw new PortraitError('Changing your picture from this page is switched off. Ask your GM.');
  }

  const stored = (await foundry.query(
    'foundry-mcp-bridge.uploadPlayerPortrait',
    { userId: p.userId, actorId: p.actorId, type, data: Buffer.from(bytes).toString('base64') },
    { timeoutMs: UPLOAD_TIMEOUT_MS }
  )) as UploadPlayerPortraitReply;
  if (stored?.success !== true || typeof stored.path !== 'string') {
    throw new PortraitError(
      typeof stored?.error === 'string' && stored.error
        ? stored.error
        : 'Could not save the picture. Ask your GM.'
    );
  }

  const uuid = `Actor.${p.actorId}`;
  const changes: Record<string, unknown> = { img: stored.path };
  const pathLabels: Record<string, string> = { img: 'portrait' };
  if (target === 'both') {
    changes['prototypeToken.texture.src'] = stored.path;
    pathLabels['prototypeToken.texture.src'] = 'token picture';
  }
  const ops: GuardedOp[] = [{ kind: 'update', uuid, changes }];
  // Tokens already on a scene keep their own picture unless they are changed too; the same plan
  // does it, so one Undo puts them all back.
  const placed =
    target === 'both' && Array.isArray(stored.placedTokens)
      ? stored.placedTokens.filter(
          (t): t is string => typeof t === 'string' && /^Scene\.\w+\.Token\.\w+$/.test(t)
        )
      : [];
  for (const tokenUuid of placed) {
    ops.push({ kind: 'update', uuid: tokenUuid, changes: { 'texture.src': stored.path } });
  }
  if (placed.length > 0) pathLabels['texture.src'] = 'placed token picture';
  const who = typeof stored.userName === 'string' && stored.userName ? stored.userName : 'A player';
  const name = stored.actorName || 'a character';
  const plan = await guardedWrites.createPlan({
    feature: PLAYER_PORTRAIT_FEATURE_ID,
    summary: `${who} set a new ${target === 'both' ? 'portrait and token picture' : 'portrait'} for ${name} (${stored.path})${placed.length > 0 ? `, also on ${placed.length} placed token${placed.length === 1 ? '' : 's'}` : ''}`,
    ops,
    pathLabels,
  });
  const applied = await guardedWrites.applyPlan(
    plan.planId,
    { confirm: true },
    `${who} (player page)`
  );
  return { ok: true, path: stored.path, actorName: name, changeId: applied.changeId };
}
