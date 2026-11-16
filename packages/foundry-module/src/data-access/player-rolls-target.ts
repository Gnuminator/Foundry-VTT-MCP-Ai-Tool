/** Resolving a roll-request target (a player user and/or character) and the whisper recipients. */

/** Outcome of resolving a roll-request target (a player user and/or character). */
export interface ResolveResult {
  found: boolean;
  user?: User;
  character?: Actor;
  targetName: string;
  errorType?: 'PLAYER_OFFLINE' | 'PLAYER_NOT_FOUND' | 'CHARACTER_NOT_FOUND';
  errorMessage?: string;
}

/**
 * Resolve a roll-request target to a player user and/or character. Resolution
 * order: a user by exact name → a player-owned character by exact name → a user
 * by partial name → a player-owned character by partial name → any character with no player owner (GM rolls it)
 * → not found. Offline players resolve to a structured PLAYER_OFFLINE error.
 */
export function resolveTargetPlayer(targetPlayer: string): ResolveResult {
  const searchTerm = targetPlayer.toLowerCase().trim();
  const allUsers = Array.from(game.users?.values() || []);

  // 1) Registered user by exact name, then a player-owned character by exact name: a partial
  //    user match never beats an exact character (character "Mira", user "Miranda").
  const exactUser = allUsers.find((u: User) => u.name?.toLowerCase() === searchTerm);
  if (exactUser) {
    return resultForUser(exactUser);
  }
  const exactCharacter = game.actors?.find(
    (actor: Actor) => actor.name?.toLowerCase() === searchTerm && actor.hasPlayerOwner
  );
  const partialUsers = exactCharacter
    ? []
    : allUsers.filter((u: User) => Boolean(u.name?.toLowerCase().includes(searchTerm)));
  if (partialUsers.length > 1) {
    return ambiguousTarget(
      targetPlayer,
      partialUsers.map(u => `${u.name} (${u.id})`)
    );
  }
  if (partialUsers[0]) {
    return resultForUser(partialUsers[0]);
  }

  // 2) Player-owned character by partial name: several partials are refused, never a first pick.
  let character = exactCharacter;
  if (!character) {
    const partialCharacters = Array.from(game.actors || []).filter(
      (actor: Actor) => actor.name?.toLowerCase().includes(searchTerm) && actor.hasPlayerOwner
    );
    if (partialCharacters.length > 1) {
      return ambiguousTarget(
        targetPlayer,
        partialCharacters.map(a => `${a.name} (${a.id})`)
      );
    }
    character = partialCharacters[0];
  }
  if (character) {
    const ownerUser = allUsers.find(
      (u: User) => character.testUserPermission(u, 'OWNER') && !u.isGM
    );
    if (ownerUser) {
      if (!ownerUser.active) {
        return {
          found: false,
          user: ownerUser,
          character,
          targetName: ownerUser.name || 'Unknown Player',
          errorType: 'PLAYER_OFFLINE',
          errorMessage: `Player "${ownerUser.name}" (owner of character "${character.name}") is registered but not currently logged in. They need to be online to receive roll requests.`,
        };
      }
      return {
        found: true,
        user: ownerUser,
        character,
        targetName: ownerUser.name || 'Unknown Player',
      };
    }
    // No (non-GM) player owner, the GM can still roll for this character.
    return {
      found: true,
      character,
      targetName: character.name || 'Unknown Character',
    };
  }

  // 3) Any character that exists but has no player owner at all.
  const unowned = Array.from(game.actors || []).filter((actor: Actor) =>
    Boolean(actor.name?.toLowerCase().includes(searchTerm))
  );
  const anyCharacter =
    unowned.find((actor: Actor) => actor.name?.toLowerCase() === searchTerm) ??
    (unowned.length === 1 ? unowned[0] : undefined);
  if (!anyCharacter && unowned.length > 1) {
    return ambiguousTarget(
      targetPlayer,
      unowned.map(a => `${a.name} (${a.id})`)
    );
  }
  if (anyCharacter && !anyCharacter.hasPlayerOwner) {
    return {
      found: true,
      character: anyCharacter,
      targetName: anyCharacter.name || 'Unknown Character',
    };
  }

  // 4) Nothing matched.
  return {
    found: false,
    targetName: targetPlayer,
    errorType: 'PLAYER_NOT_FOUND',
    errorMessage: `No player or character named "${targetPlayer}" found. Available players: ${
      allUsers
        .filter(u => !u.isGM)
        .map(u => u.name)
        .join(', ') || 'none'
    }`,
  };
}

/** Several partial matches: not found, with the candidates and ids so the caller can pick. */
export function ambiguousTarget(targetPlayer: string, candidates: string[]): ResolveResult {
  const shown = candidates.slice(0, 10).join(', ');
  const more = candidates.length > 10 ? `, ...(+${candidates.length - 10} more)` : '';
  return {
    found: false,
    targetName: targetPlayer,
    errorType: 'PLAYER_NOT_FOUND',
    errorMessage: `Multiple players or characters match "${targetPlayer}": ${shown}${more}. Use the exact name.`,
  };
}

/** Resolve a matched user: PLAYER_OFFLINE when inactive, else found (with owned character). */
export function resultForUser(user: User): ResolveResult {
  if (!user.active) {
    return {
      found: false,
      user,
      targetName: user.name || 'Unknown Player',
      errorType: 'PLAYER_OFFLINE',
      errorMessage: `Player "${user.name}" is registered but not currently logged in. They need to be online to receive roll requests.`,
    };
  }
  // The user's character (non-GM) drives roll-data lookups: the one assigned to the user in
  // User Configuration when they own it, else the first actor they own.
  const assigned = user.character;
  const playerCharacter =
    assigned && !user.isGM && assigned.testUserPermission(user, 'OWNER')
      ? assigned
      : game.actors?.find((actor: Actor) => actor.testUserPermission(user, 'OWNER') && !user.isGM);
  return {
    found: true,
    user,
    ...(playerCharacter && { character: playerCharacter }),
    targetName: user.name || 'Unknown Player',
  };
}

/** Whisper recipients for a private roll: the target user (if any) + all active GMs. */
export function collectWhisperTargets(targetUserId?: string | null): string[] {
  const targets: string[] = [];
  if (targetUserId) {
    targets.push(targetUserId);
  }
  const gmUsers = game.users?.filter(u => u.isGM && u.active);
  if (gmUsers) {
    for (const gm of gmUsers) {
      if (gm.id && !targets.includes(gm.id)) {
        targets.push(gm.id);
      }
    }
  }
  return targets;
}
