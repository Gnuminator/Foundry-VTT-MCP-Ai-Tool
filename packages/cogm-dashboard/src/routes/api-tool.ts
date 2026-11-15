import type { Express, Request, Response } from 'express';

import { ToolError, TimeoutError } from '../feed/mcp-control-client.js';
import { gmOnly } from '../redact.js';
import { CACHED_READ_TOOLS } from '../read-cache.js';
import { classifyTool, toolArgs, type ToolKind } from '../tool-policy.js';
import type { RouteContext } from './context.js';
import { asRecord, readStr } from './util.js';

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  mutates: ToolKind;
}

const TOOL_CATALOG_TTL_MS = 60_000;
/** GM actions may run a guarded write (up to ~4 min in Foundry plus the outcome check). */
const GM_ACTION_TIMEOUT_MS = 300_000;
/** `wait-for-game-event` waits up to 45 s on the backend; leave room above that. */
const WAIT_EVENT_TIMEOUT_MS = 60_000;

/**
 * GM Actions: list and run bridge tools, and the live write sweep helper. Moved out of app.ts
 * unchanged.
 */
export function mountApiToolRoutes(app: Express, ctx: RouteContext): void {
  const { logger, client, sse, readCache, settings, playerView, requireGm } = ctx;

  // --- GM Actions: tool catalog ----------------------------------------------
  let toolCatalog: ToolInfo[] | null = null;
  let toolCatalogAt = 0;

  async function getToolCatalog(force = false): Promise<ToolInfo[]> {
    if (!force && toolCatalog && Date.now() - toolCatalogAt < TOOL_CATALOG_TTL_MS) {
      return toolCatalog;
    }
    const raw = await client.listTools();
    const tools = raw
      .map(asRecord)
      .filter(t => typeof t.name === 'string')
      .map<ToolInfo>(t => {
        const name = t.name as string;
        return {
          name,
          description: readStr(t.description, ''),
          inputSchema: t.inputSchema ?? { type: 'object', properties: {} },
          mutates: classifyTool(name),
        };
      })
      .sort((a, b) => a.name.localeCompare(b.name));
    toolCatalog = tools;
    toolCatalogAt = Date.now();
    return tools;
  }

  // --- GM Actions: list + invoke bridge tools ----------------------------------
  app.get('/api/tools', requireGm, (req: Request, res: Response) => {
    getToolCatalog(req.query.refresh === '1')
      .then(tools => res.json({ tools, gmActionsEnabled: settings.gmActionsEnabled }))
      .catch((error: unknown) => {
        logger.warn('Could not list the bridge tools', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({
          error: 'The list of actions could not be loaded. Try again in a moment.',
        });
      });
  });

  app.post('/api/tool', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    const name = readStr(body.name, '').trim();
    if (!name) {
      res.status(400).json({ error: 'A non-empty "name" is required.' });
      return;
    }
    const mutates = classifyTool(name);
    const args = toolArgs(name, asRecord(body.args), body);

    if (mutates !== 'read') {
      if (!settings.gmActionsEnabled) {
        res.status(403).json({
          code: 'gm-actions-disabled',
          error: 'GM Actions are off. Turn on the GM Actions switch to run game-changing tools.',
        });
        return;
      }
      if (body.confirm !== true) {
        res
          .status(412)
          .json({ code: 'confirm-required', mutates, error: 'Confirmation required.' });
        return;
      }
      if (mutates === 'destructive' && body.confirmDestructive !== true) {
        res.status(412).json({
          code: 'confirm-destructive-required',
          mutates,
          error: 'This action is destructive and needs explicit confirmation.',
        });
        return;
      }
      logger.info('GM Action invoked', { tool: name, mutates });
    }

    // The session marker counts as a change here: the stats and the digest move with it.
    const changes = mutates !== 'read' || name === 'mark-play-session';
    if (changes) readCache.clear();
    const run = (): Promise<unknown> =>
      client
        // A GM action may run a guarded write, which waits up to about 4 minutes
        // for Foundry and then for its outcome (PB-04); reads keep the short timeout, except the
        // long-poll wait (up to 45 s by design).
        .callTool(
          name,
          args,
          name === 'wait-for-game-event'
            ? { timeoutMs: WAIT_EVENT_TIMEOUT_MS }
            : mutates === 'read'
              ? {}
              : { timeoutMs: GM_ACTION_TIMEOUT_MS }
        );
    (mutates === 'read' && CACHED_READ_TOOLS.has(name) ? readCache.get(name, args, run) : run())
      .then(result => {
        if (changes) readCache.clear();
        res.json({ ok: true, name, mutates, result });
        // A reveal or hide may have changed the handouts: refresh the player view.
        if (name === 'apply-planned-change' || name === 'undo-change') void playerView.refresh();
        // Another open dashboard window learns that the session started or ended at once.
        if (name === 'mark-play-session') sse.broadcast('play-session', {}, gmOnly);
        // A roll request reaches the players now, not at the next 4 second poll.
        if (name === 'request-player-rolls') ctx.pollEventsNow();
      })
      .catch((error: unknown) => {
        const kind =
          error instanceof ToolError
            ? 'tool'
            : error instanceof TimeoutError
              ? 'timeout'
              : 'channel';
        // A tool's own refusal is written for the GM and passes through; a timeout or a lost
        // link can carry socket and port text, so those send a fixed sentence and log the detail.
        if (kind !== 'tool') {
          logger.warn('Tool call failed', {
            name,
            kind,
            error: error instanceof Error ? error.message : String(error),
          });
        }
        res.status(kind === 'tool' ? 422 : 502).json({
          ok: false,
          name,
          kind,
          error:
            kind === 'timeout'
              ? 'Foundry took too long to answer.'
              : kind === 'channel'
                ? 'The dashboard lost its link to the bridge. Check that the AI Tool is running.'
                : error instanceof Error
                  ? error.message
                  : 'The action did not work.',
        });
      });
  });

  // Live write sweep helper (I-016, scripts/live-write-sweep.mjs): scene snapshot, a sweep
  // combat or concentration, feature switches, fixtures (playlist, party, handout), the
  // playlist state and the clean-up. The module refuses outside the test worlds
  // (SWEEP_WORLD_IDS: ai-tool-test, ai-tool-walkthrough). Not a tool.
  app.post('/api/test/live-sweep', requireGm, (req: Request, res: Response) => {
    if (!settings.gmActionsEnabled) {
      res.status(403).json({ code: 'gm-actions-disabled', error: 'GM Actions are off.' });
      return;
    }
    if (typeof client.liveSweep !== 'function') {
      res.status(501).json({ error: 'This bridge has no live sweep helper.' });
      return;
    }
    const body = asRecord(req.body);
    const request: Record<string, unknown> = { mode: readStr(body.mode, 'cleanup') };
    if (typeof body.since === 'number') request.since = body.since;
    if (Array.isArray(body.tokenIds)) request.tokenIds = body.tokenIds.map(String);
    if (Array.isArray(body.actorIds)) request.actorIds = body.actorIds.map(String);
    if (typeof body.kind === 'string') request.kind = body.kind;
    if (typeof body.id === 'string') request.id = body.id;
    if (body.switches && typeof body.switches === 'object' && !Array.isArray(body.switches)) {
      request.switches = body.switches;
    }
    client
      .liveSweep(request)
      .then(result => res.json({ ok: true, result }))
      .catch((error: unknown) => {
        logger.warn('Live sweep helper failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({ ok: false, error: 'The test helper failed.' });
      });
  });
}
