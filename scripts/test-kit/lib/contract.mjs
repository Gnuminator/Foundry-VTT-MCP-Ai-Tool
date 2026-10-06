/**
 * The test kit's shared contract: the scenario format, the context a scenario gets, the GM
 * actions a scenario or the builder may ask the Foundry GM page for, the build manifest and the
 * run report. Every other file in scripts/test-kit builds against this one; change it first and
 * on purpose. Plan: vault `Dev/Foundry AI Tool/Design/Test kit plan.md`; docs: docs/dev/TEST-KIT.md.
 *
 * A scenario is an ES module whose default export is a {@link Scenario}. SRD scenarios live in
 * scripts/test-kit/scenarios/; licensed ones live only on this PC (default
 * C:\FoundryTest\test-kit\licensed\) and are loaded with `--scenarios <dir>`. A scenario names
 * documents by name or id only and never carries book text.
 */

/** Bump when the report or manifest shape changes in a way readers must notice. */
export const KIT_FORMAT_VERSION = 2;

/** Kit sizes, smallest first (plan: "Three sizes"). A scenario lists the sizes that include it. */
export const KIT_SIZES = ['smoke', 'full', 'long'];

/** Areas a scenario exercises; the report groups by them. */
export const KIT_TAGS = ['bridge', 'module', 'dashboard', 'player', 'vault', 'playlog', 'build'];

/**
 * Worlds the kit may build in and write to. Never a real campaign, never `ai-tool-test` (the
 * everyday test world) and never `ai-tool-kit` (the hand-made licensed import world).
 */
export const KIT_WORLDS = ['ai-tool-kit-srd', 'ai-tool-kit-licensed'];

/** The kit's own world. */
export const DEFAULT_KIT_WORLD = 'ai-tool-kit-srd';

/**
 * Content profiles: where the builder finds its content. `srd` ships in the repo
 * (scripts/test-kit/data/profiles/srd.json); any other profile is a local file
 * `<kitHome>/licensed/profiles/<id>.json` and never enters a repo. Selected with `--profile <id>`.
 *
 * @typedef {object} ContentProfile
 * @property {string} id
 * @property {string} world            the kit world it builds in (one of KIT_WORLDS)
 * @property {string} title            world title when the world is created
 * @property {string[]} modules        modules to enable besides foundry-mcp-bridge (e.g. a local content module)
 * @property {{classes: string[], subclasses: string[], species: string[], backgrounds: string[], monsters: string[], spells: string[], feats: string[]}} packs
 *   compendium ids per kind, searched in order; the first pack that has an entry wins for duplicates
 * @property {{rules: Array<'2024'|'2014'>, skipNames?: string[], skipIds?: string}} [select]
 *   which rules versions count (both = 2024 plus legacy that remain), names to skip, and an id regex to skip
 */
export const DEFAULT_PROFILE = 'srd';

/** Hero levels per kit size (D-090 lane 2, the user's pick 2026-10-05). */
export const HERO_PLAN = {
  /** every class at this level with its first subclass */
  smoke: { tierLevels: [5], subclassLevel: null },
  /** every class at 1, 5, 11, 17 (first subclass from 3) and every subclass at 20 */
  full: { tierLevels: [1, 5, 11, 17], subclassLevel: 20 },
  long: { tierLevels: [1, 5, 11, 17], subclassLevel: 20 },
};

/** The live bridge ports: the kit refuses any target that uses one of them. */
export const LIVE_BRIDGE_PORTS = [31414, 31415, 31416];

/** Flag on every document the builder creates (`flags.world.testKit`), so a rebuild can wipe them. */
export const KIT_FLAG_SCOPE = 'world';
export const KIT_FLAG_KEY = 'testKit';

/** The GM user the kit provisions in its world and joins as (passwordless, GAMEMASTER role). */
export const KIT_GM_USER = 'Kit GM';
/** A player user for player-side checks (passwordless, PLAYER role). */
export const KIT_PLAYER_USER = 'Kit Player';

/**
 * GM actions: the only way a scenario or the builder runs code inside Foundry. Each runs in the
 * GM page (lib/gm.mjs, Playwright `page.evaluate`) and has a twin in the fake (lib/fake/), so CI
 * can run every scenario without Foundry. Arguments and results are plain JSON.
 *
 * Add an action here, in lib/gm-actions.mjs and in the fake together.
 */
export const GM_ACTIONS = {
  /** () => {worldId, systemId, systemVersion, coreVersion, userName, isGM, moduleActive, moduleVersion} */
  worldStatus: 'worldStatus',
  /** () => {deleted: {Actor, Scene, Item, JournalEntry, Combat, Folder}} every doc carrying the kit flag */
  wipeKit: 'wipeKit',
  /** ({type, name}) => {folderId} a kit folder, reused when it exists */
  ensureFolder: 'ensureFolder',
  /**
   * ({packIds, type?, subtype?}) => {entries: [{packId, id, uuid, name, type, identifier, classIdentifier?,
   * rules: '2024'|'2014'|'', book: string}]} the index of those packs (names and ids only, no text).
   * `rules` from system.source.rules, `book` from system.source.book.
   * Additive: the reply also has `missing: string[]`, the packIds that are not installed.
   */
  listCompendium: 'listCompendium',
  /**
   * ({name, classUuid, subclassUuid?, level, rotation, speciesUuid?, backgroundUuid?, folderId, featPackIds?}) =>
   * {actorId, name, classIdentifier, subclassIdentifier, level, hp:{value,max},
   *  picks: [{level, advancement, title, chosen: string[]}], warnings: string[]}
   * Levels the hero through the system's advancement with no dialogs. Every choice picks option
   * index (rotation + k) % options for its k-th pick, so a matrix of heroes with different
   * rotations covers every option and a build is repeatable. Throws when the advancement fails.
   * k counts the hero's picks in the order the system asks (species, background, then class); an
   * ability score improvement alternates +2 (two +1 for odd rotations) and a general feat on the
   * same count. `featPackIds` (additive) are the packs to take those feats from; without them an
   * improvement is always taken. Species and background default to Human and Soldier of
   * dnd5e.origins24 when no uuid is given. A Trait choice the system could not offer (every option
   * already taken) is a warning "<item>: <title> level N: x of y choice(s) left, every option is already
   * taken"; a Trait advancement with no choices gets no pick of ours.
   * Additive (origins slice): `abilities` ({str..cha: number}) replaces the standard array; `speciesUuid` and `backgroundUuid`
   * are applied to a new hero (and to an existing one only when given); `chooseSize: true` answers a Size advancement
   * (option rotation % options, no k used; without it the system's default stays); `actorId` adds to an existing kit hero
   * instead of making one (no new actor, no default origins, and the actor is kept on failure); `classUuid` may then be
   * left out; `items: [{uuid, level?, subclassUuid?}]` are applied after the class through the same manager (a feat, or a
   * second class at `level`, which is how a hero multiclasses). The reply also has `classes: [{identifier, levels,
   * subclass}]` and `added: [{uuid, name, type}]`.
   */
  createHero: 'createHero',
  /**
   * ({classUuid, subclassUuid?, level}) => {expected} what the advancement data says a hero of that
   * level must have: {grants: [{level, uuid, name, resolved, optional, why?}], choices: [{level, advancement, count}],
   * scale: [{identifier, value}], saves: string[] (saving throw proficiencies the class grants),
   * hitDie, hpFixed: number (sum of max die at 1 and averages, without CON), spellcasting:
   * {progression, ability} | null, spellSlots: {leveled: {"1": n, ...}, pact: {max, level} | null} | null
   * (the system's own table for a single-class caster), skillsChosen: number, subclassAt}.
   * Additive fields: grants.resolved, grants.optional, grants.why (an unresolved grant's reason), saves, spellSlots.
   * Additive (origins slice): `multiclass: true` describes the class as a second class: the advancements marked primary-only
   * (saving throws, the first skill choice) are left out, the multiclass-only ones are in, and every hit die level is the average.
   */
  describeClass: 'describeClass',
  /**
   * ({actorId}) => {name, level, classes: [{identifier, levels, subclass}], hp:{value, max,
   * bonuses: {level, overall} (worked out), sources: [{item, keys}] (items whose effects change HP)},
   * abilities: {str..cha: {value, mod}}, items: [{name, type, sourceUuid, identifier}],
   * scale: {[classId]: {[identifier]: value}} (class and subclass values), spells: {spell1..spell9: {max},
   * pact: {max, level}}, skills: {[id]: proficient}, saves: {[id]: proficient},
   * saveSources: {[ability]: item names whose effects add that save}, ownership: {[userName]: level}}
   * Additive fields: hp.bonuses, hp.sources, saveSources, subclass scale values under the class.
   */
  inspectActor: 'inspectActor',
  /** ({actorId, userName, level}) => {ok: true} sets one user's ownership level (3 = owner) */
  setOwnership: 'setOwnership',
  /** ({name, folderId, width, height, grid, walls, doors, lights}) => {sceneId, name} creates and activates */
  createCombatScene: 'createCombatScene',
  /** ({sceneId, actorId, x, y, hidden?, name?}) => {tokenId} grid square coordinates, not pixels */
  placeToken: 'placeToken',
  /** ({sceneId, tokenIds}) => {combatId, combatantIds} a new combat on that scene, started; combatantIds follow the order of tokenIds */
  startCombat: 'startCombat',
  /** () => {ended: number} ends every combat on kit scenes */
  endCombats: 'endCombats',
  /**
   * ({actorId, sceneId?, tokenId?}) => {hp:{value,max,temp}, conditions:[...], name} straight from the
   * document. With sceneId and tokenId it reads that token's actor: an unlinked token has its own HP,
   * and a guarded damage change lands there, not on the world actor.
   */
  readActor: 'readActor',
  /** ({since?}) => {errors: [{at, message, source}]} console errors the GM page collected */
  consoleErrors: 'consoleErrors',
  /**
   * ({actorId}) => {name, level, prof, ac: {value, calc, armor}, hd: {value, max, classes: [{identifier,
   * denomination, levels, spent}]}, hp: {value, max}, abilities: {str..cha: {value, mod}}, spells: {spell1..spell9, pact:
   * {value, max, level, type}}, scale: {[classId]: {[identifier]: value}}, items: [{id, name, type, identifier,
   * sourceUuid, equipped, uses: {max, spent, recovery: [{period, type, formula}]} | null, activities: [{id, type, name,
   * activation, canUse, consumption: [{type, target, value}]}], effects: [{id, name, disabled, transfer, changes:
   * [{key, value, type}]}]}]} everything the feature scenarios need to know about one actor. Read only.
   * Additive (monster slice): each activity also has `activationValue` (number | null), and an npc actor has `npc`:
   * {cr, creatureType, size, ac, movement: {walk, fly, swim, burrow, climb, hover}, movementSource: {same, as stored},
   * resources: {legact: {max, spent} | null, legres: {max, spent} | null, lair: {value, initiative, inside} | null},
   * spell: {ability, dc}}.
   */
  inspectFeatures: 'inspectFeatures',
  /**
   * Runs something on an actor and always puts the actor back as it was (items' uses, slots, hit
   * points, hit dice, effects, new items and chat messages are all restored; `restored` and `drift` say
   * whether that worked). One of:
   * - ({actorId, op: 'use', itemId, activityId, consumeAction?}) => {ok, notes: [{level, message}], threw, chatCard,
   *   uses: {before, after, max}, spells: {key: {before, after}}, effects: [{name, changes}], itemsCreated,
   *   restored, drift}. Uses one activity with no dialog, no template, no roll and no action cost;
   *   the system's error notifications are collected in `notes`.
   *   `consumeAction: true` lets the system spend the action the activation stands for (a legendary action spends
   *   resources.legact when the activity has no consumption target of its own); default false.
   * - ({actorId, op: 'effect', itemId, effectId, enabled, read: [path]}) => {before, during, restored, drift}, each
   *   `{[path]: {value, resolved?}}` read from the actor before and with a copy of the effect on the actor (an item's
   *   effect applies to the actor as a copy, like the chat card's apply button; a Set comes back as an array).
   * - ({actorId, op: 'rest', type: 'short'|'long'}) => {type, afterSpend, afterRest, restored, drift}: every use,
   *   slot and hit die is spent and hit points set to 1, the rest is taken with no dialog, and both
   *   states are reported as {items: [{id, name, max, spent, recovery}], spells, hp, hd}.
   * - ({actorId, op: 'recharge', itemId, rolls?}) => {target, rolls: [{total, success, spentBefore, spentAfter}],
   *   restored, drift}: the item's uses are all spent, then the system's own recharge roll (d6 against
   *   the target, `uses.rollRecharge`) is made `rolls` times (default 6, uses spent again before each).
   * Additive (monster slice): an `op: 'use'` reply also has `changed`, the paths of actor.system the use changed
   * ({"resources.legact.spent": {before, after}}, at most 60), so a spent legendary action shows.
   */
  exerciseActor: 'exerciseActor',
  /**
   * ({packId, from?, count?}) => {packId, installed, total, skipped: {[actorType]: n}, from, entries: [{packId, id,
   * uuid, name, cr, creatureType, size, book, rules, hp, ac, movement: {walk, fly, swim, burrow, climb, hover (bool), units},
   * senses: {darkvision, blindsight, tremorsense, truesight, special (bool)}, languages: string[], resist: {dr, di,
   * dv, ci: string[], dm (bool)}, spell: {spells, ability, innate (bool), dc}, legact (max), legres (max), lair (bool),
   * items, activities, odd: {regeneration, shapechanger, damageThreshold, multiattack, innateSpellcasting (bool),
   * recharge, summon, transform, legendaryActivities, lairActivities (counts)}}]}
   * Reads the monsters (actors of type npc, sorted by name then id) of one compendium pack, `count` (default 100)
   * from `from`, as the facts the monster scenarios need. Names, numbers and flags only, no text. Read only.
   * `total` counts the npcs of the pack; `skipped` the other actor types (character, vehicle).
   */
  listMonsters: 'listMonsters',
  /**
   * ({packId, itemId, name?, folderId?}) => {actorId, name} a world copy of a compendium monster for a probe. It carries
   * the kit flag, so a rebuild wipes it when a run died before deleteMonsters. Name default "Probe <name>".
   */
  createMonster: 'createMonster',
  /** ({actorIds}) => {deleted: number, refused: string[]} deletes probe actors; refuses any actor that is not a probe (the flag createMonster sets) */
  deleteMonsters: 'deleteMonsters',
  /**
   * ({actorId}) => {name, level, items: [{type, name, identifier, sourceUuid, origin: {item, advancement, title} | null,
   * root, prepared, quantity, level (spells)}], advancements: [{item, id, type, title, level, value}], skills: {[id]: number},
   * saves: {[id]: boolean}, proficiencies: {languages, weapons, armor, tools, damageResistances, damageImmunities,
   * conditionImmunities}, senses, movement, size, hp: {max, bonuses}, ac: {value, calc}} what a build left on the
   * actor that inspectActor and inspectFeatures do not show: where each item came from (the advancement that made
   * it, by names and not by ids), what each advancement of the class, subclass, species and background holds, and
   * the proficiencies. Read only. The studio scenario compares two heroes with it.
   */
  inspectBuild: 'inspectBuild',
  /**
   * ({op: 'start', rotation, k?, subclassUuid?, featPackIds?} | {op: 'status'} | {op: 'stop'}) => {running, k, picks,
   * warnings, errors, answered, managersSeen, completed, lastStep, lastActivityAt} | null. A loop in the Foundry page
   * that answers the system's advancement dialogs while Actor Studio shows them in its window, with the same rotation
   * rule as createHero. `stop` ends it and returns what it picked. Used only by the studio scenario.
   */
  studioPump: 'studioPump',
  /**
   * ({actorId, name?, folderId?}) => {ok: true} marks an actor made outside the builder (by Actor Studio) as the
   * kit's own: the kit flag, the kit folder, a new name. A rebuild then wipes it.
   */
  adoptActor: 'adoptActor',
  /** ({actorId}) => {deleted: boolean} deletes an actor, only when it carries the kit flag. */
  deleteKitActor: 'deleteKitActor',
  /**
   * ({packIds, kind: 'species'|'background'|'feat'}) => {entries: [{packId, id, uuid, name, type, identifier, rules:
   * '2024'|'2014'|'', book, featType?}], missing: string[]} the species (item type race), backgrounds or feats (item
   * type feat whose type is "feat": class and species features are left out) of those packs, from the index (names and
   * ids, no text). `featType` is the feat's subtype: origin, general, fightingStyle or epicBoon (general when unset).
   */
  listOrigins: 'listOrigins',
  /**
   * ({uuid, actorId?}) => {name, type, rules, featType, movement: {walk, fly, ...} | null, senses: {darkvision, ...} | null,
   * creatureType, advancements: [{id, type, title, levels, classRestriction: 'primary'|'secondary'|'', grants?, choices?:
   * [{count, pool}], mode?, items?: [{uuid, name, resolved, optional, playerFeat}], optional?, itemChoices?: [{level, count}],
   * asi?: {points, cap, fixed, locked, max}, sizes?}], effects: [{name, transfer, disabled, changes}], activities:
   * [{type, name}], uses, startingEquipment, primaryAbility: string[], primaryAll (a class needs all of them), hitDie, spellcasting: {progression, ability} | null,
   * prerequisites: {level, repeatable} | null, actor?: {prerequisitesMet, detail}} what the data of one species,
   * background, feat or class says (facts only; names of the item's own grants). With `actorId` the reply also says
   * whether that actor meets a feat's prerequisites. Read only.
   */
  describeOrigin: 'describeOrigin',
  /**
   * ({actorId, name?, folderId?, abilityFloor?, drop?}) => {actorId, name} a copy of a kit hero (items and their advancement
   * origins included), so one host hero can take many feats, one after the other. `abilityFloor` raises every ability score
   * below it to it; `drop` is a list of item names to leave out of the copy. The copy carries the kit flag; deleteKitActor removes it. Refuses an actor without the kit flag.
   */
  cloneHero: 'cloneHero',
};

/**
 * @typedef {object} Scenario
 * @property {string} id            kebab-case, unique across all loaded scenario folders
 * @property {string} title         one line, shown in the report
 * @property {Array<'smoke'|'full'|'long'>} sizes
 * @property {string[]} tags        from {@link KIT_TAGS}
 * @property {boolean} [licensed]   true for scenarios that need licensed content (never in the repo)
 * @property {string[]} needs       manifest sections it relies on: 'heroes' | 'monsters' | 'scene'
 * @property {string[]} tools       every bridge tool it calls; CI checks each exists in tool-sets.ts
 * @property {string[]} [gmActions] every GM action it calls (keys of {@link GM_ACTIONS})
 * @property {number} [timeoutMs]   whole scenario, default 120000
 * @property {string[]} [knownConsoleErrors]  regular expressions (as text) for console errors the scenario reports itself;
 *   the runner does not blame them on the bridge module (the studio scenario reports Actor Studio's own errors)
 * @property {number} [order]       run order, lowest first (default 0; ties keep the file order). A scenario that floods
 *   the play log (the feature scenarios) goes last, so it cannot starve the ones that read the log.
 * @property {(t: ScenarioContext) => Promise<void>} run
 */

/**
 * @typedef {object} ScenarioContext
 * @property {(label: string, fn: () => Promise<unknown>, opts?: {continueOnFail?: boolean}) => Promise<unknown>} step
 *   One reported step. A failing step ends the scenario unless continueOnFail. Returns fn's value.
 * @property {(cond: unknown, message: string, details?: unknown) => void} check   throws a KitAssertion
 * @property {(actual: unknown, expected: unknown, message: string) => void} equal deep equality
 * @property {(reason: string) => never} skip    marks the current step (and scenario) skipped
 * @property {(name: string, args?: object, flags?: {confirm?: boolean, confirmDestructive?: boolean}) => Promise<any>} tool
 *   POST /api/tool; returns `result`; throws a KitToolError ({kind, status, error}) on failure
 * @property {{planApply: (planTool: string, args: object) => Promise<{planId: string, changeId: string, plan: any}>, undo: (changeId: string) => Promise<any>}} guarded
 * @property {(action: string, args?: object) => Promise<any>} gm   runs a {@link GM_ACTIONS} action
 * @property {{state: () => Promise<any>, html: () => Promise<string>}} player  /api/player/state and /player
 * @property {(path: string, opts?: {method?: string, body?: unknown}) => Promise<{status: number, data: any}>} http
 * @property {KitManifest} kit        what the builder made
 * @property {import('playwright-core').Page | null} page  the Foundry GM page, for a scenario that must click in a Foundry
 *   window (Actor Studio); null against the fake
 * @property {(message: string) => void} log
 * @property {(name: string, data: unknown) => void} attach   JSON attachment in the report
 * @property {(fn: () => Promise<void>) => void} cleanup     runs after the scenario, last in first out
 * @property {boolean} fake           true when running against the fake (CI)
 * @property {'smoke'|'full'|'long'} size   the kit size of this run (additive; scenarios that sample use it)
 */

/**
 * @typedef {object} KitManifest written by `kit build` to <kitHome>/worlds/<world>/manifest.json
 * @property {number} version         {@link KIT_FORMAT_VERSION}
 * @property {string} world
 * @property {string} builtAt         ISO time
 * @property {string} systemVersion
 * @property {Record<string, string>} folders   type -> folderId
 * @property {string} profile         the content profile id
 * @property {Array<{actorId: string, name: string, classIdentifier: string, level: number, tokenId?: string,
 *   classUuid: string, classRules: string, subclassUuid?: string, subclassIdentifier?: string, rules: string, book: string,
 *   role: 'tier'|'subclass', rotation: number, owner?: string, picks?: unknown[], warnings?: string[],
 *   buildError?: string}>} heroes
 *   A hero whose advancement failed keeps its row with buildError (and no actorId), so the report
 *   shows it instead of the build stopping.
 * @property {{classes: {found: number, built: number}, subclasses: {found: number, built: number, failed: string[]}, heroes: number}} coverage
 * @property {Array<{at: string, message: string, source: string}>} [consoleErrors]
 *   console errors of the GM page over the whole build (additive in version 2)
 * @property {Array<{actorId: string, name: string, cell: string, cr: number, type: string, size: string, packId: string, itemId: string, tokenId?: string}>} monsters
 * @property {{sceneId: string, name: string, width: number, height: number}} scene
 */

/**
 * @typedef {object} KitReport written as report.json (and report.md, report.html) per run
 * @property {number} version
 * @property {{size: string, target: {name: string, dashboard: string, foundry: string, world: string}, startedAt: string, finishedAt: string, durationMs: number, gitSha: string, node: string, fake: boolean}} run
 * @property {KitManifest | null} build
 * @property {{passed: number, failed: number, skipped: number, total: number}} summary
 * @property {Array<{at: string, message: string, source: string}>} consoleErrors
 * @property {ScenarioResult[]} scenarios
 *
 * @typedef {object} ScenarioResult
 * @property {string} id
 * @property {string} title
 * @property {string} file            path relative to its scenario folder (licensed paths stay local)
 * @property {boolean} licensed
 * @property {string[]} tags
 * @property {'pass'|'fail'|'skip'|'error'} status   error = the scenario threw outside a step
 * @property {number} durationMs
 * @property {StepResult[]} steps
 * @property {string[]} logs
 * @property {Array<{name: string, data: unknown}>} attachments
 *
 * @typedef {object} StepResult
 * @property {string} label
 * @property {'pass'|'fail'|'skip'} status
 * @property {number} durationMs
 * @property {string} [detail]
 * @property {{message: string, kind?: string, reply?: unknown}} [error]
 */

/** Exit codes, as the live scripts use them. */
export const EXIT = { PASS: 0, FAIL: 1, ENV: 2 };

const ID_RE = /^[a-z0-9][a-z0-9-]{1,63}$/;

/**
 * Problems with a scenario's shape (not its behaviour), as strings; empty when it is valid.
 * @param {unknown} s
 * @returns {string[]}
 */
export function validateScenario(s) {
  const problems = [];
  if (!s || typeof s !== 'object') return ['default export is not an object'];
  const sc = /** @type {Record<string, unknown>} */ (s);
  if (typeof sc.id !== 'string' || !ID_RE.test(sc.id)) problems.push('id must be kebab-case');
  if (typeof sc.title !== 'string' || !sc.title.trim()) problems.push('title is missing');
  if (!Array.isArray(sc.sizes) || !sc.sizes.length || sc.sizes.some(x => !KIT_SIZES.includes(x)))
    problems.push(`sizes must be a non-empty subset of ${KIT_SIZES.join(', ')}`);
  if (!Array.isArray(sc.tags) || sc.tags.some(x => !KIT_TAGS.includes(x)))
    problems.push(`tags must come from ${KIT_TAGS.join(', ')}`);
  if (!Array.isArray(sc.needs) || sc.needs.some(x => !['heroes', 'monsters', 'scene'].includes(x)))
    problems.push('needs must list heroes, monsters or scene');
  if (!Array.isArray(sc.tools) || sc.tools.some(x => typeof x !== 'string'))
    problems.push('tools must list tool names');
  if (
    sc.gmActions !== undefined &&
    (!Array.isArray(sc.gmActions) || sc.gmActions.some(x => !(x in GM_ACTIONS)))
  )
    problems.push('gmActions must be keys of GM_ACTIONS');
  if (sc.licensed !== undefined && typeof sc.licensed !== 'boolean')
    problems.push('licensed must be boolean');
  if (sc.timeoutMs !== undefined && (typeof sc.timeoutMs !== 'number' || sc.timeoutMs <= 0))
    problems.push('timeoutMs must be a positive number');
  if (
    sc.knownConsoleErrors !== undefined &&
    (!Array.isArray(sc.knownConsoleErrors) ||
      sc.knownConsoleErrors.some(x => {
        try {
          new RegExp(x);
          return typeof x !== 'string';
        } catch {
          return true;
        }
      }))
  )
    problems.push('knownConsoleErrors must be a list of regular expressions (text)');
  if (sc.order !== undefined && typeof sc.order !== 'number')
    problems.push('order must be a number');
  if (typeof sc.run !== 'function') problems.push('run must be a function');
  return problems;
}
