import type { SessionEvent } from './feed/types.js';

/**
 * Who has been asked for a roll and who has rolled it (item roll-status-player-push).
 *
 * Built from the session events the dashboard already holds: a `roll-request` event per player
 * asked, then the first later `roll` (public) or `gm-roll` (whispered) by the same character.
 * The events carry the roll family (check, skill, save, tool) but not which skill or ability, so a
 * result counts by character, family and time (the Foundry Party window's `noteRoll` also checks
 * the key, which only a chat message holds).
 */

/** One request to one player, and whether the roll came back. */
export interface RollRow {
  id: string;
  sentAt: number;
  /** The button text, e.g. "Perception Skill Check (Private)". */
  label: string;
  isPublic: boolean;
  /** The player or character the request was addressed to, as the GM typed it. */
  targetName: string;
  actorId: string | null;
  /** The Foundry user the request is for, or null when it cannot be told. */
  userId: string | null;
  status: 'sent' | 'rolled';
  /** The rolled total (GM only); absent while waiting. */
  total?: number;
}

/** What the player stream carries per open request: no totals, no names of other characters. */
export interface OpenRoll {
  id: string;
  sentAt: number;
  label: string;
  userId: string;
}

/** A request older than this no longer counts as waiting. */
export const OPEN_WINDOW_MS = 30 * 60 * 1000;

/** Roll families that answer a request; attacks, damage and initiative never do. */
const ANSWERING = new Set(['check', 'skill', 'save', 'tool']);

/** A result may be stamped a moment before the request on a clock that runs behind. */
const CLOCK_SLACK_MS = 2000;

const isRecord = (v: unknown): v is Record<string, unknown> =>
  typeof v === 'object' && v !== null && !Array.isArray(v);

const text = (v: unknown): string | null => (typeof v === 'string' && v !== '' ? v : null);

/** Which of `candidates` are players (non-GMs) according to `isPlayer`. */
function playerIds(candidates: unknown, isPlayer: (userId: string) => boolean): string[] {
  return Array.isArray(candidates)
    ? candidates.filter((id): id is string => typeof id === 'string' && isPlayer(id))
    : [];
}

/**
 * Every request in `events` with its status, newest first. `isPlayer` says whether a Foundry user
 * id is a player (the whisper list of a private request also names the GMs).
 */
export function buildRollRows(
  events: readonly SessionEvent[],
  isPlayer: (userId: string) => boolean
): RollRow[] {
  const ordered = [...events].sort((a, b) => a.timestampMs - b.timestampMs);
  const rows: RollRow[] = [];
  const pending = new Map<string, RollRow[]>();
  for (const e of ordered) {
    const d = isRecord(e.details) ? e.details : {};
    if (e.eventType === 'roll-request') {
      const target = text(d['targetUserId']);
      // An older module names no user for a public request; a private one whispers to its player.
      const userId =
        target !== null && isPlayer(target)
          ? target
          : (playerIds(d['whisperTo'], isPlayer)[0] ?? null);
      const row: RollRow = {
        id: e.id,
        sentAt: e.timestampMs,
        label: text(d['label']) ?? e.description,
        isPublic: d['isPublic'] === true,
        targetName: text(d['targetName']) ?? e.actorName ?? 'a player',
        actorId: e.actorId,
        userId,
        status: 'sent',
      };
      rows.push(row);
      if (row.actorId !== null) {
        const list = pending.get(row.actorId) ?? [];
        list.push(row);
        pending.set(row.actorId, list);
      }
      continue;
    }
    if (e.eventType !== 'roll' && e.eventType !== 'gm-roll') continue;
    if (e.actorId === null || !ANSWERING.has(String(d['rollType'] ?? ''))) continue;
    // The roll answers the newest request to that character sent before it (a request nobody
    // answered must not swallow the roll of the one the GM sent after it).
    const list = pending.get(e.actorId) ?? [];
    let at = -1;
    for (let i = list.length - 1; i >= 0; i--) {
      if ((list[i]?.sentAt ?? Infinity) - CLOCK_SLACK_MS <= e.timestampMs) {
        at = i;
        break;
      }
    }
    const row = at >= 0 ? list.splice(at, 1)[0] : undefined;
    if (!row) continue;
    row.status = 'rolled';
    const total = d['total'];
    if (typeof total === 'number' && Number.isFinite(total)) row.total = total;
  }
  return rows.reverse();
}

/** The requests still waiting for a player, as the player stream carries them. */
export function openRolls(rows: readonly RollRow[], now: number): OpenRoll[] {
  const open: OpenRoll[] = [];
  for (const r of rows) {
    if (r.status !== 'sent' || r.userId === null || now - r.sentAt > OPEN_WINDOW_MS) continue;
    open.push({ id: r.id, sentAt: r.sentAt, label: r.label.slice(0, 80), userId: r.userId });
  }
  return open;
}
