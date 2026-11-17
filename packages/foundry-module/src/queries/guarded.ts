/**
 * Bridge handlers for guarded writes (plan/apply/undo): the backend plans and audits; these
 * run the Foundry side (snapshot, checked apply/undo, feed event, feature list). They are
 * registered as `read` because `applyGuardedOps` keeps its own gate, which also checks the
 * feature switches (see write-gate.ts).
 */
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { announceAiChangesUpdated } from '../ai-changes-signal.js';
import {
  applyGuardedOps,
  guardedApplyOutcome,
  logGmChange,
  snapshotGuardedOps,
} from '../data-access/guarded-write.js';
import { listGuardedFeatures } from '../guarded-features.js';
import type { QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerGuardedHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  table.on(`${MODULE_ID}.snapshotGuardedOps`, 'read', (data: { ops?: unknown } | undefined) =>
    ctx.withGmGate('Failed to snapshot planned change', () => snapshotGuardedOps(data?.ops))
  );
  table.on(`${MODULE_ID}.applyGuardedOps`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to apply planned change', () => applyGuardedOps(data))
  );
  table.on(`${MODULE_ID}.guardedApplyOutcome`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to read the apply outcome', () =>
      Promise.resolve(guardedApplyOutcome(data))
    )
  );
  table.on(`${MODULE_ID}.logGmChange`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to log change', () => Promise.resolve(logGmChange(data)))
  );
  // The backend recorded an apply or undo: tell the GM clients' "Changes" windows (I-108).
  table.on(`${MODULE_ID}.aiChangesUpdated`, 'read', () =>
    ctx.withGmGate('Failed to announce the change', () => {
      announceAiChangesUpdated();
      return Promise.resolve({ announced: true });
    })
  );
  table.on(`${MODULE_ID}.listGuardedFeatures`, 'read', () =>
    ctx.withGmGate('Failed to list features', () => Promise.resolve(listGuardedFeatures()))
  );
}
