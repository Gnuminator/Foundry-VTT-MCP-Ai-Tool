import { bridgeHandlers, type BridgeHandlerKind } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { QueryHandlers } from '../queries.js';
import { createTestWorld } from './foundry-mock/index.js';

/**
 * The kind a bridge method is registered with (`write`, `recordless-write` or `read`), read
 * from the real registration in `queries/<domain>.ts`. `method` is the name without the
 * module prefix. Undefined when nothing is registered under that name.
 */
export function handlerKind(method: string): BridgeHandlerKind | undefined {
  // QueryHandlers builds its data access, which needs the Foundry globals.
  const restore = createTestWorld().install();
  try {
    new QueryHandlers().registerHandlers();
  } finally {
    restore();
  }
  return bridgeHandlers.kindOf(`${MODULE_ID}.${method}`);
}
