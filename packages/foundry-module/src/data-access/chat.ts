import * as shared from './shared.js';
import { eventTracker } from '../session-events.js';

/** Chat log read + chat message send domain — extracted from FoundryDataAccess. */
export class ChatDataAccess {
  /**
   * Return the buffered chat log captured by the EventTracker, with filters.
   */
  async getChatLog(data: {
    limit?: number;
    speakerName?: string;
    messageType?: string;
    sinceTimestamp?: string;
  }): Promise<any> {
    shared.validateFoundryState();

    const filters: {
      limit?: number;
      speakerName?: string;
      messageType?: string;
      sinceTimestamp?: string;
    } = {};
    if (data.limit !== undefined) filters.limit = data.limit;
    if (data.speakerName !== undefined) filters.speakerName = data.speakerName;
    if (data.messageType !== undefined) filters.messageType = data.messageType;
    if (data.sinceTimestamp !== undefined) filters.sinceTimestamp = data.sinceTimestamp;

    const messages = eventTracker.getChatLog(filters);
    return {
      success: true,
      count: messages.length,
      messages,
    };
  }

  /**
   * Post a chat message as a specific actor (or the GM/world).
   */
  async sendChatMessage(data: {
    message: string;
    speakerActorId?: string;
    speakerActorName?: string;
    messageType?: string;
    whisperTargets?: string[];
  }): Promise<any> {
    shared.validateFoundryState();

    if (!data.message || typeof data.message !== 'string') {
      throw new Error('message is required');
    }

    let actor: any = null;
    if (data.speakerActorId) {
      actor = game.actors?.get(data.speakerActorId) || null;
    }
    if (!actor && data.speakerActorName) {
      actor = shared.findActorByIdentifier(data.speakerActorName);
    }

    // getSpeaker takes {scene, actor, token, alias} — NOT {user}. For the
    // GM/world voice, set the alias explicitly to the current user's name.
    const speaker = actor
      ? (ChatMessage as any).getSpeaker({ actor })
      : (ChatMessage as any).getSpeaker({ alias: game.user?.name });

    const type = (data.messageType || 'ic').toLowerCase();
    const CMS: any = (CONST as any).CHAT_MESSAGE_STYLES || (CONST as any).CHAT_MESSAGE_TYPES || {};

    let style = CMS.IC ?? 2;
    if (type === 'ooc') style = CMS.OOC ?? 1;
    else if (type === 'emote') style = CMS.EMOTE ?? 3;
    else if (type === 'whisper') style = CMS.OTHER ?? 0;

    let content = data.message;
    if (type === 'emote') content = `<em>${data.message}</em>`;

    let warning: string | null = null;
    const whisper: string[] = [];
    if (type === 'whisper') {
      for (const name of Array.isArray(data.whisperTargets) ? data.whisperTargets : []) {
        const user = game.users?.find(
          (u: any) => u.name?.toLowerCase() === String(name).toLowerCase()
        );
        if (user?.id) whisper.push(user.id);
      }
      // SAFETY: never let a "whisper" become a public message. If no targets
      // resolved, fall back to whispering to the GM(s) and report it.
      if (whisper.length === 0) {
        const gmIds = (game.users?.filter((u: any) => u.isGM) ?? [])
          .map((u: any) => u.id)
          .filter(Boolean);
        whisper.push(...gmIds);
        warning =
          'No whisper targets resolved; message was whispered to the GM(s) to avoid posting it publicly.';
      }
    }

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
