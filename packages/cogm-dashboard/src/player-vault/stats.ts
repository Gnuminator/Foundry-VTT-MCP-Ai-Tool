/**
 * The player-safe slice of `get-play-stats` for the O7 player vault. The bridge answer is GM data:
 * it carries roll visibility-blind numbers (`highestRoll`, crits, fumbles, d20 tallies), NPC
 * damage, scene and user names, loot names and every PC. This module copies an allowlist of
 * numbers into a new object, field by field (never spread and delete), so a field added to the
 * bridge answer later cannot reach a player by accident. The result type has no slot for anything
 * else, and the renderer takes only that type.
 *
 * Left out on purpose: `highestRoll`, `crits`, `fumbles`, `d20` and `dice` (the play log does not
 * record a roll's visibility, so a blind or GM roll would count), `rolls`, `damageDealt` (it is
 * NPC HP lost), `lootGained` (item names may be unidentified), `sceneMinutes`, `users`,
 * `gmChanges`, `combats`, `worldId`, `pcDownsByName`, `paperNet`, other players' characters.
 */

/** Numbers keyed by a spell slot key or a coin denomination. */
export type StatTally = Record<string, number>;

export interface PlayerPcStats {
  /** The player's own character name, from their sheet (never from the stats answer). */
  name: string;
  sessions: number;
  damageTaken: number;
  healingReceived: number;
  downs: number;
  kills: number;
  spellsCast: number;
  slotsSpent: StatTally;
  /** A total only: the names include item uses, and an unidentified item's name is a spoiler. */
  resourcesSpent: number;
  itemsUsed: number;
  currencyDelta: StatTally;
  xpGained: number;
}

export interface PlayerStats {
  campaign: {
    sessions: number;
    playMinutes: number;
    combats: number;
    rounds: number;
    pcDowns: number;
    npcKills: number;
    spellsCast: number;
  };
  /** Only the player's own characters, in the order of their sheets. */
  pcs: PlayerPcStats[];
}

/** A character the player owns: the sheet's actor id and name. */
export interface OwnCharacter {
  id: string;
  name: string;
}

function record(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function count(value: unknown): number {
  return typeof value === 'number' && Number.isFinite(value) && value > 0 ? value : 0;
}

function tally(value: unknown): StatTally {
  const source = record(value);
  const out: StatTally = {};
  if (!source) return out;
  for (const key of Object.keys(source).sort()) {
    const n = source[key];
    if (typeof n === 'number' && Number.isFinite(n) && n !== 0) out[key] = n;
  }
  return out;
}

/**
 * Project the `get-play-stats` result for one player, or null when it is not for this world or
 * not shaped like a stats answer. `worldId` is only compared, never kept.
 */
export function projectPlayStats(
  raw: unknown,
  worldId: string,
  own: OwnCharacter[]
): PlayerStats | null {
  const root = record(raw);
  if (root?.worldId !== worldId) return null;
  const campaign = record(root.campaign);
  if (!campaign) return null;
  const all = Array.isArray(root.pcs) ? root.pcs : [];

  const pcs: PlayerPcStats[] = [];
  for (const character of own) {
    const match = all.map(record).find(pc => pc !== null && pc.uuid === `Actor.${character.id}`);
    if (!match) continue;
    pcs.push({
      name: character.name,
      sessions: Array.isArray(match.sessions) ? match.sessions.length : 0,
      damageTaken: count(match.damageTaken),
      healingReceived: count(match.healingReceived),
      downs: count(match.downs),
      kills: count(match.kills),
      spellsCast: count(match.spellsCast),
      slotsSpent: tally(match.slotsSpent),
      resourcesSpent: Object.values(tally(match.resourcesSpent)).reduce(
        (sum, n) => sum + Math.max(n, 0),
        0
      ),
      itemsUsed: count(match.itemsUsed),
      currencyDelta: tally(match.currencyDelta),
      xpGained: count(match.xpGained),
    });
  }

  return {
    campaign: {
      sessions: count(campaign.sessions),
      playMinutes: count(campaign.playMinutes),
      combats: count(campaign.combats),
      rounds: count(campaign.rounds),
      pcDowns: count(campaign.pcDowns),
      npcKills: count(campaign.npcKills),
      spellsCast: count(campaign.spellsCast),
    },
    pcs,
  };
}
