/**
 * "Seen in" (R4): which play sessions an NPC or a scene appeared in, from Foundry ids in the
 * play log only (no name matching). The export builds this index next to the session notes and
 * stores it in the bridge vault; the mirror pump reads it and renders a `## Seen in` section on
 * NPC and scene notes. Pure: groups and session stats in, an index out.
 *
 * What counts as "seen":
 * - an NPC: the world actor named by any play record of the session whose `actor` is not a PC
 *   (an unlinked token's actor uuid is folded to its base actor), or an entry of a `scene` or
 *   `user-join` record's `data.tokens` that is not a PC and not hidden. Combat rosters carry
 *   names only, so they add nothing (their `combat-turn` records name the actor anyway).
 * - a scene: any play record of the session that names a `sceneId`.
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
 * The base world actor of a play-log actor uuid: the last `Actor.<id>` segment
 * (`Scene.s.Token.t.Actor.a` becomes `Actor.a`), or null for a compendium uuid or one without
 * an actor segment.
 */
export function baseActorUuid(uuid: string): string | null {
  if (uuid.startsWith('Compendium.')) return null;
  const match = /(?:^|\.)Actor\.([^.]+)$/.exec(uuid);
  return match?.[1] ? `Actor.${match[1]}` : null;
}

/** The NPC actors one play record shows, as base world actor uuids. */
function npcsOf(record: PlayRecord): string[] {
  const found: string[] = [];
  if (record.actor && record.actor.isPC === false) {
    const uuid = baseActorUuid(record.actor.uuid);
    if (uuid) found.push(uuid);
  }
  const tokens: unknown = record.data?.tokens;
  if (Array.isArray(tokens)) {
    for (const entry of tokens as unknown[]) {
      if (entry === null || typeof entry !== 'object') continue;
      const token = entry as Record<string, unknown>;
      if (token.isPC !== false || token.hidden === true) continue;
      if (typeof token.actorUuid !== 'string') continue;
      const uuid = baseActorUuid(token.actorUuid);
      if (uuid) found.push(uuid);
    }
  }
  return found;
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
    for (const record of group.playRecords) {
      if (record.sceneId) add(scenes, `Scene.${record.sceneId}`, label);
      for (const uuid of npcsOf(record)) add(actors, uuid, label);
    }
  }
  return { v: 1, actors: sortedRecord(actors), scenes: sortedRecord(scenes) };
}

/** Parse a stored index defensively: anything unexpected is dropped, never thrown. */
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
  return { v: 1, actors: clean(record.actors), scenes: clean(record.scenes) };
}
