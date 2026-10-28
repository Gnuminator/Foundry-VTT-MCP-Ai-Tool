/** Bridge reply and tool definition read by resources.ts. Unread fields stay `unknown`. */

export interface ResourcesReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface ResourcesToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
