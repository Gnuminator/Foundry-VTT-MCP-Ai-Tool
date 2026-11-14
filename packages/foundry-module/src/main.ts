import { MODULE_ID } from './constants.js';
import { handleAiChangesSocketMessage } from './ai-changes-signal.js';
import { registerAiToolControls } from './ai-tool-controls.js';
import { registerLatestRecapButton } from './latest-recap.js';
import { BridgeLinkLifecycle, type BridgeLinkStatus } from './bridge-link-lifecycle.js';
import { QueryHandlers } from './queries.js';
import { ModuleSettings, isBridgeUser, registerSettingsUsageHooks } from './settings.js';
import { CampaignHooks } from './campaign-hooks.js';
import { eventTracker } from './session-events.js';
import { spentLedger } from './spent-actions.js';
import { changeJournal } from './change-journal.js';
import { playRecorder } from './play-recorder.js';
import { USAGE_SOCKET_TYPE, trackUsage, usageRecorder } from './usage-recorder.js';
import { installCombatCreateGuard } from './combat-create-guard.js';
import { applySelectionColor } from './token-selection-color.js';
import { diagnostics } from './diagnostics.js';
import { registerGmHelperQueries, unregisterGmHelperQueries } from './gm-helper-queries.js';
import { registerGuardedFeature } from './guarded-features.js';
import { LIVE_PLAY_FEATURE_ID } from './live-plan.js';
import { OWNERSHIP_FEATURE_ID } from './data-access/ownership-players.js';
import { SETUP_FEATURE_ID } from './data-access/virtual-targets.js';
import { SCENE_MOOD_FEATURE_ID } from './scene-mood.js';
import { ACTOR_IMAGE_FEATURE_ID } from './actor-image.js';
import { TOKEN_RINGS_FEATURE_ID } from './token-rings.js';
import { SCENE_RESTORE_FEATURE_ID } from './scene-state.js';
import { NPC_TURN_FEATURE_ID } from './npc-turn.js';
import { PAPER_SYNC_FEATURE_ID } from './paper-sync-plan.js';
import { PC_CREATION_FEATURE_ID } from './pc-creation.js';
import { ROOM_SETUP_FEATURE_ID } from './room-setup.js';
import { RULES_CHECK_FEATURE_ID } from './rules-check.js';
import { PARTY_FEATURE_ID, WHO_NOTICES_FEATURE_ID } from './party-scan.js';
import { registerGmWindowsSetting } from './gm-windows.js';
import { registerLiveWindowSettings, restoreLiveWindow } from './live-window.js';
import { registerPartyAuto, registerPartyAutoSettings } from './party-auto.js';
import { registerSessionSwitchSettings } from './session-switches.js';
import { registerDiceThemes } from './dice-themes.js';
import { TAROKKA_FEATURE_ID } from './tarokka.js';
import {
  onTableSettingChanged,
  registerTarokkaTableSettings,
  startTableWatch,
} from './tarokka-table-window.js';
import { logInfo } from './log.js';
import { warmPlayerIndexes } from './player-read.js';
import { toGmMessage } from './gm-message.js';
// Connection control now handled through settings menu

// Install diagnostic error capture as early as possible (module evaluation),
// so the earliest console/uncaught errors from other modules are caught.
diagnostics.install();

/** What `getStatus()` returns. */
interface BridgeStatus {
  initialized: boolean;
  enabled: boolean;
  connected: boolean;
  connectionState: string;
  connectionInfo: BridgeLinkStatus['connectionInfo'];
  settings: Record<string, unknown>;
  registeredMethods: string[];
  lastConnectionState: string;
  lastActivity: string;
  heartbeatActive: boolean;
}

/** A module socket message from another client (roll state and chat message requests). */
interface RollSocketMessage {
  type?: unknown;
  buttonId?: string;
  messageId?: string;
  userId: string;
  rollLabel: string;
  rollState?: { rolledBy: string };
}

/** The part of a chat message the roll button hook reads. */
interface RollButtonMessage {
  getFlag?(scope: string, key: string): unknown;
}

/**
 * Main Foundry MCP Bridge Module Class
 */
class FoundryMCPBridge {
  private settings: ModuleSettings;
  private queryHandlers: QueryHandlers;
  private campaignHooks: CampaignHooks;
  private isInitialized = false;
  /** The bridge link (bridge-link-lifecycle.ts): start, stop, its state and the GM link toasts. */
  private link: BridgeLinkLifecycle;

  /** Shows the holder's link notices in this GM browser (the link lifecycle owns them). */
  watchLinkState(): void {
    this.link.watchLinkState();
  }

  /** The stored link state changed (or was read when this GM joined). */
  applyStoredLinkState(): void {
    this.link.applyStoredLinkState();
  }

  constructor() {
    this.settings = new ModuleSettings();
    this.queryHandlers = new QueryHandlers();
    this.campaignHooks = new CampaignHooks(this);
    this.link = new BridgeLinkLifecycle({
      settings: this.settings,
      isInitialized: (): boolean => this.isInitialized,
    });
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
    return this.link.isBridgeAllowedForUser();
  }

  /**
   * Initialize the module during Foundry's init hook
   */
  async initialize(): Promise<void> {
    try {
      logInfo(`[${MODULE_ID}] Initializing Foundry AI Tool...`);

      // Register module settings
      this.settings.registerSettings();
      registerSettingsUsageHooks();
      registerSessionSwitchSettings();
      registerGmWindowsSetting();
      registerLiveWindowSettings();
      // Player characters go into the dnd5e party by themselves (active GM's client only).
      registerPartyAutoSettings();
      registerPartyAuto();
      // The Tarokka card table (D-130): the public table every client reads, players included.
      registerTarokkaTableSettings();
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
        id: 'obsidian-import',
        name: 'AI Tool: Obsidian import (writes)',
        hint: "Lets the AI Tool create a GM-only quest journal from a quest prep note in the GM's Obsidian vault, after you confirm the plan.",
      });
      registerGuardedFeature({
        id: PARTY_FEATURE_ID,
        name: 'AI Tool: Party (writes)',
        hint: "Lets the dashboard's Party drawer and the AI change the party's travel pace, add the party to combat and post a party rest request.",
      });
      registerGuardedFeature({
        id: LIVE_PLAY_FEATURE_ID,
        name: 'AI Tool: Live play (writes)',
        hint: 'Lets the dashboard and the AI change hit points, conditions, resources, tokens and the scene during play.',
        defaultEnabled: true,
        autoApply: {
          name: 'AI Tool: Live play, apply without confirming',
          hint: 'Damage, healing, conditions and resources that Claude plans apply at once, without the confirm step, each with an Undo in Changes.',
        },
      });
      registerGuardedFeature({
        id: 'session-notes',
        name: 'AI Tool: Session notes (writes)',
        hint: 'Puts the notes of a recorded session into a GM-only journal automatically, without asking; each one shows in Changes with an Undo.',
      });
      registerGuardedFeature({
        id: OWNERSHIP_FEATURE_ID,
        name: 'AI Tool: Ownership (writes)',
        hint: 'Lets the dashboard and the AI change which players own or can see an actor.',
        defaultEnabled: true,
      });
      registerGuardedFeature({
        id: SETUP_FEATURE_ID,
        name: 'AI Tool: Foundry setup (writes)',
        hint: 'Lets the AI change Foundry settings, turn modules on or off, change user roles and who can open a compendium pack, journal or scene, after you confirm; never passwords, a Gamemaster or these switches.',
      });
      registerGuardedFeature({
        id: 'player-portrait',
        name: 'AI Tool: Player portraits (writes)',
        hint: "Lets a player change the picture of their own character from the dashboard's player page, and the tokens of that character already placed on scenes when they pick the token picture too (the file goes into their own folder under assets/players).",
        defaultEnabled: true,
      });
      registerGuardedFeature({
        id: ACTOR_IMAGE_FEATURE_ID,
        name: 'AI Tool: Actor images (writes)',
        hint: "Lets the AI set an actor's portrait and token picture from a file in an allowed folder on the GM's PC, after you confirm (the file goes into assets/ai-art).",
        defaultEnabled: true,
      });
      registerGuardedFeature({
        id: 'table-viewer',
        name: 'AI Tool: Table viewer (writes)',
        hint: 'Lets the AI create the Table user that the TV at the table signs in as, after you confirm.',
        defaultEnabled: true,
      });
      registerGuardedFeature({
        id: SCENE_RESTORE_FEATURE_ID,
        name: 'AI Tool: Scene restore (writes)',
        hint: "Lets the AI put a scene's walls, lights, tiles and tokens back from a world backup, after you confirm.",
      });
      registerGuardedFeature({
        id: PC_CREATION_FEATURE_ID,
        name: 'AI Tool: Character creation (writes)',
        hint: 'Lets the AI create a player character and copy pack items onto it, after you confirm.',
      });
      registerGuardedFeature({
        id: ROOM_SETUP_FEATURE_ID,
        name: 'AI Tool: Room setup (writes)',
        hint: 'Lets the AI add teleport regions and fill a room with tokens, after you confirm.',
      });
      registerGuardedFeature({
        id: SCENE_MOOD_FEATURE_ID,
        name: 'AI Tool: Scene mood and music (writes)',
        hint: "Lets the AI set a scene's darkness, light, weather and playlists, after you confirm.",
      });
      registerGuardedFeature({
        id: TOKEN_RINGS_FEATURE_ID,
        name: 'AI Tool: Token rings (writes)',
        hint: "Lets the AI turn the dynamic token ring on or off on the actors' default tokens or on tokens already placed on scenes, in batches, after you confirm.",
      });
      registerGuardedFeature({
        id: NPC_TURN_FEATURE_ID,
        name: 'AI Tool: NPC turn assistant (writes)',
        hint: 'Lets the AI move a monster on its turn and take hit points off the creatures it hits, after you confirm.',
      });
      registerGuardedFeature({
        id: PAPER_SYNC_FEATURE_ID,
        name: 'AI Tool: Paper sync (writes)',
        hint: 'Lets the AI write the numbers from a paper sheet back into a character after a night played on paper, one plan per character after you confirm.',
      });
      registerGuardedFeature({
        id: WHO_NOTICES_FEATURE_ID,
        name: 'AI Tool: Who would notice',
        hint: "Adds a row to the dashboard's Party drawer that shows which characters would notice a DC (GM only).",
        readOnly: true,
      });
      registerGuardedFeature({
        id: RULES_CHECK_FEATURE_ID,
        name: 'AI Tool: Rules check',
        hint: 'Lets the AI check whether an attack, spell or item looks legal right now and say why.',
        readOnly: true,
        defaultEnabled: true,
      });
      registerGuardedFeature({
        id: 'change-undo',
        name: 'AI Tool: Undo for everything',
        hint: "Lets the AI Tool undo and redo anyone's changes from the Changes list, each one confirmed first.",
        defaultEnabled: true,
      });

      // Register bridge handlers (module-private table, dispatched only by the
      // socket bridge) and the sender-checked GM-to-GM helper queries (the only
      // CONFIG.queries entries; registered on Foundry 14.352+ only).
      this.queryHandlers.registerHandlers();
      registerGmHelperQueries();

      // The GM-only "AI Tool" group in the scene controls (the Changes window, I-108).
      registerAiToolControls();
      registerLatestRecapButton();

      // Register campaign hooks for interactive dashboards
      this.campaignHooks.register();

      // Register session-event hooks (chat log buffer + session event log).
      // These power the chat-log, combat play-by-play, and session-log tools.
      eventTracker.registerHooks();

      // The rules check's ledger of activities used this turn (reads usage chat messages).
      spentLedger.registerHooks();

      // Register the full play-log recorder (O3): raw per-change records behind
      // the session/stats notes. Runs only on a GM client; seeds its shadow
      // copies at 'ready'.
      playRecorder.registerHooks();

      // The change journal (I-109): who changed what, with the values before and after, for
      // full undo. Its pre-hooks must run on every client (players too); the post-hooks that
      // build records check the GM role when they run.
      changeJournal.registerHooks();

      // Expose data access globally for settings UI
      window.foundryMCPBridge!.dataAccess = this.queryHandlers.dataAccess;

      this.isInitialized = true;
      logInfo(`[${MODULE_ID}] Module initialized successfully`);
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed to initialize:`, error);
      trackUsage('error', 'module.error.init', { code: 'init-failed' });
      ui.notifications.error(toGmMessage('start the AI Tool', error));
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
        logInfo(`[${MODULE_ID}] Module ready (user access restricted)`);
        return;
      }

      logInfo(`[${MODULE_ID}] Foundry ready, checking bridge status...`);

      // Offer the world's GM users in the Bridge User setting.
      this.settings.refreshBridgeUserChoices();

      // Connection control now handled through settings menu

      // Validate settings
      const validation = this.settings.validateSettings();
      if (!validation.valid) {
        console.warn(`[${MODULE_ID}] Invalid settings:`, validation.errors);
        ui.notifications.warn(`AI Tool settings need a look: ${validation.errors.join(', ')}`);
      }

      // Auto-connect when enabled (always automatic)
      const enabled = this.settings.getSetting('enabled');

      if (enabled) {
        try {
          await this.start();
        } catch (error) {
          // A first connect that fails or times out (the backend restarting beside Foundry, for
          // example at the daily restart) is not a failed ready: start() already warned, the
          // reconnect timer keeps dialling (unless auto-reconnect is off), and the index warm-ups below must still run.
          console.warn(
            `[${MODULE_ID}] The first connect to the AI Tool server did not work (if it was the server, the bridge keeps dialling in the background unless auto-reconnect is off):`,
            error
          );
        }
      }

      // Rebuild a missing or stale creature index in the background.
      this.warmEnhancedIndex();
      this.warmPlayerIndexes();

      logInfo(`[${MODULE_ID}] Module ready`);
    } catch (error) {
      console.error(`[${MODULE_ID}] Failed during ready:`, error);
    }
  }

  /**
   * Start building the enhanced creature index when the persisted copy is missing
   * or stale (an older index version after a module update, changed packs), so
   * the first creature query does not rebuild it inside the 10 s bridge timeout.
   * Runs in the bridge user's browser, or with "Any GM" in every GM's browser
   * (the backend may route queries to any of them), and does not block `ready`;
   * a query during the build waits on the same build.
   */
  private warmEnhancedIndex(): void {
    if (!this.isGMUser()) return;
    if (!isBridgeUser(this.settings.getSetting('bridgeUserId'), game.user?.id)) return;
    if (!this.settings.getSetting('enableEnhancedCreatureIndex')) return;
    if (game.system.id !== 'dnd5e') return;

    void this.queryHandlers.dataAccess
      .ensureEnhancedCreatureIndex()
      .then(({ rebuilt, totalCreatures }) => {
        logInfo(
          `[${MODULE_ID}] Enhanced creature index ${rebuilt ? 'rebuilt' : 'current'} (${totalCreatures} creatures)`
        );
      })
      .catch(error => {
        console.warn(`[${MODULE_ID}] Failed to build the enhanced creature index:`, error);
      });
  }

  /**
   * Build the player book indexes in the background after start, so the first player search
   * after a restart answers in seconds (a cold build is 20 to 30 s on the Pi, over the query
   * timeout). Same client rule as the creature index: the bridge user's browser only.
   */
  private warmPlayerIndexes(): void {
    if (!this.isGMUser()) return;
    if (!isBridgeUser(this.settings.getSetting('bridgeUserId'), game.user?.id)) return;
    if (game.system.id !== 'dnd5e') return;

    const started = Date.now();
    void warmPlayerIndexes(this.queryHandlers.dataAccess.playerWarmDeps())
      .then(built => {
        logInfo(
          `[${MODULE_ID}] Player book indexes ready (${built} packs, ${Date.now() - started} ms)`
        );
      })
      .catch(error => {
        console.warn(`[${MODULE_ID}] Failed to warm the player book indexes:`, error);
      });
  }

  /**
   * Start the MCP bridge connection
   */
  start(): Promise<void> {
    return this.link.start();
  }

  /**
   * Stop the MCP bridge connection
   */
  stop(): Promise<void> {
    return this.link.stop();
  }

  /**
   * Restart the bridge with current settings
   */
  restart(): Promise<void> {
    return this.link.restart();
  }

  /**
   * Get current bridge status
   */
  getStatus(): BridgeStatus {
    const link = this.link.getStatus();
    return {
      initialized: this.isInitialized,
      enabled: this.settings.getSetting('enabled'),
      connected: link.connected,
      connectionState: link.connectionState,
      connectionInfo: link.connectionInfo,
      settings: this.settings.getAllSettings(),
      registeredMethods: this.queryHandlers.getRegisteredMethods(),
      lastConnectionState: link.lastConnectionState,
      lastActivity: link.lastActivity,
      heartbeatActive: link.heartbeatActive,
    };
  }

  /**
   * Update last activity timestamp
   */
  updateLastActivity(): void {
    this.link.updateLastActivity();
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
    logInfo(`[${MODULE_ID}] Cleaning up...`);

    await this.stop();
    this.queryHandlers.unregisterHandlers();
    unregisterGmHelperQueries();
    this.campaignHooks.unregister();

    logInfo(`[${MODULE_ID}] Cleanup complete`);
  }
}

// Create global instance
const foundryMCPBridge = new FoundryMCPBridge();

// Make it available globally for settings callbacks
window.foundryMCPBridge = foundryMCPBridge;

// Foundry VTT Hooks
Hooks.once('init', async () => {
  try {
    await foundryMCPBridge.initialize();
  } catch (error) {
    console.error(`[${MODULE_ID}] Initialization failed:`, error);
  }
});

// The error buffer is kept in browser storage, which every world on this server shares: drop the
// previous world's errors once the world id is known.
Hooks.once('ready', () => {
  try {
    const worldId = (game as { world?: { id?: string } }).world?.id;
    if (worldId) diagnostics.bindWorld(worldId);
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not tie the error buffer to the world:`, error);
  }
});

// A fight created already begun must not throw in Combat#_onCreate on any client. Own try block.
Hooks.once('ready', () => {
  try {
    if (!installCombatCreateGuard()) {
      console.warn(`[${MODULE_ID}] Combat class has no _onCreate to guard`);
    }
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not guard Combat creation:`, error);
  }
});

// Selected tokens look different from the turn marker (test 3), on every client. Its own hook and
// try block: a colour change must never stop the bridge from starting.
Hooks.once('ready', () => {
  try {
    applySelectionColor();
  } catch (error) {
    console.warn(`[${MODULE_ID}] Could not set the token selection colour:`, error);
  }
});

Hooks.once('ready', async () => {
  try {
    // Usage log (I-084): every client batches its own events every 10 s.
    usageRecorder.start();

    // A player who joins while the GM shows the Tarokka table sees it at once.
    onTableSettingChanged();
    startTableWatch();

    await foundryMCPBridge.onReady();

    // The link holder (the Assistant GM's browser) shares its lost/back notices through a world
    // setting; a GM browser that does not hold the link shows them too, also when it joins mid-outage.
    // (The setting's onChange fires for the first write, a create, as well as for later updates.)
    foundryMCPBridge.watchLinkState();

    // Live screen B: the pinned button, and the live window if it was open before the reload.
    restoreLiveWindow();

    // Register socket listener for roll state management (after game.user is available)

    const onRollSocketMessage = async (
      data: RollSocketMessage,
      senderId?: unknown
    ): Promise<void> => {
      try {
        // Usage events from other clients (I-084): only the GM client that holds the
        // buffer keeps them. `senderId` is the authenticated sender Foundry's server
        // appends to a relayed socket message; it wins over `data.userId`.
        if ((data as { type?: unknown } | null)?.type === USAGE_SOCKET_TYPE) {
          usageRecorder.receive(data, senderId);
          return;
        }

        // The AI change log changed (I-108): GM clients with the "Changes" window re-fetch.
        if (handleAiChangesSocketMessage(data)) return;

        // Handle ChatMessage update requests (GM only)
        if (data.type === 'requestMessageUpdate' && data.buttonId && data.messageId) {
          // Only GM can update ChatMessages for other users
          if (game.user?.isGM) {
            try {
              // Get the data access instance to update the message
              const queryHandlers = foundryMCPBridge['queryHandlers'];
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
                ui.notifications?.error(toGmMessage("update a player's roll in chat", error));
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
              const queryHandlers = foundryMCPBridge['queryHandlers'];
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
                ui.notifications?.error(toGmMessage("remember a player's roll", error));
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
      (data: RollSocketMessage, senderId?: unknown) => void onRollSocketMessage(data, senderId)
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
Hooks.on('renderChatMessageHTML', (message: RollButtonMessage, html: HTMLElement) => {
  try {
    // Convert HTMLElement to jQuery for compatibility with existing handler code
    const $html = $(html);

    // Check if this message has MCP roll button flags
    const rollButtons = message.getFlag?.(MODULE_ID, 'rollButtons');

    if (rollButtons) {
      // Get the data access instance
      const queryHandlers = foundryMCPBridge['queryHandlers'];
      if (queryHandlers?.dataAccess) {
        // Check if any buttons in this message are already rolled
        for (const [_buttonId, buttonData] of Object.entries(
          rollButtons as Record<string, unknown>
        )) {
          if (
            buttonData &&
            typeof buttonData === 'object' &&
            (buttonData as { rolled?: unknown }).rolled
          ) {
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

      const queryHandlers = foundryMCPBridge['queryHandlers'];
      if (queryHandlers?.dataAccess) {
        queryHandlers.dataAccess.attachRollButtonHandlers($html);

        // Check for legacy roll states
        setTimeout(() => {
          // Legacy hook: the method no longer exists on the data access class; the typed
          // handle keeps the original call (and its failure) exactly as it was.
          (
            queryHandlers.dataAccess as unknown as {
              ensureButtonStatesForMessage(html: JQuery): void;
            }
          ).ensureButtonStatesForMessage($html);
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
  window.foundryMCPDebug = {
    bridge: foundryMCPBridge,
    getStatus: (): unknown => foundryMCPBridge.getStatus(),
    start: (): Promise<void> => foundryMCPBridge.start(),
    stop: (): Promise<void> => foundryMCPBridge.stop(),
    restart: (): Promise<void> => foundryMCPBridge.restart(),
  };
}

export { foundryMCPBridge };
