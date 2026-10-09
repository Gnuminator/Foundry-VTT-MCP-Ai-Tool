import { MODULE_ID } from '../constants.js';
import * as shared from './shared.js';

/**
 * Numeric permission level → human-readable tier name.
 *
 * Foundry uses 0–3 for NONE/LIMITED/OBSERVER/OWNER. Values outside this range
 * fall back to the raw numeric string (pinned by the "permission 99" test).
 */
const PERMISSION_NAMES: Record<number, string> = {
  0: 'NONE',
  1: 'LIMITED',
  2: 'OBSERVER',
  3: 'OWNER',
};

/** Resolve a Foundry permission level (0–3) to its canonical name string. */
function permissionName(level: number): string {
  return PERMISSION_NAMES[level] ?? String(level);
}

/**
 * Derive the highest Foundry permission tier (0–3) a user holds on an actor
 * by probing `testUserPermission` from OWNER down to OBSERVER and LIMITED.
 * Returns 0 (NONE) when no positive tier matches.
 */
function resolvePermissionTier(actor: Actor, user: User): number {
  if (actor.testUserPermission(user, 'OWNER')) return 3;
  if (actor.testUserPermission(user, 'OBSERVER')) return 2;
  if (actor.testUserPermission(user, 'LIMITED')) return 1;
  return 0;
}

/** One actor's ownership entry as returned by `getActorOwnership`. */
interface ActorOwnershipEntry {
  id: string;
  name: string;
  type: string;
  ownership: Array<{
    userId: string;
    userName: string;
    permission: string;
    numericPermission: number;
  }>;
}

/** Guarded feature id (mirror of the shared `OWNERSHIP_FEATURE_ID`, F5 L3). */
export const OWNERSHIP_FEATURE_ID = 'ownership';

/**
 * Actor ownership + player/party lookup domain, extracted from `FoundryDataAccess`.
 *
 * Covers two complementary surfaces:
 *   - **Ownership**: reading Foundry actor `ownership` maps, which control which
 *     players can see/control each actor. Changes go through plan-ownership-change
 *     (F5 L3: guarded update ops, undoable).
 *   - **Players/roster**: querying the live connected-player list, party
 *     characters, friendly tokens on the active scene, and actor/player lookups
 *     by name or id.
 */
export class OwnershipPlayersDataAccess {
  // ===== READS =====

  /**
   * Return ownership information for one or all actors, optionally filtered to
   * a single player.
   *
   * - `actorIdentifier` absent or `'all'` → every actor in the world.
   * - `actorIdentifier` set to anything else → resolved via
   *   {@link shared.findActorByIdentifier} (id, exact name, partial name).
   * - `playerIdentifier` set → resolved via `game.users.getName` then
   *   `game.users.get`; only that user appears in each actor's ownership list.
   * - GM users are always excluded from the ownership list.
   *
   * Each entry has the shape `{ id, name, type, ownership: [...] }` where each
   * ownership element is `{ userId, userName, permission, numericPermission }`.
   */
  async getActorOwnership(data: {
    actorIdentifier?: string;
    playerIdentifier?: string;
  }): Promise<ActorOwnershipEntry[]> {
    shared.validateFoundryState();

    try {
      // Resolve the actor list.
      const actors: Actor[] =
        data.actorIdentifier && data.actorIdentifier !== 'all'
          ? [shared.findActorByIdentifier(data.actorIdentifier)].filter((a): a is Actor => !!a)
          : Array.from(game.actors || []);

      // Resolve the user list (non-GM users only).
      let users: User[];
      if (data.playerIdentifier) {
        const resolved =
          game.users?.getName(data.playerIdentifier) ?? game.users?.get(data.playerIdentifier);
        users = resolved && !resolved.isGM ? [resolved] : [];
      } else {
        users = Array.from(game.users || []).filter(u => !u.isGM);
      }

      return actors.map(actor => ({
        id: actor.id,
        name: actor.name,
        type: actor.type,
        ownership: users.map(user => {
          const tier = resolvePermissionTier(actor, user);
          return {
            userId: user.id,
            userName: user.name,
            permission: permissionName(tier),
            numericPermission: tier,
          };
        }),
      }));
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting actor ownership:`, error);
      throw error;
    }
  }

  /**
   * Return every token on the active scene that has a FRIENDLY disposition
   * (`disposition === 1`). Each entry carries the actor id (preferred over the
   * token id) and the actor/token name.
   *
   * Returns `[]` when there is no active scene or when an exception occurs.
   */
  async getFriendlyNPCs(): Promise<Array<{ id: string; name: string }>> {
    shared.validateFoundryState();

    try {
      const scene = game.scenes?.find(s => s.active);
      if (!scene) return [];

      return scene.tokens
        .filter(token => token.disposition === 1)
        .map(token => ({
          id: token.actor?.id || token.id || '',
          name: token.name || token.actor?.name || 'Unknown',
        }))
        .filter((t: { id: string; name: string }) => t.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting friendly NPCs:`, error);
      return [];
    }
  }

  /**
   * Return every world actor that is a player-controlled character
   * (`hasPlayerOwner === true` and `type === 'character'`). This is the party
   * roster — NPCs with a player owner and characters without one are excluded.
   */
  async getPartyCharacters(): Promise<Array<{ id: string; name: string }>> {
    shared.validateFoundryState();

    try {
      return Array.from(game.actors || [])
        .filter(actor => actor.hasPlayerOwner && actor.type === 'character')
        .map(actor => ({ id: actor.id || '', name: actor.name || 'Unknown' }))
        .filter((c: { id: string }) => c.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting party characters:`, error);
      return [];
    }
  }

  /**
   * Return every non-GM user who is currently connected (`active === true`).
   * The result is the live player list — useful for directing rolls, chat
   * messages, or permission grants at the people who are actually at the table.
   */
  async getConnectedPlayers(): Promise<Array<{ id: string; name: string }>> {
    shared.validateFoundryState();

    try {
      return Array.from(game.users || [])
        .filter(user => user.active && !user.isGM)
        .map(user => ({ id: user.id || '', name: user.name || 'Unknown' }))
        .filter((u: { id: string }) => u.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error getting connected players:`, error);
      return [];
    }
  }

  /**
   * Find players by user name or (when no user name matches) by the name of a
   * character they own.
   *
   * Resolution order (both respect `allowPartialMatch`):
   *   1. Direct user-name match against all non-GM users.
   *   2. When the direct search yields nothing and `includeCharacterOwners` is
   *      true: scan characters whose name matches the identifier and return their
   *      non-GM OWNER — de-duplicating by user id.
   *
   * GM users are never returned regardless of which path resolves.
   */
  async findPlayers(data: {
    identifier: string;
    allowPartialMatch?: boolean;
    includeCharacterOwners?: boolean;
  }): Promise<Array<{ id: string; name: string }>> {
    shared.validateFoundryState();

    try {
      const { identifier, allowPartialMatch = true, includeCharacterOwners = true } = data;
      const search = identifier.toLowerCase();

      // Step 1: match against user names (GMs excluded).
      const players: Array<{ id: string; name: string }> = [];
      for (const user of game.users || []) {
        if (user.isGM) continue;
        const uname = user.name?.toLowerCase() ?? '';
        if (uname === search || (allowPartialMatch && uname.includes(search))) {
          players.push({ id: user.id || '', name: user.name || 'Unknown' });
        }
      }

      // Step 2: fall back to character-owner lookup only when no direct match found.
      if (players.length === 0 && includeCharacterOwners) {
        for (const actor of game.actors || []) {
          if (actor.type !== 'character') continue;
          const aname = actor.name?.toLowerCase() ?? '';
          if (aname !== search && !(allowPartialMatch && aname.includes(search))) continue;

          // Find the non-GM owner of this character.
          const owner = game.users?.find(
            user => actor.testUserPermission(user, 'OWNER') && !user.isGM
          );
          if (owner && !players.some(p => p.id === owner.id)) {
            players.push({ id: owner.id || '', name: owner.name || 'Unknown' });
          }
        }
      }

      return players.filter(p => p.id);
    } catch (error) {
      console.error(`[${MODULE_ID}] Error finding players:`, error);
      return [];
    }
  }

  /**
   * Resolve a single actor by id, exact name, or partial name substring
   * (case-insensitive). Delegates to {@link shared.findActorByIdentifier}.
   *
   * Returns `null` when no actor matches or when an exception occurs.
   */
  async findActor(data: { identifier: string }): Promise<{ id: string; name: string } | null> {
    shared.validateFoundryState();

    try {
      const actor = shared.findActorByIdentifier(data.identifier);
      return actor ? { id: actor.id, name: actor.name } : null;
    } catch (error) {
      console.error(`[${MODULE_ID}] Error finding actor:`, error);
      return null;
    }
  }
}
