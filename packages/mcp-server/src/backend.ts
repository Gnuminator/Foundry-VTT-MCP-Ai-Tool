import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import * as net from 'net';

import { evaluateLockFile } from './lock.js';

import { ComfyUIService } from './comfyui-service.js';

import { buildToolRouter } from './tool-router.js';

import {
  handleGenerateMapRequest,
  handleCheckMapStatusRequest,
  handleCancelMapJobRequest,
} from './map-generation-handlers.js';

import { config } from './config.js';

import type { ControlRequest, ToolResultPayload } from '@gnuminator/shared';

import { Logger } from './logger.js';

import { FoundryClient } from './foundry-client.js';

import { CharacterTools } from './tools/character.js';

import { CompendiumTools } from './tools/compendium.js';

import { SceneTools } from './tools/scene.js';

import { ActorCreationTools } from './tools/actor-creation.js';

import { QuestCreationTools } from './tools/quest-creation.js';

import { DiceRollTools } from './tools/dice-roll.js';

import { CampaignManagementTools } from './tools/campaign-management.js';

import { OwnershipTools } from './tools/ownership.js';

import { MapGenerationTools } from './tools/map-generation.js';

import { TokenManipulationTools } from './tools/token-manipulation.js';

import { DnD5eAddFeatureTool } from './tools/dnd5e/add-feature.js';
import { DnD5eNpcTools } from './tools/dnd5e/npc.js';
import { DnD5eFeaturesFromCompendiumTools } from './tools/dnd5e/features.js';

import { ChatLogTools } from './tools/chat-log.js';
import { ResourceTools } from './tools/resources.js';
import { EffectsTools } from './tools/effects.js';
import { CombatTools } from './tools/combat.js';
import { MovementTools } from './tools/movement.js';
import { SessionLogTools } from './tools/session-log.js';
import { CombatResolutionTools } from './tools/combat-resolution.js';
import { EncounterTools } from './tools/encounter.js';
import { SceneControlTools } from './tools/scene-control.js';
import { LootTools } from './tools/loot.js';
import { DiagnosticsTools } from './tools/diagnostics.js';

// Control channel bind target. Defaults to the frozen loopback contract
// (127.0.0.1:31414) the stdio wrapper and dashboard expect, but is injectable so
// the backend can run as a standalone process on an alternate port for testing
// or a future remote-hosting topology. See `standalone.ts` / DETACH-PLAN Phase 6.
const CONTROL_HOST = process.env.MCP_CONTROL_HOST || '127.0.0.1';

const CONTROL_PORT = parseInt(process.env.MCP_CONTROL_PORT || '31414', 10);

// When the Foundry link is disabled (MCP_FOUNDRY_LINK=off) the backend serves the
// control channel ONLY — it does not bind the Foundry connector (WS 31415 / WebRTC
// 31416) or auto-start ComfyUI. Used to smoke-test the standalone entrypoint on an
// alternate port without colliding with a live bridge. Default: enabled (full backend).
const FOUNDRY_LINK_ENABLED = !/^(off|false|0|no)$/i.test(process.env.MCP_FOUNDRY_LINK ?? '');

// Lock file is port-scoped for non-default ports so an alternate-port standalone
// instance never fights the live 31414 backend's lock. The default port keeps the
// original lock name for exact backward compatibility.
const LOCK_FILE = path.join(
  os.tmpdir(),
  CONTROL_PORT === 31414 ? 'foundry-mcp-backend.lock' : `foundry-mcp-backend-${CONTROL_PORT}.lock`
);

let lockFd: number | null = null;

function acquireLock(): boolean {
  try {
    try {
      lockFd = fs.openSync(LOCK_FILE, 'wx');
    } catch (err: any) {
      if (err && err.code === 'EEXIST') {
        try {
          const lockData = fs.readFileSync(LOCK_FILE, 'utf8');

          const lockPid = parseInt(lockData.trim(), 10);

          try {
            process.kill(lockPid, 0);

            // A process with this PID is alive. Validate it is actually our
            // backend (node.exe / node) and that the lock file is not stale.
            // PID reuse by unrelated OS processes (e.g. GameInputRedistService
            // on Windows) would otherwise cause a false "already running" exit.
            if (evaluateLockFile(lockPid, LOCK_FILE) === 'orphaned') {
              console.error(
                `Removing orphaned backend lock for PID ${lockPid} ` +
                  `(process is not node.exe or lock file is stale)`
              );
              try {
                fs.unlinkSync(LOCK_FILE);
              } catch {}
              lockFd = fs.openSync(LOCK_FILE, 'wx');
            } else {
              // Backend is genuinely running — exit gracefully
              return false;
            }
          } catch {
            console.error(`Removing stale backend lock for PID ${lockPid}`);

            try {
              fs.unlinkSync(LOCK_FILE);
            } catch {}

            lockFd = fs.openSync(LOCK_FILE, 'wx');
          }
        } catch (readErr) {
          console.error('Corrupt backend lock file, removing:', readErr);

          try {
            fs.unlinkSync(LOCK_FILE);
          } catch {}

          lockFd = fs.openSync(LOCK_FILE, 'wx');
        }
      } else {
        console.error('Failed to open backend lock file:', err);

        return false;
      }
    }

    if (lockFd === null) return false;

    fs.writeFileSync(lockFd, String(process.pid));

    try {
      fs.fsyncSync(lockFd);
    } catch {}

    console.error(`Acquired backend lock with PID ${process.pid}`);

    return true;
  } catch (error) {
    console.error('Failed to acquire backend lock:', error);

    return false;
  }
}

function releaseLock(): void {
  try {
    if (lockFd !== null) {
      try {
        fs.closeSync(lockFd);
      } catch {}
      lockFd = null;
    }

    if (fs.existsSync(LOCK_FILE)) {
      try {
        fs.unlinkSync(LOCK_FILE);
      } catch {}
    }
  } catch (error) {
    console.error('Failed to release backend lock:', error);
  }
}

async function startBackend(): Promise<void> {
  // Logger: file output allowed; avoid stdout noise

  const logger = new Logger({
    level: config.logLevel,

    format: config.logFormat,

    enableConsole: false,

    enableFile: true,

    filePath: path.join(os.tmpdir(), 'foundry-mcp-server', 'mcp-server.log'),
  });

  logger.info('Starting Foundry MCP Backend', {
    version: config.server.version,

    foundryHost: config.foundry.host,

    foundryPort: config.foundry.port,
  });

  // ComfyUI service lifecycle (map-generation pipeline)
  const comfyuiService = new ComfyUIService(logger);

  // Initialize Foundry client and tools

  const foundryClient = new FoundryClient(config.foundry, logger);

  // Initialize system registry and register adapters
  const { getSystemRegistry } = await import('./systems/index.js');
  const { DnD5eAdapter } = await import('./systems/dnd5e/adapter.js');

  const systemRegistry = getSystemRegistry(logger);
  systemRegistry.register(new DnD5eAdapter());

  logger.info('System registry initialized', {
    supportedSystems: systemRegistry.getSupportedSystems(),
  });

  const characterTools = new CharacterTools({ foundryClient, logger, systemRegistry });

  const compendiumTools = new CompendiumTools({ foundryClient, logger, systemRegistry });

  const sceneTools = new SceneTools({ foundryClient, logger });

  const actorCreationTools = new ActorCreationTools({ foundryClient, logger });

  const dnd5eAddFeatureTool = new DnD5eAddFeatureTool({ foundryClient, logger });
  const dnd5eNpcTools = new DnD5eNpcTools({ foundryClient, logger });
  const dnd5eFeaturesFromCompendiumTools = new DnD5eFeaturesFromCompendiumTools({
    foundryClient,
    logger,
  });

  const questCreationTools = new QuestCreationTools({ foundryClient, logger });

  const diceRollTools = new DiceRollTools({ foundryClient, logger });

  const campaignManagementTools = new CampaignManagementTools(foundryClient, logger);

  const ownershipTools = new OwnershipTools({ foundryClient, logger });

  const tokenManipulationTools = new TokenManipulationTools({ foundryClient, logger });

  const chatLogTools = new ChatLogTools({ foundryClient, logger });

  const resourceTools = new ResourceTools({ foundryClient, logger });

  const effectsTools = new EffectsTools({ foundryClient, logger });

  const combatTools = new CombatTools({ foundryClient, logger });

  const movementTools = new MovementTools({ foundryClient, logger });

  const sessionLogTools = new SessionLogTools({ foundryClient, logger });

  const combatResolutionTools = new CombatResolutionTools({ foundryClient, logger });

  const encounterTools = new EncounterTools({ foundryClient, logger });

  const sceneControlTools = new SceneControlTools({ foundryClient, logger });

  const lootTools = new LootTools({ foundryClient, logger });

  const diagnosticsTools = new DiagnosticsTools({ foundryClient, logger });

  // Initialize mapgen-style backend components for map generation
  let mapGenerationJobQueue: any = null;
  let mapGenerationComfyUIClient: any = null;

  try {
    // Import and initialize job queue and ComfyUI client
    const { JobQueue } = await import('./job-queue.js');
    const { ComfyUIClient } = await import('./comfyui-client.js');

    mapGenerationJobQueue = new JobQueue({ logger });

    // Initialize ComfyUI client - always runs locally on same machine as MCP server
    mapGenerationComfyUIClient = new ComfyUIClient({
      logger,
      config: {
        port: config.comfyui?.port || 31411,
      },
    });

    logger.info('Map generation backend components initialized (ComfyUI on localhost:31411)');

    // Auto-start ComfyUI if installed and autoStart is enabled
    if (mapGenerationComfyUIClient?.config?.autoStart) {
      const isInstalled = await mapGenerationComfyUIClient.checkInstallation();
      if (isInstalled) {
        logger.info('Auto-starting ComfyUI service...');
        try {
          await mapGenerationComfyUIClient.startService();
          logger.info('ComfyUI service auto-started successfully');
        } catch (error) {
          logger.warn('Failed to auto-start ComfyUI service', { error });
        }
      } else {
        logger.info('ComfyUI not installed, skipping auto-start');
      }
    }
  } catch (error) {
    logger.warn('Failed to initialize map generation components', { error });
  }

  // Set up global ComfyUI message handlers for WebSocket messages from Foundry BEFORE creating map tools

  (globalThis as any).backendComfyUIHandlers = {
    handleMessage: async (message: any) => {
      logger.info('Handling ComfyUI message', {
        requestId: message.requestId,

        type: message.type,

        hasData: !!message.data,
      });

      try {
        let result: any;

        switch (message.type) {
          case 'start-comfyui-service':
            result = await comfyuiService.start();

            break;

          case 'stop-comfyui-service':
            result = await comfyuiService.stop();

            break;

          case 'check-comfyui-status':
            result = await comfyuiService.checkStatus();

            break;

          // Map generation handlers (following existing tool pattern)
          case 'generate-map-request':
            result = await handleGenerateMapRequest(
              message,
              mapGenerationJobQueue,
              mapGenerationComfyUIClient,
              logger,
              foundryClient
            );
            break;

          case 'check-map-status-request':
            result = await handleCheckMapStatusRequest(message.data, mapGenerationJobQueue, logger);

            break;

          case 'cancel-map-job-request':
            result = await handleCancelMapJobRequest(
              message.data,
              mapGenerationJobQueue,
              mapGenerationComfyUIClient,
              logger
            );

            break;

          default:
            logger.warn('Unknown ComfyUI message type', { type: message.type });

            result = { status: 'error', message: `Unknown message type: ${message.type}` };
        }

        // Send response back through foundryClient if requestId is provided

        if (message.requestId && foundryClient) {
          const response = {
            type: `${message.type}-response`,

            requestId: message.requestId,

            ...result,
          };

          // Send response to Foundry via WebSocket

          try {
            foundryClient.sendMessage(response);
          } catch (error) {
            logger.error('Failed to send ComfyUI response to Foundry', { error, response });
          }
        }

        return result;
      } catch (error: any) {
        logger.error('ComfyUI message handling failed', {
          requestId: message.requestId,

          type: message.type,

          error: error.message,
        });

        const errorResult = {
          status: 'error',

          message: error.message,
        };

        // Send error response if requestId provided

        if (message.requestId && foundryClient) {
          try {
            foundryClient.sendMessage({
              type: `${message.type}-response`,

              requestId: message.requestId,

              ...errorResult,
            });
          } catch (sendError) {
            logger.error('Failed to send ComfyUI error response', { sendError });
          }
        }

        return errorResult;
      }
    },
  };

  // Now create MapGenerationTools with the handlers available

  const mapGenerationTools = new MapGenerationTools({
    foundryClient,
    logger,
    backendComfyUIHandlers: (globalThis as any).backendComfyUIHandlers,
  });

  // Control-channel call_tool dispatch table (see tool-router.ts).
  const toolRouter = buildToolRouter({
    characterTools,
    compendiumTools,
    sceneTools,
    actorCreationTools,
    questCreationTools,
    diceRollTools,
    campaignManagementTools,
    mapGenerationTools,
    tokenManipulationTools,
    ownershipTools,
    dnd5eAddFeatureTool,
    dnd5eNpcTools,
    dnd5eFeaturesFromCompendiumTools,
    chatLogTools,
    resourceTools,
    effectsTools,
    combatTools,
    movementTools,
    sessionLogTools,
    combatResolutionTools,
    encounterTools,
    sceneControlTools,
    lootTools,
    diagnosticsTools,
  });

  const allTools = [
    ...characterTools.getToolDefinitions(),

    ...compendiumTools.getToolDefinitions(),

    ...sceneTools.getToolDefinitions(),

    ...actorCreationTools.getToolDefinitions(),

    ...dnd5eAddFeatureTool.getToolDefinitions(),
    ...dnd5eNpcTools.getToolDefinitions(),
    ...dnd5eFeaturesFromCompendiumTools.getToolDefinitions(),

    ...questCreationTools.getToolDefinitions(),

    ...diceRollTools.getToolDefinitions(),

    ...campaignManagementTools.getToolDefinitions(),

    ...ownershipTools.getToolDefinitions(),

    ...tokenManipulationTools.getToolDefinitions(),

    ...mapGenerationTools.getToolDefinitions(),

    ...chatLogTools.getToolDefinitions(),

    ...resourceTools.getToolDefinitions(),

    ...effectsTools.getToolDefinitions(),

    ...combatTools.getToolDefinitions(),

    ...movementTools.getToolDefinitions(),

    ...sessionLogTools.getToolDefinitions(),

    ...combatResolutionTools.getToolDefinitions(),

    ...encounterTools.getToolDefinitions(),

    ...sceneControlTools.getToolDefinitions(),

    ...lootTools.getToolDefinitions(),

    ...diagnosticsTools.getToolDefinitions(),
  ];

  // Start Foundry connector (owns app port 31415). Skipped in control-only mode
  // so the standalone entrypoint can be smoke-tested without binding 31415/31416.

  if (FOUNDRY_LINK_ENABLED) {
    foundryClient.connect().catch(e => {
      logger.error('Foundry connector failed to start', e);
    });
  } else {
    logger.info('Foundry link disabled (MCP_FOUNDRY_LINK=off) — serving control channel only');
  }

  const autoStartComfyUI = async () => {
    try {
      logger.info('Auto-starting ComfyUI service...');

      const result = await comfyuiService.start();

      logger.info('ComfyUI auto-start result', result);
    } catch (error: any) {
      logger.warn('ComfyUI auto-start failed', {
        error: error instanceof Error ? error.message : String(error),
      });

      // Don't throw - backend should continue even if ComfyUI fails to start
    }
  };

  // Control channel (TCP JSON-lines)

  const server = net.createServer(socket => {
    socket.setEncoding('utf8');

    let buffer = '';

    const onControlData = async (chunk: string): Promise<void> => {
      buffer += chunk;

      let idx: number;

      while ((idx = buffer.indexOf('\n')) >= 0) {
        const line = buffer.slice(0, idx).trim();

        buffer = buffer.slice(idx + 1);

        if (!line) continue;

        try {
          const msg = JSON.parse(line) as ControlRequest;

          if (msg.method === 'ping') {
            socket.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);

            continue;
          }

          if (msg.method === 'list_tools') {
            socket.write(`${JSON.stringify({ id: msg.id, result: { tools: allTools } })}\n`);

            continue;
          }

          if (msg.method === 'call_tool') {
            const { name, args } = (msg.params || {}) as { name: string; args?: any };

            try {
              const route = toolRouter[name];
              if (!route) {
                throw new Error(`Unknown tool: ${name}`);
              }
              const result = await route(args);

              const payload: ToolResultPayload = {
                content: [
                  {
                    type: 'text',
                    text: typeof result === 'string' ? result : JSON.stringify(result),
                  },
                ],
              };

              socket.write(`${JSON.stringify({ id: msg.id, result: payload })}\n`);
            } catch (e: any) {
              const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';

              socket.write(
                `${JSON.stringify({
                  id: msg.id,
                  result: {
                    content: [{ type: 'text', text: `Error: ${errorMessage}` }],
                    isError: true,
                  },
                })}\n`
              );
            }

            continue;
          }

          // Unknown method

          socket.write(`${JSON.stringify({ id: msg.id, error: { message: 'Unknown method' } })}\n`);
        } catch (e: any) {
          try {
            socket.write(
              `${JSON.stringify({ error: { message: e?.message || 'Bad request' } })}\n`
            );
          } catch {}
        }
      }
    };
    socket.on('data', (chunk: string) => void onControlData(chunk));
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(CONTROL_PORT, CONTROL_HOST, () => {
      logger.info(`Backend control channel listening on ${CONTROL_HOST}:${CONTROL_PORT}`);

      resolve();
    });

    server.on('error', reject);
  });

  if (FOUNDRY_LINK_ENABLED) void autoStartComfyUI();

  // Shutdown hooks

  process.on('SIGINT', () => {
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });
}

// Check lock BEFORE any async operations
// If another instance is running, wait forever silently (don't exit)
// This prevents Claude Desktop from seeing a "server closed" error
const hasLock = acquireLock();

void (async function main() {
  if (!hasLock) {
    // Another backend is running - wait forever without doing anything
    // This keeps the process alive so Claude doesn't see an error
    await new Promise(() => {}); // Never resolves
    return;
  }

  process.on('exit', releaseLock);

  try {
    await startBackend();
  } catch (e: any) {
    console.error('Failed to start backend:', e?.message || e);

    releaseLock();

    process.exit(1);
  }
})();
