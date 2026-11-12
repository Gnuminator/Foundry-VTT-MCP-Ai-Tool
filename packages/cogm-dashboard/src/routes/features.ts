import type { Express } from 'express';
import { createSpaceStatusReader } from '@gnuminator/shared';

import type { DashboardDeps } from '../dashboard-types.js';
import { mountHandoutSeenRoute } from '../handout-seen-route.js';
import { mountHelpRoute } from '../help-route.js';
import { mountMeRoute } from '../me-route.js';
import { mountOpenRoute } from '../open-route.js';
import { playerConnectorFromEnv, type PlayerConnectorOptions } from '../player-connector.js';
import type { PlayerLinkStore } from '../player-links.js';
import { mountPlayerRoute } from '../player-route.js';
import { gmOnly } from '../redact.js';
import { mountSessionNotesRoute } from '../session-notes-route.js';
import { mountSpaceRoute } from '../space-route.js';
import { mountUsageRoute, type PlayerDirectory } from '../usage-route.js';
import { VersionTracker, defaultKitLastRunFile, mountVersionsRoute } from '../versions.js';
import type { RouteContext } from './context.js';
import { PLAYER_PAGE_HEADERS } from './pages-static.js';

/** What the feature routes need beyond the route context: the injected deps and two stores. */
export interface FeatureRouteDeps {
  deps: DashboardDeps;
  /** Non-GM user names for the player page's name pick and the usage log (I-084). */
  directory: PlayerDirectory;
  /** My character (I-096): one private link per player and world. */
  links: PlayerLinkStore;
}

/**
 * The routes that parse their own body, so app.ts mounts them before the app-wide JSON parser.
 * Returns the player connector, which the My character route also reads.
 */
export function mountRawBodyRoutes(
  app: Express,
  ctx: RouteContext,
  f: FeatureRouteDeps
): PlayerConnectorOptions {
  const { config, client, logger, requireGm, sse } = ctx;
  const { deps, directory } = f;
  // "Open in Foundry" (O4, open-route.ts). Before the JSON parser: its POST parses its own
  // body after its guards.
  mountOpenRoute(app, { ...deps.openRoute, config, client, logger: logger.child('open') });
  // The usage log (I-084, usage-route.ts): write-only, parses its own small body.
  mountUsageRoute(app, {
    config,
    client,
    logger: logger.child('usage'),
    directory,
    requireGm,
  });
  // The handout seen log (I-039): parses its own small body; the GM's drawer refreshes on a new open.
  mountHandoutSeenRoute(app, {
    config,
    client,
    logger: logger.child('handouts'),
    directory,
    onRecorded: () => sse.broadcast('handouts-seen', {}, gmOnly),
  });
  // The player connector (D-136): /mcp/player, before the app-wide parser (it parses its own).
  const playerConnector =
    deps.playerConnector ??
    playerConnectorFromEnv(process.env, message => logger.child('player-connector').warn(message));
  mountPlayerRoute(app, {
    config,
    connector: playerConnector,
    client,
    directory,
    logger,
    ...(deps.accessFetch ? { accessFetch: deps.accessFetch } : {}),
  });
  return playerConnector;
}

/** My character, the storage space check and the version tracker (after the JSON parser). */
export function mountMeSpaceVersionRoutes(
  app: Express,
  ctx: RouteContext,
  f: FeatureRouteDeps,
  playerConnector: PlayerConnectorOptions
): void {
  const { config, client, logger, requireGm, state, themes, prefs } = ctx;
  const { deps, directory, links } = f;
  // My character (I-096): the player's own sheet behind their private link, and the GM's links.
  mountMeRoute(app, {
    client,
    links,
    connector: playerConnector.enabled ? playerConnector.store : null,
    directory,
    requireGm,
    logger,
    worldId: () => ctx.world()?.id ?? null,
    events: () => state.recentEvents,
    onRolled: () => ctx.pollEventsNow(),
    theme: () => themes.get(ctx.world()?.id),
    publicDir: config.publicDir,
    pageHeaders: res => PLAYER_PAGE_HEADERS.apply(res),
  });

  // The storage space check (2026-10-06): GM only; nothing on /player or /me.
  const spaceLogger = logger.child('space');
  mountSpaceRoute(app, {
    requireGm,
    readStatus: createSpaceStatusReader({
      ...(deps.spaceStatusFile ? { path: deps.spaceStatusFile } : {}),
      ...(deps.spaceNow ? { now: deps.spaceNow } : {}),
      log: message => spaceLogger.info(message),
    }),
  });

  // The version tracker (I-127): GM only, on by default, the GM can switch it off in the Advanced menu.
  mountVersionsRoute(app, {
    requireGm,
    tracker: new VersionTracker({
      enabled: (): boolean => prefs.get(ctx.world()?.id).versionTracker,
      getModules: (): Promise<unknown> => client.callTool('get-modules', { includeManifest: true }),
      kitFile: deps.kitLastRunFile ?? defaultKitLastRunFile(),
    }),
  });
}

/** In-app help and the session notes card (after the JSON parser). */
export function mountHelpAndNotesRoutes(
  app: Express,
  ctx: RouteContext,
  f: FeatureRouteDeps
): void {
  const { client, logger, requireGm, settings } = ctx;
  // In-app help (I-064): the GM guide pages, rendered at build time into dist/help.json.
  // In dist (npm start) the file sits next to the app module; in dev mode (tsx src/) it is ../dist.
  // The URLs are relative to app.ts's folder (src/ or dist/), one level above this file.
  mountHelpRoute(app, {
    file: f.deps.helpFile ?? [
      new URL('../help.json', import.meta.url),
      new URL('../../dist/help.json', import.meta.url),
    ],
    requireGm,
  });

  // Session notes (recap lane, D-087; session-notes-route.ts): the After view's card.
  mountSessionNotesRoute(app, {
    client,
    requireGm,
    gmActionsEnabled: () => settings.gmActionsEnabled,
    logger,
  });
}
