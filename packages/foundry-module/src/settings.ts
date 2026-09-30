import { MODULE_ID, DEFAULT_CONFIG, type ModuleHelloData } from './constants.js';
import type { BridgeConfig } from './socket-bridge.js';

/**
 * Default bridge port: `flags.foundry-mcp-bridge.defaultServerPort` in this
 * module's manifest, else 31415. A test install sets the flag in its copy of
 * module.json so a fresh test world never dials the live bridge on 31415
 * (the port setting is hidden, so it could not be changed before the first
 * connect). Released manifests carry no flag.
 */
export function defaultServerPort(): number {
  const flag = game.modules.get(MODULE_ID)?.flags?.[MODULE_ID]?.defaultServerPort;
  return typeof flag === 'number' && Number.isInteger(flag) && flag >= 1024 && flag <= 65535
    ? flag
    : DEFAULT_CONFIG.MCP_PORT;
}

/** The "no bridge user chosen" value of the `bridgeUserId` setting. */
export const ANY_GM_CHOICE = '';

/**
 * Whether the signed-in user should run the link, given the `bridgeUserId`
 * setting: empty means every GM connects (the backend picks one), otherwise only
 * that user's browser does.
 */
export function isBridgeUser(bridgeUserId: unknown, userId: string | undefined): boolean {
  return typeof bridgeUserId !== 'string' || bridgeUserId === '' || bridgeUserId === userId;
}

/** The `module-hello` payload this browser sends right after the link opens. */
export function buildModuleHello(bridgeUserId: unknown): ModuleHelloData {
  const user = game.user;
  return {
    userId: user?.id ?? '',
    userName: user?.name ?? '',
    isBridgeUser: isBridgeUser(bridgeUserId, user?.id),
    moduleVersion: game.modules.get(MODULE_ID)?.version ?? 'unknown',
    worldId: game.world?.id ?? '',
  };
}

/** The few user fields the Bridge User choices read. */
interface GmUserLike {
  id?: string;
  name?: string;
  isGM?: boolean;
}

export class ModuleSettings {
  private moduleId: string = MODULE_ID;

  /**
   * Register all module settings with Foundry
   */
  registerSettings(): void {
    // ============================================================================
    // SETTINGS MENU - Detailed Configuration Dialog
    // ============================================================================

    // Enhanced Creature Index submenu
    (game.settings as any).registerMenu(this.moduleId, 'enhancedIndexMenu', {
      name: 'Enhanced Creature Index',
      label: 'Configure Enhanced Index',
      hint: 'The Enhanced Creature Index pre-computes creature statistics for instant filtering by Challenge Rating, creature type, and abilities. This enables AI models to quickly find creatures matching specific criteria without loading every compendium entry.',
      icon: 'fas fa-search-plus',
      type: class extends FormApplication {
        static get defaultOptions() {
          return foundry.utils.mergeObject(super.defaultOptions, {
            title: 'Enhanced Creature Index Settings',
            template: `modules/${MODULE_ID}/templates/enhanced-index-menu.html`,
            width: 500,
            height: 'auto',
            resizable: false,
            closeOnSubmit: false,
          } as any);
        }

        getData(): any {
          return {
            enableEnhancedCreatureIndex: game.settings.get(
              MODULE_ID,
              'enableEnhancedCreatureIndex'
            ),
            autoRebuildIndex: game.settings.get(MODULE_ID, 'autoRebuildIndex'),
          };
        }

        activateListeners(html: JQuery) {
          super.activateListeners(html);
          html.find('.rebuild-index-btn').click(() => {
            const bridge = (globalThis as any).foundryMCPBridge;
            if (bridge?.dataAccess?.rebuildEnhancedCreatureIndex) {
              ui.notifications?.info('Rebuilding enhanced creature index...');
              bridge.dataAccess.rebuildEnhancedCreatureIndex();
            }
          });
        }

        async _updateObject(_event: Event, formData: any) {
          await game.settings.set(
            MODULE_ID,
            'enableEnhancedCreatureIndex',
            formData.enableEnhancedCreatureIndex
          );
          await game.settings.set(MODULE_ID, 'autoRebuildIndex', formData.autoRebuildIndex);
        }
      },
      restricted: true,
    });

    // ============================================================================
    // SECTION 1: BASIC SETTINGS
    // ============================================================================

    game.settings.register(this.moduleId, 'enabled', {
      name: 'Enable MCP Bridge',
      hint: 'Master switch to enable/disable the MCP bridge connection',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
      onChange: this.onEnabledChange.bind(this),
    });

    game.settings.register(this.moduleId, 'connectionType', {
      name: 'Connection Type',
      hint: 'Auto: Smart selection (HTTPS→WebRTC, HTTP→WebSocket). WebRTC: Encrypted P2P (works over internet). WebSocket: Traditional (localhost only).',
      scope: 'world',
      config: true,
      type: String,
      choices: {
        auto: 'Auto (Recommended)',
        webrtc: 'WebRTC (Internet)',
        websocket: 'WebSocket (Local Only)',
      },
      default: 'auto',
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverHost', {
      name: 'Websocket Server Host',
      hint: 'IP address for local Websocket Server connections to the MCP Server (usually localhost). Not used for Remote Connections',
      scope: 'world',
      config: true,
      type: String,
      default: DEFAULT_CONFIG.MCP_HOST,
      onChange: this.onConnectionChange.bind(this),
    });

    game.settings.register(this.moduleId, 'serverPort', {
      name: 'Server Port',
      hint: 'Port number for MCP server communication',
      scope: 'world',
      config: false,
      type: Number,
      default: defaultServerPort(),
      onChange: this.onConnectionChange.bind(this),
    });

    // ============================================================================
    // SECTION 2: WRITE PERMISSIONS
    // ============================================================================

    game.settings.register(this.moduleId, 'allowWriteOperations', {
      name: 'Allow Write Operations',
      hint: 'Let AI model create actors, NPCs, and modify world content. Reading is always allowed.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    // Whether non-GM users may run the bridge. The bridge is GM-only by design
    // (only a GM's browser becomes an AI control surface). Default OFF. For a
    // headless bridge client (e.g. on the Orange Pi), log it in as a dedicated
    // Assistant GM user instead of turning this on.
    game.settings.register(this.moduleId, 'allowNonGmAccess', {
      name: 'Allow Non-GM Users to Run the Bridge',
      hint: 'Off by default. When on, a non-GM user can start and use the bridge from their own browser. For a headless bridge client, use an Assistant GM user instead.',
      scope: 'world',
      config: true,
      type: Boolean,
      default: false,
    });

    // One browser holds the link, so the bridge has one clear peer (PB-02). The
    // choices hold only "Any GM" until `refreshBridgeUserChoices()` adds the GM
    // users at ready (game.users is not loaded at init).
    game.settings.register(this.moduleId, 'bridgeUserId', {
      name: 'Bridge User',
      hint: 'Which GM keeps the link to the AI Tool. Only that user\'s browser connects; other GMs stay quiet. "Any GM" lets every GM connect and the tool uses the first.',
      scope: 'world',
      config: true,
      type: String,
      choices: { [ANY_GM_CHOICE]: 'Any GM (first to connect)' },
      default: ANY_GM_CHOICE,
      onChange: this.onBridgeUserChange.bind(this),
    });

    // ============================================================================
    // SECTION 3: SAFETY CONTROLS - Limits on AI model's Actions
    // ============================================================================

    game.settings.register(this.moduleId, 'maxActorsPerRequest', {
      name: 'Max Actors Per Request',
      hint: 'Maximum number of actors AI model can create in a single request',
      scope: 'world',
      config: true,
      type: Number,
      default: 10,
      range: {
        min: 1,
        max: 50,
        step: 1,
      },
    });

    // Chat log buffer size — how many recent chat messages the EventTracker
    // keeps in memory for the get-chat-log / play-by-play tools.
    game.settings.register(this.moduleId, 'chatLogBufferSize', {
      name: 'Chat Log Buffer Size',
      hint: 'Number of recent chat messages to keep in memory for AI chat-log and combat play-by-play tools.',
      scope: 'world',
      config: true,
      type: Number,
      default: 200,
      range: {
        min: 50,
        max: 1000,
        step: 50,
      },
    });

    // Removed 'enableWriteAuditLog' setting as it provides no rollback functionality
    // and only creates log entries without user-actionable features

    // Enhanced Creature Index settings (configured via submenu only)
    game.settings.register(this.moduleId, 'enableEnhancedCreatureIndex', {
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'autoRebuildIndex', {
      scope: 'world',
      config: false, // Hidden from main config, accessible via submenu only
      type: Boolean,
      default: true,
    });

    // ============================================================================
    // SECTION 4: CONNECTION BEHAVIOR
    // ============================================================================

    game.settings.register(this.moduleId, 'enableNotifications', {
      name: 'Show Connection Messages',
      hint: 'Display notifications when connecting/disconnecting from AI model',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'autoReconnectEnabled', {
      name: 'Auto-Reconnect on Disconnect',
      hint: 'Automatically try to reconnect if the connection to AI model is lost',
      scope: 'world',
      config: true,
      type: Boolean,
      default: true,
    });

    game.settings.register(this.moduleId, 'heartbeatInterval', {
      name: 'Connection Check Frequency',
      hint: 'How often to check if AI model is still connected (seconds)',
      scope: 'world',
      config: true,
      type: Number,
      default: 30,
      range: {
        min: 10,
        max: 120,
        step: 5,
      },
    });

    // Non-configurable settings, kept registered so old worlds still load.
    // DEPRECATED (lane 1, PB-03): nothing writes or reads these any more. The
    // connection state, last activity and notice throttle live in memory only,
    // because a world-setting write from every reconnect is a write to the world.
    game.settings.register(this.moduleId, 'lastConnectionState', {
      scope: 'world',
      config: false,
      type: String,
      default: 'disconnected',
    });

    game.settings.register(this.moduleId, 'lastActivity', {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // DEPRECATED (see above): the notice throttle is in memory now.
    game.settings.register(this.moduleId, 'lastMCPServerNotification', {
      scope: 'world',
      config: false,
      type: String,
      default: '',
    });

    // Roll state storage for persistent roll button states
    game.settings.register(this.moduleId, 'rollStates', {
      scope: 'world',
      config: false,
      type: Object,
      default: {},
      onChange: this.onRollStatesChanged.bind(this),
    });

    // Button to message ID mapping for ChatMessage updates
    game.settings.register(this.moduleId, 'buttonMessageMap', {
      scope: 'world',
      config: false,
      type: Object,
      default: {},
    });
  }

  /**
   * Handle roll states setting changes - fires on all clients for world-scoped settings
   */
  private onRollStatesChanged(_newValue: any): void {
    // No action needed - ChatMessage.update() handles state synchronization automatically
  }

  /**
   * Fill the Bridge User choices with the world's GM users ("Any GM" stays first).
   * Foundry reads `choices` when the settings window renders, so updating the
   * registered entry in place is enough.
   */
  refreshBridgeUserChoices(): void {
    try {
      const registry = (
        game.settings as unknown as { settings: Map<string, { choices?: unknown }> }
      ).settings;
      const entry = registry.get(`${this.moduleId}.bridgeUserId`);
      if (!entry) return;
      const choices: Record<string, string> = { [ANY_GM_CHOICE]: 'Any GM (first to connect)' };
      const users = (game.users as unknown as { contents?: GmUserLike[] } | undefined)?.contents;
      for (const user of users ?? []) {
        if (user.isGM && user.id) choices[user.id] = user.name ?? user.id;
      }
      entry.choices = choices;
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to list the GM users for Bridge User:`, error);
    }
  }

  /**
   * Update connection status display in settings
   */
  updateConnectionStatusDisplay(connected: boolean, _toolCount: number): void {
    try {
      const statusText = connected
        ? `✅ Connected`
        : `❌ Disconnected - Use connection panel to connect`;

      // Update the hint for the enabled setting to show status
      const enabledSetting = (game.settings as any).settings.get(`${this.moduleId}.enabled`);
      if (enabledSetting) {
        enabledSetting.hint = `${enabledSetting.hint.split(' |')[0]} | Status: ${statusText}`;
      }
    } catch (error) {
      console.warn(`[${this.moduleId}] Failed to update status display:`, error);
    }
  }

  /**
   * Get current bridge configuration from settings
   */
  getBridgeConfig(): BridgeConfig {
    const connectionType = this.getSetting('connectionType');

    return {
      enabled: this.getSetting('enabled'),
      serverHost: this.getSetting('serverHost'),
      serverPort: this.getSetting('serverPort'),
      namespace: '/foundry-mcp', // Fixed namespace - no user configuration needed
      reconnectAttempts: DEFAULT_CONFIG.RECONNECT_ATTEMPTS, // Use sensible default
      reconnectDelay: DEFAULT_CONFIG.RECONNECT_DELAY, // Use sensible default
      connectionTimeout: DEFAULT_CONFIG.CONNECTION_TIMEOUT, // Use sensible default
      debugLogging: false, // Always false - use browser console for debugging
      connectionType: connectionType as 'auto' | 'webrtc' | 'websocket',
      // Read live so a settings change applies to the next attempt.
      autoReconnect: () => this.getSetting('autoReconnectEnabled') !== false,
      getHello: () => buildModuleHello(this.getSetting('bridgeUserId')),
    };
  }

  /**
   * Get a specific setting value
   */
  getSetting(key: string): any {
    return game.settings.get(this.moduleId, key);
  }

  /**
   * Set a specific setting value
   */
  async setSetting(key: string, value: any): Promise<any> {
    return game.settings.set(this.moduleId, key, value);
  }

  /**
   * Get all settings as an object
   */
  getAllSettings(): Record<string, any> {
    const settingKeys = [
      // Basic Settings
      'enabled',
      'serverHost',
      'serverPort',
      'connectionType',
      // Permissions
      'allowWriteOperations',
      // Safety Controls
      'maxActorsPerRequest',
      // Enhanced Creature Index
      'enableEnhancedCreatureIndex',
      'autoRebuildIndex',
      // Connection Behavior
      'bridgeUserId',
      'enableNotifications',
      'autoReconnectEnabled',
      'heartbeatInterval',
    ];

    const settings: Record<string, any> = {};
    for (const key of settingKeys) {
      settings[key] = this.getSetting(key);
    }

    return settings;
  }

  /**
   * Validate settings for consistency
   */
  validateSettings(): { valid: boolean; errors: string[] } {
    const errors: string[] = [];

    const host = this.getSetting('serverHost');
    if (!host || typeof host !== 'string' || host.trim().length === 0) {
      errors.push('Server host cannot be empty');
    }

    const port = this.getSetting('serverPort');
    if (!port || typeof port !== 'number' || port < 1024 || port > 65535) {
      errors.push('Server port must be between 1024 and 65535');
    }

    const maxActors = this.getSetting('maxActorsPerRequest');
    // Same bounds as the setting's range slider (registerSettings: min 1, max 50). A tighter
    // check here made `start()` throw for any value the settings UI itself allows above 10.
    if (!maxActors || typeof maxActors !== 'number' || maxActors < 1 || maxActors > 50) {
      errors.push('Max actors per request must be between 1 and 50');
    }

    const heartbeat = this.getSetting('heartbeatInterval');
    if (!heartbeat || typeof heartbeat !== 'number' || heartbeat < 10 || heartbeat > 120) {
      errors.push('Heartbeat interval must be between 10 and 120 seconds');
    }

    return {
      valid: errors.length === 0,
      errors,
    };
  }

  /**
   * Handle enabled setting change
   */
  private onEnabledChange(enabled: boolean): void {
    // Trigger bridge state change through global event
    if (window.foundryMCPBridge) {
      if (enabled) {
        window.foundryMCPBridge.start?.();
      } else {
        window.foundryMCPBridge.stop?.();
      }
    }
  }

  /**
   * Handle connection setting changes
   */
  private onConnectionChange(): void {
    // If bridge is running, restart it with new settings
    if (window.foundryMCPBridge && this.getSetting('enabled')) {
      window.foundryMCPBridge.restart?.();
    }
  }

  /**
   * The bridge user changed: every client re-evaluates. The old bridge user
   * stops (stop() is a no-op where nothing runs), the new one starts.
   */
  private onBridgeUserChange(): void {
    const bridge = window.foundryMCPBridge as { restart?: () => unknown } | undefined;
    if (bridge && this.getSetting('enabled')) {
      void bridge.restart?.();
    }
  }

  /**
   * Create settings migration for version updates
   */
  /**
   * Get write operation permissions
   */
  getWritePermissions(): {
    allowWriteOperations: boolean;
    maxActorsPerRequest: number;
  } {
    return {
      allowWriteOperations: this.getSetting('allowWriteOperations'),
      maxActorsPerRequest: this.getSetting('maxActorsPerRequest'),
    };
  }

  /**
   * Check if AI model is allowed to perform write operations
   */
  isWriteOperationAllowed(_operation?: string): boolean {
    // Simplified - single permission covers all write operations
    return this.getSetting('allowWriteOperations');
  }

  migrateSettings(_fromVersion: string, _toVersion: string): void {
    // Add migration logic here for future versions
    // For now, no migrations needed as this is initial version
  }

  /**
   * Reset all settings to defaults
   */
  async resetToDefaults(): Promise<void> {
    const settingKeys = [
      // Basic Settings
      'enabled',
      'serverHost',
      'serverPort',
      'connectionType',
      // Permissions
      'allowWriteOperations',
      // Safety Controls
      'maxActorsPerRequest',
      // Enhanced Creature Index
      'enableEnhancedCreatureIndex',
      'autoRebuildIndex',
      // Connection Behavior
      'bridgeUserId',
      'enableNotifications',
      'autoReconnectEnabled',
      'heartbeatInterval',
    ];

    for (const key of settingKeys) {
      // Get the default value from the setting registration
      const setting = (game.settings as any).settings.get(`${this.moduleId}.${key}`);
      if (setting && 'default' in setting) {
        await this.setSetting(key, setting.default);
      }
    }

    ui.notifications.info('MCP Bridge settings have been reset to defaults');
  }
}
