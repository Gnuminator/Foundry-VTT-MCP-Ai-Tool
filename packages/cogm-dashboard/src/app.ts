import express, { type Express, type Request, type Response } from 'express';
import type { RecordUsageResult, UsageEvent } from '@gnuminator/shared';

import type { Config, Tone } from './config.js';
import type { Logger } from './logger.js';
import { ToolError, TimeoutError } from './feed/mcp-control-client.js';
import type { BridgeStatus, CombatState, GameFeedHandlers, WorldInfo } from './feed/types.js';
import { GameState } from './state.js';
import type { CoGm } from './ai/anthropic-co-gm.js';
import { CommentaryEngine } from './ai/commentary.js';
import { ErrorCommentaryEngine } from './ai/error-commentary.js';
import { buildAskUserMessage } from './ai/prompt.js';
import { SseHub } from './sse.js';
import { AccessJwtVerifier, accessTokenFrom } from './access-jwt.js';
import { resolveRole, isGm, type AuthRequest } from './auth.js';
import { classifyTool, toolArgs, type ToolKind } from './tool-policy.js';
import { jsonErrorHandler } from './error-handler.js';
import { gmOnly } from './redact.js';
import { hostAllowlist } from './host-allowlist.js';
import { mountOpenRoute, OPEN_PAGE_HEADERS, type OpenRouteOptions } from './open-route.js';
import { buildPlayerState } from './player/projection.js';
import { runDashboardPreflight } from './preflight.js';
import {
  isSessionSwitchAction,
  parseSessionSwitches,
  type SessionSwitchAction,
  type SessionSwitches,
} from './session-switches.js';
import { PlayerViewSource } from './player/source.js';
import { staticHeaders, type StaticHeaderGroup } from './static-headers.js';
import { PlayerDirectory, mountUsageRoute } from './usage-route.js';
import { mountHandoutSeenRoute } from './handout-seen-route.js';
import { mountSessionNotesRoute, type SessionNotesAction } from './session-notes-route.js';
import { mountHelpRoute } from './help-route.js';
import { mountMeRoute } from './me-route.js';
import { PlayerLinkStore } from './player-links.js';
import { THEMES, ThemeStore, isTheme } from './theme.js';
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
  /** Ready for session (D3): read, turn on or turn back off tonight's switches; absent on fakes. */
  sessionSwitches?(action: SessionSwitchAction): Promise<unknown>;
  /** The feature cards (I-064): every feature switch, read-only; absent on fakes. */
  featureSwitches?(): Promise<unknown>;
  /** My character (I-096): one player's character sheets; absent on fakes. */
  characterSheet?(userId: string): Promise<unknown>;
  /** Session notes (recap lane, D-087): list, get, put, approve; absent on fakes. */
  sessionNotes?(action: SessionNotesAction, params?: Record<string, unknown>): Promise<unknown>;
  readonly isConnected?: boolean;
}

export interface DashboardDeps {
  config: Config;
  logger: Logger;
  client: DashboardClient;
  coGm: CoGm;
  /** `/open` options (O4): the P1 origin allowlist (default none) and a test clock. */
  openRoute?: OpenRouteOptions;
  /** The built help (I-064); default dist/help.json next to the server. */
  helpFile?: string | URL;
  /** Fetches Cloudflare Access's public keys (I-022); default the global fetch. Tests stub it. */
  accessFetch?: ConstructorParameters<typeof AccessJwtVerifier>[1];
}

export interface Dashboard {
  app: Express;
  handlers: GameFeedHandlers;
  /** Start background work (player view polling). */
  start(): void;
  /** Stop background work and end every stream. */
  close(): void;
}

interface RuntimeSettings {
  paused: boolean;
  tone: Tone;
  model: string;
  commentOnErrors: boolean;
  /** Master switch for the write surface (GM Actions). Off by default for safety. */
  gmActionsEnabled: boolean;
}

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  mutates: ToolKind;
}

interface SecretTermsResult {
  matches?: Array<{ category?: unknown; term?: unknown }>;
}

const TOOL_CATALOG_TTL_MS = 60_000;
/** GM actions may run a guarded write (up to ~4 min in Foundry plus the outcome check). */
const GM_ACTION_TIMEOUT_MS = 300_000;
/**
 * The player page runs only its own script: no inline scripts or event handlers, even if
 * something slipped past the handout sanitizer (inline styles stay allowed for the HP bars).
 */
export const PLAYER_CSP =
  "default-src 'none'; script-src 'self'; style-src 'self' 'unsafe-inline'; connect-src 'self'; " +
  "img-src 'self' data:; font-src 'self'; base-uri 'none'; form-action 'none'; frame-ancestors 'self'";

/** The player page file and its header, on every URL that reaches it (static-headers.ts). */
export const PLAYER_PAGE_HEADERS: StaticHeaderGroup = {
  files: ['player.html', 'me.html'],
  apply: res => res.setHeader('Content-Security-Policy', PLAYER_CSP),
};
/** How often the player view context (visibility, handouts) is refreshed. */
const PLAYER_SOURCE_INTERVAL_MS = 5_000;
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
  const { config, logger, client, coGm } = deps;

  // --- Mutable runtime settings (controlled from the dashboard) --------------
  const settings: RuntimeSettings = {
    paused: false,
    tone: config.defaultTone,
    model: config.anthropicModel,
    commentOnErrors: config.commentOnErrors,
    gmActionsEnabled: false,
  };

  // The theme, chosen by the GM once per world (D-085); the players' page follows it.
  const themes = new ThemeStore(
    config.stateDir ? path.join(config.stateDir, 'dashboard-themes.json') : null,
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
  const playerHub = new SseHub(logger.child('player'));

  const commentary = new CommentaryEngine({
    coGm,
    state,
    logger,
    // AI commentary is GM-facing, never streamed to a player.
    broadcast: (type: string, payload: unknown): void => sse.broadcast(type, payload, gmOnly),
    settings: {
      getTone: (): Tone => settings.tone,
      getModel: (): string => settings.model,
      isPaused: (): boolean => settings.paused,
    },
    minIntervalMs: config.commentMinIntervalMs,
    debounceMs: config.commentDebounceMs,
    maxTokens: config.commentMaxTokens,
  });

  const errorCommentary = new ErrorCommentaryEngine({
    coGm,
    logger,
    // Diagnostics commentary is GM-facing, never streamed to a player.
    broadcast: (type: string, payload: unknown): void => sse.broadcast(type, payload, gmOnly),
    settings: {
      getModel: (): string => settings.model,
      isEnabled: (): boolean => settings.commentOnErrors,
    },
    minIntervalMs: config.errorCommentMinIntervalMs,
    debounceMs: config.commentDebounceMs,
    maxTokens: config.errorCommentMaxTokens,
  });

  // --- Live status / world ---------------------------------------------------
  let currentStatus: BridgeStatus = {
    controlChannel: 'disconnected',
    foundry: 'unknown',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  };
  let world: WorldInfo | null = null;
  let firstCombatSeen = false;
  let lastCombatJson = '';
  let worldRefreshInflight = false;
  let worldRetryTimer: NodeJS.Timeout | null = null;

  // --- Player view (M2) ------------------------------------------------------
  let playerTimer: NodeJS.Timeout | null = null;
  let lastPlayerStateJson = '';
  let lastHandoutsJson = '';

  const playerView = new PlayerViewSource(client, logger.child('player-view'), () =>
    schedulePlayerBroadcast()
  );

  function currentPlayerState(): ReturnType<typeof buildPlayerState> {
    return buildPlayerState({
      status: currentStatus,
      world,
      visibility: playerView.visibility,
      combat: state.combat,
      events: state.recentEvents,
      handouts: playerView.handouts,
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
    const handoutsJson = JSON.stringify(handouts);
    if (handoutsJson !== lastHandoutsJson) {
      lastHandoutsJson = handoutsJson;
      playerHub.broadcast('handouts', { handouts });
    }
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
    playerHub.send(res, 'theme', themePayload());
  }

  /** The current world's theme. Not game state: the same for the GM and the players. */
  function themePayload(): { theme: string; themes: readonly string[] } {
    return { theme: themes.get(world?.id), themes: THEMES };
  }

  function broadcastTheme(): void {
    sse.broadcast('theme', themePayload());
    playerHub.broadcast('theme', themePayload());
  }

  function settingsPayload(): Record<string, unknown> {
    return {
      paused: settings.paused,
      tone: settings.tone,
      model: settings.model,
      aiEnabled: coGm.enabled,
      commentOnErrors: settings.commentOnErrors,
      gmActionsEnabled: settings.gmActionsEnabled,
      pollIntervalMs: config.pollIntervalMs,
      commentMinIntervalMs: config.commentMinIntervalMs,
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

  async function refreshWorld(attempt = 0): Promise<void> {
    // Collapse concurrent triggers (transition + immediate poll) into one call.
    if (worldRefreshInflight) return;
    worldRefreshInflight = true;
    try {
      const raw = await client.callTool('get-world-info');
      world = mapWorld(raw);
      playerDirectory.harvest(raw);
      coGm.setWorld(world);
      sse.broadcast('world', world, gmOnly);
      schedulePlayerBroadcast();
      broadcastTheme();
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
    onStatus(status) {
      // World info only exists once Foundry is reachable; fetch it on the
      // transition INTO reachable (a failed fetch retries on its own backoff).
      const wasReachable = currentStatus.foundry === 'reachable';
      const becameReachable = status.foundry === 'reachable' && !wasReachable;
      currentStatus = status;
      sse.broadcast('status', status, gmOnly);
      schedulePlayerBroadcast();
      if (becameReachable) {
        void refreshWorld();
        void playerView.refresh();
      } else if (status.foundry !== 'reachable' && world !== null) {
        // Foundry dropped: invalidate the stale world so nothing acts on a world
        // that may be gone.
        world = null;
        coGm.setWorld(null);
        sse.broadcast('world', null, gmOnly);
      }
    },
    onEvents(events, meta) {
      const added = state.addEvents(events);
      if (added.length === 0) return;
      sse.broadcast('events', { events: added, initial: meta.initial }, gmOnly);
      schedulePlayerBroadcast();
      if (!meta.initial) commentary.notifyEvents(added);
    },
    onErrors(errors, meta) {
      const added = state.addErrors(errors);
      if (added.length === 0) return;
      sse.broadcast('errors', { errors: added, initial: meta.initial }, gmOnly);
      if (!meta.initial) errorCommentary.notifyErrors(added);
    },
    onCombat(combat: CombatState | null) {
      const prevSignature = state.combatSignature();
      state.setCombat(combat);

      const json = JSON.stringify(combat);
      if (json !== lastCombatJson) {
        lastCombatJson = json;
        sse.broadcast('combat', { combat }, gmOnly);
        schedulePlayerBroadcast();
      }

      const signature = state.combatSignature();
      if (firstCombatSeen && signature !== null && signature !== prevSignature) {
        commentary.notifyCombatChange();
      }
      firstCombatSeen = true;
    },
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
  if (accessVerifier) {
    app.use((req: Request, _res: Response, next: () => void) => {
      const token = accessTokenFrom(req.headers);
      if (!token) {
        next();
        return;
      }
      accessVerifier.verify(token).then(
        identity => {
          if (identity) (req as Request & AuthRequest).accessEmail = identity.email;
          next();
        },
        () => next()
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
  app.use(express.json({ limit: '256kb' }));
  // The player page and the /open confirm page get their headers from inside express.static,
  // by file name and file identity, so no URL spelling (`/player%2Ehtml`, `/Player.html`,
  // `/x/../player.html`) serves them without.
  app.use(
    express.static(config.publicDir, {
      setHeaders: staticHeaders(config.publicDir, [OPEN_PAGE_HEADERS, PLAYER_PAGE_HEADERS]),
    })
  );

  // Clean URL for the read-only player view (the static file is also at /player.html).
  // sendFile skips the static hook, so the route sets the page header itself; Express matches
  // routes case-insensitively and with an optional trailing slash (`/PLAYER`, `/player/`).
  app.get('/player', (_req: Request, res: Response) => {
    PLAYER_PAGE_HEADERS.apply(res);
    res.sendFile('player.html', { root: config.publicDir });
  });

  // My character (I-096): the player's own sheet behind their private link, and the GM's links.
  mountMeRoute(app, {
    client,
    links: playerLinks,
    directory: playerDirectory,
    requireGm,
    worldId: () => world?.id ?? null,
    theme: () => themes.get(world?.id),
    publicDir: config.publicDir,
    pageHeaders: res => PLAYER_PAGE_HEADERS.apply(res),
  });

  app.get('/api/health', (_req: Request, res: Response) => {
    res.json({
      ok: true,
      controlChannel: currentStatus.controlChannel,
      aiEnabled: coGm.enabled,
      splitEnabled: config.auth.splitEnabled,
    });
  });

  // Player endpoints: always projected, whatever the credential (M2).
  app.get('/api/player/state', (req: Request, res: Response) => {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json(currentPlayerState());
  });

  app.get('/api/player/stream', (req: Request, res: Response) => {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    attachPlayerStream(res);
  });

  app.get('/api/state', (req: Request, res: Response) => {
    const role = resolveRole(req, config.auth);
    if (!role) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    if (role === 'player') {
      // The player role gets exactly what /api/player/state serves.
      res.json({ role, ...currentPlayerState() });
      return;
    }
    res.json({
      role,
      status: currentStatus,
      combat: state.combat,
      events: state.recentEvents,
      errors: state.recentErrors,
      settings: settingsPayload(),
      world,
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
      attachPlayerStream(res);
      return;
    }
    sse.add(res, role);
    sse.send(res, 'role', { role });
    sse.send(res, 'status', currentStatus);
    if (world) sse.send(res, 'world', world);
    sse.send(res, 'settings', settingsPayload());
    sse.send(res, 'theme', themePayload());
    if (state.combat) sse.send(res, 'combat', { combat: state.combat });
    sse.send(res, 'events', { events: state.recentEvents, initial: true });
    sse.send(res, 'errors', { errors: state.recentErrors, initial: true });
  });

  app.post('/api/ask', requireGm, (req: Request, res: Response) => {
    const question = readStr(asRecord(req.body).question, '').trim();
    if (!question) {
      res.status(400).json({ error: 'A non-empty "question" is required.' });
      return;
    }
    if (!coGm.enabled) {
      res.status(400).json({ error: 'AI is disabled (no ANTHROPIC_API_KEY).' });
      return;
    }

    const genId = `ask-${Date.now().toString(36)}`;
    const tone = settings.tone;
    const model = settings.model;
    res.json({ accepted: true, id: genId });

    // A direct question preempts any in-flight auto-comment (latest-wins).
    // Commentary is GM-only: players never receive comment.* frames.
    const context = state.buildContext();
    sse.broadcast(
      'comment.start',
      { id: genId, kind: 'ask', tone, model, trigger: question },
      gmOnly
    );
    void coGm
      .stream({
        model,
        maxTokens: config.askMaxTokens,
        userMessage: buildAskUserMessage(tone, context, question),
        onDelta: text => sse.broadcast('comment.delta', { id: genId, text }, gmOnly),
      })
      .then(result => {
        if (result.aborted) {
          sse.broadcast('comment.aborted', { id: genId }, gmOnly);
        } else {
          sse.broadcast(
            'comment.done',
            { id: genId, text: result.text, usage: result.usage },
            gmOnly
          );
        }
      })
      .catch((error: unknown) => {
        sse.broadcast(
          'comment.error',
          { id: genId, message: error instanceof Error ? error.message : 'AI error' },
          gmOnly
        );
      });
  });

  // The theme, for any caller (the players' page loads it too).
  app.get('/api/theme', (req: Request, res: Response) => {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    res.json(themePayload());
  });

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

    switch (action) {
      case 'toggle-pause':
        settings.paused = !settings.paused;
        break;
      case 'pause':
        settings.paused = true;
        break;
      case 'resume':
        settings.paused = false;
        break;
      case 'set-tone':
        if (value === 'narrative' || value === 'tactical') settings.tone = value;
        break;
      case 'set-model':
        if (typeof value === 'string' && value.trim() !== '') settings.model = value.trim();
        break;
      case 'toggle-diag':
        settings.commentOnErrors = !settings.commentOnErrors;
        break;
      case 'set-diag':
        settings.commentOnErrors = value === true;
        break;
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

  app.post('/api/post-chat', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    const text = readStr(body.text, '').trim();
    if (!text) {
      res.status(400).json({ error: 'A non-empty "text" is required.' });
      return;
    }

    const message = `🧠 Co-GM: ${text}`;
    // Always a whisper. gmNames lists only the GMs logged in right now; with none (or no world
    // info yet) the module whispers to every GM user, and refuses rather than post publicly.
    const gmNames = world?.gmNames ?? [];
    const args: Record<string, unknown> = {
      message,
      messageType: 'whisper',
      whisperTargets: gmNames,
    };

    // Whisper guard (M2): a whisper reaches every client's data (only its display
    // is hidden), so text naming a GM secret needs the GM's explicit go-ahead.
    const guard: Promise<Array<{ category: string; term: string }>> =
      body.allowSecrets === true
        ? Promise.resolve([])
        : client.callTool<SecretTermsResult>('check-secret-terms', { text }).then(result =>
            (Array.isArray(result?.matches) ? result.matches : []).map(m => ({
              category: readStr(m.category, 'secret'),
              term: readStr(m.term, ''),
            }))
          );

    void guard
      .then(async matches => {
        if (matches.length > 0) {
          res.status(409).json({
            code: 'secret-terms',
            matches,
            error:
              'The text names GM secrets. Whispers reach every player client; send again with allowSecrets to post anyway.',
          });
          return;
        }
        await client.callTool('send-chat-message', args);
        res.json({ ok: true, whisperedTo: gmNames });
      })
      .catch((error: unknown) => {
        res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to post to Foundry chat.',
        });
      });
  });

  // --- Ready for session (D3, PB-17) --------------------------------------------
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
  });

  // The feature cards (I-064): every feature switch and its state, read-only. The bridge's
  // control method feature_switches; switching stays in Foundry or Ready for session.
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
        res.json({
          features: null,
          writesAllowed: null,
          error: error instanceof Error ? error.message : 'Could not read the features.',
        });
      });
  });

  app.get('/api/session/switches', requireGm, (_req: Request, res: Response) => {
    moduleSwitches('get')
      .then(switches =>
        res.json({ switches, gmActionsEnabled: settings.gmActionsEnabled, error: null })
      )
      .catch((error: unknown) => {
        res.json({
          switches: null,
          gmActionsEnabled: settings.gmActionsEnabled,
          error: error instanceof Error ? error.message : 'Could not read the switches.',
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
        res.status(502).json({
          ok: false,
          error: error instanceof Error ? error.message : 'Could not change the switches.',
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
        })
      )
      .then(result => res.json(result))
      .catch((error: unknown) => {
        res.status(500).json({
          error: error instanceof Error ? error.message : 'Pre-flight failed.',
        });
      });
  });

  // --- GM Actions: list + invoke bridge tools ----------------------------------
  app.get('/api/tools', requireGm, (req: Request, res: Response) => {
    getToolCatalog(req.query.refresh === '1')
      .then(tools => res.json({ tools, gmActionsEnabled: settings.gmActionsEnabled }))
      .catch((error: unknown) => {
        res.status(502).json({
          error: error instanceof Error ? error.message : 'Failed to list bridge tools.',
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

    client
      // A GM action may run a guarded write, which waits up to about 4 minutes
      // for Foundry and then for its outcome (PB-04); reads keep the short timeout.
      .callTool(name, args, mutates === 'read' ? {} : { timeoutMs: GM_ACTION_TIMEOUT_MS })
      .then(result => {
        res.json({ ok: true, name, mutates, result });
        // A reveal or hide may have changed the handouts: refresh the player view.
        if (name === 'apply-planned-change' || name === 'undo-change') void playerView.refresh();
      })
      .catch((error: unknown) => {
        const kind =
          error instanceof ToolError
            ? 'tool'
            : error instanceof TimeoutError
              ? 'timeout'
              : 'channel';
        res.status(kind === 'tool' ? 422 : 502).json({
          ok: false,
          name,
          kind,
          error: error instanceof Error ? error.message : 'Tool call failed.',
        });
      });
  });

  // Live write sweep helper (I-016, scripts/live-write-sweep.mjs): scene snapshot, a sweep
  // combat and the clean-up. The module refuses outside the test worlds (SWEEP_WORLD_IDS:
  // ai-tool-test, ai-tool-walkthrough). Not a
  // tool.
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
    client
      .liveSweep(request)
      .then(result => res.json({ ok: true, result }))
      .catch((error: unknown) => {
        res.status(502).json({
          ok: false,
          error: error instanceof Error ? error.message : 'Live sweep helper failed.',
        });
      });
  });

  // Last: JSON errors without stack traces or paths (the default handler shows both).
  app.use(jsonErrorHandler(logger));

  return {
    app,
    handlers,
    start(): void {
      playerView.start(PLAYER_SOURCE_INTERVAL_MS);
    },
    close(): void {
      coGm.abortActive();
      playerView.stop();
      if (playerTimer) clearTimeout(playerTimer);
      if (worldRetryTimer) clearTimeout(worldRetryTimer);
      // End the long-lived SSE responses first, or server.close() waits on them.
      sse.close();
      playerHub.close();
    },
  };
}
