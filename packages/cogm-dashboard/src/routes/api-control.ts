import type { Express, Request, Response } from 'express';

import { parsePrefsChange } from '../dashboard-prefs.js';
import { gmOnly } from '../redact.js';
import { THEMES, isTheme } from '../theme.js';
import type { RouteContext } from './context.js';
import { asRecord, readStr } from './util.js';

/**
 * POST /api/control: the dashboard's own switches (theme, screen choices, GM Actions). Moved out of
 * app.ts unchanged.
 */
export function mountApiControlRoute(app: Express, ctx: RouteContext): void {
  const { logger, sse, themes, prefs, settings, requireGm } = ctx;

  app.post('/api/control', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    const action = readStr(body.action, '');
    const value = body.value;

    if (action === 'set-theme') {
      if (!isTheme(value)) {
        res.status(400).json({ error: `Unknown theme; use one of: ${THEMES.join(', ')}.` });
        return;
      }
      const worldId = ctx.world()?.id;
      if (!worldId) {
        res
          .status(409)
          .json({ error: 'The world is not known yet; try again once Foundry is connected.' });
        return;
      }
      themes
        .set(worldId, value)
        .then(() => {
          ctx.broadcastTheme();
          res.json(ctx.themePayload());
        })
        .catch((error: unknown) => {
          logger.warn('Could not save the theme', {
            error: error instanceof Error ? error.message : String(error),
          });
          res.status(500).json({ error: 'Could not save the theme.' });
        });
      return;
    }

    if (action === 'set-prefs') {
      const change = parsePrefsChange(value);
      if (!change) {
        res.status(400).json({ error: 'No known screen choice in "value".' });
        return;
      }
      const worldId = ctx.world()?.id;
      if (!worldId) {
        res
          .status(409)
          .json({ error: 'The world is not known yet; try again once Foundry is connected.' });
        return;
      }
      prefs
        .update(worldId, change)
        .then(() => {
          sse.broadcast('prefs', ctx.prefsPayload(), gmOnly);
          res.json(ctx.prefsPayload());
        })
        .catch((error: unknown) => {
          logger.warn('Could not save the dashboard prefs', {
            error: error instanceof Error ? error.message : String(error),
          });
          res.status(500).json({ error: 'Could not save the screen choice.' });
        });
      return;
    }

    switch (action) {
      case 'toggle-gm-actions':
        settings.gmActionsEnabled = !settings.gmActionsEnabled;
        break;
      case 'set-gm-actions':
        settings.gmActionsEnabled = value === true;
        break;
      default:
        res.status(400).json({ error: `Unknown action: ${action || '(none)'}` });
        return;
    }

    ctx.broadcastSettings();
    res.json(ctx.settingsPayload());
  });
}
