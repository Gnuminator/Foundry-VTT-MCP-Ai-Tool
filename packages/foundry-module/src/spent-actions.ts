/**
 * What an actor has spent this turn (rules check, I-126). dnd5e posts a usage chat message for
 * every activity used through Foundry, whoever clicked it, so a GM client sees them all. This
 * ledger keeps those uses and, with the combat turn timeline the event tracker records, answers
 * "what has this actor used since its own turn began". A reaction comes back at the start of the
 * creature's own turn, so that same window answers both the turn and the reaction question.
 *
 * Only uses made through Foundry are seen: Dash, Dodge, Help, opportunity attacks rolled by hand
 * and anything the table adjudicates aloud never reach the ledger. Pure logic here; the hook
 * wiring at the bottom needs Foundry globals.
 */
import { MODULE_ID } from './constants.js';

export interface SpentUse {
  actorId: string;
  item: string;
  /** The item's type ("spell", "weapon"...): a second weapon attack is Extra Attack, not a second action. */
  itemType: string;
  /** The activity's raw activation type ("action", "bonus", "reaction"...). */
  activation: string;
  /** Spell level (0 for a cantrip) when the item is a spell and the level could be read. */
  itemLevel: number | null;
  /** The usage card: deleting it takes the use back out. */
  messageId: string | null;
  combatId: string | null;
  timestampMs: number;
}

export interface TurnMark {
  actorId: string | null;
  combatId?: string | null;
  timestampMs: number;
}

export interface SpentActionsResult {
  success: true;
  /** False when the module has not seen this combat's turns, so nothing can be said. */
  tracked: boolean;
  /** Uses since the actor's own turn began (its current turn, or the last one it took). */
  sinceOwnTurn: Array<{
    item: string;
    itemType: string;
    activation: string;
    itemLevel: number | null;
  }>;
}

const MAX_USES = 400;

/** Pure: the uses of `actorId` since its own turn started, for the combat `combatId`. */
export function spentSinceOwnTurn(
  actorId: string,
  combatId: string | null,
  uses: readonly SpentUse[],
  timeline: readonly TurnMark[]
): SpentActionsResult {
  const turns = timeline.filter(t => (t.combatId ?? null) === combatId);
  if (combatId === null || turns.length === 0)
    return { success: true, tracked: false, sinceOwnTurn: [] };
  // Before its first turn of this combat an actor has had no turn to spend anything in; a
  // reaction it used earlier in the round still counts, so the window opens with the combat.
  const own = [...turns].reverse().find(t => t.actorId === actorId) ?? turns[0];
  const since = own.timestampMs;
  return {
    success: true,
    tracked: true,
    sinceOwnTurn: uses
      .filter(u => u.actorId === actorId && u.combatId === combatId && u.timestampMs >= since)
      .map(u => ({
        item: u.item,
        itemType: u.itemType,
        activation: u.activation,
        itemLevel: u.itemLevel,
      })),
  };
}

class SpentLedger {
  private uses: SpentUse[] = [];
  private registered = false;

  record(use: SpentUse): void {
    this.uses.push(use);
    if (this.uses.length > MAX_USES) this.uses.splice(0, this.uses.length - MAX_USES);
  }

  snapshot(): readonly SpentUse[] {
    return this.uses;
  }

  /** A deleted usage card (a misclick) no longer counts. */
  forgetMessage(messageId: string): void {
    this.uses = this.uses.filter(u => u.messageId !== messageId);
  }

  /** Listen for dnd5e usage messages on a GM client. Safe to call twice. */
  registerHooks(): void {
    if (this.registered) return;
    this.registered = true;
    Hooks.on('createChatMessage', (message: unknown) => {
      try {
        if (!game.user?.isGM) return;
        const use = useFromMessage(message, str(game.combat?.id), Date.now(), spellLevelOf);
        if (use) this.record(use);
      } catch (error) {
        console.warn(`[${MODULE_ID}] Spent actions createChatMessage failed:`, error);
      }
    });
    Hooks.on('deleteChatMessage', (message: unknown) => {
      try {
        const id = str((message as { id?: unknown } | null)?.id);
        if (id) this.forgetMessage(id);
      } catch (error) {
        console.warn(`[${MODULE_ID}] Spent actions deleteChatMessage failed:`, error);
      }
    });
  }
}

/** The level of the spell behind an item uuid (0 for a cantrip); null when unknown. */
function spellLevelOf(uuid: string): number | null {
  const item = fromUuidSync(uuid) as { type?: unknown; system?: { level?: unknown } } | null;
  const level = item?.system?.level;
  return item?.type === 'spell' && typeof level === 'number' ? level : null;
}

function str(v: unknown): string | null {
  return typeof v === 'string' && v ? v : null;
}

/**
 * The ledger entry for a dnd5e 6 usage chat message (message type `usage`, whose `system` names
 * the item and carries the activation); null for any other message.
 */
export function useFromMessage(
  message: unknown,
  combatId: string | null,
  now: number,
  levelOf: (itemUuid: string) => number | null = () => null
): SpentUse | null {
  const msg = message as {
    id?: unknown;
    type?: unknown;
    speaker?: { actor?: unknown };
    system?: {
      activation?: { type?: unknown };
      item?: { name?: unknown; type?: unknown; uuid?: unknown };
      level?: unknown;
    };
  };
  if (msg?.type !== 'usage') return null;
  const item = msg.system?.item;
  // The speaker is the world actor (also for an unlinked token); the item uuid is the fallback.
  const actorId = str(msg.speaker?.actor) ?? /^Actor\.([^.]+)\./.exec(str(item?.uuid) ?? '')?.[1];
  const activation = str(msg.system?.activation?.type);
  if (!actorId || !activation) return null;
  // The card carries the spell level (also for a scroll cast, whose item is a consumable); the
  // item lookup is the fallback for a card without it.
  const cardLevel = typeof msg.system?.level === 'number' ? msg.system.level : null;
  const rawType = str(item?.type) ?? 'item';
  const isSpell = rawType === 'spell' || (rawType === 'consumable' && cardLevel !== null);
  return {
    actorId,
    item: str(item?.name) ?? 'an item',
    itemType: isSpell ? 'spell' : rawType,
    activation,
    itemLevel:
      cardLevel ??
      (rawType === 'spell' && str(item?.uuid) ? levelOf(str(item?.uuid) as string) : null),
    messageId: str(msg.id),
    combatId,
    timestampMs: now,
  };
}

export const spentLedger = new SpentLedger();
