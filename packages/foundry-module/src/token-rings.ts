/**
 * Dynamic token rings by default (I-093): the module's read-only `planTokenRings` query turns one
 * request into one guarded `update` op per actor (`prototypeToken.ring.enabled`). Nothing is
 * written here; the backend stores the ops as a plan under the feature `token-rings` and the
 * guarded-write system applies and undoes them.
 *
 * The wire contract is `shared/src/token-rings.ts`; only its types are imported (the browser
 * cannot resolve `@gnuminator/shared` at runtime). The names are mirrored here and pinned by
 * `token-rings.test.ts`.
 */
import type { GuardedOp, TokenRingsPlan, TokenRingsPlanRequest } from '@gnuminator/shared';

export const TOKEN_RINGS_PLAN_QUERY = 'planTokenRings';
export const TOKEN_RINGS_FEATURE_ID = 'token-rings';
export const TOKEN_RINGS_BATCH = 150;

const RING_PATH = 'prototypeToken.ring.enabled';

interface ActorLike {
  id: string;
  uuid: string;
  name: string;
  type: string;
  prototypeToken?: { ring?: { enabled?: boolean } };
}

function actors(): ActorLike[] {
  const all = (game as unknown as { actors?: { contents?: ActorLike[] } | ActorLike[] }).actors;
  return Array.isArray(all) ? all : (all?.contents ?? []);
}

function matches(actor: ActorLike, request: TokenRingsPlanRequest, names: Set<string>): boolean {
  // Group actors (the party) have no token of their own worth a ring.
  if (actor.type !== 'character' && actor.type !== 'npc') return false;
  const wanted = request.actorType ?? 'all';
  if (wanted !== 'all' && actor.type !== wanted) return false;
  if (names.size > 0 && !names.has(String(actor.name).toLowerCase())) return false;
  return true;
}

/** `planTokenRings`: one request into one plan of at most `TOKEN_RINGS_BATCH` actors. Writes nothing. */
export function planTokenRings(request: unknown): TokenRingsPlan {
  const req = request as TokenRingsPlanRequest | null;
  if (!req || typeof req !== 'object') throw new Error('A request is required.');
  if (req.action !== 'enable' && req.action !== 'disable') {
    throw new Error(`Unknown token ring action: ${String((req as { action?: unknown }).action)}`);
  }
  const names = new Set(
    (Array.isArray(req.names) ? req.names : [])
      .map(n => String(n).trim().toLowerCase())
      .filter(Boolean)
  );
  const wantOn = req.action === 'enable';
  const matching = actors().filter(a => matches(a, req, names));
  if (matching.length === 0) {
    throw new Error(
      names.size > 0
        ? 'No character or NPC in the world has one of those names.'
        : 'The world has no characters or NPCs of that kind.'
    );
  }
  const todo = matching.filter(a => Boolean(a.prototypeToken?.ring?.enabled) !== wantOn);
  const alreadyDone = matching.length - todo.length;
  if (todo.length === 0) {
    throw new Error(
      `All ${matching.length} matching actors already have their token ring ${wantOn ? 'on' : 'off'}.`
    );
  }
  const batch = todo.slice(0, TOKEN_RINGS_BATCH);
  const ops: GuardedOp[] = batch.map(a => ({
    kind: 'update',
    uuid: a.uuid,
    changes: { [RING_PATH]: wantOn },
  }));
  const remaining = todo.length - batch.length;
  const scope =
    names.size > 0
      ? `${batch.length} named actor${batch.length === 1 ? '' : 's'}`
      : `${batch.length} ${req.actorType === 'npc' ? 'NPC' : req.actorType === 'character' ? 'character' : 'actor'}${batch.length === 1 ? '' : 's'}`;
  return {
    summary: `Turn the dynamic token ring ${wantOn ? 'on' : 'off'} for ${scope}${remaining > 0 ? ` (${remaining} more need another plan)` : ''}`,
    ops,
    count: batch.length,
    remaining,
    alreadyDone,
  };
}
