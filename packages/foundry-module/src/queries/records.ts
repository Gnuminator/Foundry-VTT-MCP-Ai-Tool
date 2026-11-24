/**
 * Bridge handlers that read what the module has recorded or scanned: the play log, change
 * journal, usage log, session events, spent actions, the Obsidian export index, the pre-flight
 * and prep scans, tool-runner pickers and opening a document on the GM's screen. All read-only.
 */
import type { BridgeAnswer, BridgeRequest } from '@gnuminator/shared';
import type { BridgeHandlerTable } from '../bridge-handlers.js';
import { MODULE_ID } from '../constants.js';
import { changeJournal } from '../change-journal.js';
import { EXPORT_INDEX_QUERY, getExportIndex } from '../export-index.js';
import { openDocumentForGm } from '../gm-helper-queries.js';
import { getPreflightScan, PREFLIGHT_QUERY } from '../preflight-scan.js';
import { getPrepScan, PREP_SCAN_QUERY } from '../prep-scan.js';
import { playRecorder } from '../play-recorder.js';
import { listRefChoices } from '../data-access/ref-choices.js';
import { eventTracker } from '../session-events.js';
import { spentLedger, spentSinceOwnTurn } from '../spent-actions.js';
import { detectRulesVersion, readRulesTag } from '../systems/dnd5e/rules-version.js';
import { usageRecorder } from '../usage-recorder.js';
import { withCtx, type QueryContext } from './context.js';

/**
 * Registration table: wire method name (after `${MODULE_ID}.`) and its kind. The kind decides
 * the write gate (write-gate.ts): `write` and `recordless-write` are refused while "Allow Write
 * Operations" is off; `read` is never gated.
 */
export function registerRecordHandlers(ctx: QueryContext, table: BridgeHandlerTable): void {
  // Session event log
  table.set(`${MODULE_ID}.getSessionLog`, 'read', withCtx(ctx, getSessionLog));
  table.on(`${MODULE_ID}.getRecentEvents`, 'read', withCtx(ctx, getRecentEvents));
  table.on(`${MODULE_ID}.getSpentActions`, 'read', withCtx(ctx, getSpentActions));

  // O3: full play log (raw records behind the session/stats notes)
  table.on(
    `${MODULE_ID}.getPlayRecords`,
    'read',
    (data: { sinceSeq?: unknown; limit?: unknown } | undefined) =>
      ctx.withGmGate('Failed to get play records', () =>
        Promise.resolve(playRecorder.getPlayRecords(data))
      )
  );

  // I-109: change journal (every create, update and delete with before and after, for full undo)
  table.on(
    `${MODULE_ID}.getChangeJournal`,
    'read',
    (data: { sinceSeq?: unknown; limit?: unknown } | undefined) =>
      ctx.withGmGate('Failed to get the change journal', () =>
        Promise.resolve(changeJournal.getChangeJournal(data))
      )
  );

  // I-084: usage log (module controls used; buffer on the bridge-holding GM client)
  table.on(
    `${MODULE_ID}.getUsageRecords`,
    'read',
    (data: { sinceSeq?: unknown; limit?: unknown } | undefined) =>
      ctx.withGmGate('Failed to get usage records', () =>
        Promise.resolve(usageRecorder.getUsageRecords(data))
      )
  );

  // Obsidian mirror (O4, read-only): the export index of PCs, NPCs, scenes,
  // journals and story items. GM client only, even with allowNonGmAccess
  // (getExportIndex refuses non-GM clients itself).
  table.on(`${MODULE_ID}.${EXPORT_INDEX_QUERY}`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to build the export index', () => Promise.resolve(getExportIndex(data)))
  );

  // Pre-flight scan (I-067, I-076, read-only): secret-looking world settings
  // (masked), names players can see and module conflicts. GM client only.
  table.set(`${MODULE_ID}.${PREFLIGHT_QUERY}`, 'read', () =>
    ctx.withGmGate('Failed to run the pre-flight scan', () => Promise.resolve(getPreflightScan()))
  );

  // Session prep scan (I-045, read-only): quests, campaign parts, the Next session
  // journal and boss tokens. GM client only.
  table.set(`${MODULE_ID}.${PREP_SCAN_QUERY}`, 'read', () =>
    ctx.withGmGate('Failed to run the prep scan', () => Promise.resolve(getPrepScan()))
  );

  // Tool-runner pickers: what a parameter can name right now (read-only)
  table.set(`${MODULE_ID}.listRefChoices`, 'read', (data: unknown) =>
    ctx.withGmGate('Failed to list choices', () => listRefChoices(data))
  );

  // GM screen helpers: open a document on the GM's own Foundry client
  table.set(
    `${MODULE_ID}.openDocumentForGm`,
    'read',
    (data: { uuid?: unknown; userId?: unknown } | undefined) =>
      ctx.withGmGate('Failed to open document', () => openDocumentForGm(data ?? {}))
  );
}

/** Rules check: what an actor used since its own turn began, and its rules version (read-only). */
async function getSpentActions(
  ctx: QueryContext,
  data: BridgeRequest<'foundry-mcp-bridge.getSpentActions'>
): Promise<BridgeAnswer<'foundry-mcp-bridge.getSpentActions'>> {
  return ctx.withGmGate('Failed to read spent actions', async () => {
    const actorId = typeof data?.actorId === 'string' ? data.actorId : '';
    const combat = game.combat;
    const actor = actorId ? game.actors?.get(actorId) : undefined;
    // An explicit GM choice stored on the actor wins over detection.
    const stored = actor ? readRulesTag(actor) : null;
    const detected = actor ? (stored?.source === 'gm' ? stored : detectRulesVersion(actor)) : null;
    const item = typeof data?.itemId === 'string' ? actor?.items?.get(data.itemId) : undefined;
    const itemStored = item ? readRulesTag(item) : null;
    const itemDetected = item
      ? itemStored?.source === 'gm'
        ? itemStored
        : detectRulesVersion(item)
      : null;
    return {
      ...spentSinceOwnTurn(
        actorId,
        typeof combat?.id === 'string' ? combat.id : null,
        spentLedger.snapshot(),
        eventTracker.getCombatTimeline()
      ),
      actorRules: detected ? { version: detected.version, source: detected.source } : null,
      itemRules: itemDetected
        ? { version: itemDetected.version, source: itemDetected.source }
        : null,
    };
  });
}

async function getSessionLog(
  ctx: QueryContext,
  data: {
    limit?: number;
    eventType?: string;
    actorName?: string;
  }
): Promise<unknown> {
  return ctx.withGmGate('Failed to get session log', async () => {
    return await ctx.dataAccess.getSessionLog(data || {});
  });
}

async function getRecentEvents(
  ctx: QueryContext,
  data: BridgeRequest<'foundry-mcp-bridge.getRecentEvents'>
): Promise<BridgeAnswer<'foundry-mcp-bridge.getRecentEvents'>> {
  return ctx.withGmGate('Failed to get recent events', async () => {
    return await ctx.dataAccess.getRecentEvents(data || {});
  });
}
