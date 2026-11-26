import * as path from 'path';

import type { Express } from 'express';
import { createSpaceStatusReader } from '@gnuminator/shared';

import { isGm, resolveRole, type AuthRequest } from '../auth.js';
import {
  ClientRegistry,
  mountClientVersionsRoute,
  obsidianClientRecorder,
} from '../client-versions.js';
import type { DashboardDeps } from '../dashboard-types.js';
import { DiaryStore } from '../diary-store.js';
import { mountKeepsakeRoute } from '../keepsake-route.js';
import { mountDowntimeRoute } from '../downtime-route.js';
import { gmConnectorFromEnv } from '../gm-connector.js';
import { mountGmRoute } from '../gm-route.js';
import { mountHandoutSeenRoute } from '../handout-seen-route.js';
import { mountHelpRoute } from '../help-route.js';
import { mountMeRoute } from '../me-route.js';
import { mountOpenRoute } from '../open-route.js';
import { playerConnectorFromEnv, type PlayerConnectorOptions } from '../player-connector.js';
import type { PlayerLinkStore } from '../player-links.js';
import { mountPlayerRoute } from '../player-route.js';
import { gmOnly } from '../redact.js';
import { mountPreviouslyOnRoute } from '../previously-on-route.js';
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
  /** The built help (I-064): deps.helpFile, else the default URLs app.ts builds next to itself. */
  helpFile: string | URL | URL[];
  /** Client versions seen (item client-updates); made on first use (deps.clients in tests). */
  clients?: ClientRegistry;
}

/** The one client registry these routes share. */
function clientsOf(f: FeatureRouteDeps): ClientRegistry {
  f.clients ??= f.deps.clients ?? new ClientRegistry();
  return f.clients;
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
  // The Obsidian plugin's version header (item client-updates), recorded for requests that pass
  // the GM check. Runs after the Access identity (app.ts mounts these routes after it); never
  // rejects a request.
  app.use(
    obsidianClientRecorder(
      clientsOf(f),
      req => isGm(resolveRole(req as AuthRequest, config.auth)),
      Date.now,
      entry => {
        if (typeof client.recordClient === 'function')
          void client.recordClient(entry).catch(() => undefined);
      }
    )
  );
  // "Who uses what" (D-146): GM only; the bridge builds the report from its own counts.
  app.get('/api/who-uses-what', requireGm, (req, res) => {
    res.set('Cache-Control', 'no-store');
    if (typeof client.whoUsesWhat !== 'function') {
      res.status(501).json({ error: 'The bridge cannot build this report.' });
      return;
    }
    const days = Number(req.query.days);
    client
      .whoUsesWhat(Number.isFinite(days) ? days : 7)
      .then(report => res.json(report))
      .catch(() => res.status(502).json({ error: 'The bridge did not answer. Try again.' }));
  });
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
    meUserFor: key => {
      const world = ctx.world()?.id;
      return world ? f.links.userFor(world, key) : null;
    },
    meTableClosed: key => !ctx.world()?.id && f.links.worldFor(key) !== null,
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
  // Handouts and play stats for a player's Claude come from the player page's own filters.
  let statsCache: { worldId: string; raw: unknown; at: number } | null = null;
  mountPlayerRoute(app, {
    config,
    connector: playerConnector,
    client,
    directory,
    logger,
    local: {
      handoutsFor: userId => ctx.playerView.handoutsFor(userId),
      handoutsReady: () => ctx.playerView.handoutsReady,
      worldId: () => ctx.world()?.id ?? null,
      characterSheet: userId =>
        typeof client.characterSheet === 'function'
          ? client.characterSheet(userId)
          : Promise.reject(new Error('No character sheets')),
      // The stats rebuild from the logs: reuse one answer for a minute.
      playStats: async () => {
        const worldId = ctx.world()?.id ?? '';
        if (statsCache?.worldId === worldId && Date.now() - statsCache.at < 60_000) {
          return statsCache.raw;
        }
        const raw = await client.callTool('get-play-stats', {});
        statsCache = { worldId, raw, at: Date.now() };
        return raw;
      },
    },
    clients: clientsOf(f),
    ...(deps.accessFetch ? { accessFetch: deps.accessFetch } : {}),
  });
  // The remote GM connector: /mcp/core to /mcp/admin behind the GM Access application.
  mountGmRoute(app, {
    config: { host: config.host, auth: config.auth },
    connector:
      deps.gmConnector ??
      gmConnectorFromEnv(process.env, message => logger.child('gm-connector').warn(message)),
    client,
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
    // Character diaries (I-183): the players' own entries, in the state folder.
    diary: new DiaryStore(
      config.stateDir ? path.join(config.stateDir, 'player-diaries.json') : null,
      logger
    ),
    connector: playerConnector.enabled ? playerConnector.store : null,
    directory,
    requireGm,
    logger,
    clients: clientsOf(f),
    worldId: () => ctx.world()?.id ?? null,
    events: () => state.recentEvents,
    onRolled: () => ctx.pollEventsNow(),
    theme: () => themes.get(ctx.world()?.id),
    publicDir: config.publicDir,
    pageHeaders: res => PLAYER_PAGE_HEADERS.apply(res),
  });

  // The downtime inbox (I-180): a player's own entries behind their private link.
  mountDowntimeRoute(app, {
    client,
    links,
    directory,
    worldId: () => ctx.world()?.id ?? null,
  });

  // Keepsake ledgers: a player's own list, filled from the public log (needs the player vaults).
  if (ctx.keepsakes) {
    mountKeepsakeRoute(app, {
      links,
      worldId: () => ctx.world()?.id ?? null,
      store: ctx.keepsakes.store,
      ledgersFor: ctx.keepsakes.ledgersFor,
    });
  }

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

  // Client versions (item client-updates): GM only; the connector rows come from the backend.
  mountClientVersionsRoute(app, {
    requireGm,
    registry: clientsOf(f),
    wrapperStatus:
      typeof client.wrapperStatus === 'function'
        ? (): Promise<unknown> => client.wrapperStatus!()
        : undefined,
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
  mountHelpRoute(app, { file: f.helpFile, requireGm });

  // Session notes (recap lane, D-087; session-notes-route.ts): the After view's card.
  mountSessionNotesRoute(app, {
    client,
    requireGm,
    gmActionsEnabled: () => settings.gmActionsEnabled,
    logger,
  });

  // "Previously on" (item previously-on): last night's approved recap to chat, optionally spoken.
  // Off unless FOUNDRY_AI_PREVIOUSLY_ON=1.
  mountPreviouslyOnRoute(app, {
    client,
    requireGm,
    gmActionsEnabled: () => settings.gmActionsEnabled,
    enabled: () => process.env.FOUNDRY_AI_PREVIOUSLY_ON === '1',
    logger,
  });
}
