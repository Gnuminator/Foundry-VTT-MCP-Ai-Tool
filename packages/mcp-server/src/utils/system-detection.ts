/**
 * Game System Detection Utilities
 *
 * Detects whether the active Foundry VTT world is D&D 5e (the only system this
 * tool supports) and provides D&D 5e data-path mappings for creature/actor stats.
 * Any non-dnd5e world is reported as 'other' so tools can refuse it cleanly.
 */

import { isBridgeRefusal } from '@gnuminator/shared';

import { FoundryClient } from '../foundry-client.js';
import { Logger } from '../logger.js';

/**
 * Supported game systems. This build targets D&D 5e only; every other system
 * is reported as 'other'.
 */
export type GameSystem = 'dnd5e' | 'other';

/**
 * Cache for system detection (avoid repeated queries)
 */
let cachedSystem: GameSystem | null = null;
let cachedSystemId: string | null = null;

/**
 * Detect the active Foundry game system.
 * Results are cached to avoid repeated queries.
 */
export async function detectGameSystem(
  foundryClient: FoundryClient,
  logger?: Logger
): Promise<GameSystem> {
  if (cachedSystem) {
    return cachedSystem;
  }

  try {
    const reply: unknown = await foundryClient.query('foundry-mcp-bridge.getWorldInfo');
    if (isBridgeRefusal(reply)) {
      // The GM gate refused (a non-GM client holds the bridge). Not cached as 'other', so every
      // call asks again until a GM joins: log at warn, not error, to keep the log readable.
      if (logger) {
        logger.warn('World info refused, game system not detected yet', { error: reply.error });
      }
      return 'other';
    }
    const worldInfo = reply as { system?: unknown } | null;
    const systemId = typeof worldInfo?.system === 'string' ? worldInfo.system.toLowerCase() : '';

    cachedSystemId = systemId;
    cachedSystem = systemId === 'dnd5e' ? 'dnd5e' : 'other';

    if (logger) {
      logger.info('Game system detected', { systemId, detectedAs: cachedSystem });
    }

    return cachedSystem;
  } catch (error) {
    if (logger) {
      logger.error('Failed to detect game system, defaulting to other', { error });
    }
    // Not cached (P-060): one failed query (Foundry still loading, link down) must not mark a
    // dnd5e world as 'other' until restart; the next call asks again.
    return 'other';
  }
}

/**
 * Get the raw system ID string (e.g., "dnd5e", "pf2e", "coc7")
 */
export function getCachedSystemId(): string | null {
  return cachedSystemId;
}

/**
 * Clear cached system detection (useful for testing or world switches)
 */
export function clearSystemCache(): void {
  cachedSystem = null;
  cachedSystemId = null;
}

/**
 * D&D 5e data paths for creature/actor stats
 */
export const SystemPaths = {
  dnd5e: {
    challengeRating: 'system.details.cr',
    creatureType: 'system.details.type.value',
    size: 'system.traits.size',
    alignment: 'system.details.alignment',
    level: 'system.details.level.value', // For NPCs/characters
    hitPoints: 'system.attributes.hp',
    armorClass: 'system.attributes.ac.value',
    abilities: 'system.abilities',
    skills: 'system.skills',
    spells: 'system.spells',
    legendaryActions: 'system.resources.legact',
    legendaryResistances: 'system.resources.legres',
  },
} as const;

/**
 * Extract a value from system data using a path string
 * Handles both simple and nested paths (e.g., "system.details.cr")
 */
export function extractSystemValue(data: any, path: string | null): any {
  if (!path || !data) {
    return undefined;
  }

  const parts = path.split('.');
  let value = data;

  for (const part of parts) {
    if (value === undefined || value === null) {
      return undefined;
    }
    value = value[part];
  }

  return value;
}

/**
 * Get creature level/CR (D&D 5e: CR first, then level).
 */
export function getCreatureLevel(actorData: any, system: GameSystem): number | undefined {
  if (system === 'dnd5e') {
    const cr = extractSystemValue(actorData, SystemPaths.dnd5e.challengeRating);
    if (cr !== undefined) return Number(cr);

    const level = extractSystemValue(actorData, SystemPaths.dnd5e.level);
    if (level !== undefined) return Number(level);
  }

  return undefined;
}

/**
 * Get creature type (D&D 5e: single creature-type string).
 */
export function getCreatureType(actorData: any, system: GameSystem): string | string[] | undefined {
  if (system === 'dnd5e') {
    return extractSystemValue(actorData, SystemPaths.dnd5e.creatureType);
  }

  return undefined;
}

/**
 * Check if a creature has spellcasting (D&D 5e: spells object or spellcasting level).
 */
export function hasSpellcasting(actorData: any, system: GameSystem): boolean {
  if (system === 'dnd5e') {
    const spells = extractSystemValue(actorData, SystemPaths.dnd5e.spells);
    const spellLevel = extractSystemValue(actorData, 'system.details.spellLevel');
    return !!(spells || spellLevel);
  }

  return false;
}
