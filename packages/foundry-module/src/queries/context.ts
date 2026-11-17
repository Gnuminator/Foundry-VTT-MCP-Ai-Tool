import type { BridgeRefusal } from '@gnuminator/shared';
import type { FoundryDataAccess } from '../data-access.js';

/**
 * What the domain files in this folder need from {@link QueryHandlers} (../queries.ts):
 * the data access (read lazily on every call, because tests replace it after construction)
 * and the shared GM-gate wrapper. `QueryHandlers` implements this and passes itself in.
 */
export interface QueryContext {
  readonly dataAccess: FoundryDataAccess;
  /** Silent GM gate, validateFoundryState, run the body, wrap any throw as `<prefix>: <message>`. */
  withGmGate<T>(errorPrefix: string, body: () => Promise<T>): Promise<T | BridgeRefusal>;
  /** SECURITY: whether the caller may use the bridge handlers (GM, or non-GM when allowed). */
  validateGMAccess(): { allowed: boolean; error?: unknown };
}

/**
 * Bind a domain handler function to the context, for the registration tables. The wire data
 * keeps the handler's own parameter type (the table's `any` payload is never passed on).
 */
export function withCtx<D, R>(
  ctx: QueryContext,
  fn: (ctx: QueryContext, data: D) => R
): (data: D) => R {
  return data => fn(ctx, data);
}

/** First argument of a FoundryDataAccess method: the wire payload shape its handler forwards. */
export type DataArg<K extends keyof FoundryDataAccess> = FoundryDataAccess[K] extends (
  arg: infer A,
  ...rest: never[]
) => unknown
  ? A
  : never;
