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

/**
 * A bridge handler: receives the query payload, returns the result. Payloads
 * are untyped wire data; each handler declares and validates its own shape.
 */
// eslint-disable-next-line @typescript-eslint/no-explicit-any -- see above
export type BridgeHandler = (data: any) => unknown;

export class BridgeHandlerTable {
  private readonly handlers = new Map<string, BridgeHandler>();

  set(method: string, handler: BridgeHandler): void {
    this.handlers.set(method, handler);
  }

  get(method: string): BridgeHandler | undefined {
    return this.handlers.get(method);
  }

  has(method: string): boolean {
    return this.handlers.has(method);
  }

  /** Remove every handler whose method name starts with `prefix`. */
  deleteByPrefix(prefix: string): void {
    for (const method of [...this.handlers.keys()]) {
      if (method.startsWith(prefix)) this.handlers.delete(method);
    }
  }

  /** All registered method names (full wire names). */
  methods(): string[] {
    return [...this.handlers.keys()];
  }
}

/** The module's single handler table, shared by `QueryHandlers` and `SocketBridge`. */
export const bridgeHandlers = new BridgeHandlerTable();
