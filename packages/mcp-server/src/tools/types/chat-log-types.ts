/** Reply shapes of the chat log bridge queries (only the fields the server reads are typed). */

export interface ChatLogToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** What the `foundry-mcp-bridge.*` chat log queries answer; everything else passes through untouched. */
export interface ChatLogBridgeReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

/** The send handler returns the bridge reply as is, or a parameter-error string. */
export type ChatLogSendResult = ChatLogBridgeReply | undefined | string;
