import type { Response } from 'express';
import type { PlayerHandout } from '@gnuminator/shared';

import { normalizeFoundryUrl, withPortraitUrls } from './combat-images.js';
import type { DashboardDeps } from './dashboard-types.js';
import type { BridgeStatus, CombatState, GameFeedHandlers, FeedWorld } from './feed/types.js';
import type { GameState } from './state.js';
import type { SseHub } from './sse.js';
import type { ReadCache } from './read-cache.js';
import { gmOnly } from './redact.js';
import {
  readRecordingHealth,
  type PumpSnapshot,
  type RecordingHealth,
} from './recording-health.js';
import { buildPlayerState } from './player/projection.js';
import { buildRollRows, openRolls } from './roll-status.js';
import { PlayerViewSource } from './player/source.js';
import type { RuntimeSettings } from './routes/context.js';
import { asRecord, readStr } from './routes/util.js';
import type { PlayerDirectory } from './usage-route.js';
import type { DashboardPrefsStore } from './dashboard-prefs.js';
import { THEMES, type ThemeId, type ThemeStore } from './theme.js';
import { PlayerLogStore } from './player-vault/log-store.js';
import { PlayerVaultService } from './player-vault/service.js';
import type { VaultPlayer } from './player-vault/types.js';
import * as path from 'path';

/**
 * The dashboard's live state: the bridge status and world as the feed reports them, the feed
 * handlers that fold them into the GM and player streams, the debounced player broadcasts, the
 * Recorder and Play log dots, and the timers behind them. `app.ts` builds the stores and hubs,
 * hands them in, and reads the state back only through the accessors returned here (never copies).
 */

/** How often the player view context (visibility, handouts) is refreshed. */
const PLAYER_SOURCE_INTERVAL_MS = 5_000;
/** How often the GM stream repeats the bridge status (the page's watchdog allows 45 s of silence). */
const STATUS_HEARTBEAT_MS = 17_000;
/** How often the Recorder and Play log dots of the health line are re-read. */
const RECORDING_HEALTH_MS = 15_000;
/** Player-state broadcasts are coalesced over this window. */
const PLAYER_BROADCAST_DEBOUNCE_MS = 250;

function mapWorld(raw: unknown): FeedWorld {
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

/** What the live state reads from `app.ts`. */
interface LiveStateInputs {
  deps: DashboardDeps;
  settings: RuntimeSettings;
  state: GameState;
  sse: SseHub;
  playerHub: SseHub;
  readCache: ReadCache;
  themes: ThemeStore;
  prefs: DashboardPrefsStore;
  playerDirectory: PlayerDirectory;
  /** Set by `server.ts` after the feed exists, so read lazily. */
  resyncFeed: () => void;
}

interface LiveState {
  handlers: GameFeedHandlers;
  playerView: PlayerViewSource;
  world: () => FeedWorld | null;
  status: () => BridgeStatus;
  recordingHealth: () => RecordingHealth;
  stamped: <S extends object>(s: S) => S & { now: string };
  currentPlayerState: () => ReturnType<typeof buildPlayerState>;
  currentRolls: () => {
    rows: ReturnType<typeof buildRollRows>;
    open: ReturnType<typeof openRolls>;
  };
  attachPlayerStream: (res: Response) => void;
  themePayload: () => { theme: string; themes: readonly string[] };
  prefsPayload: () => Record<string, unknown>;
  settingsPayload: () => Record<string, unknown>;
  broadcastTheme: () => void;
  broadcastSettings: () => void;
  /** Start the player view refresh, the vaults, the status heartbeat and the health dots. */
  start: () => void;
  /** Stop their timers (the hubs are closed by the caller). */
  stop: () => void;
}

export function createLiveState(inputs: LiveStateInputs): LiveState {
  const { deps, settings, state, sse, playerHub, readCache, themes, prefs, playerDirectory } =
    inputs;
  const { config, logger, client } = deps;

  let currentStatus: BridgeStatus = {
    controlChannel: 'disconnected',
    foundry: 'unknown',
    lastError: null,
    lastPollAt: null,
    foundryDownSince: null,
  };
  let world: FeedWorld | null = null;
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

  // --- World -------------------------------------------------------------------
  /** A different world opened: the old world's events, errors and combat must not show. */
  function resetForNewWorld(): void {
    state.reset();
    readCache.clear();
    lastCombatJson = '';
    sse.broadcast('reset', {}, gmOnly);
    // The new world's first reads may have come before this; read them again.
    inputs.resyncFeed();
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

  return {
    handlers,
    playerView,
    world: () => world,
    status: () => currentStatus,
    recordingHealth: () => recordingHealth,
    stamped,
    currentPlayerState,
    currentRolls,
    attachPlayerStream,
    themePayload,
    prefsPayload,
    settingsPayload,
    broadcastTheme,
    broadcastSettings,
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
    stop(): void {
      if (heartbeatTimer) clearInterval(heartbeatTimer);
      heartbeatTimer = null;
      if (recordingHealthTimer) clearInterval(recordingHealthTimer);
      recordingHealthTimer = null;
      playerView.stop();
      playerVaults?.stop();
      if (playerTimer) clearTimeout(playerTimer);
      if (worldRetryTimer) clearTimeout(worldRetryTimer);
    },
  };
}
