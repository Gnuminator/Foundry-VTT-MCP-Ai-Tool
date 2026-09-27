/**
 * The kind of dnd5e roll a chat message carries (plan step 0.4).
 *
 * dnd5e 5.x stores it in `flags.dnd5e.roll.type` (`attack`, `damage`, `save`,
 * `skill`, ...). dnd5e 6.0 moves it to the ChatMessage subtype
 * (`message.type`) and deletes those flags, so damage detection must check
 * both.
 */

/** Core ChatMessage types that say nothing about a dnd5e roll. */
const CORE_MESSAGE_TYPES = new Set(['', 'base']);

/** `attack`, `damage`, `save`, ... or null when the message is not a dnd5e roll. */
export function chatRollKind(message: ChatMessage): string | null {
  const type = message.type;
  if (typeof type === 'string' && !CORE_MESSAGE_TYPES.has(type)) return type;
  const flags = message.flags?.dnd5e as { roll?: { type?: unknown } } | undefined;
  const legacy = flags?.roll?.type;
  return typeof legacy === 'string' && legacy ? legacy : null;
}

/** Whether a chat message is a dnd5e damage roll (5.x flags or 6.0 message type). */
export function isDamageRoll(message: ChatMessage): boolean {
  return chatRollKind(message) === 'damage';
}
