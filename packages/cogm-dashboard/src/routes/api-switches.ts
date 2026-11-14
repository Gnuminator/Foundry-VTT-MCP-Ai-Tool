import type { Express, Request, Response } from 'express';

import type { FeaturesBody, SessionSwitchesBody } from '../api-bodies.js';
import { runDashboardPreflight } from '../preflight.js';
import {
  isSessionSwitchAction,
  parseSessionSwitches,
  type SessionSwitchAction,
  type SessionSwitches,
} from '../session-switches.js';
import type { RouteContext } from './context.js';
import { asRecord } from './util.js';

/**
 * The feature cards, Turn on for tonight (D3, PB-17) and the pre-flight check. Moved out of
 * app.ts unchanged.
 */
export function mountApiSwitchesRoutes(app: Express, ctx: RouteContext): void {
  const { config, logger, client, settings, requireGm } = ctx;

  // --- Turn on for tonight (D3, PB-17) --------------------------------------------
  // One click turns on what tonight needs: the module's switches ("Allow Write Operations",
  // Handouts, Live play, Party) and GM Actions; End session turns off what Ready turned on.
  // The module side is the bridge's control method `session_switches`, never an MCP tool, so
  // only this GM route can switch writes on; Claude cannot.

  /** The module's switches, or null when the bridge or module cannot report them. */
  async function moduleSwitches(action: SessionSwitchAction): Promise<SessionSwitches | null> {
    if (typeof client.sessionSwitches !== 'function') return null;
    const parsed = parseSessionSwitches(await client.sessionSwitches(action));
    if (!parsed && action !== 'get')
      throw new Error('The module did not answer with its switches.');
    return parsed;
  }

  // The feature cards (I-064): every feature switch and its state, read-only. The bridge's
  // control method feature_switches; switching stays in Foundry or Turn on for tonight.
  app.get('/api/features', requireGm, (_req: Request, res: Response) => {
    if (typeof client.featureSwitches !== 'function') {
      res.json({
        features: null,
        writesAllowed: null,
        error: 'This bridge cannot list features.',
      } satisfies FeaturesBody);
      return;
    }
    client
      .featureSwitches()
      .then(raw => {
        const r = asRecord(raw);
        res.json({
          features: Array.isArray(r.features) ? r.features : null,
          writesAllowed: typeof r.writesAllowed === 'boolean' ? r.writesAllowed : null,
          error: null,
        } satisfies FeaturesBody);
      })
      .catch((error: unknown) => {
        logger.warn('Could not read the features', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.json({
          features: null,
          writesAllowed: null,
          error: 'Could not read the switches from Foundry.',
        } satisfies FeaturesBody);
      });
  });

  app.get('/api/session/switches', requireGm, (_req: Request, res: Response) => {
    moduleSwitches('get')
      .then(switches =>
        res.json({
          switches,
          gmActionsEnabled: settings.gmActionsEnabled,
          error: null,
        } satisfies SessionSwitchesBody)
      )
      .catch((error: unknown) => {
        logger.warn('Could not read the switches', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.json({
          switches: null,
          gmActionsEnabled: settings.gmActionsEnabled,
          error: 'Could not read the switches from Foundry.',
        } satisfies SessionSwitchesBody);
      });
  });

  app.post('/api/session/switches', requireGm, (req: Request, res: Response) => {
    const action = asRecord(req.body).action;
    if (!isSessionSwitchAction(action) || action === 'get') {
      res.status(400).json({ error: 'action must be "ready" or "end".' });
      return;
    }
    const gmActionsBefore = settings.gmActionsEnabled;
    // End always turns GM Actions off, even when the module cannot be reached (the safe side).
    if (action === 'end' && settings.gmActionsEnabled) {
      settings.gmActionsEnabled = false;
      ctx.broadcastSettings();
    }
    moduleSwitches(action)
      .then(switches => {
        // Ready turns GM Actions on only once the module's switches are on: not when Foundry
        // dropped one (the reply's `failed` names it).
        const failed = switches?.failed.length ?? 0;
        if (action === 'ready' && failed === 0 && !settings.gmActionsEnabled) {
          settings.gmActionsEnabled = true;
          ctx.broadcastSettings();
        }
        res.json({
          ok: true,
          switches,
          gmActionsEnabled: settings.gmActionsEnabled,
          gmActionsChanged: settings.gmActionsEnabled !== gmActionsBefore,
        });
      })
      .catch((error: unknown) => {
        logger.warn('Could not change the switches', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(502).json({
          ok: false,
          error: 'Could not change the switches in Foundry. Check that the world is open.',
          gmActionsEnabled: settings.gmActionsEnabled,
          gmActionsChanged: settings.gmActionsEnabled !== gmActionsBefore,
        });
      });
  });

  // --- Pre-flight (I-068): read-only checks before a session -------------------
  app.get('/api/preflight', requireGm, (_req: Request, res: Response) => {
    void moduleSwitches('get')
      .catch(() => null)
      .then(sessionSwitches =>
        runDashboardPreflight({
          callTool: <T>(name: string, args?: Record<string, unknown>) =>
            client.callTool<T>(name, args ?? {}),
          gmActionsEnabled: settings.gmActionsEnabled,
          sessionSwitches,
          playerState: ctx.currentPlayerState(),
          foundryUrl: config.foundryUrl,
        })
      )
      .then(result => res.json(result))
      .catch((error: unknown) => {
        logger.warn('Pre-flight failed', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.status(500).json({ error: 'The check could not run. Try again in a moment.' });
      });
  });
}
