/** Types for the stdio wrapper (index.ts) and the backend entry (backend.ts). Type-only helpers. */

/** The reply to the control channel's `list_tools` call, as far as the wrapper reads it. */
export interface ListToolsReply {
  tools?: unknown[];
}

/** The `call_tool` request params the MCP SDK hands the wrapper. */
export interface CallToolParams {
  name: unknown;
  arguments?: Record<string, unknown>;
}

/** Template-literal stringification of an unknown value (the same text `${value}` gave for `any`). */
export function templateText(value: unknown): string {
  return `${value as string}`;
}

/** What a caught value's `message` is, when it has one (the old `(e as any)?.message`). */
export function messageOf(error: unknown): unknown {
  return (error as { message?: unknown } | null | undefined)?.message;
}
