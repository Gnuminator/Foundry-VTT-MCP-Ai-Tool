/**
 * One write gate for every bridge handler that changes the world (P-036).
 *
 * "Allow Write Operations" used to be checked by a few handlers only (actor
 * creation, some scene edits, guarded writes); ownership, token vision and
 * light, item and feature additions, damage, conditions, combat, chat and more
 * wrote regardless. Now every handler is registered with a kind (`write`,
 * `recordless-write` or `read`, see `BridgeHandlerKind`), and `gateWriteHandlers`
 * wraps every write kind once at registration, so a write is refused while the
 * switch is off, whoever asks (Claude or the dashboard). The kind is a required
 * argument of `BridgeHandlerTable.on/set`, so a handler cannot be left unclassified.
 *
 * Chat and roll messages count as writes: they create chat messages players
 * see. Guarded writes (`applyGuardedOps`) are registered as `read` because they keep
 * their own gate, which also checks the feature switches.
 *
 * Recordless writes (chat, rolls, playlists, a page popup, a notice, a folder, a portrait
 * file) make no change-journal record. They do not break the change group: it would only end
 * the window in which dnd5e's late follow-ups of an AI change stay with it, and some of them
 * run as a step of a guarded apply itself. playerRoll breaks the group itself on its
 * initiative path (rollTrackerInitiative), where it starts a tracker roll that dnd5e follows up.
 */
import type { BridgeHandlerTable } from './bridge-handlers.js';
import { changeJournal } from './change-journal.js';
import { WRITES_OFF_MESSAGE, writeOperationsAllowed } from './guarded-features.js';

/** The refusal every gated write gets (the same text as guarded writes). */
export const WRITES_DISABLED_MESSAGE = WRITES_OFF_MESSAGE;

/** Throw the standard refusal while "Allow Write Operations" is off. */
export function requireWriteOperations(): void {
  if (!writeOperationsAllowed()) throw new Error(WRITES_DISABLED_MESSAGE);
}

/**
 * Wrap every write handler registered in `table` (kind `write` or `recordless-write`)
 * with the write gate. Call once, after all handlers are registered.
 */
export function gateWriteHandlers(table: BridgeHandlerTable): void {
  for (const wire of table.methodsOfKind('write', 'recordless-write')) {
    const handler = table.get(wire);
    if (!handler) continue;
    const kind = table.kindOf(wire) ?? 'write';
    const breaks = kind === 'write';
    table.set(wire, kind, async (data: unknown) => {
      requireWriteOperations();
      // A direct write is its own change, never a follow-up of the guarded apply just before it
      // (the journal's guarded gap would else file it under the AI change in Recent Changes).
      if (breaks) changeJournal.breakGroup();
      return await handler(data);
    });
  }
}
