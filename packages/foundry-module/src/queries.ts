import type { BridgeRefusal } from '@gnuminator/shared';
import { MODULE_ID } from './constants.js';
import { bridgeHandlers } from './bridge-handlers.js';
import { FoundryDataAccess } from './data-access.js';
import { gateWriteHandlers } from './write-gate.js';
import { registerActorAuthoringHandlers } from './queries/actor-authoring.js';
import { registerActorHandlers } from './queries/actors.js';
import { registerChatRollHandlers } from './queries/chat-rolls.js';
import { registerCombatHandlers } from './queries/combat.js';
import { registerCompendiumHandlers } from './queries/compendium.js';
import type { QueryContext } from './queries/context.js';
import { registerDiagnosticsHandlers } from './queries/diagnostics.js';
import { registerGuardedHandlers } from './queries/guarded.js';
import { registerJournalHandlers } from './queries/journals.js';
import { registerRecordHandlers } from './queries/records.js';
import { registerSceneHandlers } from './queries/scenes.js';

/**
 * The bridge's query router. The handlers themselves live in `queries/<domain>.ts`; each file
 * has a registration table at its top that names every wire method with its kind (`write`,
 * `recordless-write` or `read`, see `BridgeHandlerKind` in bridge-handlers.ts). This class
 * holds the shared state (the data access, the GM gate) the domain files use through
 * {@link QueryContext}.
 */
export class QueryHandlers implements QueryContext {
  public dataAccess: FoundryDataAccess;

  constructor() {
    this.dataAccess = new FoundryDataAccess();
  }

  /**
   * SECURITY: Validate access - returns silent failure for disallowed users.
   * The GM (or Assistant GM) is always allowed; the `allowNonGmAccess` setting
   * (default off) additionally permits the non-GM user running this client.
   * Handlers are only reachable through the socket bridge (see bridge-handlers.ts).
   */
  validateGMAccess(): { allowed: boolean; error?: unknown } {
    if (game.user?.isGM || this.allowNonGmAccess()) {
      return { allowed: true };
    }
    // Silent failure - no error message for disallowed users
    return { allowed: false };
  }

  /** Whether non-GM callers are permitted (read defensively for early boot/tests). */
  private allowNonGmAccess(): boolean {
    try {
      return game.settings.get(MODULE_ID, 'allowNonGmAccess') === true;
    } catch {
      return false;
    }
  }

  /**
   * Shared wrapper for the GM-gated query handlers. Reproduces the convention
   * shared by ~80 handlers exactly: silent GM gate (non-GM callers get an
   * access-denied object and the body never runs) → validateFoundryState →
   * run the handler body → wrap any throw as `<errorPrefix>: <message>`.
   *
   * Handlers that diverge from this shape stay bespoke: `ping` (ungated) and
   * `createJournalEntry` (no validateFoundryState).
   */
  async withGmGate<T>(errorPrefix: string, body: () => Promise<T>): Promise<T | BridgeRefusal> {
    const gmCheck = this.validateGMAccess();
    if (!gmCheck.allowed) {
      return { error: 'Access denied', success: false as const };
    }
    try {
      this.dataAccess.validateFoundryState();
      return await body();
    } catch (error) {
      throw new Error(
        `${errorPrefix}: ${error instanceof Error ? error.message : 'Unknown error'}`,
        { cause: error }
      );
    }
  }

  /**
   * Register all bridge handlers in the module-private table
   * ({@link bridgeHandlers}), which only the socket bridge dispatches from.
   * SECURITY: never register these in `CONFIG.queries`: Foundry relays queries
   * from any user holding "Query Users" (Player by default) to the GM's client.
   */
  registerHandlers(): void {
    const handlers = bridgeHandlers;

    registerDiagnosticsHandlers(this, handlers);
    registerGuardedHandlers(this, handlers);
    registerActorHandlers(this, handlers);
    registerActorAuthoringHandlers(this, handlers);
    registerCompendiumHandlers(this, handlers);
    registerSceneHandlers(this, handlers);
    registerCombatHandlers(this, handlers);
    registerJournalHandlers(this, handlers);
    registerChatRollHandlers(this, handlers);
    registerRecordHandlers(this, handlers);

    // P-036: every write kind refuses while "Allow Write Operations" is off (write-gate.ts).
    // Last, so it wraps everything registered above.
    gateWriteHandlers(handlers);
  }

  /**
   * Unregister all query handlers
   */
  unregisterHandlers(): void {
    bridgeHandlers.deleteByPrefix(`${MODULE_ID}.`);
  }

  /**
   * Handle query requests from other parts of the module
   */
  async handleQuery(queryName: string, data: unknown): Promise<unknown> {
    try {
      const handler = bridgeHandlers.get(queryName);
      if (!handler) {
        throw new Error(`Query handler not found: ${queryName}`);
      }

      return await handler(data);
    } catch (error) {
      console.error(`[${MODULE_ID}] Query failed: ${queryName}`, error);
      return {
        error: error instanceof Error ? error.message : 'Unknown error',
        success: false,
      };
    }
  }

  /**
   * Get list of all registered query methods
   */
  getRegisteredMethods(): string[] {
    const prefix = `${MODULE_ID}.`;
    return bridgeHandlers
      .methods()
      .filter(key => key.startsWith(prefix))
      .map(key => key.slice(prefix.length));
  }

  /**
   * Test if a specific query handler is registered
   */
  isMethodRegistered(method: string): boolean {
    return bridgeHandlers.has(`${MODULE_ID}.${method}`);
  }
}
