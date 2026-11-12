import express from 'express';

import type { Dashboard, DashboardDeps } from './dashboard-types.js';
import { GameState } from './state.js';
import { SseHub } from './sse.js';
import { createReadCache } from './read-cache.js';
import { jsonErrorHandler } from './error-handler.js';
import { hostAllowlist } from './host-allowlist.js';
import { createLiveState } from './live-state.js';
import type { RouteContext, RuntimeSettings } from './routes/context.js';
import { mountApiControlRoute } from './routes/api-control.js';
import { mountApiStreamRoutes } from './routes/api-stream.js';
import { mountApiSwitchesRoutes } from './routes/api-switches.js';
import { mountApiToolRoutes } from './routes/api-tool.js';
import { createRequireGm, mountAccessIdentity } from './routes/auth.js';
import {
  mountHelpAndNotesRoutes,
  mountMeSpaceVersionRoutes,
  mountRawBodyRoutes,
  type FeatureRouteDeps,
} from './routes/features.js';
import { mountPageRoutes } from './routes/pages-static.js';
import { PlayerDirectory } from './usage-route.js';
import { PlayerLinkStore } from './player-links.js';
import { DashboardPrefsStore } from './dashboard-prefs.js';
import { ThemeStore } from './theme.js';
import * as path from 'path';

/**
 * The co-GM dashboard as an Express app plus its feed handlers, built from
 * injected dependencies so tests can run it against a fake bridge
 * (`server.ts` wires the real control client, feed and listener).
 *
 * `app.ts` is wiring only: it builds the stores and the two SSE hubs, hands them to the live
 * state (`live-state.ts`: status, world, feed handlers, stream broadcasts, health dots) and the
 * route groups (`src/routes/`), and mounts them in the security order below.
 *
 * Two SSE hubs keep the roles apart (M2):
 * - `sse`: the GM dashboard. Every broadcast is `gmOnly`, so even a non-GM
 *   client that somehow joined it would receive nothing.
 * - `playerHub`: the player page. It only ever receives the projected player
 *   state (`player/projection.ts`) and sanitized handouts; nothing is
 *   broadcast to it from the GM side.
 * The player endpoints always project, whatever credential is presented: a GM
 * token authorizes a player page, never upgrades it.
 */

/** The public types moved to dashboard-types.ts; server.ts and the tests import them from here. */
export type { Dashboard, DashboardClient, DashboardDeps } from './dashboard-types.js';
/** The player page header and its policy moved to routes/pages-static.ts; tests import them from here. */
export { PLAYER_CSP, PLAYER_PAGE_HEADERS } from './routes/pages-static.js';
/** The heartbeat and health-dot intervals moved to live-state.ts; the tests import them from here. */
export { STATUS_HEARTBEAT_MS, RECORDING_HEALTH_MS } from './live-state.js';

export function createDashboard(deps: DashboardDeps): Dashboard {
  const { config, logger, client } = deps;

  // --- Mutable runtime settings (controlled from the dashboard) --------------
  const settings: RuntimeSettings = {
    gmActionsEnabled: false,
  };

  // The theme, chosen by the GM once per world (D-085); the players' page follows it.
  const themes = new ThemeStore(
    config.stateDir ? path.join(config.stateDir, 'dashboard-themes.json') : null,
    logger
  );

  // The GM's screen choices per world (D-092, I-107): the During layout and the combat buttons.
  const prefs = new DashboardPrefsStore(
    config.stateDir ? path.join(config.stateDir, 'dashboard-prefs.json') : null,
    logger
  );

  // Non-GM user names for the player page's name pick and the usage log (I-084).
  const playerDirectory = new PlayerDirectory(client, logger.child('usage'));

  // My character (I-096): one private link per player and world.
  const playerLinks = new PlayerLinkStore(
    config.stateDir ? path.join(config.stateDir, 'player-links.json') : null,
    logger
  );

  const state = new GameState(config.maxEvents, config.maxErrors);
  const sse = new SseHub(logger);
  // A few seconds of memory for the slow page-load reads; a non-read tool call or a new game
  // event empties it.
  const readCache = createReadCache();
  const playerHub = new SseHub(logger.child('player'));

  // Set by server.ts through `onFeed` once the feed exists; read lazily.
  let pollEventsNow: () => void = () => undefined;
  let resyncFeed: () => void = () => undefined;

  // The bridge status, world, feed handlers and stream broadcasts (live-state.ts).
  const live = createLiveState({
    deps,
    settings,
    state,
    sse,
    playerHub,
    readCache,
    themes,
    prefs,
    playerDirectory,
    resyncFeed: () => resyncFeed(),
  });

  // --- Routes ------------------------------------------------------------------
  // What the route groups in src/routes read from this closure (accessors, never copies).
  const ctx: RouteContext = {
    config,
    logger,
    client,
    settings,
    readCache,
    themes,
    prefs,
    playerView: live.playerView,
    pollEventsNow: () => pollEventsNow(),
    broadcastTheme: live.broadcastTheme,
    broadcastSettings: live.broadcastSettings,
    state,
    sse,
    world: live.world,
    status: live.status,
    recordingHealth: live.recordingHealth,
    /** Express middleware: 401/403 unless the caller resolves to the GM role (routes/auth.ts). */
    requireGm: createRequireGm(config.auth),
    stamped: live.stamped,
    currentPlayerState: live.currentPlayerState,
    currentRolls: live.currentRolls,
    attachPlayerStream: live.attachPlayerStream,
    themePayload: live.themePayload,
    prefsPayload: live.prefsPayload,
    settingsPayload: live.settingsPayload,
  };

  // --- HTTP / SSE ------------------------------------------------------------
  // The order below is the security order: Host check, then the Access identity, before any
  // route resolves a role; the routes that parse their own body before the app-wide JSON parser.
  const app = express();
  const featureDeps: FeatureRouteDeps = {
    deps,
    directory: playerDirectory,
    links: playerLinks,
    // In-app help (I-064): in dist (npm start) help.json sits next to this module; in dev mode
    // (tsx src/) it is ../dist. Built here so the URLs stay relative to this file.
    helpFile: deps.helpFile ?? [
      new URL('./help.json', import.meta.url),
      new URL('../dist/help.json', import.meta.url),
    ],
  };
  // First, before every route and static file: refuse any Host the dashboard does not know
  // (DNS rebinding; host-allowlist.ts). Both modes; with the split on it is defense in depth.
  app.use(
    hostAllowlist({
      bindHost: config.host,
      allowedHosts: config.allowedHosts,
      logger: logger.child('host'),
    })
  );
  // Cloudflare Access (I-022, routes/auth.ts): the verified email on the request before any route.
  mountAccessIdentity(app, { config, logger, accessFetch: deps.accessFetch });
  // Open in Foundry, usage log, handout seen log, player connector: each parses its own body.
  const playerConnector = mountRawBodyRoutes(app, ctx, featureDeps);
  app.use(express.json({ limit: '256kb' }));
  mountPageRoutes(app, ctx);
  mountMeSpaceVersionRoutes(app, ctx, featureDeps, playerConnector);
  mountApiStreamRoutes(app, ctx);
  mountApiControlRoute(app, ctx);
  mountHelpAndNotesRoutes(app, ctx, featureDeps);
  mountApiSwitchesRoutes(app, ctx);
  mountApiToolRoutes(app, ctx);

  // Last: JSON errors without stack traces or paths (the default handler shows both).
  app.use(jsonErrorHandler(logger));

  return {
    app,
    handlers: live.handlers,
    /** The feed's way to read events at once; set by server.ts after the feed exists. */
    onFeed(feed: { pollNow: () => void; resync?: () => void }): void {
      pollEventsNow = feed.pollNow;
      resyncFeed = feed.resync ?? ((): void => undefined);
    },
    start: live.start,
    close(): void {
      live.stop();
      // End the long-lived SSE responses first, or server.close() waits on them.
      sse.close();
      playerHub.close();
    },
  };
}
