/** Reply shapes of the combat-resolution bridge queries (only the fields the server reads are typed). */

import type { BridgeReply } from '@gnuminator/shared';

export interface CombatResolutionToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** The combat-resolution queries of the bridge contract. */
export type CombatResolutionMethod =
  | 'foundry-mcp-bridge.rollSavingThrows'
  | 'foundry-mcp-bridge.useNpcActivity'
  | 'foundry-mcp-bridge.manageRest';

/** A handler returns the module's reply as is (a refusal throws before this). */
export type CombatResolutionToolResult = BridgeReply<CombatResolutionMethod>;
