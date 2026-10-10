import { MODULE_ID, TOKEN_DISPOSITIONS } from '../constants.js';
import { rec } from '../character-sheet-fields.js';

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
export function sanitizeData(data: unknown): Record<string, unknown> {
  // Typed as an object for the callers (a `system`, `flags`...); a null or primitive passes
  // through unchanged.
  if (data === null || data === undefined) {
    return data as unknown as Record<string, unknown>;
  }

  if (typeof data !== 'object') {
    return data as unknown as Record<string, unknown>;
  }

  try {
    // removeSensitiveFields returns a sanitized copy
    const sanitized = removeSensitiveFields(data);

    // Use custom JSON serializer to avoid deprecated property warnings
    const jsonString = safeJSONStringify(sanitized);
    return JSON.parse(jsonString) as Record<string, unknown>;
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
  obj: unknown,
  visited: WeakSet<object> = new WeakSet(),
  depth: number = 0
): unknown {
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
      return (obj as unknown[]).map((item): unknown =>
        removeSensitiveFields(item, visited, depth + 1)
      );
    }

    // dnd5e 6 keeps item `properties` in a Set and `activities` in a Collection (a Map), which
    // JSON turns into `{}`: a Set becomes an array, a Map the array of its values (their
    // `toJSON()`, so a document's parent links are never walked).
    if (obj instanceof Set) {
      return [...(obj as Set<unknown>)].map((item): unknown =>
        removeSensitiveFields(item, visited, depth + 1)
      );
    }
    if (obj instanceof Map) {
      return [...(obj as Map<unknown, unknown>).values()].map((item): unknown =>
        removeSensitiveFields(toJSONOrSelf(item), visited, depth + 1)
      );
    }

    // Create a new sanitized object
    const sanitized: Record<string, unknown> = {};

    // Use Object.keys (does not invoke getters) so we can filter deprecated
    // accessor properties before reading their values.
    const keys = Object.keys(obj);
    const source = obj as Record<string, unknown>;

    // dnd5e 5.3 moved senses.darkvision/blindsight/tremorsense/truesight to
    // senses.ranges.*. The legacy keys remain as deprecated getters that
    // log a warning when read. Detect this shape and skip the legacy keys.
    const DEPRECATED_DND5E_SENSE_KEYS = ['darkvision', 'blindsight', 'tremorsense', 'truesight'];
    const isDnd5eSensesShape =
      keys.includes('ranges') && keys.some(k => DEPRECATED_DND5E_SENSE_KEYS.includes(k));
    const skipAbilitySave = isAbilityShape(obj);

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

      if (skipAbilitySave && key === 'save') {
        continue;
      }

      // Recursively sanitize the value (read only after filter to avoid getter-triggered warnings)
      sanitized[key] = removeSensitiveFields(source[key], visited, depth + 1);
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

  return sensitiveKeys.includes(key) || problematicKeys.includes(key);
}

/**
 * Whether an object is an actor ability entry (`abilities.str`: `value`, `proficient` and
 * `save`), whose legacy `save` accessor warned when read. Only that `save` is skipped; an
 * activity's `save` ({ ability, dc }) is kept.
 */
export function isAbilityShape(obj: unknown): boolean {
  if (obj === null || typeof obj !== 'object' || Array.isArray(obj)) return false;
  const keys = Object.keys(obj);
  return keys.includes('save') && keys.includes('value') && keys.includes('proficient');
}

/**
 * Custom JSON serializer that drops deprecated Foundry accessor properties
 * (e.g. the legacy ability `save`) so reading them never logs warnings.
 */
export function safeJSONStringify(obj: unknown): string {
  try {
    return JSON.stringify(obj, function (this: unknown, key: string, value: unknown) {
      // Skip the legacy ability `save` (the holder is an ability entry), keep every other `save`
      if (key === 'save' && isAbilityShape(this)) return undefined;
      return value;
    });
  } catch (error) {
    console.warn(`[${MODULE_ID}] JSON stringify failed, using fallback:`, error);
    return '{}';
  }
}

/** Coerce a token disposition to a number, defaulting to neutral. */
export function getTokenDisposition(disposition: unknown): number {
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

/** Resolve an actor by id, exact name, or partial name match. */
export function findActorByIdentifier(identifier: string): Actor | undefined {
  return (
    game.actors?.get(identifier) ??
    game.actors?.getName(identifier) ??
    Array.from(game.actors || []).find(a =>
      a.name?.toLowerCase().includes(identifier.toLowerCase())
    )
  );
}

/**
 * Resolve a damage/roll target to an Actor. Prefers a token on the current
 * scene (so unlinked NPC tokens use their own synthetic actor/HP), then the one
 * token on that scene made from the world actor named or id'd (the dashboard's
 * actor picker sends ids), then falls back to that world actor.
 */
export function resolveTargetActor(identifier: string): Actor | undefined {
  const worldActor = findActorByIdentifier(identifier);
  return findSceneTokenActor(identifier, worldActor?.id) ?? worldActor;
}

/**
 * The actor of a token on the current scene: the token named or id'd by `identifier`,
 * else the one token made from the world actor `worldActorId` (default: `identifier`).
 * Several tokens from one actor are ambiguous: `undefined` then, so callers keep the
 * world actor. A linked token's actor is the world actor itself.
 */
export function findSceneTokenActor(
  identifier: string,
  worldActorId?: string
): Actor | null | undefined {
  // `?.`: test mocks may have no scenes collection.
  const scene = game.scenes?.current;
  if (!scene) return undefined;
  const tokens = scene.tokens.contents;
  const lower = identifier.toLowerCase();
  const token = tokens.find(t => t.id === identifier || t.name?.toLowerCase() === lower);
  if (token?.actor) return token.actor;
  const actorId = worldActorId ?? identifier;
  const fromActor = tokens.filter(t => t.actorId === actorId);
  return fromActor.length === 1 ? fromActor[0]?.actor : undefined;
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
    const existingFolder = game.folders?.find(f => f.name === folderName && f.type === type);

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
    return folder?.id ?? null;
  } catch (error) {
    console.warn(`[${MODULE_ID}] Failed to create folder "${folderName}":`, error);
    // Return null so items are created without folders rather than failing
    return null;
  }
}

/** Major version number of the active game system (0 if unparseable). */
export function systemMajor(): number {
  return parseInt(String(game.system?.version || '0').split('.')[0], 10) || 0;
}

/** Throw unless the active game system is dnd5e. */
export function requireDnd5e(toolName: string): void {
  if (game.system?.id !== 'dnd5e') {
    throw new Error(`${toolName} requires the dnd5e game system`);
  }
}

/** Whether this Foundry names chat visibility by message mode (v14 `CONFIG.ChatMessage.modes`). */
export function usesMessageModes(): boolean {
  const config = (globalThis as { CONFIG?: { ChatMessage?: { modes?: unknown } } }).CONFIG;
  const modes = config?.ChatMessage?.modes;
  return !!modes && typeof modes === 'object' && 'public' in modes && 'gm' in modes;
}

/**
 * A public or GM-only roll's chat visibility, in the running Foundry's own terms: v14 message
 * modes (`public`/`gm`), v13 roll modes (`publicroll`/`gmroll`). Pass it as dnd5e's message-config
 * `rollMode`: dnd5e 6 hands that to v14's `ChatMessage.create` as `messageMode` unmapped, where a
 * legacy value falls back to the user's default mode (public), so a "GM-only" roll went public.
 */
export function rollModeFor(isPublic: boolean | undefined): string {
  if (usesMessageModes()) return isPublic ? 'public' : 'gm';
  return isPublic ? 'publicroll' : 'gmroll';
}

/** `Roll#toMessage` options for that visibility: v14 takes `messageMode` (`rollMode` is deprecated there). */
export function rollToMessageOptions(
  isPublic: boolean | undefined
): { messageMode: string } | { rollMode: string } {
  const mode = rollModeFor(isPublic);
  return usesMessageModes() ? { messageMode: mode } : { rollMode: mode };
}

/** Names of an actor's active, status-bearing (non-disabled) condition effects. */
export function actorConditionNames(actor: Actor | null | undefined): string[] {
  if (!actor) return [];
  try {
    const effs = actor.effects?.contents ?? actor.effects ?? [];
    return effs
      .filter(e => (e.statuses?.size ?? 0) > 0 && !e.disabled)
      .map((e): unknown => e.name || rec(e).label)
      .filter((n): n is string => typeof n === 'string');
  } catch {
    return [];
  }
}

/** A document or data model as its `toJSON()` (plain data, no parent links), else the value. */
function toJSONOrSelf(value: unknown): unknown {
  const toJSON = (value as { toJSON?: unknown } | null)?.toJSON;
  return typeof toJSON === 'function' ? (toJSON as () => unknown).call(value) : value;
}
