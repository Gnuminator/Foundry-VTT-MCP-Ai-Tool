/**
 * Changing a user's role through a guarded write (D-135 part 3, "god-mode for setup"). Everything
 * else about a User (permissions, password) stays refused (`table-viewer-user.ts`). A role may be
 * changed only when:
 *
 * - the write comes from the "foundry-setup" feature, or from the undo or rollback of one,
 * - the new role is None, Player, Trusted Player or Assistant GM: the AI Tool never makes a
 *   Gamemaster and never touches one (so an undo never has to restore a GM either),
 * - the user is not the one the bridge runs as.
 *
 * The values are mirrored from `shared/src/foundry-setup.ts` (the browser cannot resolve
 * `@gnuminator/shared`) and pinned by `virtual-targets.contract.test.ts`.
 */
import { SETUP_FEATURE_ID } from './data-access/virtual-targets.js';
import {
  TABLE_VIEWER_ROLE,
  assertUserUpdateAllowed,
  isTableViewerUser,
} from './table-viewer-user.js';

/** Roles a plan may give or take: `CONST.USER_ROLES` names to numbers, without Gamemaster. */
export const SETTABLE_USER_ROLES: Record<string, number> = {
  NONE: 0,
  PLAYER: 1,
  TRUSTED: 2,
  ASSISTANT: 3,
};

const ROLE_FEATURES = new Set([SETUP_FEATURE_ID, 'change-undo', 'rollback']);

interface UserLike {
  id?: string;
  name?: string;
  role?: number;
  isGM?: boolean;
}

/** The role number in a set of changes, or undefined when it does not change the role. */
function newRole(changes: Record<string, unknown>): unknown {
  return changes.role;
}

/**
 * Throws unless `role` in `changes` is one a plan may set on this user. Called at plan time (no
 * feature) and again at apply (with the feature).
 */
export function assertUserRoleChange(
  user: UserLike,
  changes: Record<string, unknown>,
  feature?: string
): void {
  if (!('role' in changes)) return;
  if (feature !== undefined && !ROLE_FEATURES.has(feature)) {
    throw new Error(
      `A User's role is only changed by the "${SETUP_FEATURE_ID}" feature (got "${feature}")`
    );
  }
  const role = newRole(changes);
  if (typeof role !== 'number' || !Number.isInteger(role) || role < 0 || role > 3) {
    throw new Error('A role plan may only set None, Player, Trusted Player or Assistant GM');
  }
  if (role > TABLE_VIEWER_ROLE && isTableViewerUser(user)) {
    throw new Error(
      `${user.name ?? 'This user'} is the shared table viewer login (no password); it stays at Player or below`
    );
  }
  // `isGM` is true for an Assistant GM too (role 3), which a plan may change.
  if (typeof user.role === 'number' && user.role > 3) {
    throw new Error(
      `${user.name ?? 'This user'} is a Gamemaster; the AI Tool does not change them`
    );
  }
  const self = (game as unknown as { user?: { id?: string } }).user?.id;
  if (self !== undefined && user.id === self) {
    throw new Error('The user the bridge runs as cannot have its role changed by a plan');
  }
}

/**
 * The User-update check of a guarded write: a role change passes when the rules above hold; every
 * other refusal of `assertUserUpdateAllowed` (permissions, password) stays.
 */
export function assertUserUpdate(
  user: UserLike,
  changePaths: readonly string[],
  unsetPaths: readonly string[],
  changes: Record<string, unknown>,
  feature: string
): void {
  const roleChange = changePaths.includes('role');
  if (roleChange) assertUserRoleChange(user, changes, feature);
  if (unsetPaths.some(path => path.replace(/^[-=]=/, '').split('.')[0] === 'role')) {
    throw new Error("A User's role cannot be unset");
  }
  assertUserUpdateAllowed(
    changePaths.filter(path => path !== 'role'),
    unsetPaths
  );
}
