/**
 * The tool module contract (R9): one object per tool family that says how to build the family's
 * instance, which MCP tool definitions it lists and which `call_tool` routes it answers. The
 * backend, the router, the tool list and the test stub are all derived from the static list in
 * `tools/index.ts`, so a new tool family is one module file plus one line there.
 *
 * Type-only imports: the stdio wrapper loads tool-router.ts, which must not pull in the tool
 * classes, so this file stays free of runtime imports.
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
import type { ToolCallContext, ToolDefinitionLike } from '../tool-router.js';
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

export interface ToolModule<T> {
  /** Unique, stable id of the family (the file name), for errors and tests. */
  id: string;
  create: (ctx: ToolContext) => T;
  /** The MCP tool definitions the family lists, in its own order, without hints. */
  definitions: (tools: T) => ToolDefinitionLike[];
  /** One route per tool name the family answers. */
  routes: Readonly<Record<string, ToolRoute<T>>>;
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
  const get = <T>(module: ToolModule<T>): T => build(module) as T;
  const ctx: ToolContext = { services, use: get };
  for (const module of modules) build(module);
  return { modules, get };
}
