/**
 * The size budget of each tool set, in characters of the JSON Claude Desktop receives for the
 * set (tool-catalog.test.ts measures it). The sets exist to keep Claude Desktop's context small.
 *
 * USER-OWNED: raise a number only on purpose and with the user's OK. A lane never raises one in
 * passing; every raise costs Claude Desktop context in every conversation.
 *
 * Budgets with some room. Raise one only on purpose.
 * I-124 raised core and prep by 2,000 for the tool hints (title, readOnlyHint, destructiveHint).
 */
import type { ToolSetName } from './tool-sets.js';

export const TOOL_SET_BUDGETS: Readonly<Record<ToolSetName, number>> = {
  core: 18_500, // about 18,200 with search-rules (I-152; raised 1,000 on purpose) on top of get-level-up-options (about 17,200); about 16,600 before
  play: 50_000, // about 41,100 with the rounds field of plan-actor-change (condition-round-duration; raised 9,000 on purpose, confirmed by the user 2026-10-31); about 40,400 with wait-for-game-event (I-001; raised 1,000 on purpose, confirmed by the user 2026-10-29); about 39,400 before; about 39,000 with plan-combat-change (David's GM test; raised 1,500 on purpose, room for its start action); about 38,000 before, with plan-paper-sync (Paper nights A: eleven sheet fields in one schema, about 3,700 characters) on top of Paper nights C's session fields; raised 1,500 on purpose for check-action, 1,000 for the multiattack and path fields of plan-npc-turn, 3,000 for plan-paper-sync. The next Play tool needs another raise
  prep: 22_500, // about 22,200 (22,183 measured after #620's encounter suggestions); about 22,450 with the five chosen-card arguments of plan-tarokka-import (tarokka-gm-choice, no raise); about 22,100 with the clear option of plan-tarokka-import (#507, raised 500 on purpose); about 21,900 before. Near full: the next Prep tool needs a raise, which costs Claude Desktop context: the user decides, never raise it in passing
  build: 29_000, // about 28,100 with plan-room-setup (I-133)
  player: 2_500, // about 1,900; new set (D-136, player-connector-set): the five player tools, served only on /mcp/player, never on stdio
  admin: 15_000, // raised from 10,500 to 15,000 for the placed-tokens text of plan-token-rings and room for the setup tools (the user, 2026-11-06); about 10,500 before; about 8,700 with plan-foundry-setup (D-135, part 1; raised from 8,000 to 10,500 for all three setup parts, the user's OK 2026-11-02); about 7,800 before
};
