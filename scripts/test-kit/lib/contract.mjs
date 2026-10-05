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
export const KIT_FORMAT_VERSION = 1;

/** Kit sizes, smallest first (plan: "Three sizes"). A scenario lists the sizes that include it. */
export const KIT_SIZES = ['smoke', 'full', 'long'];

/** Areas a scenario exercises; the report groups by them. */
export const KIT_TAGS = ['bridge', 'module', 'dashboard', 'player', 'vault', 'playlog', 'build'];

/**
 * Worlds the kit may build in and write to. Never a real campaign, never `ai-tool-test` (the
 * everyday test world) and never `ai-tool-kit` (the hand-made licensed import world).
 */
export const KIT_WORLDS = ['ai-tool-kit-srd'];

/** The kit's own world. */
export const DEFAULT_KIT_WORLD = 'ai-tool-kit-srd';

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
  /** ({name, classId, level, speciesId?, backgroundId?, folderId}) => {actorId, name, classIdentifier, level, hp:{value,max}} */
  createHero: 'createHero',
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
 * @property {(message: string) => void} log
 * @property {(name: string, data: unknown) => void} attach   JSON attachment in the report
 * @property {(fn: () => Promise<void>) => void} cleanup     runs after the scenario, last in first out
 * @property {boolean} fake           true when running against the fake (CI)
 */

/**
 * @typedef {object} KitManifest written by `kit build` to <kitHome>/worlds/<world>/manifest.json
 * @property {number} version         {@link KIT_FORMAT_VERSION}
 * @property {string} world
 * @property {string} builtAt         ISO time
 * @property {string} systemVersion
 * @property {Record<string, string>} folders   type -> folderId
 * @property {Array<{actorId: string, name: string, classIdentifier: string, level: number, tokenId?: string}>} heroes
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
  if (typeof sc.run !== 'function') problems.push('run must be a function');
  return problems;
}
