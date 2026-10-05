/**
 * The GM actions, one function per key of GM_ACTIONS (contract.mjs). gm.mjs serializes each into
 * the Foundry GM page with Playwright's `page.evaluate`, so every function here is
 * self-contained: no closures over module scope, helpers are declared inside the function, and
 * the kit constants arrive in `args._kit` (gm.mjs adds `{flagScope, flagKey}`).
 *
 * `consoleErrors` is not here: the Node side collects console and page errors (gm.mjs).
 *
 * Verified against Foundry 14.368 and dnd5e 6.0.5 (Modern Rules 2024). Facts that shaped the code:
 * - The system ships `dnd5e.classes24` (12 classes + subclasses + features), `dnd5e.origins24`
 *   (species, backgrounds, origin feats) and a legacy `dnd5e.heroes` pack of 12 premade 2014
 *   characters. The kit builds heroes from the 2024 class items, not the premade pack.
 * - Creating a class item with `actor.createEmbeddedDocuments` skips advancement (no HP, no
 *   features). The supported route is `AdvancementManager.forNewItem(actor, data,
 *   {automaticApplication: true})`: it applies fixed grants itself and stops (renders) at each
 *   choice; the hero builder answers each stop with defaults and clicks "next" until the
 *   `dnd5e.advancementManagerComplete` hook fires. HP then comes out of the HitPoints advancement
 *   (level 1 max die, later levels average) plus the Constitution modifier.
 */

/** @param {object} _args */
async function worldStatus(_args) {
  const mod = game.modules.get('foundry-mcp-bridge');
  return {
    worldId: game.world.id,
    systemId: game.system.id,
    systemVersion: game.system.version,
    coreVersion: game.version,
    userName: game.user.name,
    isGM: game.user.isGM,
    moduleActive: !!mod?.active,
    moduleVersion: mod?.version ?? '',
  };
}

/**
 * Delete every document that carries the kit flag, children first.
 * @param {{_kit: {flagScope: string, flagKey: string}}} args
 */
async function wipeKit(args) {
  const { flagScope, flagKey } = args._kit;
  const marked = doc => !!doc.getFlag(flagScope, flagKey);
  const deleted = { Actor: 0, Scene: 0, Item: 0, JournalEntry: 0, Combat: 0, Folder: 0 };
  const drop = async (name, collection) => {
    const ids = collection.filter(marked).map(d => d.id);
    if (!ids.length) return;
    await getDocumentClass(name).deleteDocuments(ids);
    deleted[name] += ids.length;
  };
  // Combats on a kit scene go with it, flagged or not.
  const kitSceneIds = new Set(game.scenes.filter(marked).map(s => s.id));
  const strayCombats = game.combats
    .filter(c => !marked(c) && kitSceneIds.has(c.scene?.id))
    .map(c => c.id);
  if (strayCombats.length) {
    await Combat.deleteDocuments(strayCombats);
    deleted.Combat += strayCombats.length;
  }
  await drop('Combat', game.combats);
  await drop('Scene', game.scenes);
  await drop('Actor', game.actors);
  await drop('Item', game.items);
  await drop('JournalEntry', game.journal);
  await drop('Folder', game.folders);
  return { deleted };
}

/**
 * A kit folder of a document type, reused when it exists.
 * @param {{type: string, name: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function ensureFolder(args) {
  const { flagScope, flagKey } = args._kit;
  const existing = game.folders.find(
    f => f.type === args.type && f.name === args.name && f.getFlag(flagScope, flagKey)
  );
  if (existing) return { folderId: existing.id };
  const folder = await Folder.create({
    name: args.name,
    type: args.type,
    flags: { [flagScope]: { [flagKey]: { built: true } } },
  });
  return { folderId: folder.id };
}

/**
 * A level-N character built through the dnd5e advancement manager.
 * `classId` is an item id in dnd5e.classes24, a name ("Fighter") or a full UUID; `speciesId` and
 * `backgroundId` likewise against dnd5e.origins24 (default: Human and Soldier).
 * @param {{name: string, classId: string, level?: number, speciesId?: string, backgroundId?: string, folderId?: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function createHero(args) {
  const { flagScope, flagKey } = args._kit;
  const level = Math.max(1, Math.min(20, Number(args.level ?? 1)));
  const kitFlags = { [flagScope]: { [flagKey]: { built: true } } };
  const sleep = ms => new Promise(resolve => setTimeout(resolve, ms));
  const Manager = dnd5e.applications.advancement.AdvancementManager;

  const findData = async (ref, packId, type) => {
    let doc = null;
    if (typeof ref === 'string' && ref.includes('.')) doc = await fromUuid(ref);
    else {
      const pack = game.packs.get(packId);
      const index = await pack.getIndex();
      const wanted = String(ref).toLowerCase();
      const entry = index.find(
        e => (e._id === ref || e.name.toLowerCase() === wanted) && (!type || e.type === type)
      );
      if (entry) doc = await pack.getDocument(entry._id);
    }
    if (!doc) throw new Error(`createHero: no ${type} "${ref}" in ${packId}`);
    const data = doc.toObject();
    delete data._id;
    return data;
  };

  // Run one manager to the end, answering every choice with a default.
  const runManager = async (actor, itemData, label) => {
    const mgr = Manager.forNewItem(actor, itemData, { automaticApplication: true });
    if (!mgr.steps.length) {
      await actor.createEmbeddedDocuments('Item', [itemData]);
      return;
    }
    let done = false;
    const hook = Hooks.on('dnd5e.advancementManagerComplete', m => {
      if (m === mgr) done = true;
    });
    try {
      await mgr.render(true);
      let lastIndex = -2;
      let waited = 0;
      while (!done) {
        await sleep(150);
        waited += 150;
        if (waited > 45000) throw new Error(`createHero: the advancement manager hung at ${label}`);
        if (!mgr.rendered || !mgr.step) continue;
        const index = mgr.steps.indexOf(mgr.step);
        const flow = mgr.step.flow;
        const adv = flow?.advancement;
        const button = mgr.element?.querySelector('[data-action="next"],[data-action="complete"]');
        if (!button || (!flow?.element?.isConnected && !flow?._element)) continue;
        if (index === lastIndex) continue;
        await sleep(250);
        lastIndex = index;
        waited = 0;
        const lvl = flow.level;
        if (adv?.type === 'HitPoints') {
          // Level 1 of the first class is max automatically; later levels take the average. The
          // flow validates its form, so tick "use average" in the page instead of applying data.
          const box = flow.element?.querySelector('[name="useAverage"]');
          if (box && !box.checked) {
            box.click();
            await sleep(500);
          }
        }
        if (adv?.type === 'Trait') {
          const chosen = [];
          for (let k = 0; k < 30; k++) {
            const taken = new Set([...(adv.value.chosen ?? []), ...chosen]);
            const { available } = await adv.unfulfilledChoices(taken);
            const entry = available.find(a => a.choices.asSet().size > 0);
            if (!entry) break;
            chosen.push(entry.choices.asSet().first());
          }
          if (chosen.length) await adv.apply(lvl, { chosen });
        }
        if (adv?.type === 'ItemChoice') {
          const count = adv.configuration.choices?.[lvl]?.count ?? 0;
          const have = new Set(Object.values(adv.value.added?.[lvl] ?? {}));
          const taken = new Set(
            actor.items.map(i => i._stats?.compendiumSource ?? i.flags?.dnd5e?.sourceId)
          );
          const pool = (adv.configuration.pool ?? []).map(p => p.uuid);
          const selected = pool
            .filter(u => !have.has(u) && !taken.has(u))
            .slice(0, Math.max(0, count - have.size));
          if (selected.length) await adv.apply(lvl, { selected });
        }
        button.click();
      }
    } finally {
      Hooks.off('dnd5e.advancementManagerComplete', hook);
      if (mgr.rendered) await mgr.close({ skipConfirmation: true });
    }
  };

  const actor = await Actor.implementation.create({
    name: args.name,
    type: 'character',
    folder: args.folderId ?? null,
    flags: kitFlags,
    // The standard array, the same for everyone; Constitution 13 gives +1 hit point per level.
    system: {
      abilities: {
        str: { value: 15 },
        dex: { value: 14 },
        con: { value: 13 },
        int: { value: 12 },
        wis: { value: 10 },
        cha: { value: 8 },
      },
    },
  });
  try {
    const origins = 'dnd5e.origins24';
    const species = await findData(args.speciesId ?? 'Human', origins, 'race');
    await runManager(actor, species, 'species');
    const background = await findData(args.backgroundId ?? 'Soldier', origins, 'background');
    await runManager(actor, background, 'background');
    const klass = await findData(args.classId, 'dnd5e.classes24', 'class');
    klass.system.levels = level;
    klass.flags = { ...(klass.flags ?? {}), ...kitFlags };
    await runManager(actor, klass, 'class');
    const max = actor.system.attributes.hp.max;
    if (actor.system.attributes.hp.value !== max) {
      await actor.update({ 'system.attributes.hp.value': max });
    }
    const classItem = actor.items.find(i => i.type === 'class');
    if (!classItem) throw new Error('createHero: the class item was not added');
    return {
      actorId: actor.id,
      name: actor.name,
      classIdentifier: classItem.system.identifier,
      level: actor.system.details.level,
      hp: { value: actor.system.attributes.hp.value, max: actor.system.attributes.hp.max },
    };
  } catch (err) {
    await actor.delete().catch(() => {});
    throw err;
  }
}

/**
 * A gridded scene without an image: a rectangular room of walls with one door and a light.
 * `width` and `height` are in grid squares, `grid` is the square size in pixels (default 100),
 * `walls` (boolean) draws the four room walls, `doors` is how many door segments the bottom
 * wall gets (0 or 1), `lights` is how many lights to place (in the middle of the room).
 * The scene is activated; the call returns once the canvas has drawn it.
 * @param {{name: string, folderId?: string, width: number, height: number, grid?: number, walls?: boolean, doors?: number, lights?: number, _kit: {flagScope: string, flagKey: string}}} args
 */
async function createCombatScene(args) {
  const { flagScope, flagKey } = args._kit;
  const size = args.grid ?? 100;
  const cols = args.width;
  const rows = args.height;
  const w = cols * size;
  const h = rows * size;
  const scene = await Scene.create({
    name: args.name,
    folder: args.folderId ?? null,
    width: cols * size,
    height: rows * size,
    padding: 0,
    backgroundColor: '#2b2b33',
    grid: { type: CONST.GRID_TYPES.SQUARE, size, distance: 5, units: 'ft' },
    tokenVision: true,
    fog: { exploration: false },
    flags: { [flagScope]: { [flagKey]: { built: true } } },
  });
  // activate() alone draws it (a second view() call races the first draw and logs canvas errors).
  // Walls and lights come after the canvas is ready: placeables created before the first draw are
  // drawn while the canvas is torn down and rebuilt, and log uncaught canvas errors.
  await scene.activate();
  const until = Date.now() + 45000;
  while (!(globalThis.canvas?.ready && globalThis.canvas.scene?.id === scene.id)) {
    if (Date.now() > until) throw new Error('createCombatScene: the canvas did not draw the scene');
    await new Promise(resolve => setTimeout(resolve, 250));
  }
  if (args.walls !== false) {
    const wall = (x1, y1, x2, y2, door = 0) => ({ c: [x1, y1, x2, y2], door });
    const walls = [wall(0, 0, w, 0), wall(0, 0, 0, h), wall(w, 0, w, h)];
    if ((args.doors ?? 1) > 0) {
      const gap = Math.floor(cols / 2) * size;
      walls.push(wall(0, h, gap, h), wall(gap, h, gap + size, h, CONST.WALL_DOOR_TYPES.DOOR));
      walls.push(wall(gap + size, h, w, h));
    } else walls.push(wall(0, h, w, h));
    await scene.createEmbeddedDocuments('Wall', walls);
  }
  const lightCount = args.lights ?? 1;
  if (lightCount > 0) {
    const lights = Array.from({ length: lightCount }, (_, i) => ({
      x: Math.round(w / 2) + i * size,
      y: Math.round(h / 2),
      config: { dim: 30, bright: 15 }, // grid distance units (ft)
    }));
    await scene.createEmbeddedDocuments('AmbientLight', lights);
  }
  return { sceneId: scene.id, name: scene.name };
}

/**
 * A token for an actor on a scene; x and y are grid squares (top-left of the token). The actor
 * is adopted into the kit: it gets the kit flag and the kit Actor folder if one exists, so a
 * rebuild wipes actors the bridge created too.
 * @param {{sceneId: string, actorId: string, x: number, y: number, hidden?: boolean, name?: string, _kit: {flagScope: string, flagKey: string}}} args
 */
async function placeToken(args) {
  const { flagScope, flagKey } = args._kit;
  const scene = game.scenes.get(args.sceneId);
  if (!scene) throw new Error(`placeToken: no scene ${args.sceneId}`);
  const actor = game.actors.get(args.actorId);
  if (!actor) throw new Error(`placeToken: no actor ${args.actorId}`);
  if (!actor.getFlag(flagScope, flagKey)) {
    const folder = game.folders.find(f => f.type === 'Actor' && f.getFlag(flagScope, flagKey));
    const update = { [`flags.${flagScope}.${flagKey}`]: { built: true } };
    if (folder && !actor.folder) update.folder = folder.id;
    await actor.update(update);
  }
  const size = scene.grid.size;
  const overrides = { x: args.x * size, y: args.y * size, hidden: !!args.hidden };
  if (args.name) overrides.name = args.name;
  const data = (await actor.getTokenDocument(overrides)).toObject();
  data.flags = { ...(data.flags ?? {}), [flagScope]: { [flagKey]: { built: true } } };
  // A few SRD monsters ship with no image (Allosaurus, Ankylosaurus); an empty token texture makes
  // the canvas log "Requested texture path is empty".
  if (!data.texture?.src) {
    data.texture = { ...(data.texture ?? {}), src: 'icons/svg/mystery-man.svg' };
  }
  const [token] = await scene.createEmbeddedDocuments('Token', [data]);
  return { tokenId: token.id };
}

/**
 * A new combat on a scene with those tokens, initiative rolled and started.
 * @param {{sceneId: string, tokenIds: string[], _kit: {flagScope: string, flagKey: string}}} args
 */
async function startCombat(args) {
  const { flagScope, flagKey } = args._kit;
  const scene = game.scenes.get(args.sceneId);
  if (!scene) throw new Error(`startCombat: no scene ${args.sceneId}`);
  const combat = await Combat.implementation.create({
    scene: scene.id,
    active: true,
    flags: { [flagScope]: { [flagKey]: { built: true } } },
  });
  const combatants = args.tokenIds.map(id => {
    const token = scene.tokens.get(id);
    if (!token) throw new Error(`startCombat: no token ${id} on ${scene.name}`);
    return { tokenId: id, sceneId: scene.id, actorId: token.actorId, hidden: token.hidden };
  });
  const created = await combat.createEmbeddedDocuments('Combatant', combatants);
  await combat.rollAll();
  await combat.startCombat();
  // Foundry returns the new combatants in its own order; hand the ids back in the order asked.
  const byToken = new Map(created.map(c => [c.tokenId, c.id]));
  return { combatId: combat.id, combatantIds: args.tokenIds.map(id => byToken.get(id)) };
}

/**
 * Delete every combat on a kit scene (or carrying the kit flag). `endCombat()` opens a confirm
 * dialog in Foundry 14, so this deletes the document instead.
 * @param {{_kit: {flagScope: string, flagKey: string}}} args
 */
async function endCombats(args) {
  const { flagScope, flagKey } = args._kit;
  const ids = game.combats
    .filter(c => c.getFlag(flagScope, flagKey) || c.scene?.getFlag(flagScope, flagKey))
    .map(c => c.id);
  if (ids.length) await Combat.deleteDocuments(ids);
  return { ended: ids.length };
}

/**
 * With `sceneId` and `tokenId` it reads the token's actor (an unlinked token has its own HP).
 * @param {{actorId: string, sceneId?: string, tokenId?: string}} args
 */
async function readActor(args) {
  let actor = game.actors.get(args.actorId);
  if (args.tokenId) {
    const token = game.scenes.get(args.sceneId)?.tokens.get(args.tokenId);
    if (!token?.actor) throw new Error(`readActor: no token ${args.tokenId} on ${args.sceneId}`);
    actor = token.actor;
  }
  if (!actor) throw new Error(`readActor: no actor ${args.actorId}`);
  const hp = actor.system.attributes?.hp ?? {};
  return {
    name: actor.name,
    hp: { value: hp.value ?? 0, max: hp.max ?? 0, temp: hp.temp ?? 0 },
    conditions: [...actor.statuses],
  };
}

/** The functions gm.mjs runs in the page, by GM action. */
export const GM_ACTION_FUNCTIONS = {
  worldStatus,
  wipeKit,
  ensureFolder,
  createHero,
  createCombatScene,
  placeToken,
  startCombat,
  endCombats,
  readActor,
};
