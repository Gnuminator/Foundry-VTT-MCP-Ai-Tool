/**
 * The tool module contract (R9, R10): one object per tool family that says how to build the
 * family's instance, which MCP tool definitions it lists, which `call_tool` routes it answers,
 * and each tool's set and hints. The backend, the router, the tool list, the test stub, the tool
 * sets (tool-sets.ts) and the hints (tool-hints.ts) are all derived from the static list in
 * `tools/index.ts`, so a new tool family is one module file plus one line there.
 *
 * Type-only imports: tool-sets.ts and tool-hints.ts read the modules, so this file must not
 * import them (or anything else) at runtime.
 */
import type { FoundryClient } from '../foundry-client.js';
import type { GameEventHub } from '../game-event-hub.js';
import type { GuardedWriteService } from '../guarded-write/service.js';
import type { UndoPlanner } from '../guarded-write/undo-planner.js';
import type { ChangeHistory } from '../change-history.js';
import type { HandoutsService } from '../handouts/service.js';
import type { Logger } from '../logger.js';
import type { SecretTermsService } from '../secret-terms.js';
import type { SystemRegistry } from '../systems/system-registry.js';
import type { TarokkaService } from '../tarokka/service.js';
import type { VaultStore, WorldIdResolver } from '../vault/index.js';
import type { ToolHintSpec } from '../tool-hints.js';
import type { ToolCallContext, ToolDefinitionLike } from '../tool-router.js';
import type { ToolSetName } from '../tool-sets.js';
import type { ObsidianMirrorToolsOptions } from './obsidian-mirror.js';
import type { PlaySessionToolsOptions } from './play-session.js';
import type { PreflightToolsOptions } from './preflight.js';

/**
 * Everything a tool family may need that is not another tool family. backend.ts builds these
 * before any tool; the test stub fills them with empty stand-ins (definitions never touch them).
 */
export interface ToolServices {
  foundryClient: FoundryClient;
  logger: Logger;
  /** Optional so the test stub can leave it out, as the tools allow. */
  systemRegistry?: SystemRegistry | undefined;
  /** wait-for-game-event sleeps on it; the event pumps publish to it. */
  gameEventHub: GameEventHub;
  guardedWrites: GuardedWriteService;
  worldIds: WorldIdResolver;
  store: VaultStore;
  changeHistory: ChangeHistory;
  undoPlanner: UndoPlanner;
  tarokka: TarokkaService;
  secretTerms: SecretTermsService;
  handouts: HandoutsService;
  /** Called after mark-play-session records a marker (re-renders the Obsidian notes). */
  onPlaySessionMarked: NonNullable<PlaySessionToolsOptions['onMarked']>;
  wrapperStatus: NonNullable<PreflightToolsOptions['wrapperStatus']>;
  pumpHealth: NonNullable<PreflightToolsOptions['pumpHealth']>;
  /** FOUNDRY_AI_OBSIDIAN_DIR, or null when unset. */
  obsidianVaultDir: string | null;
  /** Where the voice pipeline writes session folders (FVTT_SESSIONS_DIR or the default). */
  sessionsDir: string;
  mirrorStatus: ObsidianMirrorToolsOptions['status'];
  mirrorEnv: NonNullable<ObsidianMirrorToolsOptions['env']>;
  /** The player set's extra deny terms from the Pi config, read at each call. */
  playerExtraDenyTerms: () => readonly string[];
}

/** What a module's `create` gets: the services, and the instance of any other module. */
export interface ToolContext {
  services: ToolServices;
  /** The (single, shared) instance of another module, built on first use. */
  use: <U>(module: ToolModule<U>) => U;
}

/** One `call_tool` route: the family's instance, the call's arguments and its context. */
export type ToolRoute<T> = (tools: T, args: unknown, context?: ToolCallContext) => Promise<unknown>;

/**
 * What every tool says about itself besides its definition: the one tool set it belongs to
 * (tool-sets.ts, PB-12) and its MCP hints (tool-hints.ts, I-124: a short title and read, write
 * or destructive).
 */
export interface ToolMeta extends ToolHintSpec {
  set: ToolSetName;
}

export interface ToolModule<T> {
  /** Unique, stable id of the family (the file name), for errors and tests. */
  id: string;
  create: (ctx: ToolContext) => T;
  /** The MCP tool definitions the family lists, in its own order, without hints. */
  definitions: (tools: T) => ToolDefinitionLike[];
  /** One route per tool name the family answers. */
  routes: Readonly<Record<string, ToolRoute<T>>>;
  /**
   * Set and hints of each tool, in the order of `definitions` (the tool catalog test checks the
   * names and the order), so the set lists follow the tool list Claude receives.
   */
  tools: Readonly<Record<string, ToolMeta>>;
}

/**
 * Any tool module, its instance type erased: what lists of modules hold. A `ToolModule<X>` is
 * assignable to it; read an instance back through `ToolInstances.get`.
 */
export interface AnyToolModule {
  id: string;
  create: (ctx: ToolContext) => unknown;
  definitions: (tools: never) => ToolDefinitionLike[];
  routes: Readonly<Record<string, ToolRoute<never>>>;
  tools: Readonly<Record<string, ToolMeta>>;
}

/** Identity helper so a module literal infers its instance type. */
export function defineToolModule<T>(module: ToolModule<T>): ToolModule<T> {
  return module;
}

/** Built tool instances, one per module, and the module list they came from. */
export interface ToolInstances {
  /** In tools/list order. */
  modules: readonly AnyToolModule[];
  get: <T>(module: ToolModule<T>) => T;
}

/** The instance of an erased module, typed to fit its own `definitions` and `routes`. */
export function instanceOf(tools: ToolInstances, module: AnyToolModule): never {
  return tools.get(module as ToolModule<unknown>) as never;
}

/**
 * Build one instance per module (and per module another one asks for through `use`), each
 * exactly once. Construction order follows first use, so a family can depend on another family
 * listed after it (character uses rules-check).
 */
export function createToolInstances(
  services: ToolServices,
  modules: readonly AnyToolModule[]
): ToolInstances {
  const built = new Map<AnyToolModule, unknown>();
  const building = new Set<AnyToolModule>();
  const ids = new Set<string>();
  for (const module of modules) {
    if (ids.has(module.id)) throw new Error(`Duplicate tool module id: ${module.id}`);
    ids.add(module.id);
  }
  const build = (module: AnyToolModule): unknown => {
    if (built.has(module)) return built.get(module);
    if (building.has(module)) throw new Error(`Tool module cycle at: ${module.id}`);
    building.add(module);
    const instance = module.create(ctx);
    building.delete(module);
    built.set(module, instance);
    return instance;
  };
  // `use` inside `create` may reach a module outside the list (built lazily); the returned `get`
  // may not, so a typo or a forgotten line in tools/index.ts fails loudly.
  const use = <T>(module: ToolModule<T>): T => build(module) as T;
  const listed = new Set<AnyToolModule>(modules);
  const get = <T>(module: ToolModule<T>): T => {
    if (!listed.has(module)) {
      throw new Error(`Tool module not in the list: ${module.id}`);
    }
    return use(module);
  };
  const ctx: ToolContext = { services, use };
  for (const module of modules) build(module);
  return { modules, get };
}
