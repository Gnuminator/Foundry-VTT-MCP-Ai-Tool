import * as shared from './shared.js';
import { eventTracker } from '../session-events.js';

// ---------------------------------------------------------------------------
// Types
// ---------------------------------------------------------------------------

/** The four optional filter dimensions accepted by `getChatLog`. */
interface ChatLogFilters {
  limit?: number;
  speakerName?: string;
  messageType?: string;
  sinceTimestamp?: string;
}

/** Numeric message-style constants — prefer CHAT_MESSAGE_STYLES (v11+), fall
 *  back to CHAT_MESSAGE_TYPES (v10). Defaults cover both. */
interface ChatMessageStyles {
  IC?: number;
  OOC?: number;
  EMOTE?: number;
  OTHER?: number;
  [key: string]: number | undefined;
}

// ---------------------------------------------------------------------------
// Private helpers
// ---------------------------------------------------------------------------

/**
 * Resolve a speaker object for the chat message.
 *
 * If an actor was resolved, `ChatMessage.getSpeaker({ actor })` fills the
 * alias from the actor's name, token name, or scene overrides as Foundry sees
 * fit. Without an actor (GM / world voice) we supply `{ alias: game.user?.name }`
 * so the current user's display name appears in chat — `getSpeaker` does NOT
 * accept a `user` key, only `{ scene, actor, token, alias }`.
 */
function resolveSpeaker(actor: any): any {
  return actor
    ? (ChatMessage as any).getSpeaker({ actor })
    : (ChatMessage as any).getSpeaker({ alias: game.user?.name });
}

/**
 * Map a normalised message-type string to a Foundry style integer.
 *
 * Priority: CONST.CHAT_MESSAGE_STYLES (v11+) → CONST.CHAT_MESSAGE_TYPES (v10)
 * → hard-coded defaults so the mapping is never undefined.
 *
 * Defaults mirror Foundry's historical values:
 *   OTHER=0, OOC=1, IC=2, EMOTE=3
 */
function resolveStyle(type: string): number {
  const CMS: ChatMessageStyles =
    (CONST as any).CHAT_MESSAGE_STYLES || (CONST as any).CHAT_MESSAGE_TYPES || {};

  switch (type) {
    case 'ooc':
      return CMS.OOC ?? 1;
    case 'emote':
      return CMS.EMOTE ?? 3;
    case 'whisper':
      return CMS.OTHER ?? 0;
    default:
      // 'ic' and any unknown type
      return CMS.IC ?? 2;
  }
}

/**
 * Resolve whisper target user ids from display names (case-insensitive).
 *
 * SAFETY CONTRACT: a "whisper" message must never become a public broadcast.
 * If no requested targets can be resolved to user ids, we fall back to all GM
 * user ids and signal the fallback via the returned `warning`. Callers must
 * include `warning` in the response when it is non-null.
 */
function resolveWhisperTargets(targets: string[]): { ids: string[]; warning: string | null } {
  const ids: string[] = [];

  for (const name of targets) {
    const user = game.users?.find((u: any) => u.name?.toLowerCase() === String(name).toLowerCase());
    if (user?.id) ids.push(user.id);
  }

  if (ids.length === 0) {
    // No requested targets resolved — whisper to GM(s) to prevent public post.
    const gmIds = (game.users?.filter((u: any) => u.isGM) ?? [])
      .map((u: any) => u.id)
      .filter(Boolean) as string[];
    ids.push(...gmIds);
    return {
      ids,
      warning:
        'No whisper targets resolved; message was whispered to the GM(s) to avoid posting it publicly.',
    };
  }

  return { ids, warning: null };
}

// ---------------------------------------------------------------------------
// Class
// ---------------------------------------------------------------------------

/**
 * Chat log read + chat message send domain — extracted from FoundryDataAccess.
 *
 * `getChatLog` reads the ring-buffer maintained by the EventTracker (it does
 * NOT query `game.messages` directly), forwarding only the filters that were
 * explicitly supplied — undefined keys are omitted from the filter object so
 * EventTracker can distinguish "no filter" from "filter to undefined".
 *
 * `sendChatMessage` is a thin orchestration layer: it resolves an optional
 * speaker actor, maps the caller-supplied message-type string to a Foundry
 * style integer, enforces the whisper-safety invariant, and delegates the
 * actual document creation to `ChatMessage.create`.
 */
export class ChatDataAccess {
  /**
   * Return the buffered chat log captured by the EventTracker, with filters.
   *
   * Only keys whose incoming value is not `undefined` are forwarded — this lets
   * EventTracker distinguish "caller did not mention limit" from "caller passed
   * limit: undefined".
   */
  async getChatLog(data: {
    limit?: number;
    speakerName?: string;
    messageType?: string;
    sinceTimestamp?: string;
  }): Promise<any> {
    shared.validateFoundryState();

    // Build the filters object by hand, omitting any key that is undefined.
    // Using an explicit conditional per key (rather than Object.entries) keeps
    // TypeScript happy with the typed intermediate.
    const filters: ChatLogFilters = {};
    if (data.limit !== undefined) filters.limit = data.limit;
    if (data.speakerName !== undefined) filters.speakerName = data.speakerName;
    if (data.messageType !== undefined) filters.messageType = data.messageType;
    if (data.sinceTimestamp !== undefined) filters.sinceTimestamp = data.sinceTimestamp;

    const messages = eventTracker.getChatLog(filters);
    return { success: true, count: messages.length, messages };
  }

  /**
   * Post a chat message as a specific actor (or the GM/world voice).
   *
   * Speaker resolution order:
   *   1. `speakerActorId` → `game.actors.get(id)`
   *   2. `speakerActorName` → `shared.findActorByIdentifier(name)` (fuzzy match)
   *   3. Neither supplied → current user name as alias (world/GM voice)
   *
   * Whisper safety: if `messageType` is `'whisper'` but none of the requested
   * `whisperTargets` can be matched to a game user, the message is routed to
   * all GM users instead and a `warning` is included in the response. The
   * message is NEVER posted publicly when whisper semantics were requested.
   */
  async sendChatMessage(data: {
    message: string;
    speakerActorId?: string;
    speakerActorName?: string;
    messageType?: string;
    whisperTargets?: string[];
  }): Promise<any> {
    shared.validateFoundryState();

    // Validate early — empty string is also invalid.
    if (!data.message || typeof data.message !== 'string') {
      throw new Error('message is required');
    }

    // --- Resolve speaker actor ---
    let actor: any = null;
    if (data.speakerActorId) {
      actor = game.actors?.get(data.speakerActorId) ?? null;
    }
    if (!actor && data.speakerActorName) {
      actor = shared.findActorByIdentifier(data.speakerActorName);
    }

    const speaker = resolveSpeaker(actor);

    // --- Normalize message type and derive Foundry style integer ---
    const type = (data.messageType || 'ic').toLowerCase();
    const style = resolveStyle(type);

    // Emotes wrap the content in italics; all other types pass through verbatim.
    const content = type === 'emote' ? `<em>${data.message}</em>` : data.message;

    // --- Whisper target resolution (only for whisper type) ---
    let warning: string | null = null;
    const whisper: string[] = [];

    if (type === 'whisper') {
      const targets = Array.isArray(data.whisperTargets) ? data.whisperTargets : [];
      const resolved = resolveWhisperTargets(targets);
      whisper.push(...resolved.ids);
      warning = resolved.warning;
    }

    // --- Create the ChatMessage document ---
    const messageData: any = { content, speaker, style };
    if (whisper.length > 0) messageData.whisper = whisper;

    const created: any = await (ChatMessage as any).create(messageData);

    return {
      success: true,
      messageId: created?.id ?? null,
      speaker: speaker?.alias ?? null,
      messageType: type,
      whisperedTo: whisper.length > 0 ? (data.whisperTargets ?? []) : [],
      ...(warning ? { warning } : {}),
    };
  }
}
