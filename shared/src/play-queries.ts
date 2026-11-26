/**
 * @module play-queries
 *
 * Request and reply shapes of the bridge queries the play-set tools reach (combat, chat and
 * rolls, scenes and tokens, music). `bridge-queries.ts` maps each wire method to these. They
 * describe what the module's handlers already send today, so nothing changes on the wire: add
 * fields as optional, never rename one. A reply type lists the fields the backend relies on;
 * the module may send more.
 */

/** A hit-point block as the tools show it. */
export interface PlayHpSnapshot {
  value: number | null;
  max: number | null;
}

/** A `{max, spent}` counter (legendary actions, legendary resistances). */
export interface PlayBossCounter {
  max: number;
  spent: number;
  remaining: number;
}

/** Legendary actions, legendary resistances and lair of an NPC. */
export interface PlayBossResources {
  legendary: PlayBossCounter | null;
  resistances: PlayBossCounter | null;
  lair: { inside: boolean; initiative: number | null } | null;
}

/** One combatant of the tracker snapshot. */
export interface CombatantSnapshot {
  id: string;
  name: string;
  initiative: number | null;
  isCurrentTurn: boolean;
  actedThisRound: boolean;
  tokenId: string | null;
  actorId: string | null;
  sceneId: string | null;
  tokenUuid: string | null;
  img: string | null;
  hp: { value: number | null; max: number | null; temp: number } | null;
  conditions: string[];
  /** Rounds left on the timed conditions, by condition name (0 = the time is up). */
  timed: Record<string, number>;
  statuses: string[];
  isPC: boolean;
  category: 'pc' | 'enemy' | 'npc';
  defeated: boolean;
  deathSaves: { successes: number; failures: number } | null;
  hidden: boolean;
  boss: PlayBossResources | null;
}

/** Reply of `getCombatState`: either "no encounter" or the full snapshot. */
export type CombatStateReply =
  | { success: true; active: false; message: string }
  | {
      success: true;
      active: boolean;
      round: number;
      turn: number;
      current: CombatantSnapshot | null;
      combatants: CombatantSnapshot[];
      downed: CombatantSnapshot[];
    };

/** Request of `advanceCombatTurn`. */
export interface AdvanceCombatTurnRequest {
  skipTo?: string | undefined;
}

/** Reply of `advanceCombatTurn`. */
export interface AdvanceCombatTurnReply {
  success: true;
  round: number;
  turn: number;
  current: string | null;
}

/** Request of `setInitiative`. */
export interface SetInitiativeRequest {
  combatantName: string;
  initiative: number;
}

/** Reply of `setInitiative`. */
export interface SetInitiativeReply {
  success: true;
  combatant: string;
  initiative: number;
}

/** Request of `rollInitiativeForNpcs`. */
export interface RollInitiativeForNpcsRequest {
  scope?: 'npcs' | 'all' | 'missing' | undefined;
  combatantIds?: string[] | undefined;
}

/** Reply of `rollInitiativeForNpcs`. */
export interface RollInitiativeForNpcsReply {
  success: true;
  scope: string;
  round: number;
  order: { name: string; initiative: number | null; isPC: boolean }[];
}

/** A target that could not be resolved, or whose roll or rest threw. */
export interface PlayTargetError {
  target: string;
  error: string;
}

/** Request of `rollSavingThrows`. */
export interface RollSavingThrowsRequest {
  targets: string[];
  rollType: 'save' | 'check' | 'skill';
  ability?: string | undefined;
  skill?: string | undefined;
  dc?: number | undefined;
  isPublic?: boolean | undefined;
}

/** Reply of `rollSavingThrows`. */
export interface RollSavingThrowsReply {
  success: true;
  rollType: 'save' | 'check' | 'skill';
  dc: number | null;
  results: ({ target: string; total: number | null; success: boolean | null } | PlayTargetError)[];
}

/** Request of `useNpcActivity`. */
export interface UseNpcActivityRequest {
  actorName: string;
  itemName: string;
  /** Which activity of the item (name, id or type); default: its attack. */
  activity?: string | undefined;
  targetAC?: number | undefined;
  isPublic?: boolean | undefined;
}

/** Reply of `useNpcActivity`. */
export interface UseNpcActivityReply {
  success: boolean;
  actor: string;
  item: string | undefined;
  hadAttack: boolean;
  attackTotal: number | null;
  targetName: string | null;
  targetAC: number | null;
  hit: boolean | null;
  isCritical: boolean;
  damageTotal: number | null;
  damageByType?: Array<{ type: string; total: number }> | undefined;
  formula: string | null;
  activity?: string | undefined;
  activityType?: string | undefined;
  save?: { abilities: string[]; dc: number | null; onSave: string | null } | undefined;
  legendarySpent?: { before: number; after: number } | undefined;
}

/** Request of `manageRest`. */
export interface ManageRestRequest {
  targets: string[];
  restType: 'short' | 'long';
  newDay?: boolean | undefined;
}

/** Reply of `manageRest`. */
export interface ManageRestReply {
  success: true;
  restType: 'short' | 'long';
  results: (
    | {
        target: string;
        hpRecovered: unknown;
        hitDiceRecovered: unknown;
        hp: PlayHpSnapshot | null;
      }
    | PlayTargetError
  )[];
}

/** Request of `getChatLog`. */
export interface GetChatLogRequest {
  limit?: number | undefined;
  speakerName?: string | undefined;
  messageType?: string | undefined;
  sinceTimestamp?: string | undefined;
}

/** One chat message as `getChatLog` lists it. */
export interface ChatLogMessage {
  id: string;
  timestamp: string;
  timestampMs: number;
  speakerName: string;
  actorId: string | null;
  messageType: string;
  isRoll: boolean;
  content: string;
  flavor: string | null;
  whisperTo: string[];
}

/** Reply of `getChatLog`. */
export interface GetChatLogReply {
  success: true;
  count: number;
  messages: ChatLogMessage[];
}

/** Reply of `getCombatPlayByPlay`. */
export interface CombatPlayByPlayReply {
  success: true;
  combatActive: boolean;
  totalRounds: number;
  rounds: Array<{ round: number; turns: { combatant: string; actions: unknown[] }[] }>;
  significantEvents: unknown[];
  summary: { totalRounds: number; damageByActor: Record<string, number>; note: string | null };
}

/** Request of `sendChatMessage`. */
export interface SendChatMessageRequest {
  message: string;
  speakerActorId?: string | undefined;
  speakerActorName?: string | undefined;
  messageType?: string | undefined;
  whisperTargets?: string[] | undefined;
}

/** Reply of `sendChatMessage`. */
export interface SendChatMessageReply {
  success: true;
  messageId: string | null;
  speaker: string | null;
  messageType: string;
  whisperedTo: string[];
  warning?: string;
}

/** Request of `setNpcOnStage`. */
export interface SetNpcOnStageRequest {
  actorId?: string | undefined;
  actorName?: string | undefined;
  clear?: boolean | undefined;
  nameKnown?: boolean | undefined;
}

/** Reply of `setNpcOnStage` (GM side: includes the true name). */
export interface SetNpcOnStageReply {
  success: true;
  onStage: { actorId: string; name: string; nameShown: boolean } | null;
  previous: { actorId: string } | null;
}

/** Request of `request-player-rolls`. */
export interface RequestPlayerRollsRequest {
  rollType: string;
  rollTarget: string;
  targetPlayer: string;
  isPublic: boolean;
  rollModifier: string;
  flavor: string;
  /** A difficulty class the roll is judged against. */
  dc?: number | undefined;
  /** The GM's choice: `advantage` or `disadvantage`. */
  advantage?: 'advantage' | 'disadvantage' | undefined;
}

/** Reply of `request-player-rolls`. */
export interface RequestPlayerRollsReply {
  success: boolean;
  message: string;
  error?: string;
}

/** Request of `rollNpcCheck`. */
export interface RollNpcCheckRequest {
  actorName: string;
  rollType: string;
  rollTarget: string;
  isPublic: boolean;
  advantage?: 'advantage' | 'disadvantage' | undefined;
}

/** Reply of `rollNpcCheck`. */
export interface RollNpcCheckReply {
  success: boolean;
  actorName: string;
  rollType: string;
  rollTarget: string;
  formula: string;
  total: number;
  isPublic: boolean;
  mode: 'advantage' | 'disadvantage' | 'normal';
}

/** One entry of the `list-scenes` reply. */
export interface SceneSummaryReply {
  id: string;
  name: string;
  active: boolean;
  dimensions: { width: number; height: number };
  gridSize: number;
  background: string;
  walls: number;
  tokens: number;
  lighting: number;
  sounds: number;
  navigation: boolean;
}

/** Request of `list-scenes`. */
export interface ListScenesRequest {
  filter?: string | undefined;
  include_active_only?: boolean | undefined;
}

/** Request of `switch-scene`. */
export interface SwitchSceneRequest {
  scene_identifier: string;
  optimize_view?: boolean | undefined;
}

/** Reply of `switch-scene`. */
export interface SwitchSceneReply {
  success: true;
  sceneId: string;
  sceneName: string;
  dimensions: { width: number; height: number };
}

/** A Foundry 14 Scene Level as the tools name it. */
export interface PlayLevelRef {
  id: string;
  name: string;
}

/** One token entry of the `getTokenPositions` reply. */
export interface TokenPositionEntry {
  tokenId: string;
  name: string;
  actorId: string | null;
  x: number;
  y: number;
  gridX: number;
  gridY: number;
  elevation: number;
  level?: PlayLevelRef | null;
  category: 'pc' | 'enemy' | 'npc';
  hidden: boolean;
  hp: PlayHpSnapshot | null;
  conditions: string[];
}

/** Reply of `getTokenPositions`. */
export interface TokenPositionsReply {
  success: true;
  sceneId: string;
  sceneName: string;
  gridSize: number;
  gridDistance: number | null;
  gridUnits: string;
  tokenCount: number;
  tokens: TokenPositionEntry[];
}

/** Request of `measureDistance`. */
export interface MeasureDistanceRequest {
  fromTokenName: string;
  toTokenName: string;
}

/** Reply of `measureDistance`. The level fields are only there on a scene with Scene Levels. */
export interface MeasureDistanceReply {
  success: true;
  from: string;
  to: string;
  distance: number | null;
  units: string;
  approximate?: true;
  fromLevel?: PlayLevelRef | null;
  toLevel?: PlayLevelRef | null;
  fromElevation?: number;
  toElevation?: number;
  verticalDistance?: number;
  horizontalDistance?: number | null;
  threeD?: true;
}

/** One token in the `getTargets` reply. */
export interface TargetTokenEntry {
  tokenId: string;
  name: string;
  actorId: string | null;
  ac: number | null;
  hp: PlayHpSnapshot | null;
}

/** Reply of `getTargets`. `selected` is what the GM has selected on the canvas. */
export interface TargetsReply {
  success: true;
  count: number;
  targets: TargetTokenEntry[];
  selected: TargetTokenEntry[];
}

/** Request of `playPlaylist`. */
export interface PlayPlaylistRequest {
  playlistName?: string | undefined;
  action?: 'play' | 'stop' | undefined;
}

/** Reply of `playPlaylist`. */
export interface PlayPlaylistReply {
  success: true;
  playlist: string;
}

/** Request of `get-token-details`. */
export interface GetTokenDetailsRequest {
  tokenId: string;
}

/** Reply of `get-token-details`. */
export interface TokenDetailsReply {
  success: true;
  id: string;
  name: string;
  x: number;
  y: number;
  width: number;
  height: number;
  rotation: number;
  scale: number;
  alpha: number;
  hidden: boolean;
  disposition: number;
  elevation: number;
  lockRotation: boolean;
  img: string | null | undefined;
  actorId: string | undefined;
  actorData: { name: string; type: string; img: string } | null;
  actorLink: boolean;
}

/** One condition `get-available-conditions` lists. */
export interface ConditionEntry {
  id: string;
  name: unknown;
  icon: unknown;
  description: unknown;
  /** dnd5e's own rules page for the condition (a uuid, no text); absent for ones it has none for. */
  reference?: string | undefined;
}

/** Reply of `get-available-conditions`. */
export interface AvailableConditionsReply {
  success: true;
  gameSystem: string | undefined;
  conditions: ConditionEntry[];
}

/** Request of `useItem`. */
export interface UseItemRequest {
  actorIdentifier: string;
  itemIdentifier: string;
  /** Target character or token names or ids; "self" targets the caster. */
  targets?: string[] | undefined;
  options?:
    | {
        consume?: boolean | undefined;
        configureDialog?: boolean | undefined;
        skipDialog?: boolean | undefined;
        spellLevel?: number | undefined;
        versatile?: boolean | undefined;
        rollAttack?: boolean | undefined;
      }
    | undefined;
}

/** Reply of `useItem`. */
export interface UseItemReply {
  success: boolean;
  status?: string | undefined;
  message: string;
  itemName?: string | undefined;
  actorName?: string | undefined;
  targets?: string[] | undefined;
  requiresGMInteraction?: boolean | undefined;
}

/** Request of `getCharacterResources` and `getActiveEffects`. */
export interface ActorIdentifierRequest {
  identifier: string;
}

/** Reply of `getCharacterResources`. */
export interface CharacterResourcesReply {
  success: true;
  actorId: string;
  actorName: string;
  system: string | undefined;
  spellSlots: Record<
    string,
    { max: number; current: number; expended: number; level?: number | null | undefined }
  >;
  classResources: { key: string; label: string; max: number | null; current: number | null }[];
  itemCharges: { itemName: string; charges: number; max: number; recharge: string | null }[];
  concentration: { active: false } | { active: true; spell: string | null; remaining: unknown };
  hitDice: { total: number | null; available: number | null; dieType: string | null } | null;
  deathSaves: { successes: number; failures: number } | null;
}

/** Reply of `getActiveEffects`. */
export interface ActiveEffectsReply {
  success: true;
  actorId: string;
  actorName: string;
  count: number;
  effects: {
    id: string;
    name: string;
    icon: string | null;
    disabled: boolean;
    isCondition: boolean;
    type: 'condition' | 'buff/debuff';
    statuses: string[];
    duration: {
      rounds: number | null;
      turns: number | null;
      seconds: number | null;
      remaining: number | null;
    };
    changes: { key: string; mode: string; type: string; value: unknown }[];
    requiresConcentration: boolean;
  }[];
}

/** Request of `getRecentEvents`. */
export interface GetRecentEventsRequest {
  sinceTimestamp?: string | undefined;
  limit?: number | undefined;
  eventType?: string | undefined;
}

/** Reply of `getRecentEvents`; each event is the module's session log entry. */
export interface RecentEventsReply {
  success: true;
  count: number;
  events: unknown[];
  latestTimestamp: string | null;
  serverTime: string;
}

/** Request of `getSpentActions`. */
export interface GetSpentActionsRequest {
  actorId?: string | undefined;
  itemId?: string | undefined;
}

/** Reply of `getSpentActions`. */
export interface SpentActionsReply {
  success: true;
  /** False when the module has not seen this combat's turns, so nothing can be said. */
  tracked: boolean;
  /** Uses since the actor's own turn began (its current turn, or the last one it took). */
  sinceOwnTurn: {
    item: string;
    itemType: string;
    activation: string;
    itemLevel: number | null;
  }[];
  actorRules: { version: string; source: string } | null;
  itemRules: { version: string; source: string } | null;
}
