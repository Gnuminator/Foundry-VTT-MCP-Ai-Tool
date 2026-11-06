/**
 * Foundry setup with undo (D-135): `plan-foundry-setup` (admin set) reads and plans changes to a
 * world or client setting, a compendium pack's configuration (who may open it, locked, folder),
 * modules on or off for the world, and (later) user roles. Each is a guarded update of a pseudo uuid the
 * module understands (`module: data-access/virtual-targets.ts`), so plan, confirm, undo, the
 * conflict check and Recent Changes work as for any document.
 */

/** The guarded feature switch ("AI Tool: Foundry setup (writes)"), off by default. */
export const FOUNDRY_SETUP_FEATURE_ID = 'foundry-setup';

/** `GameSetting.<namespace>.<key>`: the target of a setting change; the path `value` is the value. */
export const SETTING_UUID_PREFIX = 'GameSetting.';
/** `PackConfig.<packId>`: the target of a pack's configuration; paths `ownership`, `locked`, `folder`. */
export const PACK_UUID_PREFIX = 'PackConfig.';

export const MODULE_CONFIG_SETTING = 'core.moduleConfiguration';

/** What `plan-foundry-setup` can read and change. */
export const FOUNDRY_SETUP_AREAS = ['setting', 'pack', 'module', 'user', 'ownership'] as const;
export type FoundrySetupArea = (typeof FOUNDRY_SETUP_AREAS)[number];

export const FOUNDRY_SETUP_MODES = ['read', 'plan'] as const;
export type FoundrySetupMode = (typeof FOUNDRY_SETUP_MODES)[number];

/** The roles a compendium pack's ownership is set for, as Foundry stores them. */
export const PACK_OWNERSHIP_ROLES = ['PLAYER', 'TRUSTED', 'ASSISTANT'] as const;
export type PackOwnershipRole = (typeof PACK_OWNERSHIP_ROLES)[number];

/**
 * The roles `plan-foundry-setup` may give a user (`CONST.USER_ROLES`): never Gamemaster, and a
 * Gamemaster is never changed. Mirrored in the module's `user-role.ts`.
 */
export const SETTABLE_USER_ROLES = { NONE: 0, PLAYER: 1, TRUSTED: 2, ASSISTANT: 3 } as const;
export type SettableUserRole = keyof typeof SETTABLE_USER_ROLES;

/** `User.<id>`: the target of a role change, path `role`. */
export const USER_UUID_PREFIX = 'User.';

/** The documents whose ownership `area: "ownership"` reads and plans besides actors. */
export const SETUP_OWNERSHIP_TYPES = ['journal', 'scene'] as const;
export type SetupOwnershipType = (typeof SETUP_OWNERSHIP_TYPES)[number];

/** A pack's ownership levels (`CONST.DOCUMENT_OWNERSHIP_LEVELS` names). */
export const PACK_OWNERSHIP_LEVELS = ['NONE', 'LIMITED', 'OBSERVER', 'OWNER'] as const;
export type PackOwnershipLevel = (typeof PACK_OWNERSHIP_LEVELS)[number];
