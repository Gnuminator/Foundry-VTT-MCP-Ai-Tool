/**
 * Remove one player's records from a world's bridge vault, for the player guide's promise
 * ("Having your data removed", docs/player/README.md).
 *
 * The records that carry a user are the play log (`sessions/<date>.play.jsonl`: rolls, changes,
 * chat with its text, each with `userId` and `userName`) and the usage log
 * (`sessions/<date>.usage.jsonl`: `who.userId` and `who.name`). The session event log and the
 * change history name actors, not users, and are left alone.
 *
 * A record matches when its user id equals `user`, or its user name equals `user` ignoring case
 * and surrounding spaces. `chatOnly` removes only the play log's chat records (the text the
 * player wrote) and leaves the usage log alone (it holds no text). Lines that do not parse (a torn
 * last line) are kept as they are. Nothing is written in a dry run.
 */
import type { VaultStore } from './store.js';

export interface ForgetUserOptions {
  /** A Foundry user id or user name. */
  user: string;
  chatOnly?: boolean;
  dryRun?: boolean;
}

export interface ForgetUserFileResult {
  file: string;
  removed: number;
  kept: number;
}

export interface ForgetUserResult {
  worldId: string;
  /** Files with at least one matching record. */
  files: ForgetUserFileResult[];
  removed: number;
  dryRun: boolean;
}

const PLAY_LOG = /\.play\.jsonl$/;
const USAGE_LOG = /\.usage\.jsonl$/;

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function sameName(value: unknown, wanted: string): boolean {
  return typeof value === 'string' && value.trim().toLowerCase() === wanted.toLowerCase();
}

function matchesUser(id: unknown, name: unknown, user: string): boolean {
  return (typeof id === 'string' && id === user) || sameName(name, user);
}

function playRecordMatches(
  record: Record<string, unknown>,
  user: string,
  chatOnly: boolean
): boolean {
  if (chatOnly && record.kind !== 'chat') return false;
  return matchesUser(record.userId, record.userName, user);
}

function usageEventMatches(record: Record<string, unknown>, user: string): boolean {
  const who = asRecord(record.who);
  return who !== null && matchesUser(who.userId, who.name, user);
}

export async function forgetUser(
  store: VaultStore,
  worldId: string,
  options: ForgetUserOptions
): Promise<ForgetUserResult> {
  const user = options.user.trim();
  if (!user) throw new Error('Name the user (Foundry user name or id)');
  const chatOnly = options.chatOnly === true;
  const dryRun = options.dryRun === true;

  const files: ForgetUserFileResult[] = [];
  for (const file of await store.list(worldId, 'sessions')) {
    const isPlay = PLAY_LOG.test(file);
    const isUsage = USAGE_LOG.test(file);
    if (!isPlay && !(isUsage && !chatOnly)) continue;

    const text = await store.readRaw(worldId, 'sessions', file);
    if (text === null) continue;
    const kept: string[] = [];
    let removed = 0;
    for (const line of text.split('\n')) {
      if (!line.trim()) continue;
      let record: Record<string, unknown> | null = null;
      try {
        record = asRecord(JSON.parse(line));
      } catch {
        record = null;
      }
      const match =
        record !== null &&
        (isPlay ? playRecordMatches(record, user, chatOnly) : usageEventMatches(record, user));
      if (match) removed += 1;
      else kept.push(line);
    }
    if (removed === 0) continue;
    files.push({ file, removed, kept: kept.length });
    if (!dryRun) {
      if (kept.length === 0) await store.remove(worldId, 'sessions', file);
      else await store.writeRaw(worldId, 'sessions', file, `${kept.join('\n')}\n`);
    }
  }
  return {
    worldId,
    files,
    removed: files.reduce((sum, f) => sum + f.removed, 0),
    dryRun,
  };
}
