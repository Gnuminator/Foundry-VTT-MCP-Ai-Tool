/**
 * @module bridge-queries
 *
 * The typed contract for the bridge queries: the request the backend sends in an `mcp-query`
 * frame and the reply the Foundry module's handler returns, per wire method. Both sides import
 * it, so a reply shape that drifts on one side fails the typecheck on the other.
 *
 * The method names, request fields and reply fields are wire contracts (see protocol.ts): an old
 * module talks to a new backend and the other way round, so add fields as optional and never
 * rename one. This file only gives the existing wire values names; it changes nothing on the wire.
 *
 * Not every method is here yet: the play set (combat, chat and rolls, scenes and tokens, music,
 * character resources and effects, the event log) is typed; the other sets follow lane by lane.
 * An unlisted method still works through the untyped overload of `FoundryClient.query` and the
 * module's untyped `bridgeHandlers.set`.
 */

import type { CombatChangePlan, CombatChangeRequest } from './combat-change.js';
import type { LiveChangePlan, LiveChangeRequest } from './live-play.js';
import type { PartyPlaceRequest, PartyPlacement, PartyState } from './party.js';
import type * as Play from './play-queries.js';
import type { RenownState } from './renown.js';
import type { SceneChangePlan, SceneChangeRequest } from './scene-change.js';
import type { SceneInfo } from './types.js';
import type { ChangeJournalResponse } from './change-journal.js';
import type { CharacterEntityResult } from './character-entity.js';
import type {
  CharacterSheetsResult,
  PlayerRollReply,
  PlayerRollRequestBody,
} from './character-sheet.js';
import type { ExportIndexRequest, ExportIndexResponse } from './export-index.js';
import type { UploadActorImageReply, UploadActorImageRequest } from './actor-image.js';
import type { UploadHandoutImageReply, UploadHandoutImageRequest } from './handout-press.js';
import type { UploadPlayerPortraitReply, UploadPlayerPortraitRequest } from './player-portrait.js';
import type {
  GuardedApplyOutcome,
  GuardedApplyRequest,
  GuardedApplyResult,
  GuardedFeatureState,
  GuardedOp,
  OpSnapshot,
} from './guarded-write.js';
import type {
  LibraryDocumentsRequest,
  LibraryDocumentsResponse,
  LibraryIndexRequest,
  LibraryIndexResponse,
} from './library-index.js';
import type { PlayRecordsResponse } from './play-log.js';
import type { PageForPlayers } from './player-view.js';
import type { PcCreationPlan, PcCreationRequest } from './pc-creation.js';
import type { RoomSetupPlan, RoomSetupRequest } from './room-setup.js';
import type { SceneMoodPlan, SceneMoodPlanRequest, SceneMoodsReply } from './scene-mood.js';
import type { TokenRingsPlan, TokenRingsPlanRequest } from './token-rings.js';
import type { NpcTurnPlan, NpcTurnRequest } from './npc-turn.js';
import type { PaperSyncPlan, PaperSyncRequest } from './paper-sync.js';
import type { SceneStateReply, SceneStateRequest } from './scene-restore.js';
import type { UsageRecordsResponse } from './usage.js';

/**
 * A refusal the module sends as the handler's reply (inside a successful `mcp-response`): the
 * GM gate (`Access denied` when the module runs on a client that is not the GM's) and handlers
 * that refuse without throwing. A thrown handler error arrives as a rejected query instead.
 */
export interface BridgeRefusal {
  success: false;
  error: string;
}

/** Whether a bridge reply is a {@link BridgeRefusal}. */
export function isBridgeRefusal(reply: unknown): reply is BridgeRefusal {
  return (
    typeof reply === 'object' &&
    reply !== null &&
    (reply as { success?: unknown }).success === false
  );
}

/**
 * The reply without the refusal: throws `<what>: <the module's error>` on a refusal. Replaces
 * the per-service `unwrap` helpers.
 */
export function unwrapBridgeReply<T>(reply: T | BridgeRefusal, what: string): T {
  if (isBridgeRefusal(reply)) {
    const error = (reply as { error?: unknown }).error;
    throw new Error(`${what}: ${typeof error === 'string' ? error : 'refused by Foundry'}`);
  }
  return reply;
}

/** Reply of `ping`. */
export interface BridgePingReply {
  status: string;
  timestamp: number;
  module: string;
  foundryVersion?: string;
  worldId?: string;
  userId?: string;
}

/** Request of the sequence-paged buffers (`getChangeJournal`, `getPlayRecords`, `getUsageRecords`). */
export interface BridgeSeqPageRequest {
  /** Records with a sequence number above this one. */
  sinceSeq?: number;
  limit?: number;
}

/** Request of `logGmChange`: one line in the GM's feed for a recorded apply or undo. */
export interface LogGmChangeRequest {
  changeId: string;
  feature: string;
  summary: string;
  mode: string;
}

/** Request of `showJournalPage` (I-110). */
export interface ShowJournalPageRequest {
  uuid: string;
  userIds: string[];
}

/** Reply of `showJournalPage`. */
export interface ShowJournalPageReply {
  shown: true;
  uuid: string;
  users: string[];
}

/**
 * Request of `postHandoutNotice`: whisper a short "handout revealed" chat message that names the
 * page and links to it. `userIds` empty means every player who can see the page.
 */
export interface PostHandoutNoticeRequest {
  uuid: string;
  userIds: string[];
}

/** Reply of `postHandoutNotice`. */
export interface PostHandoutNoticeReply {
  posted: boolean;
  uuid: string;
  /** Foundry user ids the message was whispered to (empty when nobody could see the page). */
  users: string[];
}

/** Reply of `ensureJournalFolder`. */
export interface EnsureJournalFolderReply {
  folderId: string;
  created: boolean;
}

/**
 * The typed bridge queries: wire method to request and reply. The reply is what the handler
 * returns when it does not refuse; every method may also answer with a {@link BridgeRefusal}.
 * `request: undefined` means the backend sends no data; the module's dispatcher then hands the
 * handler `{}` (`data.data || {}` in `socket-bridge.ts`), so such handlers ignore their argument.
 */
export interface BridgeQueryMap {
  'foundry-mcp-bridge.ping': { request: undefined; reply: BridgePingReply };
  'foundry-mcp-bridge.getChangeJournal': {
    request: BridgeSeqPageRequest;
    reply: ChangeJournalResponse;
  };
  'foundry-mcp-bridge.getPlayRecords': {
    request: BridgeSeqPageRequest;
    reply: PlayRecordsResponse;
  };
  'foundry-mcp-bridge.getUsageRecords': {
    request: BridgeSeqPageRequest;
    reply: UsageRecordsResponse;
  };
  'foundry-mcp-bridge.snapshotGuardedOps': { request: { ops: GuardedOp[] }; reply: OpSnapshot[] };
  'foundry-mcp-bridge.applyGuardedOps': { request: GuardedApplyRequest; reply: GuardedApplyResult };
  'foundry-mcp-bridge.guardedApplyOutcome': {
    request: { changeId: string };
    reply: GuardedApplyOutcome;
  };
  'foundry-mcp-bridge.logGmChange': { request: LogGmChangeRequest; reply: { logged: true } };
  'foundry-mcp-bridge.showJournalPage': {
    request: ShowJournalPageRequest;
    reply: ShowJournalPageReply;
  };
  'foundry-mcp-bridge.postHandoutNotice': {
    request: PostHandoutNoticeRequest;
    reply: PostHandoutNoticeReply;
  };
  'foundry-mcp-bridge.listGuardedFeatures': { request: undefined; reply: GuardedFeatureState[] };
  'foundry-mcp-bridge.ensureJournalFolder': {
    request: { name: string };
    reply: EnsureJournalFolderReply;
  };
  'foundry-mcp-bridge.aiChangesUpdated': { request: undefined; reply: { announced: true } };
  'foundry-mcp-bridge.getPagesForPlayers': {
    request: { uuids: string[] };
    reply: { pages: PageForPlayers[] };
  };
  'foundry-mcp-bridge.getExportIndex': { request: ExportIndexRequest; reply: ExportIndexResponse };
  'foundry-mcp-bridge.getLibraryIndex': {
    request: LibraryIndexRequest;
    reply: LibraryIndexResponse;
  };
  'foundry-mcp-bridge.getLibraryDocuments': {
    request: LibraryDocumentsRequest;
    reply: LibraryDocumentsResponse;
  };
  'foundry-mcp-bridge.planSceneMood': { request: SceneMoodPlanRequest; reply: SceneMoodPlan };
  'foundry-mcp-bridge.getSceneMoods': { request: undefined; reply: SceneMoodsReply };
  'foundry-mcp-bridge.planTokenRings': { request: TokenRingsPlanRequest; reply: TokenRingsPlan };
  'foundry-mcp-bridge.getSceneState': { request: SceneStateRequest; reply: SceneStateReply };
  'foundry-mcp-bridge.planNpcTurn': { request: NpcTurnRequest; reply: NpcTurnPlan };
  'foundry-mcp-bridge.planPaperSync': { request: PaperSyncRequest; reply: PaperSyncPlan };
  'foundry-mcp-bridge.planRoomSetup': { request: RoomSetupRequest; reply: RoomSetupPlan };
  'foundry-mcp-bridge.planPcCreation': { request: PcCreationRequest; reply: PcCreationPlan };
  'foundry-mcp-bridge.characterSheet': {
    request: { userId: string };
    reply: CharacterSheetsResult;
  };
  'foundry-mcp-bridge.playerRoll': {
    request: PlayerRollRequestBody;
    reply: PlayerRollReply;
  };
  'foundry-mcp-bridge.uploadPlayerPortrait': {
    request: UploadPlayerPortraitRequest;
    reply: UploadPlayerPortraitReply;
  };
  'foundry-mcp-bridge.uploadHandoutImage': {
    request: UploadHandoutImageRequest;
    reply: UploadHandoutImageReply;
  };
  'foundry-mcp-bridge.uploadActorImage': {
    request: UploadActorImageRequest;
    reply: UploadActorImageReply;
  };
  'foundry-mcp-bridge.getCharacterEntity': {
    request: { characterIdentifier: string; entityIdentifier: string };
    reply: CharacterEntityResult;
  };
  // The play set: combat, chat and rolls, scenes and tokens, music (shapes in play-queries.ts).
  'foundry-mcp-bridge.getCombatState': { request: undefined; reply: Play.CombatStateReply };
  'foundry-mcp-bridge.advanceCombatTurn': {
    request: Play.AdvanceCombatTurnRequest;
    reply: Play.AdvanceCombatTurnReply;
  };
  'foundry-mcp-bridge.setInitiative': {
    request: Play.SetInitiativeRequest;
    reply: Play.SetInitiativeReply;
  };
  'foundry-mcp-bridge.rollInitiativeForNpcs': {
    request: Play.RollInitiativeForNpcsRequest;
    reply: Play.RollInitiativeForNpcsReply;
  };
  'foundry-mcp-bridge.rollSavingThrows': {
    request: Play.RollSavingThrowsRequest;
    reply: Play.RollSavingThrowsReply;
  };
  'foundry-mcp-bridge.useNpcActivity': {
    request: Play.UseNpcActivityRequest;
    reply: Play.UseNpcActivityReply;
  };
  'foundry-mcp-bridge.manageRest': { request: Play.ManageRestRequest; reply: Play.ManageRestReply };
  'foundry-mcp-bridge.planLiveChange': { request: LiveChangeRequest; reply: LiveChangePlan };
  'foundry-mcp-bridge.planCombatChange': {
    request: CombatChangeRequest;
    reply: CombatChangePlan;
  };
  'foundry-mcp-bridge.getChatLog': { request: Play.GetChatLogRequest; reply: Play.GetChatLogReply };
  'foundry-mcp-bridge.getCombatPlayByPlay': {
    request: undefined;
    reply: Play.CombatPlayByPlayReply;
  };
  'foundry-mcp-bridge.sendChatMessage': {
    request: Play.SendChatMessageRequest;
    reply: Play.SendChatMessageReply;
  };
  'foundry-mcp-bridge.request-player-rolls': {
    request: Play.RequestPlayerRollsRequest;
    reply: Play.RequestPlayerRollsReply;
  };
  'foundry-mcp-bridge.rollNpcCheck': {
    request: Play.RollNpcCheckRequest;
    reply: Play.RollNpcCheckReply;
  };
  'foundry-mcp-bridge.getActiveScene': { request: undefined; reply: SceneInfo };
  'foundry-mcp-bridge.list-scenes': {
    request: Play.ListScenesRequest;
    reply: Play.SceneSummaryReply[];
  };
  'foundry-mcp-bridge.switch-scene': {
    request: Play.SwitchSceneRequest;
    reply: Play.SwitchSceneReply;
  };
  'foundry-mcp-bridge.getTokenPositions': {
    request: { sceneId?: string | undefined };
    reply: Play.TokenPositionsReply;
  };
  'foundry-mcp-bridge.measureDistance': {
    request: Play.MeasureDistanceRequest;
    reply: Play.MeasureDistanceReply;
  };
  'foundry-mcp-bridge.getTargets': { request: undefined; reply: Play.TargetsReply };
  'foundry-mcp-bridge.playPlaylist': {
    request: Play.PlayPlaylistRequest;
    reply: Play.PlayPlaylistReply;
  };
  'foundry-mcp-bridge.get-token-details': {
    request: Play.GetTokenDetailsRequest;
    reply: Play.TokenDetailsReply;
  };
  'foundry-mcp-bridge.get-available-conditions': {
    request: undefined;
    reply: Play.AvailableConditionsReply;
  };
  'foundry-mcp-bridge.useItem': { request: Play.UseItemRequest; reply: Play.UseItemReply };
  'foundry-mcp-bridge.getCharacterResources': {
    request: Play.ActorIdentifierRequest;
    reply: Play.CharacterResourcesReply;
  };
  'foundry-mcp-bridge.getActiveEffects': {
    request: Play.ActorIdentifierRequest;
    reply: Play.ActiveEffectsReply;
  };
  'foundry-mcp-bridge.getRecentEvents': {
    request: Play.GetRecentEventsRequest;
    reply: Play.RecentEventsReply;
  };
  'foundry-mcp-bridge.getSpentActions': {
    request: Play.GetSpentActionsRequest;
    reply: Play.SpentActionsReply;
  };
  'foundry-mcp-bridge.getPartyState': { request: undefined; reply: PartyState };
  'foundry-mcp-bridge.getRenownState': { request: undefined; reply: RenownState };
  'foundry-mcp-bridge.planPartyPlacement': {
    request: PartyPlaceRequest;
    reply: PartyPlacement;
  };
  'foundry-mcp-bridge.planSceneChange': { request: SceneChangeRequest; reply: SceneChangePlan };
}

/** A bridge method the contract types. */
export type BridgeMethod = keyof BridgeQueryMap;

/** What the backend sends for `M` (`undefined` when the method takes nothing). */
export type BridgeRequest<M extends BridgeMethod> = BridgeQueryMap[M]['request'];

/** What the module's handler for `M` returns when it does not refuse. */
export type BridgeReply<M extends BridgeMethod> = BridgeQueryMap[M]['reply'];

/** What arrives at the backend for `M`: the reply or a refusal. */
export type BridgeAnswer<M extends BridgeMethod> = BridgeReply<M> | BridgeRefusal;

/** Per-query options the backend's connector understands. */
export interface BridgeQueryOptions {
  /** Overrides the connector's default query timeout. */
  timeoutMs?: number;
}

/** The arguments after the method: the request (optional when it may be undefined), then options. */
export type BridgeQueryArgs<M extends BridgeMethod> =
  undefined extends BridgeRequest<M>
    ? [data?: BridgeRequest<M>, options?: BridgeQueryOptions]
    : [data: BridgeRequest<M>, options?: BridgeQueryOptions];

/** A method string that the contract does not type (yet); `never` for a typed one. */
export type UntypedBridgeMethod<M extends string> = M &
  ([M] extends [BridgeMethod] ? never : unknown);
