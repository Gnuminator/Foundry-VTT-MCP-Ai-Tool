/** Reply shapes of the dice-roll bridge queries (only the fields the server reads are typed). */

export interface DiceRollToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** What the dice-roll `foundry-mcp-bridge.*` queries answer. */
export interface DiceRollBridgeReply {
  success?: boolean;
  message?: string;
  error?: string;
  [key: string]: unknown;
}
