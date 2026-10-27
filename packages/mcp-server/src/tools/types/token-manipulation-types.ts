/** Bridge replies read by token-manipulation.ts. Unread fields stay `unknown`. */

export interface TokenActorData {
  name?: unknown;
  type?: unknown;
  img?: unknown;
}

export interface TokenDetailsReply {
  id?: unknown;
  name?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  rotation?: unknown;
  scale?: unknown;
  alpha?: unknown;
  hidden?: unknown;
  img?: unknown;
  disposition?: unknown;
  elevation?: unknown;
  lockRotation?: unknown;
  actorId?: unknown;
  actorData?: TokenActorData | null;
  actorLink?: unknown;
}

export interface AvailableConditionsReply {
  conditions?: { length?: number } | null;
  gameSystem?: unknown;
}
