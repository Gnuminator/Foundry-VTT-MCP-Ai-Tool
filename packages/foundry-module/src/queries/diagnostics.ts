/**
 * Bridge handlers for the world, module troubleshooting and the test helpers: ping, world
 * info, installed modules and their errors, the Foundry setup, the live write sweep and
 * "Ready for session".
 */
import type { BridgePingReply } from '@gnuminator/shared';
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { getSetupInfo } from '../data-access/setup-info.js';
import { LIVE_SWEEP_QUERY, liveSweep } from '../live-sweep.js';
import { SESSION_SWITCHES_QUERY, sessionSwitches } from '../session-switches.js';
import { withCtx, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerDiagnosticsHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Utility: ping is ungated (no GM check), by design
  table.on(`${MODULE_ID}.ping`, 'read', () => ping());
  table.set(`${MODULE_ID}.getWorldInfo`, 'read', () => getWorldInfo(ctx));

  // Diagnostics (module troubleshooting)
  table.set(`${MODULE_ID}.getModules`, 'read', withCtx(ctx, getModules));
  table.set(`${MODULE_ID}.getSetupInfo`, 'read', withCtx(ctx, getSetupInfoHandler));
  table.set(`${MODULE_ID}.getModuleErrors`, 'read', withCtx(ctx, getModuleErrors));
  table.set(`${MODULE_ID}.clearModuleErrors`, 'read', () => clearModuleErrors(ctx));
  table.set(`${MODULE_ID}.getModuleManifest`, 'read', withCtx(ctx, getModuleManifest));

  // Live write sweep helper (I-016): scene snapshot, a sweep combat and the clean-up for
  // `scripts/live-write-sweep.mjs`, in the test world only (live-sweep.ts refuses any other
  // world). Not an MCP tool.
  table.set(`${MODULE_ID}.${LIVE_SWEEP_QUERY}`, 'write', (data: unknown) =>
    ctx.withGmGate('Live sweep helper failed', () => liveSweep(data))
  );

  // Ready for session (D3, PB-17): the dashboard's GM route turns tonight's switches on and
  // End session turns them off again. Not an MCP tool (the control method `session_switches`),
  // so Claude can never switch on its own writes. It sets the switches themselves, so it must
  // work while "Allow Write Operations" is off: read kind. GM client only.
  table.set(`${MODULE_ID}.${SESSION_SWITCHES_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Session switches failed', () => sessionSwitches(data))
  );
}

/**
 * Handle ping request
 */
function ping(): Promise<BridgePingReply> {
  return Promise.resolve({
    status: 'ok',
    timestamp: Date.now(),
    module: MODULE_ID,
    foundryVersion: game.version,
    worldId: game.world?.id,
    userId: game.user?.id,
  });
}

/**
 * Handle get world info request
 */
async function getWorldInfo(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to get world info', async () => {
    return await ctx.dataAccess.getWorldInfo();
  });
}

async function getModules(
  ctx: QueryContext,
  data: {
    activeOnly?: boolean;
    withIssuesOnly?: boolean;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get modules', async () => {
    return await ctx.dataAccess.getModules(data || {});
  });
}

async function getSetupInfoHandler(ctx: QueryContext, data: unknown): Promise<unknown> {
  return ctx.withGmGate('Failed to read the Foundry setup', async () => getSetupInfo(data));
}

async function getModuleErrors(
  ctx: QueryContext,
  data: {
    level?: 'error' | 'warn';
    moduleId?: string;
    sinceTimestamp?: string;
    limit?: number;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get module errors', async () => {
    return await ctx.dataAccess.getModuleErrors(data || {});
  });
}

async function clearModuleErrors(ctx: QueryContext): Promise<unknown> {
  return ctx.withGmGate('Failed to clear module errors', async () => {
    return await ctx.dataAccess.clearModuleErrors();
  });
}

async function getModuleManifest(ctx: QueryContext, data: { moduleId: string }): Promise<unknown> {
  return ctx.withGmGate('Failed to get module manifest', async () => {
    if (!data?.moduleId) throw new Error('moduleId is required');
    return await ctx.dataAccess.getModuleManifest(data);
  });
}
