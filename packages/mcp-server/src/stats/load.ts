/**
 * Loading a world's session log and play log from the bridge vault, for the
 * tools that build on `stats/build.ts` (`get-play-stats`, `get-prep-digest`).
 */
import { PLAY_LOG_FILE, type PlayRecord } from '@gnuminator/shared';

import type { SessionEvent } from '../obsidian/grouping.js';
import type { VaultStore } from '../vault/store.js';

const SESSION_LOG_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;

export function isPlayRecordLike(value: unknown): value is PlayRecord {
  const r = value as Partial<PlayRecord> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.key === 'string' &&
    typeof r.t === 'number' &&
    Number.isFinite(r.t) &&
    typeof r.kind === 'string'
  );
}

/** Every session-log event of the world (`sessions/<date>.jsonl`), file order. */
export async function loadSessionEvents(
  store: Pick<VaultStore, 'list' | 'readLines'>,
  worldId: string
): Promise<SessionEvent[]> {
  const files = (await store.list(worldId, 'sessions')).filter(f => SESSION_LOG_FILE.test(f));
  const all: SessionEvent[] = [];
  for (const file of files) {
    all.push(...((await store.readLines(worldId, 'sessions', file)) as SessionEvent[]));
  }
  return all;
}

/** Every play record of the world (`sessions/<date>.play.jsonl`), file order. */
export async function loadPlayRecords(
  store: Pick<VaultStore, 'list' | 'readLines'>,
  worldId: string
): Promise<PlayRecord[]> {
  const files = (await store.list(worldId, 'sessions')).filter(f => PLAY_LOG_FILE.test(f));
  const all: PlayRecord[] = [];
  for (const file of files) {
    const lines = await store.readLines(worldId, 'sessions', file);
    all.push(...lines.filter(isPlayRecordLike));
  }
  return all;
}
