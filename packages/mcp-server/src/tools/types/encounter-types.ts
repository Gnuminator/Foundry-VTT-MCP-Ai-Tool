/** Bridge reply and tool definition read by encounter.ts. Unread fields stay `unknown`. */

export interface EncounterReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface EncounterToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
