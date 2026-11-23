import {
  LOOSE_ENDS_MAX_PER_KIND,
  LOOSE_ENDS_NPC_GAP,
  LOOSE_ENDS_STALE_AFTER,
  type PlayRecord,
  type PrepLooseEnd,
  type PrepLooseEnds,
  type PrepQuest,
} from '@gnuminator/shared';

import type { SessionEvent } from '../obsidian/grouping.js';

/** One session as the digest groups it: the session number is index + 1. */
export interface LooseEndsGroup {
  events: SessionEvent[];
  playRecords: PlayRecord[];
}

interface LooseEndsInput {
  groups: LooseEndsGroup[];
  /** Open quests from the prep scan; null when Foundry did not answer. */
  openQuests: PrepQuest[] | null;
  /** Scenes in the world (id, name); null when Foundry did not answer. */
  scenes: Array<{ id: string; name: string }> | null;
}

/** `Actor.<id>` of the base actor, from an actor or unlinked-token uuid. */
function baseActorUuid(uuid: string): string {
  const match = /Actor\.[^.]+$/.exec(uuid);
  return match ? match[0] : uuid;
}

function describe(name: string, lastSeen: number | null, latest: number): PrepLooseEnd {
  return {
    name,
    lastSeenSession: lastSeen,
    sessionsSince: lastSeen === null ? null : latest - lastSeen,
    label:
      lastSeen === null
        ? `${name}: not seen in any logged session`
        : `${name}: last seen session ${lastSeen}`,
  };
}

/** Oldest first (never seen first), then by name, so the cap drops the least stale. */
function cap(items: PrepLooseEnd[]): { kept: PrepLooseEnd[]; omitted: number } {
  const sorted = [...items].sort(
    (a, b) => (a.lastSeenSession ?? 0) - (b.lastSeenSession ?? 0) || a.name.localeCompare(b.name)
  );
  return {
    kept: sorted.slice(0, LOOSE_ENDS_MAX_PER_KIND),
    omitted: Math.max(0, sorted.length - LOOSE_ENDS_MAX_PER_KIND),
  };
}

/**
 * Loose ends (I-172): open quests nobody touched, NPCs met once, scenes not used for a while, each
 * with the last session it was seen in. Facts from the play log and session log only; the NPCs
 * need no Foundry, quests and scenes need the prep scan and the scene list.
 */
export function computeLooseEnds(input: LooseEndsInput): PrepLooseEnds | null {
  const latest = input.groups.length;
  if (latest === 0) return null;

  const questSeen = new Map<string, number>();
  const questSeenByName = new Map<string, number>();
  const sceneSeen = new Map<string, number>();
  const npcSessions = new Map<string, { name: string; sessions: Set<number> }>();

  input.groups.forEach((group, i) => {
    const number = i + 1;
    for (const event of group.events) {
      if (event.eventType !== 'journal-created' && event.eventType !== 'journal-updated') continue;
      const id = event.details?.journalId;
      if (typeof id === 'string' && id) questSeen.set(id, number);
      const name = event.details?.name;
      if (typeof id !== 'string' && typeof name === 'string' && name) {
        questSeenByName.set(name, number);
      }
    }
    for (const record of group.playRecords) {
      if (record.sceneId) sceneSeen.set(record.sceneId, number);
      // Only NPCs that spoke count as met: a monster fought once is not a loose end.
      if (record.kind === 'chat' && record.actor?.isPC === false) {
        const uuid = baseActorUuid(record.actor.uuid);
        const entry = npcSessions.get(uuid) ?? { name: record.actor.name, sessions: new Set() };
        entry.name = record.actor.name || entry.name;
        entry.sessions.add(number);
        npcSessions.set(uuid, entry);
      }
    }
  });

  const quests: PrepLooseEnd[] = [];
  for (const quest of input.openQuests ?? []) {
    // Match by journal id; the name only helps events that carry no id.
    const seen = questSeen.get(quest.journalId) ?? questSeenByName.get(quest.name) ?? null;
    const gap = seen === null ? latest : latest - seen;
    if (gap >= LOOSE_ENDS_STALE_AFTER) quests.push(describe(quest.name, seen, latest));
  }

  const npcs: PrepLooseEnd[] = [];
  for (const entry of npcSessions.values()) {
    if (entry.sessions.size !== 1) continue;
    const [only] = [...entry.sessions];
    if (only !== undefined && latest - only >= LOOSE_ENDS_NPC_GAP) {
      npcs.push(describe(entry.name, only, latest));
    }
  }

  const scenes: PrepLooseEnd[] = [];
  let neverVisited: number | null = null;
  if (input.scenes) {
    neverVisited = 0;
    for (const scene of input.scenes) {
      const seen = sceneSeen.get(scene.id);
      if (seen === undefined) neverVisited += 1;
      else if (latest - seen >= LOOSE_ENDS_STALE_AFTER) {
        scenes.push(describe(scene.name, seen, latest));
      }
    }
  }

  const q = cap(quests);
  const n = cap(npcs);
  const s = cap(scenes);
  return {
    sessions: latest,
    staleAfter: LOOSE_ENDS_STALE_AFTER,
    quests: q.kept,
    npcs: n.kept,
    scenes: s.kept,
    neverVisitedScenes: neverVisited,
    omitted: { quests: q.omitted, npcs: n.omitted, scenes: s.omitted },
    unavailable: [
      ...(input.openQuests === null ? (['quests'] as const) : []),
      ...(input.scenes === null ? (['scenes'] as const) : []),
    ],
  };
}
