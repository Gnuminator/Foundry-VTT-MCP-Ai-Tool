/** Bridge reply and tool definition read by effects.ts. Unread fields stay `unknown`. */

export interface EffectsReply {
  success?: boolean;
  error?: string;
  [key: string]: unknown;
}

export interface EffectsToolDefinition {
  name: string;
  description: string;
  inputSchema: Record<string, unknown>;
}
