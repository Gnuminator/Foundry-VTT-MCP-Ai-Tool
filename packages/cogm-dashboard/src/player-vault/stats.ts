/**
 * The player-safe slice of `get-play-stats` for the O7 player vault. The bridge answer is GM data:
 * it carries roll visibility-blind numbers (`highestRoll`, crits, fumbles, d20 tallies), NPC
 * damage, scene and user names, loot names and every PC. This module copies an allowlist of
 * numbers into a new object, field by field (never spread and delete), so a field added to the
 * bridge answer later cannot reach a player by accident. The result type has no slot for anything
 * else, and the renderer takes only that type.
 *
 * Roll numbers come only from the `public*` fields (`publicRolls`, `publicCrits`, `publicFumbles`,
 * `publicD20`, `publicHighestRoll`), which the stats build fills from rolls whose play record says
 * `visibility: 'public'`. Never read `rolls`, `crits`, `fumbles`, `d20`, `highestRoll` or `dice`:
 * they count blind, GM and self rolls.
 *
 * Left out on purpose: those unfiltered roll fields, `damageDealt` (it is
 * NPC HP lost), `lootGained` (item names may be unidentified), `sceneMinutes`, `users`,
 * `gmChanges`, `combats`, `worldId`, `pcDownsByName`, `paperNet`, other players' characters.
 */

/** Numbers keyed by a spell slot key or a coin denomination. */
export type StatTally = Record<string, number>;

/** A player's best public d20 roll: the numbers and what was rolled, nothing else. */
export interface PlayerBestRoll {
  total: number;
  /** E.g. `Athletics check`, or null. */
  label: string | null;
  natural: number | null;
}

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
  /** Public rolls only (see the file header). */
  rolls: number;
  crits: number;
  fumbles: number;
  /** Natural d20 results 1..20 (index 0 = a natural 1), public rolls only. */
  d20: number[];
  highestRoll: PlayerBestRoll | null;
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

function d20Tally(value: unknown): number[] {
  const out = new Array<number>(20).fill(0);
  if (!Array.isArray(value)) return out;
  for (let i = 0; i < 20; i++) out[i] = count(value[i]);
  return out;
}

function bestRoll(value: unknown): PlayerBestRoll | null {
  const source = record(value);
  if (!source || typeof source.total !== 'number' || !Number.isFinite(source.total)) return null;
  return {
    total: source.total,
    label: typeof source.label === 'string' ? source.label : null,
    natural:
      typeof source.natural === 'number' && Number.isFinite(source.natural) ? source.natural : null,
  };
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
      rolls: count(match.publicRolls),
      crits: count(match.publicCrits),
      fumbles: count(match.publicFumbles),
      d20: d20Tally(match.publicD20),
      highestRoll: bestRoll(match.publicHighestRoll),
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
