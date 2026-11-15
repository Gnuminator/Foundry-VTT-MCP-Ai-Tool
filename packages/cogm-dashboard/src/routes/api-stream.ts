import type { Express, Request, Response } from 'express';

import { presentedUnknownToken, presentedUnverifiedAccess, resolveRole } from '../auth.js';
import { sendJsonGzip } from '../gzip-assets.js';
import type { RouteContext } from './context.js';

/**
 * The read side the pages load on start: health, the state snapshots and the two SSE streams,
 * and the theme. Moved out of app.ts unchanged; the order of the routes is the same.
 */
export function mountApiStreamRoutes(app: Express, ctx: RouteContext): void {
  const { config, state, sse } = ctx;

  app.get('/api/health', (_req: Request, res: Response) => {
    const status = ctx.status();
    res.json({
      ok: true,
      controlChannel: status.controlChannel,
      foundry: status.foundry,
      lastPollAt: status.lastPollAt,
      foundryDownSince: status.foundryDownSince,
      splitEnabled: config.auth.splitEnabled,
    });
  });

  // Player endpoints: always projected, whatever the credential (M2).
  app.get('/api/player/state', (req: Request, res: Response) => {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json(ctx.currentPlayerState());
  });

  app.get('/api/player/stream', (req: Request, res: Response) => {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    ctx.attachPlayerStream(res);
  });

  app.get('/api/state', (req: Request, res: Response) => {
    const role = resolveRole(req, config.auth);
    if (!role) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (role === 'player') {
      // The player role gets exactly what /api/player/state serves, plus whether the token it
      // sent is unknown: then it is a GM's stale link, and the GM page stays (web/src/lib/role.ts).
      // `accessUnverified`: an Access token the dashboard could not verify; the same page stays.
      void sendJsonGzip(req, res, {
        role,
        ...(presentedUnknownToken(req, config.auth) ? { unknownToken: true } : {}),
        ...(presentedUnverifiedAccess(req, config.auth) ? { accessUnverified: true } : {}),
        ...ctx.currentPlayerState(),
      });
      return;
    }
    void sendJsonGzip(req, res, {
      role,
      status: ctx.status(),
      combat: state.combat,
      events: state.recentEvents,
      errors: state.recentErrors,
      settings: ctx.settingsPayload(),
      world: ctx.world(),
      // Null until the world is known, as on the stream (the test kit reads the prefs here).
      prefs: ctx.world() ? ctx.prefsPayload() : null,
    });
  });

  app.get('/api/stream', (req: Request, res: Response) => {
    const role = resolveRole(req, config.auth);
    if (!role) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (role === 'player') {
      // Never on the GM hub: the player role gets the player stream.
      ctx.attachPlayerStream(res);
      return;
    }
    const world = ctx.world();
    sse.add(res, role);
    sse.send(res, 'role', { role });
    sse.send(res, 'status', ctx.stamped(ctx.status()));
    sse.send(res, 'recording-health', ctx.recordingHealth());
    if (world) sse.send(res, 'world', world);
    sse.send(res, 'settings', ctx.settingsPayload());
    sse.send(res, 'theme', ctx.themePayload());
    // Per world: before the world is known these would be the defaults (and flash the layout
    // trial card); the world load broadcasts them.
    if (world) sse.send(res, 'prefs', ctx.prefsPayload());
    // Always, null when no fight runs: a page that was disconnected while a fight ended would
    // otherwise keep showing it as live (the broadcast of the end went to nobody).
    sse.send(res, 'rolls', { rows: ctx.currentRolls().rows });
    sse.send(res, 'combat', { combat: state.combat });
    sse.send(res, 'events', { events: state.recentEvents, initial: true });
    // The stream tests wait for this as the last snapshot event of the GM stream (SNAPSHOT_END in
    // stream-combat.app.test.ts and dashboard-prefs.app.test.ts): keep it last, or update both.
    sse.send(res, 'errors', { errors: state.recentErrors, initial: true });
  });

  // The theme, for any caller (the players' page loads it too).
  app.get('/api/theme', (req: Request, res: Response) => {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json(ctx.themePayload());
  });
}
