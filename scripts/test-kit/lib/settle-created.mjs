/**
 * The wait `createHero` does after each new item, in a file of its own so kit:test can run it with
 * a stub actor (gm-actions.mjs runs only inside the Foundry page).
 *
 * dnd5e finishes two things after a new item is created without awaiting them: a species item
 * links itself (system.details.race, from its _onCreate), and an item with Cast activities adds its
 * cached spell copies (onCreateActivities). The next advancement manager clones the actor and
 * writes the clone back whole (diff: false, and items missing from the clone are deleted), so a
 * manager started before those writes land erases the species link (no speeds, no senses) and
 * deletes the spells. A player clicking through the forms is far slower; the kit started the next
 * manager within ~100 ms and lost that race on a slow run (8 species, 2026-10-09).
 *
 * Self-contained like a GM action: gm.mjs sends its source into the page with createHero
 * (`args._helpers.settleCreated`), so it may not close over module scope. Everything that touches
 * Foundry arrives in `deps`.
 *
 * Error messages are matched by classifyBuildError (advancement.mjs) as SYSTEM: keep "is not
 * linked to the actor" and "no cached spell" in them.
 *
 * @param {any} actor the dnd5e actor (itemTypes.race, _source.system.details.race, items.contents)
 * @param {string} label the step, for the error message
 * @param {{resolveUuid: (uuid: string) => Promise<unknown>, sleep: (ms: number) => Promise<void>,
 *   now?: () => number, timeoutMs?: number, intervalMs?: number}} deps resolveUuid is the async
 *   `fromUuid` (the sync one returns null for a pack whose index is not loaded, which would skip
 *   that spell silently)
 */
export async function settleCreated(actor, label, deps) {
  const { resolveUuid, sleep } = deps;
  const now = deps.now ?? (() => Date.now());
  const timeoutMs = deps.timeoutMs ?? 10000;
  const intervalMs = deps.intervalMs ?? 50;
  // A spell uuid that resolves to nothing (a pack that is gone) never gets a cached copy: not waited for.
  const exists = new Map();
  const spellExists = async uuid => {
    if (!exists.has(uuid)) exists.set(uuid, !!(await resolveUuid(uuid)));
    return exists.get(uuid);
  };
  // Read on every check: a species replaced mid-wait must link too, not the one seen first.
  const species = () => actor.itemTypes.race?.[0];
  const unlinked = race => !!race && actor._source.system.details?.race !== race.id;
  const uncached = async () => {
    const waiting = [];
    for (const item of actor.items.contents)
      for (const a of item.system.activities?.getByType?.('cast') ?? [])
        if (a.spell?.uuid && !a.cachedSpell && (await spellExists(a.spell.uuid)))
          waiting.push(`${item.name}: ${a.name}`);
    return waiting;
  };
  const until = now() + timeoutMs;
  for (;;) {
    const race = species();
    const isUnlinked = unlinked(race);
    const waiting = await uncached();
    if (!isUnlinked && !waiting.length) return;
    if (now() > until) {
      if (isUnlinked)
        throw new Error(
          `createHero: ${label}: the species ${race.name} is not linked to the actor (system.details.race)`
        );
      throw new Error(`createHero: ${label}: no cached spell for ${waiting.join(', ')}`);
    }
    await sleep(intervalMs);
  }
}
