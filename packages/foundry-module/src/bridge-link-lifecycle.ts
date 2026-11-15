/**
 * The bridge link's lifecycle in this browser: starting and stopping the socket bridge, the
 * connection state kept in memory, the light heartbeat, the "server not found" notice, and the
 * GM link toasts with their relay to the other GM browsers (the `linkState` world setting).
 *
 * The socket bridge itself owns reconnecting (forever, with backoff); this class only starts one
 * bridge at a time, notes the state and decides what the GM is told. `main.ts` creates one and
 * delegates `start`, `stop`, `restart` and the link part of `getStatus` to it.
 */
import { MODULE_ID } from './constants.js';
import { setBridgeLink } from './bridge-link.js';
import { GM_GUIDE_URL } from './help-menu.js';
import {
  createLinkNotifier,
  createLinkRelayReceiver,
  parseLinkRelayState,
  type LinkRelayStateName,
} from './link-notice.js';
import { SocketBridge, type BridgeConnectionInfo } from './socket-bridge.js';
import { LINK_STATE_CHANGED_HOOK, type ModuleSettings, isBridgeUser } from './settings.js';
import { logInfo } from './log.js';

/** How long the "MCP server not found" notice stays quiet after it was shown (per browser). */
const SERVER_NOTICE_THROTTLE_MS = 10 * 60 * 1000;

/** The link part of the module's `getStatus()`. */
export interface BridgeLinkStatus {
  connected: boolean;
  connectionState: string;
  connectionInfo: BridgeConnectionInfo | undefined;
  lastConnectionState: string;
  lastActivity: string;
  heartbeatActive: boolean;
}

/** What the lifecycle needs from the module. */
interface BridgeLinkLifecycleOptions {
  settings: ModuleSettings;
  /** False until the module's `init` finished; `start()` refuses before that. */
  isInitialized: () => boolean;
}

export class BridgeLinkLifecycle {
  private readonly settings: ModuleSettings;
  private readonly isInitialized: () => boolean;
  private socketBridge: SocketBridge | null = null;
  private heartbeatInterval: number | null = null;
  private lastActivity: Date = new Date();
  private isConnecting = false;
  /** In memory only: writing these to world settings on every reconnect wrote to the world. */
  private lastConnectionState = 'disconnected';
  private lastServerNoticeAt = 0;
  private heartbeatWarned = false;
  /** GM-only toasts when an open link is lost and when it is back. */
  private linkNotifier = createLinkNotifier({
    notify: (message, level) => {
      if (level === 'warn') ui.notifications?.warn(message);
      else ui.notifications?.info(message);
    },
    isGM: () => this.isGMUser(),
    enabled: () => this.settings.getSetting('enableNotifications') !== false,
    publish: state => this.publishLinkState(state),
  });
  /** The other GMs' side: shows the holder's notices in a browser that does not hold the link. */
  private linkRelay = createLinkRelayReceiver({
    notify: (message, level) => {
      if (level === 'warn') ui.notifications?.warn(message);
      else ui.notifications?.info(message);
    },
    isGM: () => this.isGMUser(),
    enabled: () => this.settings.getSetting('enableNotifications') !== false,
    holdsLink: () => this.socketBridge !== null,
  });

  /** In memory only: what this browser last wrote to `linkState` (set once the write succeeded). */
  private lastPublishedLinkState: LinkRelayStateName | null = null;
  /** The state whose write is under way, so a repeat before it finishes writes nothing. */
  private publishingLinkState: LinkRelayStateName | null = null;
  /** Counts writes so a late settle of an older write cannot overwrite the record of a newer one. */
  private linkStateWriteSeq = 0;

  constructor(options: BridgeLinkLifecycleOptions) {
    this.settings = options.settings;
    this.isInitialized = options.isInitialized;
  }

  /**
   * Only a browser that is the chosen bridge user may write the notice: with "Any GM" (no user
   * chosen) every GM browser holds a link and each would write, and a user without the right to
   * change world settings cannot write at all.
   */
  private canPublishLinkState(): boolean {
    const bridgeUserId = this.settings.getSetting('bridgeUserId');
    if (typeof bridgeUserId !== 'string' || bridgeUserId === '') return false;
    if (!isBridgeUser(bridgeUserId, game.user?.id)) return false;
    const user = game.user as unknown as { can?: (permission: string) => boolean } | undefined;
    return user?.can?.('SETTINGS_MODIFY') === true;
  }

  /** Writes the holder's notice state to the world so every other GM browser can show it. */
  private publishLinkState(state: LinkRelayStateName): void {
    // One write per change of notice: a repeated "lost" (a failed start() while the outage lasts) writes nothing.
    // A write under way is the newest intent: compare with it first, so "lost" after "up" went out is not skipped as a repeat.
    if (state === (this.publishingLinkState ?? this.lastPublishedLinkState)) return;
    if (!this.canPublishLinkState()) return;
    this.publishingLinkState = state;
    const seq = ++this.linkStateWriteSeq;
    const done = (error?: unknown): void => {
      // Only the newest write clears the marker: an older write of the same state settling late
      // must not clear the marker of a newer one still under way (up, lost, up).
      if (seq === this.linkStateWriteSeq) this.publishingLinkState = null;
      if (error !== undefined) {
        console.warn(`[${MODULE_ID}] Could not share the link state with other GMs:`, error);
      } else if (seq === this.linkStateWriteSeq) {
        this.lastPublishedLinkState = state;
      }
    };
    try {
      const result = game.settings.set(MODULE_ID, 'linkState', { state, at: Date.now() });
      void Promise.resolve(result).then(
        () => done(),
        error => done(error ?? new Error('write failed'))
      );
    } catch (error) {
      done(error ?? new Error('write failed'));
    }
  }

  /** Shows the holder's notices in this GM browser: on every stored change, and once for the value present now. */
  watchLinkState(): void {
    Hooks.on(LINK_STATE_CHANGED_HOOK, () => this.applyStoredLinkState());
    this.applyStoredLinkState();
  }

  /** The stored link state changed (or was read when this GM joined): show it unless this browser holds the link. */
  applyStoredLinkState(): void {
    try {
      this.linkRelay.apply(parseLinkRelayState(game.settings.get(MODULE_ID, 'linkState')));
    } catch (error) {
      console.warn(`[${MODULE_ID}] Could not read the shared link state:`, error);
    }
  }

  /**
   * Check if current user is a GM (silent check for security)
   */
  private isGMUser(): boolean {
    return game.user?.isGM || false;
  }

  /**
   * Whether the current user may run the bridge. A GM (or Assistant GM) always
   * may; the `allowNonGmAccess` setting (default off) additionally lets a non-GM
   * user start it from their own browser. SECURITY: the bridge turns the running
   * browser into an AI control surface.
   */
  isBridgeAllowedForUser(): boolean {
    return this.isGMUser() || this.settings.getSetting('allowNonGmAccess') === true;
  }

  /**
   * Start the MCP bridge connection
   */
  async start(): Promise<void> {
    if (!this.isInitialized()) {
      throw new Error('Module not initialized');
    }

    // SECURITY: double-check access (safety measure). GM-only unless allowNonGmAccess is on.
    if (!this.isBridgeAllowedForUser()) {
      console.warn(`[${MODULE_ID}] Attempted to start bridge without access`);
      return;
    }

    // One bridge user holds the link (PB-02). Other GMs skip it quietly.
    const bridgeUserId = this.settings.getSetting('bridgeUserId');
    if (!isBridgeUser(bridgeUserId, game.user?.id)) {
      logInfo(`[${MODULE_ID}] Not the bridge user; this browser does not start the link`);
      return;
    }

    if (this.socketBridge?.isConnected() || this.isConnecting) {
      logInfo(`[${MODULE_ID}] Bridge already running or connecting`);
      return;
    }

    // Never leave an old bridge (and its reconnect timer) running beside a new one.
    if (this.socketBridge) {
      this.socketBridge.disconnect();
      this.socketBridge = null;
      setBridgeLink(null);
    }

    // A new bridge starts with a clean notifier: a "lost" left by the old one must not turn the
    // first link of this one (which already shows "AI Tool connected") into "link is back".
    // Silent: a start() during an outage must not tell the other GMs the outage ended.
    this.linkNotifier.reset({ silent: true });
    // A "lost" left in the world by an earlier holder (browser killed mid-outage) must not stay on other GMs' screens.
    if (
      this.isGMUser() &&
      this.settings.getSetting('enableNotifications') !== false &&
      this.lastPublishedLinkState !== 'lost' &&
      this.publishingLinkState !== 'lost' &&
      parseLinkRelayState(game.settings.get(MODULE_ID, 'linkState')).state === 'lost'
    ) {
      this.publishLinkState('quiet');
    }

    this.isConnecting = true;
    let dialled = false;
    let bridge: SocketBridge | undefined;

    try {
      logInfo(`[${MODULE_ID}] Starting MCP bridge...`);

      const config = this.settings.getBridgeConfig();
      config.onLinkChange = (up): void => {
        if (up) {
          this.linkNotifier.up();
          // A reconnect after a failed first connect: start() threw, so its own heartbeat
          // start never ran. Only for the bridge that is still current, and not while start()
          // is still connecting (it sets the state and starts the heartbeat itself).
          if (this.socketBridge === bridge && !this.isConnecting) {
            this.lastConnectionState = 'connected';
            this.updateLastActivity();
            if (this.heartbeatInterval === null) this.startHeartbeat();
          }
        } else this.linkNotifier.down();
      };

      // Validate configuration
      const validation = this.settings.validateSettings();
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Create and connect socket bridge
      bridge = new SocketBridge(config);
      this.socketBridge = bridge;
      setBridgeLink(bridge);
      dialled = true;
      await bridge.connect();

      // stop() ran while the connect was pending: this bridge is gone, so leave the state alone.
      if (this.socketBridge !== bridge) {
        logInfo(`[${MODULE_ID}] Bridge was stopped while connecting`);
        return;
      }

      // Log connection details for debugging
      const connectionInfo = this.socketBridge.getConnectionInfo();
      logInfo(
        `[${MODULE_ID}] Bridge started successfully - Type: ${connectionInfo.type}, State: ${connectionInfo.state}`
      );

      this.lastConnectionState = 'connected';
      // A start() during an outage that connects: the other GMs were told "lost", so tell them it is back.
      if (this.lastPublishedLinkState === 'lost' || this.publishingLinkState === 'lost') {
        this.publishLinkState('up');
      }
      this.updateLastActivity();

      // Start heartbeat monitoring if enabled
      this.startHeartbeat();

      // Show connection notification based on user preference
      if (this.settings.getSetting('enableNotifications')) {
        ui.notifications.info('AI Tool connected');
      }
      logInfo(
        `[${MODULE_ID}] GM connection established - Bridge active for user: ${game.user?.name}`
      );
    } catch (error) {
      // stop() ran while the connect was pending and cancelled it: not a failure, nothing to report.
      if (bridge && this.socketBridge !== bridge) {
        logInfo(`[${MODULE_ID}] Bridge was stopped while connecting`);
        return;
      }
      // Log as warning instead of error for initial connection failures
      console.warn(`[${MODULE_ID}] Failed to start bridge:`, error);

      // Show helpful message for GM users when MCP server isn't available
      if (dialled && this.isGMUser()) {
        // The retries go on in the background: if a retry opens the link, owe the "back" toast.
        this.linkNotifier.markLost();
        // A browser WebSocket error never says why (no ECONNREFUSED), so the first
        // failed start is the signal. Throttled in memory so a long outage does not spam.
        const now = Date.now();
        if (now - this.lastServerNoticeAt >= SERVER_NOTICE_THROTTLE_MS) {
          this.lastServerNoticeAt = now;
          ui.notifications?.warn(
            `Cannot reach the AI Tool server. Is it started? Troubleshooting: ${GM_GUIDE_URL}troubleshooting/`
          );
        }
      }

      this.lastConnectionState = 'error';
      throw error;
    } finally {
      // A stop() already cleared the flag, and a newer start() may own it now.
      if (!bridge || this.socketBridge === bridge) this.isConnecting = false;
    }
  }

  /**
   * Stop the MCP bridge connection
   */
  stop(): Promise<void> {
    this.stopNow();
    return Promise.resolve();
  }

  private stopNow(): void {
    if (!this.socketBridge) {
      logInfo(`[${MODULE_ID}] Bridge not running`);
      return;
    }

    try {
      logInfo(`[${MODULE_ID}] Stopping MCP bridge...`);

      // Stop heartbeat monitoring
      this.stopHeartbeat();
      // A connect still pending on this bridge must not keep start() locked out.
      this.isConnecting = false;

      this.socketBridge.disconnect();
      this.socketBridge = null;
      setBridgeLink(null);

      this.lastConnectionState = 'disconnected';

      // Stopped on purpose: no "lost" or "back" toast for this.
      this.linkNotifier.reset();

      logInfo(`[${MODULE_ID}] Bridge stopped`);

      // Show disconnection notification based on user preference
      if (this.settings.getSetting('enableNotifications')) {
        ui.notifications.info('AI Tool disconnected');
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] Error stopping bridge:`, error);
    }
  }

  /**
   * Restart the bridge with current settings
   */
  async restart(): Promise<void> {
    logInfo(`[${MODULE_ID}] Restarting bridge...`);

    await this.stop();

    // Small delay to ensure clean disconnect
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (this.settings.getSetting('enabled')) {
      await this.start();
    }
  }

  /**
   * The link part of the module's status
   */
  getStatus(): BridgeLinkStatus {
    return {
      connected: this.socketBridge?.isConnected() ?? false,
      connectionState: this.socketBridge?.getConnectionState() ?? 'disconnected',
      connectionInfo: this.socketBridge?.getConnectionInfo(),
      lastConnectionState: this.lastConnectionState,
      lastActivity: this.lastActivity.toISOString(),
      heartbeatActive: this.heartbeatInterval !== null,
    };
  }

  /**
   * Start heartbeat monitoring
   */
  private startHeartbeat(): void {
    this.stopHeartbeat(); // Ensure no duplicate intervals

    const interval = this.settings.getSetting('heartbeatInterval') * 1000; // Convert to milliseconds

    this.heartbeatInterval = window.setInterval(() => {
      this.performHeartbeat();
    }, interval);

    logInfo(`[${MODULE_ID}] Heartbeat monitoring started (${interval}ms interval)`);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      logInfo(`[${MODULE_ID}] Heartbeat monitoring stopped`);
    }
  }

  /**
   * Perform heartbeat check. Light on purpose: the socket bridge owns
   * reconnecting (forever, with backoff), so this only notes the state. It never
   * restarts the bridge and never switches `autoReconnectEnabled` off.
   */
  private performHeartbeat(): void {
    if (this.socketBridge?.isConnected()) {
      this.lastConnectionState = 'connected';
      this.heartbeatWarned = false;
      this.updateLastActivity();
      return;
    }
    this.lastConnectionState = 'disconnected';
    // Log once per disconnection to avoid spam
    if (!this.heartbeatWarned && new Date().getTime() - this.lastActivity.getTime() > 60000) {
      this.heartbeatWarned = true;
      console.warn(`[${MODULE_ID}] Heartbeat: connection is down, the bridge keeps retrying`);
    }
  }

  /**
   * Update last activity timestamp
   */
  updateLastActivity(): void {
    this.lastActivity = new Date();
  }
}
