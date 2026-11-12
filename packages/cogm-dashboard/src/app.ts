import express, { type Response } from 'express';
import type { PlayerHandout } from '@gnuminator/shared';

import { normalizeFoundryUrl, withPortraitUrls } from './combat-images.js';
import type { Dashboard, DashboardDeps } from './dashboard-types.js';
import type { BridgeStatus, CombatState, GameFeedHandlers, WorldInfo } from './feed/types.js';
import { GameState } from './state.js';
import { SseHub } from './sse.js';
import { createReadCache } from './read-cache.js';
import { jsonErrorHandler } from './error-handler.js';
import { gmOnly } from './redact.js';
import {
  readRecordingHealth,
  type PumpSnapshot,
  type RecordingHealth,
} from './recording-health.js';
import { hostAllowlist } from './host-allowlist.js';
import { buildPlayerState } from './player/projection.js';
import { buildRollRows, openRolls } from './roll-status.js';
import { PlayerViewSource } from './player/source.js';
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
import { asRecord, readStr } from './routes/util.js';
import { mountPageRoutes } from './routes/pages-static.js';
import { PlayerDirectory } from './usage-route.js';
import { PlayerLinkStore } from './player-links.js';
import { DashboardPrefsStore } from './dashboard-prefs.js';
import { THEMES, ThemeStore, type ThemeId } from './theme.js';
import { PlayerLogStore } from './player-vault/log-store.js';
import { PlayerVaultService } from './player-vault/service.js';
import type { VaultPlayer } from './player-vault/types.js';
import * as path from 'path';

/**
 * The co-GM dashboard as an Express app plus its feed handlers, built from
 * injected dependencies so tests can run it against a fake bridge
 * (`server.ts` wires the real control client, feed and listener).
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
/** How often the player view context (visibility, handouts) is refreshed. */
const PLAYER_SOURCE_INTERVAL_MS = 5_000;
/** How often the GM stream repeats the bridge status (the page's watchdog allows 45 s of silence). */
export const STATUS_HEARTBEAT_MS = 17_000;
/** How often the Recorder and Play log dots of the health line are re-read. */
export const RECORDING_HEALTH_MS = 15_000;
/** Player-state broadcasts are coalesced over this window. */
const PLAYER_BROADCAST_DEBOUNCE_MS = 250;

function mapWorld(raw: unknown): WorldInfo {
  const r = asRecord(raw);
  const system = asRecord(r.system);
  const foundry = asRecord(r.foundry);
  const activeUsers = Array.isArray(r.activeUsers) ? r.activeUsers : [];
  const gmNames = activeUsers
    .map(asRecord)
    .filter(u => u.isGM === true)
    .map(u => u.name)
    .filter((name): name is string => typeof name === 'string');
  return {
    id: readStr(r.id, ''),
    title: readStr(r.title, 'Unknown world'),
    systemId: readStr(system.id, 'unknown'),
    systemVersion: readStr(system.version, ''),
    foundryVersion: readStr(foundry.version, ''),
    gmNames,
  };
}

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

  // --- Live status / world ---------------------------------------------------
  let currentStatus: BridgeStatus = {
    controlChannel: 'disconnected',
    foundry: 'unknown',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  };
  let world: WorldInfo | null = null;
  /** The last world id seen, kept when `world` is nulled on a drop, to spot a switch. */
  let lastWorldId: string | null = null;
  let lastCombatJson = '';
  let worldRefreshInflight = false;
  let worldRetryTimer: NodeJS.Timeout | null = null;
  let heartbeatTimer: NodeJS.Timeout | null = null;
  /** The status as the stream sends it, with the server's clock (`now`), so a page whose own clock is off can still age "Last update". */
  const stamped = <S extends object>(s: S): S & { now: string } => ({
    ...s,
    now: new Date().toISOString(),
  });

  // --- Recorder and Play log dots (item health-line-dots) -----------------------
  let recordingHealth: RecordingHealth = { recorder: null, playLog: null };
  let recordingHealthTimer: NodeJS.Timeout | null = null;
  async function refreshRecordingHealth(): Promise<void> {
    const next = await readRecordingHealth({
      botStatusUrl: deps.botStatusUrl ?? config.botStatusUrl ?? '',
      readPumps: async (): Promise<PumpSnapshot[] | null> => {
        const r = await client.callTool<{ pumps?: PumpSnapshot[] }>(
          'get-preflight',
          { action: 'pumps' },
          { timeoutMs: 4000 }
        );
        return Array.isArray(r?.pumps) ? r.pumps : null;
      },
    });
    if (JSON.stringify(next) === JSON.stringify(recordingHealth)) return;
    recordingHealth = next;
    sse.broadcast('recording-health', recordingHealth, gmOnly);
  }

  // --- Player view (M2) ------------------------------------------------------
  let playerTimer: NodeJS.Timeout | null = null;
  let lastPlayerStateJson = '';
  let lastHandoutsJson = '';
  let lastRollsJson = '';
  let pollEventsNow: () => void = () => undefined;
  let resyncFeed: () => void = () => undefined;

  const playerView = new PlayerViewSource(client, logger.child('player-view'), () =>
    schedulePlayerBroadcast()
  );

  // O7 player vaults: one kept-current Obsidian vault per player, off unless the folder is set.
  const playerVaults = config.playerVaultsDir
    ? new PlayerVaultService({
        rootDir: config.playerVaultsDir,
        intervalMs: config.playerVaultIntervalMs ?? 60_000,
        client,
        logger: logger.child('player-vault'),
        store: new PlayerLogStore(
          config.stateDir ? path.join(config.stateDir, 'player-vault-log') : null,
          logger.child('player-vault')
        ),
        world: (): { id: string; title: string } | null =>
          world ? { id: world.id, title: world.title } : null,
        players: (): VaultPlayer[] => playerDirectory.list(),
        refreshPlayers: (): Promise<void> => playerDirectory.refreshIfStale(),
        handouts: (userId): PlayerHandout[] => playerView.handoutsFor(userId),
        handoutsReady: (): boolean => playerView.handoutsReady,
        theme: (worldId): ThemeId => themes.get(worldId),
      })
    : null;

  function currentPlayerState(): ReturnType<typeof buildPlayerState> {
    return buildPlayerState({
      status: currentStatus,
      world,
      visibility: playerView.visibility,
      combat: state.combat,
      events: state.recentEvents,
      handouts: playerView.handouts,
      newSinceMs: playerView.sessionSinceMs,
      sessionOpen: playerView.sessionOpen,
      sessionEndedMs: playerView.lastSessionEndedMs,
      opts: config.playerView,
    });
  }

  /** Push the projected state (and handouts, when they changed) to every player stream. */
  function broadcastPlayerState(): void {
    playerTimer = null;
    const { handouts, ...rest } = currentPlayerState();
    const json = JSON.stringify(rest);
    if (json !== lastPlayerStateJson) {
      lastPlayerStateJson = json;
      playerHub.broadcast('state', rest);
    }
    broadcastRolls();
    const handoutsJson = JSON.stringify(handouts);
    if (handoutsJson !== lastHandoutsJson) {
      lastHandoutsJson = handoutsJson;
      playerHub.broadcast('handouts', { handouts });
    }
  }

  /** Who was asked for a roll and who rolled it: the GM sees all, a player only the open requests. */
  function currentRolls(): {
    rows: ReturnType<typeof buildRollRows>;
    open: ReturnType<typeof openRolls>;
  } {
    const rows = buildRollRows(state.recentEvents, id => playerDirectory.get(id) !== null).slice(
      0,
      20
    );
    return { rows, open: openRolls(rows, Date.now()) };
  }

  function broadcastRolls(): void {
    const { rows, open } = currentRolls();
    const json = JSON.stringify({ rows, open });
    if (json === lastRollsJson) return;
    lastRollsJson = json;
    sse.broadcast('rolls', { rows }, gmOnly);
    playerHub.broadcast('rolls', { open });
  }

  function schedulePlayerBroadcast(): void {
    if (playerTimer) return;
    playerTimer = setTimeout(broadcastPlayerState, PLAYER_BROADCAST_DEBOUNCE_MS);
    playerTimer.unref();
  }

  /** Attach a player stream: projected snapshot now, projected updates later. */
  function attachPlayerStream(res: Response): void {
    playerHub.add(res, 'player');
    const { handouts, ...rest } = currentPlayerState();
    playerHub.send(res, 'state', rest);
    playerHub.send(res, 'handouts', { handouts });
    playerHub.send(res, 'rolls', { open: currentRolls().open });
    // The stream tests wait for this as the last snapshot event of the player stream (SNAPSHOT_END
    // in the two *.app.test.ts files): keep it last, or update both.
    playerHub.send(res, 'theme', themePayload());
  }

  /** The current world's theme. Not game state: the same for the GM and the players. */
  function themePayload(): { theme: string; themes: readonly string[] } {
    return { theme: themes.get(world?.id), themes: THEMES };
  }

  /** The GM's screen choices for the current world. GM only: never on the player stream. */
  function prefsPayload(): Record<string, unknown> {
    return { ...prefs.get(world?.id) };
  }

  function broadcastTheme(): void {
    sse.broadcast('theme', themePayload());
    playerHub.broadcast('theme', themePayload());
  }

  function settingsPayload(): Record<string, unknown> {
    return {
      gmActionsEnabled: settings.gmActionsEnabled,
      pollIntervalMs: config.pollIntervalMs,
      // GM-only (settings are sent through `gmOnly`): the Obsidian vault "Open in
      // Obsidian" links resolve against, or null when off.
      obsidian: config.obsidianVaultName ? { vault: config.obsidianVaultName } : null,
    };
  }

  function broadcastSettings(): void {
    sse.broadcast('settings', settingsPayload(), gmOnly);
  }

  /** Express middleware: 401/403 unless the caller resolves to the GM role (routes/auth.ts). */
  const requireGm = createRequireGm(config.auth);

  /** A different world opened: the old world's events, errors and combat must not show. */
  function resetForNewWorld(): void {
    state.reset();
    readCache.clear();
    lastCombatJson = '';
    sse.broadcast('reset', {}, gmOnly);
    // The new world's first reads may have come before this; read them again.
    resyncFeed();
    logger.info('World changed: cleared the events and errors of the previous world');
  }

  async function refreshWorld(attempt = 0): Promise<void> {
    // Collapse concurrent triggers (transition + immediate poll) into one call.
    if (worldRefreshInflight) return;
    worldRefreshInflight = true;
    try {
      const raw = await client.callTool('get-world-info');
      const next = mapWorld(raw);
      if (next.id !== '') {
        if (lastWorldId !== null && next.id !== lastWorldId) resetForNewWorld();
        lastWorldId = next.id;
      }
      world = next;
      playerDirectory.harvest(raw);
      sse.broadcast('world', world, gmOnly);
      schedulePlayerBroadcast();
      broadcastTheme();
      sse.broadcast('prefs', prefsPayload(), gmOnly);
      logger.info('World info loaded', { title: world.title, system: world.systemId });
    } catch (error) {
      logger.debug('world-info fetch failed', {
        error: error instanceof Error ? error.message : String(error),
      });
      // Bounded backoff retry while still reachable, not a per-poll storm.
      if (attempt < 3 && currentStatus.foundry === 'reachable' && world === null) {
        if (worldRetryTimer) clearTimeout(worldRetryTimer);
        worldRetryTimer = setTimeout(() => {
          worldRetryTimer = null;
          void refreshWorld(attempt + 1);
        }, 3000);
        worldRetryTimer.unref();
      }
    } finally {
      worldRefreshInflight = false;
    }
  }

  // --- Feed handlers ---------------------------------------------------------
  const handlers: GameFeedHandlers = {
    onPoll(at) {
      // Quiet on purpose: a broadcast per poll would wake every client for no visible change.
      currentStatus = { ...currentStatus, lastPollAt: at };
    },
    onStatus(status) {
      // World info only exists once Foundry is reachable; fetch it on the
      // transition INTO reachable (a failed fetch retries on its own backoff).
      const wasReachable = currentStatus.foundry === 'reachable';
      const becameReachable = status.foundry === 'reachable' && !wasReachable;
      currentStatus = status;
      sse.broadcast('status', stamped(status), gmOnly);
      schedulePlayerBroadcast();
      if (becameReachable) {
        void refreshWorld();
        void playerView.refresh();
      } else if (status.foundry !== 'reachable' && world !== null) {
        // Foundry dropped: invalidate the stale world so nothing acts on a world
        // that may be gone.
        world = null;
        sse.broadcast('world', null, gmOnly);
      }
    },
    onEvents(events, meta) {
      playerVaults?.onEvents(events);
      const added = state.addEvents(events);
      if (added.length === 0) return;
      // A change made elsewhere (Claude Desktop, Foundry itself) must not read back stale.
      readCache.clear();
      sse.broadcast('events', { events: added, initial: meta.initial }, gmOnly);
      schedulePlayerBroadcast();
    },
    onErrors(errors, meta) {
      const added = state.addErrors(errors);
      if (added.length === 0) return;
      sse.broadcast('errors', { errors: added, initial: meta.initial }, gmOnly);
    },
    onCombat(rawCombat: CombatState | null) {
      const combat = withPortraitUrls(rawCombat, normalizeFoundryUrl(config.foundryUrl ?? ''));
      state.setCombat(combat);

      const json = JSON.stringify(combat);
      if (json !== lastCombatJson) {
        lastCombatJson = json;
        sse.broadcast('combat', { combat }, gmOnly);
        schedulePlayerBroadcast();
      }
    },
  };

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
    playerView,
    pollEventsNow: () => pollEventsNow(),
    broadcastTheme,
    broadcastSettings,
    state,
    sse,
    world: () => world,
    status: () => currentStatus,
    recordingHealth: () => recordingHealth,
    requireGm,
    stamped,
    currentPlayerState,
    currentRolls,
    attachPlayerStream,
    themePayload,
    prefsPayload,
    settingsPayload,
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
    handlers,
    /** The feed's way to read events at once; set by server.ts after the feed exists. */
    onFeed(feed: { pollNow: () => void; resync?: () => void }): void {
      pollEventsNow = feed.pollNow;
      resyncFeed = feed.resync ?? ((): void => undefined);
    },
    start(): void {
      playerView.start(PLAYER_SOURCE_INTERVAL_MS);
      playerVaults?.start();
      // The heartbeat (item gm-health-line): the status again every STATUS_HEARTBEAT_MS, so a page
      // can tell "quiet" from "the stream died without telling it" (its watchdog is 45 s).
      if (heartbeatTimer === null) {
        heartbeatTimer = setInterval(() => {
          sse.broadcast('status', stamped(currentStatus), gmOnly);
        }, deps.statusHeartbeatMs ?? STATUS_HEARTBEAT_MS);
        heartbeatTimer.unref();
      }
      if (recordingHealthTimer === null) {
        const tick = (): void => void refreshRecordingHealth().catch(() => undefined);
        tick();
        recordingHealthTimer = setInterval(tick, deps.recordingHealthMs ?? RECORDING_HEALTH_MS);
        recordingHealthTimer.unref();
      }
    },
    close(): void {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (recordingHealthTimer) clearInterval(recordingHealthTimer);
      recordingHealthTimer = null;
      playerView.stop();
      playerVaults?.stop();
      if (playerTimer) clearTimeout(playerTimer);
      if (worldRetryTimer) clearTimeout(worldRetryTimer);
      // End the long-lived SSE responses first, or server.close() waits on them.
      sse.close();
      playerHub.close();
    },
  };
}
