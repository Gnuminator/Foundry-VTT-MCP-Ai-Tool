/**
 * "Seen in" (R4): which play sessions an NPC or a scene appeared in, from Foundry ids in the
 * play log only (no name matching). The export builds this index next to the session notes and
 * stores it in the bridge vault; the mirror pump reads it and renders a `## Seen in` section on
 * NPC and scene notes. Pure: groups and session stats in, an index out.
 *
 * "Seen" means the players saw it, so only what happens while a player is online counts (the
 * GM prepping alone, or making and placing NPCs, never does):
 * - Who is online: a `scene` record's `data.players` (everyone online then), adjusted by
 *   `user-join` and `user-leave` records whose `data.isGM` is false. Records from before
 *   2026-10 carry neither, so their sessions list nothing.
 * - An NPC: the world actor of a table record (`TABLE_KINDS`, not whispered or blind; an
 *   unlinked token's actor uuid is folded to its base actor), or a not-hidden entry of the
 *   `data.tokens` snapshot of an active `scene` record or a player's `user-join` record.
 * - A scene: an active `scene` record (`data.active`, not a GM preview), or the
 *   `data.activeSceneId` of a player's `user-join` record.
 * Every world actor is indexed; the mirror shows no list on PC notes.
 */
import type { PlayRecord } from '@gnuminator/shared';

import type { SessionStats } from '../stats/types.js';
import type { UnionSessionGroup } from './grouping.js';

/** The index file in the bridge vault (area `gm`), written by the export. */
export const SEEN_INDEX_FILE = 'obsidian-seen.json';

export interface SeenIndex {
  v: 1;
  /** `Actor.<id>` -> session labels, in session order (oldest first), no duplicates. */
  actors: Record<string, string[]>;
  /** `Scene.<id>` -> session labels, in session order (oldest first), no duplicates. */
  scenes: Record<string, string[]>;
}

export const EMPTY_SEEN_INDEX: SeenIndex = { v: 1, actors: {}, scenes: {} };

/**
 * Record kinds whose actor the players saw act: rolls, item use, chat, damage and healing,
 * conditions, combat turns. Lifecycle kinds (actor and token create, delete and move, items
 * added or removed) are GM work and never count.
 */
const TABLE_KINDS: ReadonlySet<string> = new Set([
  'roll',
  'item-use',
  'chat',
  'hp',
  'hp-temp',
  'death-save',
  'effect-add',
  'effect-remove',
  'combat-turn',
]);

/**
 * The base world actor of a play-log actor uuid: the last `Actor.<id>` segment
 * (`Scene.s.Token.t.Actor.a` becomes `Actor.a`), or null for a compendium uuid or one without
 * an actor segment.
 */
export function baseActorUuid(uuid: string): string | null {
  if (uuid.startsWith('Compendium.')) return null;
  const match = /(?:^|\.)Actor\.([^.]+)$/.exec(uuid);
  return match?.[1] ? `Actor.${match[1]}` : null;
}

/** The not-hidden actors of a `data.tokens` snapshot, as base world actor uuids. */
function snapshotActors(record: PlayRecord): string[] {
  const found: string[] = [];
  const tokens: unknown = record.data?.tokens;
  if (!Array.isArray(tokens)) return found;
  for (const entry of tokens as unknown[]) {
    if (entry === null || typeof entry !== 'object') continue;
    const token = entry as Record<string, unknown>;
    if (token.hidden === true || typeof token.actorUuid !== 'string') continue;
    const uuid = baseActorUuid(token.actorUuid);
    if (uuid) found.push(uuid);
  }
  return found;
}

/** A table record the players could see (not whispered, not blind). */
function isTableRecord(record: PlayRecord): boolean {
  return (
    TABLE_KINDS.has(record.kind) && record.data?.whisper !== true && record.data?.blind !== true
  );
}

/** A `user-join` or `user-leave` record of a player (not a GM). */
function isPlayerPresence(record: PlayRecord): boolean {
  return (
    (record.kind === 'user-join' || record.kind === 'user-leave') &&
    record.userId !== null &&
    record.data?.isGM === false
  );
}

/** What one group (session) shows: actor and scene uuids the players saw. */
function seenInGroup(records: readonly PlayRecord[]): { actors: string[]; scenes: string[] } {
  const actors: string[] = [];
  const scenes: string[] = [];
  const players = new Set<string>();
  const ordered = [...records].sort((a, b) => a.t - b.t || a.seq - b.seq);
  for (const record of ordered) {
    const online: unknown = record.data?.players;
    if (record.kind === 'scene' && Array.isArray(online)) {
      players.clear();
      for (const id of online as unknown[]) if (typeof id === 'string') players.add(id);
    } else if (isPlayerPresence(record) && record.userId) {
      if (record.kind === 'user-join') players.add(record.userId);
      else players.delete(record.userId);
    }
    if (players.size === 0) continue;

    if (record.kind === 'scene' && record.data?.active === true) {
      if (record.sceneId) scenes.push(`Scene.${record.sceneId}`);
      actors.push(...snapshotActors(record));
    } else if (record.kind === 'user-join' && isPlayerPresence(record)) {
      const activeSceneId = record.data?.activeSceneId;
      if (typeof activeSceneId === 'string') scenes.push(`Scene.${activeSceneId}`);
      actors.push(...snapshotActors(record));
    } else if (record.actor && isTableRecord(record)) {
      const uuid = baseActorUuid(record.actor.uuid);
      if (uuid) actors.push(uuid);
    }
  }
  return { actors, scenes };
}

function add(map: Map<string, string[]>, key: string, label: string): void {
  const labels = map.get(key);
  if (!labels) map.set(key, [label]);
  else if (!labels.includes(label)) labels.push(label);
}

function sortedRecord(map: Map<string, string[]>): Record<string, string[]> {
  const out: Record<string, string[]> = {};
  for (const key of [...map.keys()].sort()) out[key] = map.get(key) ?? [];
  return out;
}

/**
 * Build the index. `groups[i]` pairs with `sessions[i]` (the same index the export's session
 * note loop uses); a group without a matching session or without any events or records is
 * skipped the same way.
 */
export function buildSeenIndex(
  groups: ReadonlyArray<Pick<UnionSessionGroup, 'events' | 'playRecords'>>,
  sessions: ReadonlyArray<Pick<SessionStats, 'label'>>
): SeenIndex {
  const actors = new Map<string, string[]>();
  const scenes = new Map<string, string[]>();
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const label = sessions[i]?.label;
    if (!group || !label) continue;
    if (group.events.length === 0 && group.playRecords.length === 0) continue;
    const seen = seenInGroup(group.playRecords);
    for (const uuid of seen.scenes) add(scenes, uuid, label);
    for (const uuid of seen.actors) add(actors, uuid, label);
  }
  return { v: 1, actors: sortedRecord(actors), scenes: sortedRecord(scenes) };
}

/**
 * Parse a stored index defensively: anything unexpected is dropped, never thrown, and a file
 * of another version is read as empty.
 */
export function parseSeenIndex(value: unknown): SeenIndex {
  const clean = (raw: unknown): Record<string, string[]> => {
    const out: Record<string, string[]> = {};
    if (raw === null || typeof raw !== 'object' || Array.isArray(raw)) return out;
    for (const [key, labels] of Object.entries(raw as Record<string, unknown>)) {
      if (!Array.isArray(labels)) continue;
      const list = (labels as unknown[]).filter((l): l is string => typeof l === 'string');
      if (list.length > 0) out[key] = list;
    }
    return out;
  };
  if (value === null || typeof value !== 'object') return { v: 1, actors: {}, scenes: {} };
  const record = value as Record<string, unknown>;
  if (record.v !== 1) return { v: 1, actors: {}, scenes: {} };
  return { v: 1, actors: clean(record.actors), scenes: clean(record.scenes) };
}
