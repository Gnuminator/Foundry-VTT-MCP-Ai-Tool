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
  sinceOwnTurn: Array<{ item: string; itemType: string; activation: string }>;
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
      .map(u => ({ item: u.item, itemType: u.itemType, activation: u.activation })),
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

  /** Listen for dnd5e usage messages on a GM client. Safe to call twice. */
  registerHooks(): void {
    if (this.registered) return;
    this.registered = true;
    Hooks.on('createChatMessage', (message: unknown) => {
      try {
        if (!game.user?.isGM) return;
        const use = useFromMessage(message, str(game.combat?.id), Date.now());
        if (use) this.record(use);
      } catch (error) {
        console.warn(`[${MODULE_ID}] Spent actions createChatMessage failed:`, error);
      }
    });
  }
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
  now: number
): SpentUse | null {
  const msg = message as {
    type?: unknown;
    speaker?: { actor?: unknown };
    system?: {
      activation?: { type?: unknown };
      item?: { name?: unknown; type?: unknown; uuid?: unknown };
    };
  };
  if (msg?.type !== 'usage') return null;
  const item = msg.system?.item;
  // The speaker is the world actor (also for an unlinked token); the item uuid is the fallback.
  const actorId = str(msg.speaker?.actor) ?? /^Actor\.([^.]+)\./.exec(str(item?.uuid) ?? '')?.[1];
  const activation = str(msg.system?.activation?.type);
  if (!actorId || !activation) return null;
  return {
    actorId,
    item: str(item?.name) ?? 'an item',
    itemType: str(item?.type) ?? 'item',
    activation,
    combatId,
    timestampMs: now,
  };
}

export const spentLedger = new SpentLedger();
