/** Shapes of the bridge replies that `scene.ts` reads. Every field is optional; unread fields stay `unknown`. */

export interface SceneUserLike {
  id?: unknown;
  name?: unknown;
  isGM?: unknown;
  active?: unknown;
  tableViewer?: unknown;
}

export interface SceneNoteData {
  id?: unknown;
  text?: string;
  x?: unknown;
  y?: unknown;
}

export interface SceneTokenData {
  id?: unknown;
  name?: unknown;
  x?: unknown;
  y?: unknown;
  width?: unknown;
  height?: unknown;
  actorId?: unknown;
  disposition?: number;
  hidden?: unknown;
  img?: unknown;
}

export interface ActiveSceneData {
  id?: unknown;
  name?: unknown;
  active?: unknown;
  width?: unknown;
  height?: unknown;
  padding?: unknown;
  background?: unknown;
  navigation?: unknown;
  walls?: unknown;
  lights?: unknown;
  sounds?: unknown;
  notes?: SceneNoteData[];
  tokens?: SceneTokenData[];
}

export interface WorldInfoData {
  id?: unknown;
  title?: unknown;
  system?: unknown;
  systemVersion?: unknown;
  foundryVersion?: unknown;
  users?: SceneUserLike[];
}

export interface TokenSummary {
  total: number;
  byDisposition: {
    friendly: number;
    neutral: number;
    hostile: number;
    secret: number;
    unknown: number;
  };
  hasActors: number;
  withoutActors: number;
}
