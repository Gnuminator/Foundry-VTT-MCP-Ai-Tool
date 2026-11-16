/**
 * The two player tools the dashboard answers itself (D-136): `get-my-handouts` and
 * `get-my-play-stats`. They reuse the filters the player page and My character already apply, so
 * a player's Claude learns nothing the player's own page does not show:
 *
 * - Handouts: `PlayerViewSource.handoutsFor(userId)` (revealed pages only, links cleaned for that
 *   player, a page limited to other players left out), already sanitized on arrival, then turned
 *   into plain text. The session-notes journal is never an input.
 * - Stats: `projectPlayStats` over the player's own sheets (an allowlist of numbers; no blind or
 *   GM rolls, NPC damage, loot names or other players).
 *
 * The user id is the verified one from the route; the arguments never carry one.
 */
import type { PlayerHandout } from '@gnuminator/shared';

import { htmlToMarkdown } from './player-vault/html-md.js';
import { RECAP_TITLE } from './player-vault/render.js';
import { projectPlayStats } from './player-vault/stats.js';

export const PLAYER_LOCAL_TOOLS: readonly string[] = ['get-my-handouts', 'get-my-play-stats'];

const QUEST_TITLE = /\bquests?\b/i;
const DEFAULT_LIMIT = 5;
const MAX_LIMIT = 10;
/** Longest text of one handout handed to a player's Claude. */
const HANDOUT_TEXT_CHARS = 6000;

export interface LocalPlayerToolDeps {
  /** The handouts this player may see (`PlayerViewSource.handoutsFor`). */
  handoutsFor(userId: string): PlayerHandout[];
  /** Whether the handouts have been read from the bridge at least once. */
  handoutsReady(): boolean;
  /** The bridge's GM stats (`get-play-stats`); only `projectPlayStats` may read the answer. */
  playStats(): Promise<unknown>;
  /** The player's own sheets (`character_sheet`). */
  characterSheet(userId: string): Promise<unknown>;
  worldId(): string | null;
}

type Kind = 'recap' | 'quest' | 'handout';

const text = (message: string): { content: Array<{ type: 'text'; text: string }> } => ({
  content: [{ type: 'text', text: message }],
});
const failure = (
  message: string
): { isError: true; content: Array<{ type: 'text'; text: string }> } => ({
  isError: true,
  content: [{ type: 'text', text: `Error: ${message}` }],
});

function kindOf(title: string): Kind {
  if (RECAP_TITLE.test(title)) return 'recap';
  if (QUEST_TITLE.test(title)) return 'quest';
  return 'handout';
}

function parseArgs(args: unknown): { kind?: Kind; limit: number } | string {
  const a = args !== null && typeof args === 'object' ? (args as Record<string, unknown>) : {};
  let kind: Kind | undefined;
  if (a.kind !== undefined) {
    if (a.kind !== 'recap' && a.kind !== 'quest' && a.kind !== 'handout') {
      return 'Check the arguments: kind must be recap, quest or handout';
    }
    kind = a.kind;
  }
  let limit = DEFAULT_LIMIT;
  if (a.limit !== undefined) {
    if (typeof a.limit !== 'number' || !Number.isInteger(a.limit) || a.limit < 1) {
      return 'Check the arguments: limit must be a whole number from 1 to 10';
    }
    limit = Math.min(a.limit, MAX_LIMIT);
  }
  return { ...(kind ? { kind } : {}), limit };
}

function handouts(deps: LocalPlayerToolDeps, userId: string, args: unknown): unknown {
  const parsed = parseArgs(args);
  if (typeof parsed === 'string') return failure(parsed);
  if (!deps.handoutsReady()) {
    return failure('The table has not loaded the handouts yet. Try again in a moment.');
  }
  const own = deps
    .handoutsFor(userId)
    // The same rule as the player page and the vault: no `players` list, or one that names them.
    .filter(h => !h.players || h.players.includes(userId))
    .map(h => ({ h, kind: kindOf(h.title), at: h.revealedAt ? Date.parse(h.revealedAt) : NaN }))
    .filter(row => !parsed.kind || row.kind === parsed.kind)
    // Newest revealed first; a handout with no reveal time goes last.
    .sort(
      (a, b) =>
        (Number.isFinite(b.at) ? b.at : -Infinity) - (Number.isFinite(a.at) ? a.at : -Infinity)
    );
  const list = own.slice(0, parsed.limit).map(({ h, kind }) => {
    const body = htmlToMarkdown(h.html).trim();
    return {
      title: h.title,
      kind,
      revealedAt: h.revealedAt,
      text: body.length > HANDOUT_TEXT_CHARS ? `${body.slice(0, HANDOUT_TEXT_CHARS)}…` : body,
      ...(body.length > HANDOUT_TEXT_CHARS ? { truncated: true } : {}),
    };
  });
  return text(
    JSON.stringify({
      handouts: list,
      ...(own.length > list.length ? { more: own.length - list.length } : {}),
      ...(own.length === 0 ? { note: 'Nothing revealed to you yet.' } : {}),
    })
  );
}

async function playStats(deps: LocalPlayerToolDeps, userId: string): Promise<unknown> {
  const worldId = deps.worldId();
  if (!worldId) return failure('The table is not ready. Try again in a moment.');
  const [sheetsRaw, statsRaw] = await Promise.all([deps.characterSheet(userId), deps.playStats()]);
  const record =
    sheetsRaw !== null && typeof sheetsRaw === 'object'
      ? (sheetsRaw as { userId?: unknown; sheets?: unknown })
      : null;
  // Same check as the player vault: the answer must be for this user, or no stats at all.
  if (record?.userId !== userId || !Array.isArray(record.sheets)) {
    return failure('Your characters could not be read. Try again.');
  }
  const own = (record.sheets as Array<{ id?: unknown; name?: unknown }>)
    .filter(s => typeof s.id === 'string' && typeof s.name === 'string')
    .map(s => ({ id: s.id as string, name: s.name as string }));
  const stats = projectPlayStats(statsRaw, worldId, own);
  if (!stats)
    return failure(
      'Play stats for this world are not available right now (the bridge has not loaded this world yet). Try again later.'
    );
  return text(JSON.stringify(stats));
}

/** Run one of {@link PLAYER_LOCAL_TOOLS}; never throws (a failure is an error result). */
export async function runLocalPlayerTool(
  deps: LocalPlayerToolDeps,
  tool: string,
  args: unknown,
  userId: string
): Promise<unknown> {
  try {
    if (tool === 'get-my-handouts') return handouts(deps, userId, args);
    if (tool === 'get-my-play-stats') return await playStats(deps, userId);
    return failure('Not a player tool');
  } catch {
    return failure('The table could not answer right now. Try again.');
  }
}
