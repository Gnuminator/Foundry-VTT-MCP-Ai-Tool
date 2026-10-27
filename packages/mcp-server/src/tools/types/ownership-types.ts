/** Reply shapes of the ownership bridge queries (only the fields the server reads are typed). */

export interface OwnershipToolDefinition {
  name: string;
  description: string;
  inputSchema: unknown;
}

/** An actor or a player as the resolve queries answer it. */
export interface OwnershipEntity {
  id: string;
  name: string;
}

/** The `list-actor-ownership` answer: the bridge reply as is, or the failure message. */
export type OwnershipListResult =
  | { success: true; ownership: unknown }
  | { success: false; error: string };
