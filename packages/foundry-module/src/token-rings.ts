/**
 * Dynamic token rings by default (I-093): the module's read-only `planTokenRings` query turns one
 * request into one guarded `update` op per actor (`prototypeToken.ring.enabled`), or with
 * `tokens: 'placed'` one op per token already placed on a scene (`ring.enabled` on the token
 * document, so unlinked tokens with their own copy are covered). Nothing is written here; the
 * backend stores the ops as a plan under the feature `token-rings` and the guarded-write system
 * applies and undoes them.
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
const TOKEN_RING_PATH = 'ring.enabled';

interface ActorLike {
  id: string;
  uuid: string;
  name: string;
  type: string;
  prototypeToken?: { ring?: { enabled?: boolean } };
}

interface TokenLike {
  uuid: string;
  name?: string;
  actor?: { name?: string; type?: string } | null;
  ring?: { enabled?: boolean };
}

interface SceneLike {
  name: string;
  tokens?: { contents?: TokenLike[] } | TokenLike[];
}

function listOf<T>(all: { contents?: T[] } | T[] | undefined): T[] {
  return Array.isArray(all) ? all : (all?.contents ?? []);
}

function actors(): ActorLike[] {
  return listOf((game as unknown as { actors?: { contents?: ActorLike[] } | ActorLike[] }).actors);
}

function scenes(): SceneLike[] {
  return listOf((game as unknown as { scenes?: { contents?: SceneLike[] } | SceneLike[] }).scenes);
}

function isRingActorType(type: string | undefined): boolean {
  // Group actors (the party) have no token of their own worth a ring.
  return type === 'character' || type === 'npc';
}

function matches(actor: ActorLike, request: TokenRingsPlanRequest, names: Set<string>): boolean {
  if (!isRingActorType(actor.type)) return false;
  const wanted = request.actorType ?? 'all';
  if (wanted !== 'all' && actor.type !== wanted) return false;
  if (names.size > 0 && !names.has(String(actor.name).toLowerCase())) return false;
  return true;
}

function lowerSet(values: unknown): Set<string> {
  return new Set(
    (Array.isArray(values) ? values : []).map(n => String(n).trim().toLowerCase()).filter(Boolean)
  );
}

function unmatchedNames(asked: unknown, seen: Set<string>): string[] {
  const out: string[] = [];
  for (const n of Array.isArray(asked) ? asked : []) {
    const key = String(n).trim().toLowerCase();
    if (key && !seen.has(key) && !out.includes(String(n).trim())) out.push(String(n).trim());
  }
  return out;
}

/** The plain-English noun for the scope of a plan, with count. */
function scopeOf(count: number, req: TokenRingsPlanRequest, named: boolean, noun: string): string {
  const plural = count === 1 ? '' : 's';
  if (named) return `${count} named ${noun}${plural}`;
  const kind = req.actorType === 'npc' ? 'NPC ' : req.actorType === 'character' ? 'character ' : '';
  return `${count} ${kind}${noun}${plural}`;
}

/** Summary line shared by both targets. */
function buildPlan(
  wantOn: boolean,
  matchingCount: number,
  ops: GuardedOp[],
  todoCount: number,
  scope: string,
  unmatched: string[]
): TokenRingsPlan {
  const remaining = todoCount - ops.length;
  const miss =
    unmatched.length > 0 ? `; no match for ${unmatched.map(n => `"${n}"`).join(', ')}` : '';
  return {
    summary: `Turn the dynamic token ring ${wantOn ? 'on' : 'off'} for ${scope}${remaining > 0 ? ` (${remaining} more need another plan)` : ''}${miss}`,
    ops,
    count: ops.length,
    remaining,
    alreadyDone: matchingCount - todoCount,
    unmatched,
  };
}

/** Tokens already placed on scenes (tokens `placed`): one `ring.enabled` update per token. */
function planPlacedRings(req: TokenRingsPlanRequest, wantOn: boolean): TokenRingsPlan {
  const names = lowerSet(req.names);
  const sceneNames = lowerSet(req.scenes);
  const seenNames = new Set<string>();
  const seenScenes = new Set<string>();
  const matching: TokenLike[] = [];
  for (const scene of scenes()) {
    const sceneKey = String(scene.name).toLowerCase();
    if (sceneNames.size > 0 && !sceneNames.has(sceneKey)) continue;
    seenScenes.add(sceneKey);
    for (const token of listOf(scene.tokens)) {
      const actorType = token.actor?.type;
      if (!isRingActorType(actorType)) continue;
      const wanted = req.actorType ?? 'all';
      if (wanted !== 'all' && actorType !== wanted) continue;
      if (names.size > 0) {
        const keys = [token.name, token.actor?.name].map(n => String(n ?? '').toLowerCase());
        const hit = keys.find(k => names.has(k));
        if (hit === undefined) continue;
        seenNames.add(hit);
      }
      matching.push(token);
    }
  }
  const unmatched = [
    ...unmatchedNames(req.scenes, seenScenes).map(n => `scene ${n}`),
    ...unmatchedNames(req.names, seenNames),
  ];
  if (matching.length === 0) {
    throw new Error(
      names.size > 0 || sceneNames.size > 0
        ? 'No placed character or NPC token matches those scene or token names.'
        : 'No character or NPC tokens are placed on any scene.'
    );
  }
  const todo = matching.filter(t => Boolean(t.ring?.enabled) !== wantOn);
  if (todo.length === 0) {
    throw new Error(
      `All ${matching.length} matching placed tokens already have their token ring ${wantOn ? 'on' : 'off'}.`
    );
  }
  const ops: GuardedOp[] = todo.slice(0, TOKEN_RINGS_BATCH).map(t => ({
    kind: 'update',
    uuid: t.uuid,
    changes: { [TOKEN_RING_PATH]: wantOn },
  }));
  const scope = scopeOf(ops.length, req, names.size > 0, 'placed token');
  return buildPlan(wantOn, matching.length, ops, todo.length, scope, unmatched);
}

/** `planTokenRings`: one request into one plan of at most `TOKEN_RINGS_BATCH` ops. Writes nothing. */
export function planTokenRings(request: unknown): TokenRingsPlan {
  const req = request as TokenRingsPlanRequest | null;
  if (!req || typeof req !== 'object') throw new Error('A request is required.');
  if (req.action !== 'enable' && req.action !== 'disable') {
    throw new Error(`Unknown token ring action: ${String((req as { action?: unknown }).action)}`);
  }
  const target: unknown = (req as { tokens?: unknown }).tokens ?? 'actors';
  if (target !== 'actors' && target !== 'placed') {
    throw new Error(
      `Unknown token ring target: ${typeof target === 'string' ? target : 'invalid'}`
    );
  }
  const wantOn = req.action === 'enable';
  if (target === 'placed') return planPlacedRings(req, wantOn);

  const names = lowerSet(req.names);
  const matching = actors().filter(a => matches(a, req, names));
  if (matching.length === 0) {
    throw new Error(
      names.size > 0
        ? 'No character or NPC in the world has one of those names.'
        : 'The world has no characters or NPCs of that kind.'
    );
  }
  const todo = matching.filter(a => Boolean(a.prototypeToken?.ring?.enabled) !== wantOn);
  if (todo.length === 0) {
    throw new Error(
      `All ${matching.length} matching actors already have their token ring ${wantOn ? 'on' : 'off'}.`
    );
  }
  const ops: GuardedOp[] = todo.slice(0, TOKEN_RINGS_BATCH).map(a => ({
    kind: 'update',
    uuid: a.uuid,
    changes: { [RING_PATH]: wantOn },
  }));
  const unmatched = unmatchedNames(req.names, new Set(matching.map(a => a.name.toLowerCase())));
  const scope = scopeOf(ops.length, req, names.size > 0, 'actor');
  return buildPlan(wantOn, matching.length, ops, todo.length, scope, unmatched);
}
