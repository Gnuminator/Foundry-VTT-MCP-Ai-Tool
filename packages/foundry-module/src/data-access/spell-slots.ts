/**
 * The leveled slot a slot-cast spell (dnd5e method "spell", level 1+) needs: undefined when the
 * item is not one or the slot at its wanted level has a use left (nothing to change), the lowest
 * higher level with a slot when it is empty ({ pact: level } when the pact slot is the lowest one
 * that fits: a multiclass warlock casts a "spell" method spell with it), 'none' when no slot at
 * that level or above is left, 'below' when the caller asked for a level under the spell's own.
 * `attack` is the attack activity of a rollAttack call: only its slot box counts then; `headless`
 * (no dialog) means the first usable activity runs.
 */
export function slotLevelFor(
  actor: Actor,
  item: Item,
  wanted: number | undefined,
  attack?: unknown,
  headless = false
): number | { pact: number } | 'none' | 'below' | undefined {
  const sys = item.system as
    | { level?: unknown; method?: unknown; activities?: unknown; linkedActivity?: unknown }
    | undefined;
  const level = sys?.level;
  if (item.type !== 'spell' || typeof level !== 'number' || level < 1) return undefined;
  if (sys?.method !== 'spell') return undefined;
  // dnd5e spends no slot for a spell granted by a Cast activity (it uses the linked item's uses),
  // for a fixed-level spell, or for an activity whose "consume spell slot" box is off: leave those
  // to dnd5e (and its dialog) instead of refusing or forcing a slot.
  const flags = item.flags as { dnd5e?: { cachedFor?: unknown; spellLevel?: unknown } } | undefined;
  if (flags?.dnd5e?.cachedFor || flags?.dnd5e?.spellLevel || sys.linkedActivity) return undefined;
  const acts = sys.activities as { values?: () => Iterable<unknown> } | unknown[] | undefined;
  const list = Array.isArray(acts) ? acts : acts?.values ? Array.from(acts.values()) : [];
  const noSlot = (a: unknown): boolean =>
    (a as { consumption?: { spellSlot?: unknown } })?.consumption?.spellSlot === false;
  // One activity runs when a rollAttack call names it, when no dialog shows (dnd5e takes the first
  // usable activity) or when only one can be used: its box alone decides. Otherwise the GM picks in
  // the dialog and the module cannot know which one, so a spell with any no-slot activity is left
  // to dnd5e.
  const usable = list.filter(a => (a as { canUse?: unknown })?.canUse !== false);
  const chosen: unknown = attack ?? (headless || usable.length === 1 ? usable[0] : undefined);
  if (chosen !== undefined ? noSlot(chosen) : list.some(noSlot)) return undefined;
  const spells = (
    actor.system as {
      spells?: Record<string, { value?: unknown; level?: unknown } | undefined>;
    }
  )?.spells;
  if (!spells) return undefined;
  if (wanted !== undefined && wanted < level) return 'below';
  const left = (n: number): number => {
    const v = spells[`spell${n}`]?.value;
    return typeof v === 'number' ? v : 0;
  };
  const pactLevel =
    typeof spells.pact?.level === 'number' && typeof spells.pact.value === 'number'
      ? spells.pact.value > 0
        ? spells.pact.level
        : 0
      : 0;
  const from = Math.max(wanted ?? level, level);
  if (left(from) > 0) return undefined;
  // An explicit level is the caller's choice: no silent switch to a bigger slot (a pact slot of
  // exactly that level is a slot at that level).
  if (wanted !== undefined) return pactLevel === from ? { pact: from } : 'none';
  for (let n = from; n <= 9; n++) {
    if (pactLevel === n) return { pact: n };
    if (n > from && left(n) > 0) return n;
  }
  return 'none';
}
