/** Shapes of the bridge replies and tool results used by actor-creation.ts. */

export interface CreatedActorInfo {
  name?: unknown;
  [key: string]: unknown;
}

/** Reply of `foundry-mcp-bridge.createActorFromCompendium`. */
export interface CreateActorBridgeReply {
  success?: unknown;
  totalCreated?: unknown;
  totalRequested?: unknown;
  actors: CreatedActorInfo[];
  tokensPlaced?: number;
  errors?: unknown[];
}

export interface CompendiumEntryNamed {
  name?: unknown;
}

export interface ActorCreationResponse {
  summary: string;
  success: unknown;
  details: {
    actors: CreatedActorInfo[];
    sourceEntry: { packId: string; itemId: string };
    tokensPlaced: number;
    errors: unknown[] | undefined;
  };
  message: string;
}
