/** Reply shapes of the combat bridge queries (only the fields the server reads are typed). */

export interface CombatToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** What `foundry-mcp-bridge.*` combat queries answer; everything else passes through untouched. */
export interface CombatBridgeReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** A combat handler returns the bridge reply as is, or a parameter-error string. */
export type CombatToolResult = CombatBridgeReply | undefined | string;
