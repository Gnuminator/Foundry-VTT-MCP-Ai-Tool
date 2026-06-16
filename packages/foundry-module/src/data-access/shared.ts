import { MODULE_ID, TOKEN_DISPOSITIONS } from '../constants.js';

/**
 * Cross-cutting data-access helpers, as stateless free functions.
 *
 * These were private methods on `FoundryDataAccess` but hold no instance state —
 * they read Foundry globals + their arguments and return values. Lifting them to
 * free functions lets every domain module import them directly instead of
 * reaching back through the facade. (`FoundryDataAccess` keeps thin wrappers that
 * delegate here so its existing call sites are unaffected.)
 */

/**
 * Deep-sanitize a Foundry data object for tool output: strip sensitive/problematic
 * fields and round-trip through a getter-safe JSON serializer. Returns `{}` on
 * failure rather than throwing.
 */
export function sanitizeData(data: any): any {
  if (data === null || data === undefined) {
    return data;
  }

  if (typeof data !== 'object') {
    return data;
  }

  try {
    // removeSensitiveFields returns a sanitized copy
    const sanitized = removeSensitiveFields(data);

    // Use custom JSON serializer to avoid deprecated property warnings
    const jsonString = safeJSONStringify(sanitized);
    return JSON.parse(jsonString);
  } catch (error) {
    console.warn(`[${MODULE_ID}] Failed to sanitize data:`, error);
    return {};
  }
}

/**
 * Remove sensitive fields from a data object with circular-reference protection.
 * Returns a sanitized copy instead of modifying the original.
 */
export function removeSensitiveFields(
  obj: any,
  visited: WeakSet<object> = new WeakSet(),
  depth: number = 0
): any {
  // Handle primitives
  if (obj === null || typeof obj !== 'object') {
    return obj;
  }

  // Safety depth limit to prevent extremely deep recursion
  if (depth > 50) {
    console.warn(`[${MODULE_ID}] Sanitization depth limit reached at depth ${depth}`);
    return '[Max depth reached]';
  }

  // Check for circular reference
  if (visited.has(obj)) {
    return '[Circular Reference]';
  }

  // Mark this object as visited
  visited.add(obj);

  try {
    // Handle arrays
    if (Array.isArray(obj)) {
      return obj.map(item => removeSensitiveFields(item, visited, depth + 1));
    }

    // Create a new sanitized object
    const sanitized: any = {};

    // Use Object.keys (does not invoke getters) so we can filter deprecated
    // accessor properties before reading their values.
    const keys = Object.keys(obj);

    // dnd5e 5.3 moved senses.darkvision/blindsight/tremorsense/truesight to
    // senses.ranges.*. The legacy keys remain as deprecated getters that
    // log a warning when read. Detect this shape and skip the legacy keys.
    const DEPRECATED_DND5E_SENSE_KEYS = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];
    const isDnd5eSensesShape =
      keys.includes('ranges') && keys.some(k => DEPRECATED_DND5E_SENSE_KEYS.includes(k));

    for (const key of keys) {
      // Skip sensitive and problematic fields entirely
      if (isSensitiveOrProblematicField(key)) {
        continue;
      }

      // Skip most private properties except essential ones.
      // _stats (Foundry document audit metadata) and _source (raw stored data
      // duplicate) are bloat in tool output; we keep only _id.
      if (key.startsWith('_') && key !== '_id') {
        continue;
      }

      if (isDnd5eSensesShape && DEPRECATED_DND5E_SENSE_KEYS.includes(key)) {
        continue;
      }

      // Recursively sanitize the value (read only after filter to avoid getter-triggered warnings)
      sanitized[key] = removeSensitiveFields(obj[key], visited, depth + 1);
    }

    return sanitized;
  } catch (error) {
    console.warn(`[${MODULE_ID}] Error during sanitization at depth ${depth}:`, error);
    return '[Sanitization failed]';
  }
}

/**
 * Whether a field should be excluded from sanitized output (sensitive,
 * cycle-prone, or a deprecated dnd5e accessor).
 */
export function isSensitiveOrProblematicField(key: string): boolean {
  const sensitiveKeys = [
    'password',
    'token',
    'secret',
    'key',
    'auth',
    'credential',
    'session',
    'cookie',
    'private',
  ];

  const problematicKeys = [
    'parent',
    '_parent',
    'collection',
    'apps',
    'document',
    '_document',
    'constructor',
    'prototype',
    '__proto__',
    'valueOf',
    'toString',
    // dnd5e item leveling metadata; full of cycles back to the actor and other items.
    // Not gameplay-relevant for LLM consumers.
    'advancement',
  ];

  // Skip deprecated ability save properties that trigger warnings
  const deprecatedKeys = [
    'save', // Skip the deprecated 'save' property on abilities
  ];

  return (
    sensitiveKeys.includes(key) || problematicKeys.includes(key) || deprecatedKeys.includes(key)
  );
}

/**
 * Custom JSON serializer that drops deprecated Foundry accessor properties
 * (e.g. the legacy ability `save`) so reading them never logs warnings.
 */
export function safeJSONStringify(obj: any): string {
  try {
    return JSON.stringify(obj, (key, value) => {
      // Skip deprecated properties during JSON serialization
      if (key === 'save' && typeof value === 'object' && value !== null) {
        // If this looks like a deprecated ability save object, skip it
        return undefined;
      }
      return value;
    });
  } catch (error) {
    console.warn(`[${MODULE_ID}] JSON stringify failed, using fallback:`, error);
    return '{}';
  }
}

/** Coerce a token disposition to a number, defaulting to neutral. */
export function getTokenDisposition(disposition: any): number {
  if (typeof disposition === 'number') {
    return disposition;
  }

  // Default to neutral if unknown
  return TOKEN_DISPOSITIONS.NEUTRAL;
}

/** Assert Foundry is ready with an active world + user, else throw. */
export function validateFoundryState(): void {
  if (!game?.ready) {
    throw new Error('Foundry VTT is not ready');
  }

  if (!game.world) {
    throw new Error('No active world');
  }

  if (!game.user) {
    throw new Error('No active user');
  }
}

/**
 * Append an audit record for a write operation to the world's flag store
 * (capped at the last 100 entries). Always records — no setting gates it.
 */
export function auditLog(
  operation: string,
  data: any,
  result: 'success' | 'failure',
  error?: string
): void {
  // Always audit write operations (no setting required)
  const logEntry = {
    timestamp: new Date().toISOString(),
    operation,
    user: game.user?.name || 'Unknown',
    userId: game.user?.id || 'unknown',
    world: game.world?.id || 'unknown',
    data: sanitizeData(data),
    result,
    error,
  };

  // Store in flags for persistence (optional)
  if (game.world && (game.world as any).setFlag) {
    const auditLogs = (game.world as any).getFlag(MODULE_ID, 'auditLogs') || [];
    auditLogs.push(logEntry);

    // Keep only last 100 entries to prevent bloat
    if (auditLogs.length > 100) {
      auditLogs.splice(0, auditLogs.length - 100);
    }

    (game.world as any).setFlag(MODULE_ID, 'auditLogs', auditLogs);
  }
}

/** Resolve an actor by id, exact name, or partial name match. */
export function findActorByIdentifier(identifier: string): any {
  return (
    game.actors?.get(identifier) ||
    game.actors?.getName(identifier) ||
    Array.from(game.actors || []).find(a =>
      a.name?.toLowerCase().includes(identifier.toLowerCase())
    )
  );
}

/**
 * Resolve a damage/roll target to an Actor. Prefers a token on the current
 * scene (so unlinked NPC tokens use their own synthetic actor/HP), then falls
 * back to a world actor by name or id.
 */
export function resolveTargetActor(identifier: string): any {
  const scene = (game.scenes as any)?.current;
  if (scene) {
    const token = scene.tokens.find(
      (t: any) => t.id === identifier || t.name?.toLowerCase() === identifier.toLowerCase()
    );
    if (token?.actor) return token.actor;
  }
  return findActorByIdentifier(identifier);
}

/**
 * Find an existing folder of the given type by name, or create one (with an
 * MCP-generated flag + sensible default description/color). Returns the folder
 * id, or `null` if creation fails (so callers can fall back to no folder).
 */
export async function getOrCreateFolder(
  folderName: string,
  type: 'Actor' | 'JournalEntry'
): Promise<string | null> {
  try {
    // Look for existing folder
    const existingFolder = game.folders?.find((f: any) => f.name === folderName && f.type === type);

    if (existingFolder) {
      return existingFolder.id;
    }

    // Create appropriate descriptions
    let description = '';
    if (type === 'Actor') {
      if (folderName === 'Foundry MCP Creatures') {
        description = 'Creatures and monsters created via Foundry MCP Bridge';
      } else {
        description = `NPCs and creatures related to: ${folderName}`;
      }
    } else {
      description = `Quest and content for: ${folderName}`;
    }

    // Create new folder
    const folderData = {
      name: folderName,
      type,
      description,
      color: type === 'Actor' ? '#4a90e2' : '#f39c12', // Blue for actors, orange for journals
      sort: 0,
      parent: null,
      flags: {
        'foundry-mcp-bridge': {
          mcpGenerated: true,
          createdAt: new Date().toISOString(),
          questContext: type === 'JournalEntry' ? folderName : undefined,
        },
      },
    };

    const folder = await Folder.create(folderData);
    return folder?.id || null;
  } catch (error) {
    console.warn(`[${MODULE_ID}] Failed to create folder "${folderName}":`, error);
    // Return null so items are created without folders rather than failing
    return null;
  }
}

/** Major version number of the active game system (0 if unparseable). */
export function systemMajor(): number {
  return parseInt(String((game.system as any)?.version || '0').split('.')[0], 10) || 0;
}

/** Throw unless the active game system is dnd5e. */
export function requireDnd5e(toolName: string): void {
  if ((game.system as any)?.id !== 'dnd5e') {
    throw new Error(`${toolName} requires the dnd5e game system`);
  }
}

/** Map a public/private flag to a Foundry dice roll-mode string. */
export function rollModeFor(isPublic: boolean | undefined): string {
  const modes: any = (CONST as any).DICE_ROLL_MODES || {};
  return isPublic ? (modes.PUBLIC ?? 'publicroll') : (modes.PRIVATE ?? 'gmroll');
}

/** Names of an actor's active, status-bearing (non-disabled) condition effects. */
export function actorConditionNames(actor: any): string[] {
  if (!actor) return [];
  try {
    const effs = actor.effects?.contents ?? actor.effects ?? [];
    return effs
      .filter((e: any) => (e.statuses?.size ?? 0) > 0 && !e.disabled)
      .map((e: any) => e.name || e.label)
      .filter((n: any): n is string => typeof n === 'string');
  } catch {
    return [];
  }
}
