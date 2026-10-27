/** Reply shapes of the session log bridge queries (only the fields the server reads are typed). */

export interface SessionLogToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** What the `foundry-mcp-bridge.*` session log queries answer; everything else passes through untouched. */
export interface SessionLogBridgeReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}
