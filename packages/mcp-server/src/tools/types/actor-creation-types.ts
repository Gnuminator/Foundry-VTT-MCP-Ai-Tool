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

/** Reply of `foundry-mcp-bridge.getCompendiumDocumentFull`. */
export interface CompendiumEntryBridgeReply {
  name?: unknown;
  type?: unknown;
  packLabel?: unknown;
  system?: unknown;
  fullData?: unknown;
  items?: CompendiumEntryNamed[];
  effects?: CompendiumEntryNamed[];
}

export interface CompendiumEntryResponse {
  name: unknown;
  type: unknown;
  pack: unknown;
  system: unknown;
  fullData: unknown;
  items: CompendiumEntryNamed[];
  effects: CompendiumEntryNamed[];
  summary: string;
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
