/**
 * The kind of dnd5e roll a chat message carries (plan step 0.4; extended for
 * O3's play recorder).
 *
 * dnd5e 5.x stores it in `flags.dnd5e.roll.type` (`attack`, `damage`, `save`,
 * `skill`, ...) plus an item/usage descriptor at `flags.dnd5e.item`. dnd5e 6.0
 * moves the roll kind to the ChatMessage subtype (`message.type`, one of the
 * keys of `CONFIG.ChatMessage.dataModels`: `attack`, `check`, `damage`,
 * `generic`, `healing`, `hitDie`, `hitPoints`, `item`, `rest`, `save`, `usage`,
 * ...; verified against `dnd5e.mjs` 6.0.5's `config$2` map) and stores the
 * per-kind data in `message.system` instead of flags. Every helper here checks
 * `message.system` first and falls back to the 5.x flags shape, so both
 * versions resolve through the same call.
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

/** The `message.system` object (6.0) when present, loosely typed. */
function systemOf(message: ChatMessage): Record<string, unknown> | undefined {
  const system = (message as unknown as { system?: unknown }).system;
  return system && typeof system === 'object' ? (system as Record<string, unknown>) : undefined;
}

/** The 5.x `flags.dnd5e.roll` object, loosely typed. */
function legacyRollFlags(message: ChatMessage): Record<string, unknown> | undefined {
  const flags = message.flags?.dnd5e as { roll?: unknown } | undefined;
  const roll = flags?.roll;
  return roll && typeof roll === 'object' ? (roll as Record<string, unknown>) : undefined;
}

function stringField(...values: unknown[]): string | undefined {
  for (const value of values) {
    if (typeof value === 'string' && value) return value;
  }
  return undefined;
}

/**
 * Whether a chat message is a dnd5e item-usage card (the "an item was used"
 * summary, as opposed to the individual roll messages it can spawn). 6.0 keys
 * this off the `usage`/`item` message subtypes; 5.x cards of this kind carry
 * `flags.dnd5e.item` without a `flags.dnd5e.roll.type`.
 */
export function isUsageCard(message: ChatMessage): boolean {
  const kind = chatRollKind(message);
  if (kind === 'usage' || kind === 'item') return true;
  if (kind !== null) return false;
  const flags = message.flags?.dnd5e as { item?: unknown } | undefined;
  return !!flags?.item && typeof flags.item === 'object';
}

/**
 * The canonical `PlayRollInfo.rollType` for a chat message: `attack`,
 * `damage`, `healing`, `hitDie`, `save`, `death`, `check`, `skill`, `tool`,
 * `initiative`, or `other` when the message is a roll of an unrecognized
 * dnd5e kind. Callers should only use this once they know the message carries
 * at least one roll (or call it defensively; unrelated messages simply map to
 * `other`).
 */
export function dnd5eRollType(message: ChatMessage): string {
  const kind = chatRollKind(message);
  const system = systemOf(message);
  const legacy = legacyRollFlags(message);
  const subType = stringField(system?.type, legacy?.type);
  switch (kind) {
    case 'attack':
      return 'attack';
    case 'damage':
      return 'damage';
    case 'healing':
      return 'healing';
    case 'hitDie':
      return 'hitDie';
    case 'save':
      return subType === 'death' ? 'death' : 'save';
    case 'death':
      return 'death';
    case 'check':
      if (subType === 'initiative') return 'initiative';
      if (stringField(system?.skill, legacy?.skill)) return 'skill';
      if (stringField(system?.tool, legacy?.tool)) return 'tool';
      return 'check';
    case 'skill':
      return 'skill';
    case 'tool':
      return 'tool';
    case 'initiative':
      return 'initiative';
    default:
      return 'other';
  }
}

/**
 * The ability, skill or tool key a check/save/attack message names
 * (`skill` and `tool` checks still carry the underlying `ability`; skill and
 * tool take priority since they are the more specific subject).
 */
export function dnd5eRollSubject(message: ChatMessage): string | undefined {
  const system = systemOf(message);
  const legacy = legacyRollFlags(message);
  return stringField(
    system?.skill,
    legacy?.skill,
    system?.tool,
    legacy?.tool,
    system?.ability,
    legacy?.ability
  );
}

/** An item/spell reference a roll, usage or item message names, when known. */
export function dnd5eMessageItemRef(
  message: ChatMessage
): { uuid: string; name: string; type: string } | undefined {
  const system = systemOf(message);
  const sysItem = system?.item as { uuid?: unknown; name?: unknown; type?: unknown } | undefined;
  if (typeof sysItem?.uuid === 'string' && sysItem.uuid) {
    return {
      uuid: sysItem.uuid,
      name: stringField(sysItem.name) ?? 'Item',
      type: stringField(sysItem.type) ?? 'item',
    };
  }
  const flags = message.flags?.dnd5e as
    | { item?: { uuid?: unknown; id?: unknown; name?: unknown; type?: unknown } }
    | undefined;
  const legacyItem = flags?.item;
  const legacyUuid = stringField(legacyItem?.uuid, legacyItem?.id);
  if (legacyItem && legacyUuid) {
    return {
      uuid: legacyUuid,
      name: stringField(legacyItem.name) ?? 'Item',
      type: stringField(legacyItem.type) ?? 'item',
    };
  }
  return undefined;
}

/** The spell level a usage/item card names, when it names one. */
export function dnd5eSpellLevel(message: ChatMessage): number | undefined {
  const system = systemOf(message);
  if (typeof system?.level === 'number') return system.level;
  const flags = message.flags?.dnd5e as
    | { spellLevel?: unknown; use?: { spellLevel?: unknown } }
    | undefined;
  const legacy = flags?.spellLevel ?? flags?.use?.spellLevel;
  return typeof legacy === 'number' ? legacy : undefined;
}

/** `short`/`long` for a rest chat card, when the message names one. */
export function dnd5eRestType(message: ChatMessage): 'short' | 'long' | undefined {
  const system = systemOf(message);
  const fromSystem = system?.type;
  if (fromSystem === 'short' || fromSystem === 'long') return fromSystem;
  const flags = message.flags?.dnd5e as { rest?: { type?: unknown } } | undefined;
  const fromFlags = flags?.rest?.type;
  if (fromFlags === 'short' || fromFlags === 'long') return fromFlags;
  return undefined;
}

/** Target descriptors (`{ac, actor, name, token}`) a roll or usage message stored, when any. */
export function dnd5eMessageTargets(
  message: ChatMessage
): Array<{ ac: number | null; actor: string | null; name: string | null }> {
  const system = systemOf(message);
  const raw = system?.targets;
  if (!Array.isArray(raw)) return [];
  // `Array.isArray` narrows to `any[]` (its lib.d.ts signature takes `arg: any`),
  // so re-annotate as `unknown[]` before reading into it.
  const targets: unknown[] = raw;
  return targets.map(entry => {
    const target = entry && typeof entry === 'object' ? (entry as Record<string, unknown>) : {};
    return {
      ac: typeof target.ac === 'number' ? target.ac : null,
      actor: typeof target.actor === 'string' ? target.actor : null,
      name: typeof target.name === 'string' ? target.name : null,
    };
  });
}
