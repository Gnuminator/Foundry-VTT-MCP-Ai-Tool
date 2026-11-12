import express, { type Express, type Request, type Response } from 'express';
import {
  createSpaceStatusReader,
  type PlayerHandout,
  type RecordUsageResult,
  type UsageEvent,
} from '@gnuminator/shared';

import { normalizeFoundryUrl, withPortraitUrls } from './combat-images.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import { ToolError, TimeoutError } from './feed/mcp-control-client.js';
import type { BridgeStatus, CombatState, GameFeedHandlers, WorldInfo } from './feed/types.js';
import { GameState } from './state.js';
import { SseHub } from './sse.js';
import { AccessJwtVerifier, accessTokenFrom } from './access-jwt.js';
import { resolveRole, isGm, type AuthRequest } from './auth.js';
import { CACHED_READ_TOOLS, createReadCache } from './read-cache.js';
import { classifyTool, toolArgs, type ToolKind } from './tool-policy.js';
import { jsonErrorHandler } from './error-handler.js';
import { gmOnly } from './redact.js';
import {
  readRecordingHealth,
  type PumpSnapshot,
  type RecordingHealth,
} from './recording-health.js';
import { hostAllowlist } from './host-allowlist.js';
import { mountOpenRoute, type OpenRouteOptions } from './open-route.js';
import { buildPlayerState } from './player/projection.js';
import { buildRollRows, openRolls } from './roll-status.js';
import { runDashboardPreflight } from './preflight.js';
import {
  isSessionSwitchAction,
  parseSessionSwitches,
  type SessionSwitchAction,
  type SessionSwitches,
} from './session-switches.js';
import { PlayerViewSource } from './player/source.js';
import type { RouteContext } from './routes/context.js';
import { mountApiStreamRoutes } from './routes/api-stream.js';
import { mountPageRoutes, PLAYER_PAGE_HEADERS } from './routes/pages-static.js';
import { PlayerDirectory, mountUsageRoute } from './usage-route.js';
import { mountHandoutSeenRoute } from './handout-seen-route.js';
import { mountSessionNotesRoute, type SessionNotesAction } from './session-notes-route.js';
import { mountHelpRoute } from './help-route.js';
import { mountMeRoute } from './me-route.js';
import { playerConnectorFromEnv, type PlayerConnectorOptions } from './player-connector.js';
import { mountPlayerRoute } from './player-route.js';
import { mountSpaceRoute } from './space-route.js';
import { VersionTracker, defaultKitLastRunFile, mountVersionsRoute } from './versions.js';
import { PlayerLinkStore } from './player-links.js';
import { DashboardPrefsStore, parsePrefsChange } from './dashboard-prefs.js';
import { THEMES, ThemeStore, isTheme, type ThemeId } from './theme.js';
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

/** The bridge calls the dashboard makes (the MCP control client satisfies it). */
export interface DashboardClient {
  callTool<T = unknown>(
    name: string,
    args?: Record<string, unknown>,
    options?: { timeoutMs?: number }
  ): Promise<T>;
  listTools(): Promise<unknown[]>;
  /** Hand usage events to the bridge (I-084); absent on fakes, "Unknown method" on old backends. */
  recordUsage?(events: UsageEvent[]): Promise<RecordUsageResult>;
  /** A player opened a handout (I-039 seen log); absent on fakes and old backends. */
  recordHandoutSeen?(pageId: string, userId: string, name: string): Promise<{ recorded: boolean }>;
  /** The live write sweep's helper (I-016; test world only); absent on fakes. */
  liveSweep?(request: Record<string, unknown>): Promise<unknown>;
  /** Turn on for tonight (D3): read, turn on or turn back off tonight's switches; absent on fakes. */
  sessionSwitches?(action: SessionSwitchAction): Promise<unknown>;
  /** The feature cards (I-064): every feature switch, read-only; absent on fakes. */
  featureSwitches?(): Promise<unknown>;
  /** My character (I-096): one player's character sheets; absent on fakes. */
  characterSheet?(userId: string): Promise<unknown>;
  /** The player's roll button: the module rolls for their character; absent on fakes. */
  playerRoll?(userId: string, buttonId: string): Promise<unknown>;
  /** "Upload my portrait": a player's picture for their own character; absent on fakes. */
  playerPortrait?(
    userId: string,
    actorId: string,
    target: 'portrait' | 'both',
    data: string
  ): Promise<unknown>;
  /** The player connector (D-136): the five tool definitions and one tool run; absent on fakes. */
  listPlayerTools?(): Promise<unknown>;
  playerTool?(userId: string, tool: string, args: unknown): Promise<unknown>;
  /** Session notes (recap lane, D-087): list, get, put, approve; absent on fakes. */
  sessionNotes?(action: SessionNotesAction, params?: Record<string, unknown>): Promise<unknown>;
  readonly isConnected?: boolean;
}

export interface DashboardDeps {
  config: Config;
  logger: Logger;
  client: DashboardClient;
  /** `/open` options (O4): the P1 origin allowlist (default none) and a test clock. */
  openRoute?: OpenRouteOptions;
  /** The built help (I-064); default dist/help.json next to the server. */
  helpFile?: string | URL;
  /** Fetches Cloudflare Access's public keys (I-022); default the global fetch. Tests stub it. */
  accessFetch?: ConstructorParameters<typeof AccessJwtVerifier>[1];
  /** The player connector (D-136); default from the environment (`FOUNDRY_AI_PLAYER_CONNECTOR*`). */
  playerConnector?: PlayerConnectorOptions;
  /** The storage space check's status file; default env FOUNDRY_AI_SPACE_STATUS, else the Pi's path. */
  spaceStatusFile?: string;
  /** Test clock for the space check's age. */
  spaceNow?: () => number;
  /** Test only: the status heartbeat interval in ms (default STATUS_HEARTBEAT_MS). */
  statusHeartbeatMs?: number;
  /** Test only: the bot status URL (default config.botStatusUrl). */
  botStatusUrl?: string;
  /** Test only: how often the Recorder and Play log dots are re-read (default RECORDING_HEALTH_MS). */
  recordingHealthMs?: number;
  /** The test kit's last-run.json for the version tracker; default env or the PC's kit home. */
  kitLastRunFile?: string | null;
}

export interface Dashboard {
  app: Express;
  handlers: GameFeedHandlers;
  /** The feed's way to read events at once; server.ts sets it once the feed exists. */
  onFeed(feed: { pollNow: () => void; resync?: () => void }): void;
  /** Start background work (player view polling). */
  start(): void;
  /** Stop background work and end every stream. */
  close(): void;
}

interface RuntimeSettings {
  /** Master switch for the write surface (GM Actions). Off by default for safety. */
  gmActionsEnabled: boolean;
}

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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

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

  /** Express middleware: 401/403 unless the caller resolves to the GM role. */
  function requireGm(req: Request, res: Response, next: () => void): void {
    const role = resolveRole(req, config.auth);
    if (!isGm(role)) {
      res
        .status(role ? 403 : 401)
        .json({ code: 'gm-required', error: 'GM access is required for this action.' });
      return;
    }
    next();
  }

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
  const app = express();
  // Cloudflare Access (I-022): a verified token's email, set on the request before any route
  // resolves a role. Without the config, or without a valid token, nothing is set.
  const accessVerifier = config.auth.access
    ? new AccessJwtVerifier(config.auth.access, deps.accessFetch)
    : null;
  if (config.auth.gmEmails.length > 0 && !accessVerifier) {
    logger.warn(
      'GM_EMAILS is set but CF_ACCESS_TEAM_DOMAIN and CF_ACCESS_AUD are not: email logins are off'
    );
  }
  // First, before every route and static file: refuse any Host the dashboard does not know
  // (DNS rebinding; host-allowlist.ts). Both modes; with the split on it is defense in depth.
  app.use(
    hostAllowlist({
      bindHost: config.host,
      allowedHosts: config.allowedHosts,
      logger: logger.child('host'),
    })
  );
  // A token that does not verify (or cannot be checked) is marked, not just ignored: a GM behind
  // it would otherwise be told they are a player (presentedUnverifiedAccess, /api/state).
  if (accessVerifier || config.auth.gmEmails.length > 0) {
    app.use((req: Request, _res: Response, next: () => void) => {
      const token = accessTokenFrom(req.headers);
      if (!token) {
        next();
        return;
      }
      const request = req as Request & AuthRequest;
      if (!accessVerifier) {
        request.accessTokenUnverified = true;
        next();
        return;
      }
      accessVerifier.verify(token).then(
        identity => {
          if (identity) request.accessEmail = identity.email;
          else request.accessTokenUnverified = true;
          next();
        },
        () => {
          request.accessTokenUnverified = true;
          next();
        }
      );
    });
  }
  // "Open in Foundry" (O4, open-route.ts). Before the JSON parser: its POST parses its own
  // body after its guards.
  mountOpenRoute(app, { ...deps.openRoute, config, client, logger: logger.child('open') });
  // The usage log (I-084, usage-route.ts): write-only, parses its own small body.
  mountUsageRoute(app, {
    config,
    client,
    logger: logger.child('usage'),
    directory: playerDirectory,
    requireGm,
  });
  // The handout seen log (I-039): parses its own small body; the GM's drawer refreshes on a new open.
  mountHandoutSeenRoute(app, {
    config,
    client,
    logger: logger.child('handouts'),
    directory: playerDirectory,
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
    directory: playerDirectory,
    logger,
    ...(deps.accessFetch ? { accessFetch: deps.accessFetch } : {}),
  });
  app.use(express.json({ limit: '256kb' }));
  mountPageRoutes(app, ctx);

  // My character (I-096): the player's own sheet behind their private link, and the GM's links.
  mountMeRoute(app, {
    client,
    links: playerLinks,
    connector: playerConnector.enabled ? playerConnector.store : null,
    directory: playerDirectory,
    requireGm,
    logger,
    worldId: () => world?.id ?? null,
    events: () => state.recentEvents,
    onRolled: () => pollEventsNow(),
    theme: () => themes.get(world?.id),
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
      enabled: (): boolean => prefs.get(world?.id).versionTracker,
      getModules: (): Promise<unknown> => client.callTool('get-modules', { includeManifest: true }),
      kitFile: deps.kitLastRunFile ?? defaultKitLastRunFile(),
    }),
  });

  mountApiStreamRoutes(app, ctx);

  app.post('/api/control', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    const action = readStr(body.action, '');
    const value = body.value;

    if (action === 'set-theme') {
      if (!isTheme(value)) {
        res.status(400).json({ error: `Unknown theme; use one of: ${THEMES.join(', ')}.` });
        return;
      }
      const worldId = world?.id;
      if (!worldId) {
        res
          .status(409)
          .json({ error: 'The world is not known yet; try again once Foundry is connected.' });
        return;
      }
      themes
        .set(worldId, value)
        .then(() => {
          broadcastTheme();
          res.json(themePayload());
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
      const worldId = world?.id;
      if (!worldId) {
        res
          .status(409)
          .json({ error: 'The world is not known yet; try again once Foundry is connected.' });
        return;
      }
      prefs
        .update(worldId, change)
        .then(() => {
          sse.broadcast('prefs', prefsPayload(), gmOnly);
          res.json(prefsPayload());
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

    broadcastSettings();
    res.json(settingsPayload());
  });

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

  // In-app help (I-064): the GM guide pages, rendered at build time into dist/help.json.
  // In dist (npm start) the file sits next to this module; in dev mode (tsx src/) it is ../dist.
  mountHelpRoute(app, {
    file: deps.helpFile ?? [
      new URL('./help.json', import.meta.url),
      new URL('../dist/help.json', import.meta.url),
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

  // The feature cards (I-064): every feature switch and its state, read-only. The bridge's
  // control method feature_switches; switching stays in Foundry or Turn on for tonight.
  app.get('/api/features', requireGm, (_req: Request, res: Response) => {
    if (typeof client.featureSwitches !== 'function') {
      res.json({ features: null, writesAllowed: null, error: 'This bridge cannot list features.' });
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
        });
      })
      .catch((error: unknown) => {
        logger.warn('Could not read the features', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.json({
          features: null,
          writesAllowed: null,
          error: 'Could not read the switches from Foundry.',
        });
      });
  });

  app.get('/api/session/switches', requireGm, (_req: Request, res: Response) => {
    moduleSwitches('get')
      .then(switches =>
        res.json({ switches, gmActionsEnabled: settings.gmActionsEnabled, error: null })
      )
      .catch((error: unknown) => {
        logger.warn('Could not read the switches', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.json({
          switches: null,
          gmActionsEnabled: settings.gmActionsEnabled,
          error: 'Could not read the switches from Foundry.',
        });
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
      broadcastSettings();
    }
    moduleSwitches(action)
      .then(switches => {
        // Ready turns GM Actions on only once the module's switches are on: not when Foundry
        // dropped one (the reply's `failed` names it).
        const failed = switches?.failed.length ?? 0;
        if (action === 'ready' && failed === 0 && !settings.gmActionsEnabled) {
          settings.gmActionsEnabled = true;
          broadcastSettings();
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
          playerState: currentPlayerState(),
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
        if (name === 'request-player-rolls') pollEventsNow();
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
