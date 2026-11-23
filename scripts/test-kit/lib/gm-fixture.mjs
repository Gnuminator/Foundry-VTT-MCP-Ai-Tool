/**
 * The GM action of the scene fixture (lib/scene-fixture.mjs). Like gm-actions.mjs, the function is
 * serialized into the Foundry GM page by Playwright, so it is self-contained.
 */

/**
 * Plain test actors for the scene fixture (the first a character, the rest npcs; no class, no
 * compendium), flagged as kit so a rebuild wipes them. A kit actor with that name is reused.
 * @param {{names: string[], folderId?: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function createFixtureActors(args) {
  const { flagScope, flagKey } = args._kit;
  const actorIds = [];
  for (const [i, name] of (args.names ?? []).entries()) {
    const found = game.actors.find(a => a.name === name && a.getFlag(flagScope, flagKey));
    if (found) {
      actorIds.push(found.id);
      continue;
    }
    const data = { name, type: i === 0 ? 'character' : 'npc' };
    if (args.folderId) data.folder = args.folderId;
    foundry.utils.setProperty(data, `flags.${flagScope}.${flagKey}`, { built: true, fixture: true });
    const actor = await Actor.implementation.create(data);
    actorIds.push(actor.id);
  }
  return { actorIds };
}

/** The functions gm.mjs runs in the page, by GM action. */
export const FIXTURE_GM_FUNCTIONS = { createFixtureActors };
