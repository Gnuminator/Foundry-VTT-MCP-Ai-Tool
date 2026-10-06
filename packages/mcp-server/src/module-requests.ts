/**
 * Backend side of the "AI changes" window inside Foundry (I-108): what answers a
 * `module-request` frame, and what tells the module a change was recorded.
 *
 * Kept out of `backend.ts` so both can be tested without starting the backend.
 */
import { MODULE_REQUEST_TOOLS, type ModuleRequestData } from '@gnuminator/shared';
import type { RecordedListener } from './guarded-write/service.js';
import type { ModuleRequestHandler } from './foundry-connector.js';
import type { Logger } from './logger.js';
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

export interface ModuleRequestDeps {
  toolRouter: Record<string, ToolHandler>;
  guardedChangeTools: Pick<GuardedChangeTools, 'handleUndoChange'>;
}

/**
 * Dispatch for `module-request` frames: the same in-process tools the control
 * channel runs. The connector already checks the allowlist; it is checked again
 * here so a later caller of `setModuleRequestHandler` cannot reach a write tool.
 * An undo carries who asked into the audit entry.
 */
export function createModuleRequestHandler(deps: ModuleRequestDeps): ModuleRequestHandler {
  return (tool, args, requestedBy) => {
    if (!(MODULE_REQUEST_TOOLS as readonly string[]).includes(tool)) {
      return Promise.reject(new Error(`Tool not allowed for module requests: ${tool}`));
    }
    if (tool === 'undo-change') {
      return deps.guardedChangeTools.handleUndoChange(args, requesterLabel(requestedBy));
    }
    const route = deps.toolRouter[tool];
    if (!route) return Promise.reject(new Error(`Unknown tool: ${tool}`));
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
