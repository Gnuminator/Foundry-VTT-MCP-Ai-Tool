/** Reply shapes of the combat-resolution bridge queries (only the fields the server reads are typed). */

export interface CombatResolutionToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** What the combat-resolution `foundry-mcp-bridge.*` queries answer; the rest passes through. */
export interface CombatResolutionBridgeReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** A handler returns the bridge reply as is, or a parameter-error string. */
export type CombatResolutionToolResult = CombatResolutionBridgeReply | undefined | string;
