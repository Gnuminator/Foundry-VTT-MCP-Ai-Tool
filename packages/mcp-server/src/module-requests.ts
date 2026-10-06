/**
 * Backend side of the "AI changes" window inside Foundry (I-108): what answers a
 * `module-request` frame, and what tells the module a change was recorded.
 *
 * Kept out of `backend.ts` so both can be tested without starting the backend.
 */
import { MODULE_REQUEST_TOOLS, type ModuleRequestData } from '@gnuminator/shared';
import type { GuardedWriteService, RecordedListener } from './guarded-write/service.js';
import { HANDOUTS_FEATURE } from './handouts/service.js';
import type { ModuleRequestHandler } from './foundry-connector.js';
import type { Logger } from './logger.js';
import { TAROKKA_FEATURE } from './tarokka/service.js';
import type { ToolHandler } from './tool-router.js';
import type { GuardedChangeTools } from './tools/guarded-changes.js';

/** The module query that makes every GM client's "AI changes" window fetch the list again. */
export const AI_CHANGES_UPDATED_QUERY = 'foundry-mcp-bridge.aiChangesUpdated';

/** How long the announce may take; it is a fire-and-forget nudge. */
const ANNOUNCE_TIMEOUT_MS = 5_000;

/** The GM's name for the audit entry (the Foundry user that clicked, not the browser that holds the link). */
export function requesterLabel(requestedBy: ModuleRequestData['requestedBy']): string {
  return requestedBy.userName || requestedBy.userId;
}

/**
 * The planners a module request may run, with what each is allowed to do. A plan only
 * changes the game once it is applied, and a module request may apply only a plan one
 * of these planners made (see {@link createModuleRequestHandler}). A planner with no
 * `actions` has no action argument to narrow (the Tarokka reveal is one write).
 */
export const MODULE_PLANNERS: Readonly<
  Record<string, { feature: string; actions?: readonly string[] }>
> = {
  // Reveal the next queued handout, or take one off the queue. "reveal", "hide" and "queue"
  // stay with Claude and the dashboard.
  'plan-page-reveal': { feature: HANDOUTS_FEATURE, actions: ['reveal-next', 'unqueue'] },
  // Reveal one Tarokka position with the text the GM typed. Linking, dealing and importing
  // stay with Claude and the dashboard.
  'plan-tarokka-reveal': { feature: TAROKKA_FEATURE },
};

/** The arguments of `apply-planned-change` a module request passes on (nothing else). */
const APPLY_ARGS = ['planId', 'confirm', 'confirmDestructive'] as const;

/** How many plan ids made through module requests are remembered. */
const MAX_REMEMBERED_PLANS = 200;

export interface ModuleRequestDeps {
  toolRouter: Record<string, ToolHandler>;
  guardedChangeTools: Pick<GuardedChangeTools, 'handleUndoChange' | 'handleApplyPlannedChange'>;
  guardedWrites: Pick<GuardedWriteService, 'getPlan'>;
}

/**
 * Dispatch for `module-request` frames: the same in-process tools the control
 * channel runs. The connector already checks the allowlist; it is checked again
 * here so a later caller of `setModuleRequestHandler` cannot reach a write tool.
 * Writes are narrow: a planner only for the actions in {@link MODULE_PLANNERS}, an
 * apply only for a plan such a planner made through a module request (and whose
 * feature still matches), an undo for any change. Apply and undo carry who asked
 * into the audit entry.
 */
export function createModuleRequestHandler(deps: ModuleRequestDeps): ModuleRequestHandler {
  const plannedHere = new Set<string>();
  const remember = (plan: unknown): void => {
    const planId = (plan as { planId?: unknown } | null)?.planId;
    if (typeof planId !== 'string' || planId === '') return;
    plannedHere.add(planId);
    if (plannedHere.size > MAX_REMEMBERED_PLANS) {
      const oldest = plannedHere.values().next().value;
      if (oldest !== undefined) plannedHere.delete(oldest);
    }
  };

  return async (tool, args, requestedBy) => {
    if (!(MODULE_REQUEST_TOOLS as readonly string[]).includes(tool)) {
      throw new Error(`Tool not allowed for module requests: ${tool}`);
    }
    if (tool === 'undo-change') {
      return deps.guardedChangeTools.handleUndoChange(args, requesterLabel(requestedBy));
    }
    const planner = Object.hasOwn(MODULE_PLANNERS, tool) ? MODULE_PLANNERS[tool] : undefined;
    if (planner) {
      if (
        planner.actions &&
        !(typeof args.action === 'string' && planner.actions.includes(args.action))
      ) {
        throw new Error(
          `A request from the Foundry window can only run ${tool} with action ${planner.actions
            .map(a => `"${a}"`)
            .join(' or ')}`
        );
      }
      const route = deps.toolRouter[tool];
      if (!route) throw new Error(`Unknown tool: ${tool}`);
      const result: unknown = await route(args);
      remember(result);
      return result;
    }
    if (tool === 'apply-planned-change') {
      const planId = args.planId;
      if (typeof planId !== 'string' || planId === '') {
        throw new Error('apply-planned-change needs a planId');
      }
      const plan = deps.guardedWrites.getPlan(planId);
      const features = Object.values(MODULE_PLANNERS).map(p => p.feature);
      if (!plannedHere.has(planId) || !features.includes(plan.feature)) {
        throw new Error(
          'A request from the Foundry window can only apply a plan it made itself with a reveal planner'
        );
      }
      const safe: Record<string, unknown> = {};
      for (const key of APPLY_ARGS) if (key in args) safe[key] = args[key];
      return deps.guardedChangeTools.handleApplyPlannedChange(safe, requesterLabel(requestedBy));
    }
    const route = deps.toolRouter[tool];
    if (!route) throw new Error(`Unknown tool: ${tool}`);
    return route(args);
  };
}

/**
 * A recorded-change listener that tells the module (and so every GM client with
 * the "AI changes" window open) to fetch the list again. It never waits for the
 * module and never fails the change: an older module has no such query, and
 * Foundry may be disconnected.
 */
export function createAiChangesAnnouncer(
  foundry: {
    query(method: string, data?: unknown, options?: { timeoutMs?: number }): Promise<unknown>;
  },
  logger: Pick<Logger, 'debug'>
): RecordedListener {
  return () => {
    foundry.query(AI_CHANGES_UPDATED_QUERY, {}, { timeoutMs: ANNOUNCE_TIMEOUT_MS }).catch(error => {
      logger.debug('Could not announce the recorded change to the module', {
        error: error instanceof Error ? error.message : String(error),
      });
    });
  };
}
