import { MODULE_ID } from './constants.js';
import { SocketBridge } from './socket-bridge.js';
import { QueryHandlers } from './queries.js';
import { ModuleSettings, isBridgeUser, registerSettingsUsageHooks } from './settings.js';
import { CampaignHooks } from './campaign-hooks.js';
import { eventTracker } from './session-events.js';
import { playRecorder } from './play-recorder.js';
import { USAGE_SOCKET_TYPE, trackUsage, usageRecorder } from './usage-recorder.js';
import { diagnostics } from './diagnostics.js';
import {
  registerGmHelperQueries,
  sendTarokkaOffer,
  unregisterGmHelperQueries,
} from './gm-helper-queries.js';
import { registerGuardedFeature } from './guarded-features.js';
import { LIVE_PLAY_FEATURE_ID } from './live-plan.js';
import { OWNERSHIP_FEATURE_ID } from './data-access/ownership-players.js';
import { PARTY_FEATURE_ID } from './party-scan.js';
import { registerSessionSwitchSettings } from './session-switches.js';
import { registerDiceThemes } from './dice-themes.js';
import { TAROKKA_FEATURE_ID, onTarokkaSettingChanged } from './tarokka.js';
// Connection control now handled through settings menu

/** How long the "MCP server not found" notice stays quiet after it was shown (per browser). */
const SERVER_NOTICE_THROTTLE_MS = 10 * 60 * 1000;

// Install diagnostic error capture as early as possible (module evaluation),
// so the earliest console/uncaught errors from other modules are caught.
diagnostics.install();

/**
 * Main Foundry MCP Bridge Module Class
 */
class FoundryMCPBridge {
  private settings: ModuleSettings;
  private queryHandlers: QueryHandlers;
  private campaignHooks: CampaignHooks;
  private socketBridge: SocketBridge | null = null;
  private isInitialized = false;
  private heartbeatInterval: number | null = null;
  private lastActivity: Date = new Date();
  private isConnecting = false;
  /** In memory only: writing these to world settings on every reconnect wrote to the world. */
  private lastConnectionState = 'disconnected';
  private lastServerNoticeAt = 0;
  private heartbeatWarned = false;

  constructor() {
    this.settings = new ModuleSettings();
    this.queryHandlers = new QueryHandlers();
    this.campaignHooks = new CampaignHooks(this);
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
  private isBridgeAllowedForUser(): boolean {
    return this.isGMUser() || this.settings.getSetting('allowNonGmAccess') === true;
  }

  /**
   * Initialize the module during Foundry's init hook
   */
  async initialize(): Promise<void> {
    try {
      console.log(`[${MODULE_ID}] Initializing Foundry MCP Bridge...`);

      // Register module settings
      this.settings.registerSettings();
      registerSettingsUsageHooks();
      registerSessionSwitchSettings();
      // Themed dice (I-085): every client, players included; silent without Dice So Nice.
      registerDiceThemes();

      // Guarded-write feature switches (world settings; off unless defaultEnabled).
      registerGuardedFeature({
        id: TAROKKA_FEATURE_ID,
        name: 'AI Tool: Tarokka (writes)',
        hint: 'Lets the AI Tool save Tarokka readings to its vault, link cards to journals and publish reveal pages to players.',
      });
      registerGuardedFeature({
        id: 'handouts',
        name: 'AI Tool: Handouts (writes)',
        hint: "Reveal or hide journal pages on the dashboard's player page.",
      });
      registerGuardedFeature({
        id: 'obsidian-mirror',
        name: 'AI Tool: Obsidian mirror (writes)',
        hint: "Lets the AI Tool change which Foundry documents it mirrors into the GM's Obsidian vault (the mirror settings).",
      });
      registerGuardedFeature({
        id: PARTY_FEATURE_ID,
        name: 'AI Tool: Party (writes)',
        hint: "Lets the dashboard's Party drawer and the AI change the party's travel pace, add the party to combat and post a party rest request.",
      });
      registerGuardedFeature({
        id: LIVE_PLAY_FEATURE_ID,
        name: 'AI Tool: Live play (writes)',
        hint: 'Lets the dashboard and the AI apply damage, healing, temporary hit points, conditions and resources (spell slots, class resources, item uses), move, change or delete tokens, and dress the scene (area templates, darkness and light, map notes, loot).',
        defaultEnabled: true,
        autoApply: {
          name: 'AI Tool: Live play, apply without confirming',
          hint: "Damage, healing, conditions and resources that Claude plans apply at once, without the confirm step. The dashboard's Damage and Condition buttons apply at once without it. Each one still shows an Undo and is listed in Recent Changes.",
        },
      });
      registerGuardedFeature({
        id: 'session-notes',
        name: 'AI Tool: Session notes (writes)',
        hint: 'Puts the notes of a recorded session (Recap, GM summary, Scenes) into a GM-only journal in Foundry automatically, without asking, as soon as Foundry is open with writes on. Each one shows in Recent Changes with an Undo. Players see the Recap only when you reveal it.',
      });
      registerGuardedFeature({
        id: OWNERSHIP_FEATURE_ID,
        name: 'AI Tool: Ownership (writes)',
        hint: 'Lets the dashboard and the AI change which players own or can see an actor.',
        defaultEnabled: true,
      });
      Hooks.on('clientSettingChanged', (key: string) => {
        void onTarokkaSettingChanged(key, sendTarokkaOffer).catch(error => {
          console.warn(`[${MODULE_ID}] Tarokka offer failed:`, error);
        });
      });

      // Register bridge handlers (module-private table, dispatched only by the
      // socket bridge) and the sender-checked GM-to-GM helper queries (the only
      // CONFIG.queries entries; registered on Foundry 14.352+ only).
      this.queryHandlers.registerHandlers();
      registerGmHelperQueries();

      // Register campaign hooks for interactive dashboards
      this.campaignHooks.register();

      // Register session-event hooks (chat log buffer + session event log).
      // These power the chat-log, combat play-by-play, and session-log tools.
      eventTracker.registerHooks();

      // Register the full play-log recorder (O3): raw per-change records behind
      // the session/stats notes. Runs only on a GM client; seeds its shadow
      // copies at 'ready'.
      playRecorder.registerHooks();

      // Expose data access globally for settings UI
      (window as any).foundryMCPBridge.dataAccess = this.queryHandlers.dataAccess;

      this.isInitialized = true;
      console.log(`[${MODULE_ID}] Module initialized successfully`);
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to initialize:`, error);
      trackUsage('error', 'module.error.init', { code: 'init-failed' });
      ui.notifications.error('Failed to initialize Foundry MCP Bridge');
      throw error;
    }
  }

  /**
   * Start the module after Foundry is ready
   */
  async onReady(): Promise<void> {
    try {
      // SECURITY: silent access gate. GM-only unless allowNonGmAccess is enabled.
      if (!this.isBridgeAllowedForUser()) {
        console.log(`[${MODULE_ID}] Module ready (user access restricted)`);
        return;
      }

      console.log(`[${MODULE_ID}] Foundry ready, checking bridge status...`);

      // Offer the world's GM users in the Bridge User setting.
      this.settings.refreshBridgeUserChoices();

      // Connection control now handled through settings menu

      // Validate settings
      const validation = this.settings.validateSettings();
      if (!validation.valid) {
        console.warn(`[${MODULE_ID}] Invalid settings:`, validation.errors);
        ui.notifications.warn(
          `MCP Bridge settings validation failed: ${validation.errors.join(', ')}`
        );
      }

      // Auto-connect when enabled (always automatic)
      const enabled = this.settings.getSetting('enabled');

      if (enabled) {
        await this.start();
      }

      // Auto-build enhanced creature index if enabled and not exists
      await this.checkAndBuildEnhancedIndex();

      console.log(`[${MODULE_ID}] Module ready`);
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed during ready:`, error);
    }
  }

  /**
   * Check if enhanced creature index exists and build if needed (better UX)
   */
  private async checkAndBuildEnhancedIndex(): Promise<void> {
    try {
      // Only for GM users
      if (!this.isGMUser()) return;

      // Check if enhanced index is enabled
      const enhancedIndexEnabled = this.settings.getSetting('enableEnhancedCreatureIndex');
      if (!enhancedIndexEnabled) return;

      // Check if index file exists
      const indexFilename = 'enhanced-creature-index.json';
      try {
        const browseResult = await (
          foundry as any
        ).applications.apps.FilePicker.implementation.browse('data', `worlds/${game.world.id}`);
        const indexExists = browseResult.files.some((f: any) => f.endsWith(indexFilename));

        if (!indexExists) {
          console.log(
            `[${MODULE_ID}] Enhanced creature index not found, building automatically for better UX...`
          );
          ui.notifications?.info('Building enhanced creature index for faster searches...');

          // Trigger index build through data access
          if (this.queryHandlers?.dataAccess?.rebuildEnhancedCreatureIndex) {
            await this.queryHandlers.dataAccess.rebuildEnhancedCreatureIndex();
          }
        } else {
          console.log(`[${MODULE_ID}] Enhanced creature index exists, ready for instant searches`);
        }
      } catch (error) {
        // World directory might not exist yet, that's okay
        console.log(
          `[${MODULE_ID}] Could not check for enhanced index file (world directory may not exist yet)`
        );
      }
    } catch (error) {
      console.warn(`[${MODULE_ID}] Failed to auto-build enhanced index:`, error);
    }
  }

  /**
   * Start the MCP bridge connection
   */
  async start(): Promise<void> {
    if (!this.isInitialized) {
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
      console.log(`[${MODULE_ID}] Not the bridge user; this browser does not start the link`);
      return;
    }

    if (this.socketBridge?.isConnected() || this.isConnecting) {
      console.log(`[${MODULE_ID}] Bridge already running or connecting`);
      return;
    }

    // Never leave an old bridge (and its reconnect timer) running beside a new one.
    if (this.socketBridge) {
      this.socketBridge.disconnect();
      this.socketBridge = null;
    }

    this.isConnecting = true;
    let dialled = false;

    try {
      console.log(`[${MODULE_ID}] Starting MCP bridge...`);

      const config = this.settings.getBridgeConfig();

      // Validate configuration
      const validation = this.settings.validateSettings();
      if (!validation.valid) {
        throw new Error(`Invalid configuration: ${validation.errors.join(', ')}`);
      }

      // Create and connect socket bridge
      this.socketBridge = new SocketBridge(config);
      dialled = true;
      await this.socketBridge.connect();

      // Log connection details for debugging
      const connectionInfo = this.socketBridge.getConnectionInfo();
      console.log(
        `[${MODULE_ID}] Bridge started successfully - Type: ${connectionInfo.type}, State: ${connectionInfo.state}`
      );

      this.lastConnectionState = 'connected';
      this.updateLastActivity();

      // Update settings display with connection status
      this.settings.updateConnectionStatusDisplay(true, 75); // MCP tools exposed by the bridge

      // Start heartbeat monitoring if enabled
      this.startHeartbeat();

      // Show connection notification based on user preference
      if (this.settings.getSetting('enableNotifications')) {
        ui.notifications.info('🔗 MCP Bridge connected successfully');
      }
      console.log(
        `[${MODULE_ID}] GM connection established - Bridge active for user: ${game.user?.name}`
      );
    } catch (error) {
      // Log as warning instead of error for initial connection failures
      console.warn(`[${MODULE_ID}] Failed to start bridge:`, error);

      // Show helpful message for GM users when MCP server isn't available
      if (dialled && this.isGMUser()) {
        // A browser WebSocket error never says why (no ECONNREFUSED), so the first
        // failed start is the signal. Throttled in memory so a long outage does not spam.
        const now = Date.now();
        if (now - this.lastServerNoticeAt >= SERVER_NOTICE_THROTTLE_MS) {
          this.lastServerNoticeAt = now;
          ui.notifications?.warn(
            'MCP Server not found. Install it from https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool'
          );
        }
      }

      this.lastConnectionState = 'error';
      throw error;
    } finally {
      this.isConnecting = false;
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
      console.log(`[${MODULE_ID}] Bridge not running`);
      return;
    }

    try {
      console.log(`[${MODULE_ID}] Stopping MCP bridge...`);

      // Stop heartbeat monitoring
      this.stopHeartbeat();

      this.socketBridge.disconnect();
      this.socketBridge = null;

      this.lastConnectionState = 'disconnected';

      // Update settings display with disconnected status
      this.settings.updateConnectionStatusDisplay(false, 0);

      console.log(`[${MODULE_ID}] Bridge stopped`);

      // Show disconnection notification based on user preference
      if (this.settings.getSetting('enableNotifications')) {
        ui.notifications.info('MCP Bridge disconnected');
      }
    } catch (error) {
      console.error(`[${MODULE_ID}] Error stopping bridge:`, error);
    }
  }

  /**
   * Restart the bridge with current settings
   */
  async restart(): Promise<void> {
    console.log(`[${MODULE_ID}] Restarting bridge...`);

    await this.stop();

    // Small delay to ensure clean disconnect
    await new Promise(resolve => setTimeout(resolve, 1000));

    if (this.settings.getSetting('enabled')) {
      await this.start();
    }
  }

  /**
   * Get current bridge status
   */
  getStatus(): any {
    return {
      initialized: this.isInitialized,
      enabled: this.settings.getSetting('enabled'),
      connected: this.socketBridge?.isConnected() ?? false,
      connectionState: this.socketBridge?.getConnectionState() ?? 'disconnected',
      connectionInfo: this.socketBridge?.getConnectionInfo(),
      settings: this.settings.getAllSettings(),
      registeredMethods: this.queryHandlers.getRegisteredMethods(),
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

    console.log(`[${MODULE_ID}] Heartbeat monitoring started (${interval}ms interval)`);
  }

  /**
   * Stop heartbeat monitoring
   */
  private stopHeartbeat(): void {
    if (this.heartbeatInterval) {
      clearInterval(this.heartbeatInterval);
      this.heartbeatInterval = null;
      console.log(`[${MODULE_ID}] Heartbeat monitoring stopped`);
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

  /**
   * Get query handlers for campaign hooks
   */
  getQueryHandlers(): QueryHandlers {
    return this.queryHandlers;
  }

  /**
   * Connection control is now handled through the settings menu
   */

  /**
   * Cleanup when module is disabled or world is closed
   */
  async cleanup(): Promise<void> {
    console.log(`[${MODULE_ID}] Cleaning up...`);

    await this.stop();
    this.queryHandlers.unregisterHandlers();
    unregisterGmHelperQueries();
    this.campaignHooks.unregister();

    console.log(`[${MODULE_ID}] Cleanup complete`);
  }
}

// Create global instance
const foundryMCPBridge = new FoundryMCPBridge();

// Make it available globally for settings callbacks
(window as any).foundryMCPBridge = foundryMCPBridge;

// Foundry VTT Hooks
Hooks.once('init', async () => {
  try {
    await foundryMCPBridge.initialize();
  } catch (error) {
    console.error(`[${MODULE_ID}] Initialization failed:`, error);
  }
});

Hooks.once('ready', async () => {
  try {
    // Usage log (I-084): every client batches its own events every 10 s.
    usageRecorder.start();

    await foundryMCPBridge.onReady();

    // Register socket listener for roll state management (after game.user is available)

    const onRollSocketMessage = async (data: any, senderId?: unknown): Promise<void> => {
      try {
        // Usage events from other clients (I-084): only the GM client that holds the
        // buffer keeps them. `senderId` is the authenticated sender Foundry's server
        // appends to a relayed socket message; it wins over `data.userId`.
        if ((data as { type?: unknown } | null)?.type === USAGE_SOCKET_TYPE) {
          usageRecorder.receive(data, senderId);
          return;
        }

        // Handle ChatMessage update requests (GM only)
        if (data.type === 'requestMessageUpdate' && data.buttonId && data.messageId) {
          // Only GM can update ChatMessages for other users
          if (game.user?.isGM) {
            try {
              // Get the data access instance to update the message
              const queryHandlers = foundryMCPBridge['queryHandlers'] as any;
              if (queryHandlers?.dataAccess) {
                await queryHandlers.dataAccess.updateRollButtonMessage(
                  data.buttonId,
                  data.userId,
                  data.rollLabel
                );
              }
            } catch (error) {
              console.error(`[${MODULE_ID}] GM failed to update message:`, error);
              // Notify GM about the failure
              if (game.user?.isGM) {
                trackUsage('error', 'module.error.roll-update', { code: 'update-failed' });
                ui.notifications?.error(
                  `Failed to update player roll message: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
              }
            }
          }
          return;
        }

        // Handle roll state save requests (GM only) - LEGACY
        if (data.type === 'requestRollStateSave' && data.buttonId && data.rollState) {
          // Only GM can save to world settings
          if (game.user?.isGM) {
            try {
              // Get the data access instance to save the roll state
              const queryHandlers = foundryMCPBridge['queryHandlers'] as any;
              if (queryHandlers?.dataAccess) {
                await queryHandlers.dataAccess.saveRollState(
                  data.buttonId,
                  data.rollState.rolledBy
                );
              }
            } catch (error) {
              console.error(`[${MODULE_ID}] GM failed to save LEGACY roll state:`, error);
              // Notify GM about the failure so they can take action
              if (game.user?.isGM) {
                trackUsage('error', 'module.error.roll-state', { code: 'save-failed' });
                ui.notifications?.error(
                  `Failed to save player roll state: ${error instanceof Error ? error.message : 'Unknown error'}`
                );
              }
            }
          }
          return;
        }

        // Handle real-time roll state updates - LEGACY (now handled by ChatMessage.update())
        if (data.type === 'rollStateUpdate' && data.buttonId && data.rollState) {
          // No longer needed - ChatMessage.update() automatically syncs across all clients
        }

        // Note: rollStateSaved confirmations removed - not needed since rollStateUpdate handles UI sync
      } catch (error) {
        console.error(`[${MODULE_ID}] Error handling socket message:`, error);
      }
    };
    game.socket?.on(
      'module.foundry-mcp-bridge',
      (data: any, senderId?: unknown) => void onRollSocketMessage(data, senderId)
    );
  } catch (error) {
    console.error(`[${MODULE_ID}] Ready failed:`, error);
  }
});

// Handle settings menu close to check for changes
Hooks.on('closeSettingsConfig', () => {
  try {
    const enabled = foundryMCPBridge.getStatus().enabled;
    const connected = foundryMCPBridge.getStatus().connected;

    if (enabled && !connected) {
      // Setting was enabled but not connected, try to start
      foundryMCPBridge.start().catch(error => {
        console.error(`[${MODULE_ID}] Failed to start after settings change:`, error);
      });
    } else if (!enabled && connected) {
      // Setting was disabled but still connected, stop
      foundryMCPBridge.stop().catch(error => {
        console.error(`[${MODULE_ID}] Failed to stop after settings change:`, error);
      });
    }
  } catch (error) {
    console.error(`[${MODULE_ID}] Error handling settings change:`, error);
  }
});

// Global hook to handle MCP roll button rendering and state management
// Using renderChatMessageHTML for Foundry v13 compatibility (renderChatMessage is deprecated)
Hooks.on('renderChatMessageHTML', (message: any, html: HTMLElement) => {
  try {
    // Convert HTMLElement to jQuery for compatibility with existing handler code
    const $html = $(html);

    // Check if this message has MCP roll button flags
    const rollButtons = message.getFlag?.(MODULE_ID, 'rollButtons');

    if (rollButtons) {
      // Get the data access instance
      const queryHandlers = foundryMCPBridge['queryHandlers'] as any;
      if (queryHandlers?.dataAccess) {
        // Check if any buttons in this message are already rolled
        for (const [_buttonId, buttonData] of Object.entries(rollButtons)) {
          if (buttonData && typeof buttonData === 'object' && (buttonData as any).rolled) {
            break;
          }
        }

        // If message has rolled buttons, the content should already be updated
        // Just attach any necessary handlers for active buttons
        if ($html.find('.mcp-roll-button').length > 0) {
          // Only attach handlers to active (non-rolled) buttons
          queryHandlers.dataAccess.attachRollButtonHandlers($html);
        }
      }
    } else if ($html.find('.mcp-roll-button').length > 0) {
      // Legacy message without flags - fall back to old behavior

      const queryHandlers = foundryMCPBridge['queryHandlers'] as any;
      if (queryHandlers?.dataAccess) {
        queryHandlers.dataAccess.attachRollButtonHandlers($html);

        // Check for legacy roll states
        setTimeout(() => {
          queryHandlers.dataAccess.ensureButtonStatesForMessage($html);
        }, 100);
      }
    }
  } catch (error) {
    console.warn(`[${MODULE_ID}] Error processing roll buttons in chat message:`, error);
  }
});

// Socket listener will be registered in the 'ready' hook when game.user is available

// Handle world close/reload
Hooks.on('canvasReady', () => {
  // Canvas ready indicates the world is fully loaded
  // Good time to ensure bridge is in correct state
  try {
    const status = foundryMCPBridge.getStatus();
    if (status.enabled && !status.connected) {
      foundryMCPBridge.start().catch(error => {
        console.warn(`[${MODULE_ID}] Failed to reconnect on canvas ready:`, error);
      });
    }
  } catch (error) {
    console.error(`[${MODULE_ID}] Error on canvas ready:`, error);
  }
});

// Cleanup on unload
window.addEventListener('beforeunload', () => {
  foundryMCPBridge.cleanup().catch(error => {
    console.error(`[${MODULE_ID}] Cleanup failed:`, error);
  });
});

// Development helpers (only in debug mode)
if (typeof window !== 'undefined') {
  (window as any).foundryMCPDebug = {
    bridge: foundryMCPBridge,
    getStatus: () => foundryMCPBridge.getStatus(),
    start: () => foundryMCPBridge.start(),
    stop: () => foundryMCPBridge.stop(),
    restart: () => foundryMCPBridge.restart(),
  };
}

export { foundryMCPBridge };
