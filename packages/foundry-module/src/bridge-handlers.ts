/**
 * Private dispatch table for the bridge's query handlers.
 *
 * The handlers used to be registered in Foundry's `CONFIG.queries`. Foundry
 * relays a query from any user who holds the core "Query Users" permission
 * (Player role by default) to any other user and runs whatever handler is
 * registered under that name, with no allowlist. So any player could run every
 * bridge handler on the GM's client, e.g.
 * `game.users.activeGM.query('foundry-mcp-bridge.applyGuardedOps', ...)`.
 *
 * The handlers now live in this module-private table. Only the socket bridge
 * (the authenticated link to the backend) dispatches from it; nothing here is
 * reachable through Foundry's query relay. The wire method names
 * (`foundry-mcp-bridge.<method>`) are unchanged.
 */

import type {
  BridgeAnswer,
  BridgeMethod,
  BridgeRequest,
  UntypedBridgeMethod,
} from '@gnuminator/shared';

/**
 * A bridge handler: receives the query payload, returns the result. Payloads
 * are untyped wire data; each handler declares and validates its own shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export type BridgeHandler = (data: any) => unknown;

/**
 * A handler for a method of the bridge contract (`shared/src/bridge-queries.ts`): the
 * compiler checks its reply against the contract. The request is what the backend sends;
 * a handler that validates wire data itself may still take `unknown`.
 */
export type TypedBridgeHandler<M extends BridgeMethod> = (
  data: BridgeRequest<M>
) => BridgeAnswer<M> | Promise<BridgeAnswer<M>>;

/**
 * What a handler does to the world. The write gate (write-gate.ts) reads this:
 * - `write`: changes the world and makes a change-journal record; refused while "Allow Write
 *   Operations" is off, and ends the change group first.
 * - `recordless-write`: changes the world (chat, rolls, playlists, a page popup, a notice, a
 *   folder, a portrait file) but makes no journal record; refused the same way and does not
 *   break the change group.
 * - `read`: does not change the world (reads, plans, the guarded-write plumbing that has its own
 *   gate, the GM feed line, opening a sheet, clearing the local error list).
 */
export type BridgeHandlerKind = 'write' | 'recordless-write' | 'read';

export class BridgeHandlerTable {
  private readonly handlers = new Map<string, BridgeHandler>();
  private readonly kinds = new Map<string, BridgeHandlerKind>();

  /** Register a handler for a method of the bridge contract. */
  on<M extends BridgeMethod>(
    method: M,
    kind: BridgeHandlerKind,
    handler: TypedBridgeHandler<M>
  ): void {
    this.handlers.set(method, handler as BridgeHandler);
    this.kinds.set(method, kind);
  }

  /** Register a handler for a method the contract does not type yet. */
  set<M extends string>(
    method: UntypedBridgeMethod<M>,
    kind: BridgeHandlerKind,
    handler: BridgeHandler
  ): void {
    this.handlers.set(method, handler);
    this.kinds.set(method, kind);
  }

  get(method: string): BridgeHandler | undefined {
    return this.handlers.get(method);
  }

  /** The kind a method was registered with. */
  kindOf(method: string): BridgeHandlerKind | undefined {
    return this.kinds.get(method);
  }

  /** Registered method names (full wire names) of the given kinds. */
  methodsOfKind(...kinds: BridgeHandlerKind[]): string[] {
    return [...this.kinds].filter(([, k]) => kinds.includes(k)).map(([m]) => m);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  /** Remove every handler whose method name starts with `prefix`. */
  deleteByPrefix(prefix: string): void {
    for (const method of [...this.handlers.keys()]) {
      if (method.startsWith(prefix)) {
        this.handlers.delete(method);
        this.kinds.delete(method);
      }
    }
  }

  /** All registered method names (full wire names). */
  methods(): string[] {
    return [...this.handlers.keys()];
  }
}

/** The module's single handler table, shared by `QueryHandlers` and `SocketBridge`. */
export const bridgeHandlers = new BridgeHandlerTable();
