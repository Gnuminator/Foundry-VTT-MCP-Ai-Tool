/**
 * The "Table" viewer for the TV (tv-login, G1): a Player-role Foundry user with no password and no
 * characters, signed in once on the TV in a kiosk browser (D-097). `plan-table-viewer` plans its
 * creation as a guarded change (a `create` op on a User; undo deletes it again).
 */

/** The guarded feature switch ("AI Tool: Table viewer (writes)"), on by default. */
export const TABLE_VIEWER_FEATURE_ID = 'table-viewer';

/** The user's default name, as it appears on Foundry's join page. */
export const TABLE_VIEWER_DEFAULT_NAME = 'Table';

/** Foundry's CONST.USER_ROLES.PLAYER. The Table user is never given a higher role. */
export const TABLE_VIEWER_ROLE = 1;

/**
 * The flag (`flags.foundry-mcp-bridge.tableViewer`) `plan-table-viewer` sets on the user it creates.
 * The tool's own player lists (handout receipts, the player visibility check, "all players"
 * ownership, play attendance, the player count) skip a user with it: the TV is a screen, not a
 * person at the table.
 */
export const TABLE_VIEWER_FLAG = 'tableViewer';
