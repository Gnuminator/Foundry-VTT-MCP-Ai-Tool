// Who was asked for a roll and who has rolled it (item roll-status-player-push). The server builds
// the rows from the session events (src/roll-status.ts) and pushes them as the GM stream's `rolls`
// event; the roll bar shows the latest ask as "waiting for 2 of 4" and "Brenna rolled 17".
import { useQuery, useQueryClient } from '@tanstack/react-query';
import { useMemo } from 'react';

import { ROLLS_KEY } from './rolls-key';

/** One request to one player (src/roll-status.ts RollRow). */
export interface RollRow {
  id: string;
  sentAt: number;
  label: string;
  isPublic: boolean;
  targetName: string;
  actorId: string | null;
  userId: string | null;
  status: 'sent' | 'rolled';
  total?: number;
}

/** A request this old no longer shows under the roll bar. */
const ROUND_SHOWN_MS = 2 * 60 * 60 * 1000;

/** Requests of one ask are sent within a moment of each other. */
const ROUND_SPREAD_MS = 30_000;

/** Reads the stream payload; anything that is not a row is dropped. */
export function readRollRows(raw: unknown): RollRow[] {
  if (!Array.isArray(raw)) return [];
  const rows: RollRow[] = [];
  for (const item of raw) {
    const r = (item ?? {}) as Record<string, unknown>;
    if (
      typeof r['id'] !== 'string' ||
      typeof r['sentAt'] !== 'number' ||
      typeof r['label'] !== 'string' ||
      typeof r['targetName'] !== 'string'
    )
      continue;
    rows.push({
      id: r['id'],
      sentAt: r['sentAt'],
      label: r['label'],
      isPublic: r['isPublic'] === true,
      targetName: r['targetName'],
      actorId: typeof r['actorId'] === 'string' ? r['actorId'] : null,
      userId: typeof r['userId'] === 'string' ? r['userId'] : null,
      status: r['status'] === 'rolled' ? 'rolled' : 'sent',
      ...(typeof r['total'] === 'number' ? { total: r['total'] } : {}),
    });
  }
  return rows;
}

/** The latest ask: the newest request and the others sent with it for the same roll. */
export interface RollRound {
  /** The id of the ask: its first request, stable while the others of the ask arrive. */
  id: string;
  /** When the ask went out (its oldest request). */
  sentAt: number;
  label: string;
  rows: RollRow[];
  waiting: RollRow[];
}

/** The newest ask in `rows` (newest first), or null when there is none or it is old. */
export function latestRound(rows: readonly RollRow[], now: number): RollRound | null {
  const newest = rows[0];
  if (!newest || now - newest.sentAt > ROUND_SHOWN_MS) return null;
  const group = rows
    .filter(r => r.label === newest.label && newest.sentAt - r.sentAt <= ROUND_SPREAD_MS)
    // The same player twice in one ask: keep the newest request.
    .filter((r, i, all) => all.findIndex(o => o.targetName === r.targetName) === i)
    .reverse();
  return {
    id: group[0]?.id ?? newest.id,
    sentAt: group[0]?.sentAt ?? newest.sentAt,
    label: newest.label.replace(/\s*\((?:Private|Public)\)\s*$/i, ''),
    rows: group,
    waiting: group.filter(r => r.status === 'sent'),
  };
}

/** The headline: "Perception: waiting for 2 of 4" or "Perception: all 4 rolled". */
export function roundHeadline(round: RollRound): string {
  const total = round.rows.length;
  if (round.waiting.length === 0) {
    return `${round.label}: ${total === 1 ? 'rolled' : `all ${total} rolled`}`;
  }
  return `${round.label}: waiting for ${round.waiting.length} of ${total}`;
}

/** A request with no roll after this long offers a nudge. */
export const NUDGE_AFTER_MS = 5 * 60 * 1000;

/** The players of the ask who still owe a roll once their request is `NUDGE_AFTER_MS` old. */
export function nudgeTargets(round: RollRound, now: number): RollRow[] {
  return round.waiting.filter(r => now - r.sentAt >= NUDGE_AFTER_MS);
}

/** The chat line for the nudge: "Still waiting for Tom and Brenna: Perception." */
export function nudgeLine(round: RollRound, targets: readonly RollRow[]): string {
  const names = targets.map(r => r.targetName);
  const who =
    names.length <= 2
      ? names.join(' and ')
      : `${names.slice(0, -1).join(', ')} and ${names[names.length - 1]}`;
  return `Still waiting for ${who}: ${round.label}.`;
}

/** The results line for chat once everyone has rolled: "Perception: Brenna 17, Tom 9." */
export function resultsLine(round: RollRound): string {
  const parts = round.rows.map(r =>
    r.total !== undefined ? `${r.targetName} ${r.total}` : `${r.targetName} rolled`
  );
  return `${round.label}: ${parts.join(', ')}.`;
}

/** One player's line: "Brenna rolled 17", "Tom: waiting". */
export function rowLine(row: RollRow): string {
  if (row.status === 'sent') return `${row.targetName}: waiting`;
  return row.total !== undefined
    ? `${row.targetName} rolled ${row.total}`
    : `${row.targetName} rolled`;
}

/** The rows the stream has brought, newest first (empty until the first `rolls` event). */
export function useRollRows(): RollRow[] {
  const queryClient = useQueryClient();
  const { data } = useQuery({
    queryKey: ROLLS_KEY,
    queryFn: () => queryClient.getQueryData<unknown>(ROLLS_KEY) ?? [],
    staleTime: Infinity,
    gcTime: Infinity,
  });
  return useMemo(() => readRollRows(data), [data]);
}
