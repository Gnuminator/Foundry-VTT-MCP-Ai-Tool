/**
 * The Table user of the TV (tv-login, G1). `plan-table-viewer` creates it with a flag, and the
 * module's own player lists skip a user that has it: the TV is a screen, not a person at the
 * table. The module also holds the allowlist for creating a User through a guarded write.
 *
 * The values are mirrored from `shared/src/table-viewer.ts` (the browser cannot resolve
 * `@gnuminator/shared`) and pinned by `table-viewer-user.contract.test.ts`.
 */
import { MODULE_ID } from './constants.js';

export const TABLE_VIEWER_FLAG = 'tableViewer';
export const TABLE_VIEWER_ROLE = 1;
export const TABLE_VIEWER_FEATURE_ID = 'table-viewer';

/** True for the user `plan-table-viewer` made (the flag in its data), read from a document or a snapshot. */
export function isTableViewerUser(user: unknown): boolean {
  const u = user as {
    getFlag?: (scope: string, key: string) => unknown;
    flags?: Record<string, Record<string, unknown> | undefined>;
  } | null;
  if (!u || typeof u !== 'object') return false;
  if (u.flags?.[MODULE_ID]?.[TABLE_VIEWER_FLAG] === true) return true;
  try {
    return u.getFlag?.(MODULE_ID, TABLE_VIEWER_FLAG) === true;
  } catch {
    return false;
  }
}

/** A non-GM user that counts as a person at the table. */
export function isTablePlayer(user: { isGM?: boolean }): boolean {
  return user.isGM !== true && !isTableViewerUser(user);
}

/**
 * Features whose writes may create a User. `change-undo` and `rollback` only put back what an undo
 * or a failed batch took away; the data check below holds for them too.
 */
const USER_CREATE_FEATURES = new Set([TABLE_VIEWER_FEATURE_ID, 'change-undo', 'rollback']);

/**
 * Throws unless a `create` of a User is the Table viewer's: from the `table-viewer` feature (or
 * the undo of it), a role no higher than Player, and no password. Every other write path that
 * could create a User, a GM or an assistant, or one with a password, is refused here.
 */
export function assertUserCreateAllowed(feature: string, data: Record<string, unknown>): void {
  if (!USER_CREATE_FEATURES.has(feature)) {
    throw new Error(
      `Creating a User is only allowed for the "${TABLE_VIEWER_FEATURE_ID}" feature (got "${feature}")`
    );
  }
  // Foundry also reads a dotted key ("permissions.X") or an operator key ("==role", "-=role") on
  // create; the checks below look at plain top-level fields, so refuse these spellings outright.
  const odd = Object.keys(data).find(key => key.includes('.') || /^[-=]=/.test(key));
  if (odd !== undefined) {
    throw new Error(`A created User may not use the key "${odd}" (plain fields only)`);
  }
  const role = data.role;
  if (
    role !== undefined &&
    (typeof role !== 'number' || !(role >= 0 && role <= TABLE_VIEWER_ROLE))
  ) {
    throw new Error(
      `A created User may have the role Player or lower (got ${JSON.stringify(role)})`
    );
  }
  // An empty password is Foundry's default and shows up in the recorded source of a deleted user.
  for (const key of ['password', 'passwordSalt']) {
    const value = data[key];
    if (value !== undefined && value !== '' && value !== null) {
      throw new Error(`A created User may not carry a ${key}`);
    }
  }
  // Permission overrides (for example SETTINGS_MODIFY) are not a Table viewer's; the recorded
  // source of a deleted Table user holds an empty object.
  const permissions = data.permissions;
  if (permissions !== undefined && permissions !== null) {
    if (typeof permissions !== 'object' || Array.isArray(permissions)) {
      throw new Error('A created User may not carry permissions');
    }
    const entries = Object.entries(permissions);
    if (entries.some(([key, value]) => value === true || key.includes('.') || /^[-=]=/.test(key))) {
      throw new Error('A created User may not carry a permission override');
    }
  }
}

/** User fields no guarded write may change: who counts as a GM, what they may do, how they log in. */
const USER_UPDATE_REFUSED = ['role', 'permissions', 'password', 'passwordSalt'];

/**
 * Throws if an `update` of a User touches its role, permissions or password (a path under one of
 * them counts, as does an unset of it). The Table user's undo and redo never update a User.
 */
export function assertUserUpdateAllowed(
  changePaths: readonly string[],
  unsetPaths: readonly string[] = []
): void {
  for (const path of [...changePaths, ...unsetPaths]) {
    // "-=x" deletes and "==x" replaces a field in Foundry's update syntax.
    const field = path.replace(/^[-=]=/, '').split('.')[0] ?? '';
    if (USER_UPDATE_REFUSED.includes(field)) {
      throw new Error(
        `A User's ${field} cannot be changed through a guarded write (got "${path}")`
      );
    }
  }
}
