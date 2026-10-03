import * as fs from 'fs';

import * as os from 'os';

import * as path from 'path';

import * as net from 'net';

import { evaluateLockFile } from './lock.js';

import {
  BACKEND_LOCK_HELD_EXIT_CODE,
  WRAPPER_SPAWNED_ENV,
  isTruthyFlag,
} from './control-target.js';

import { buildToolRouter, collectToolDefinitions } from './tool-router.js';

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
import { GuardedChangeTools } from './tools/guarded-changes.js';
import { TarokkaTools } from './tools/tarokka.js';
import { PlaySessionTools } from './tools/play-session.js';
import { PlayStatsTools } from './tools/play-stats.js';
import { PlayerViewTools } from './tools/player-view.js';
import { PreflightTools } from './tools/preflight.js';
import { LivePlayTools } from './tools/live-play.js';
import { PartyTools } from './tools/party.js';
import { PrepDigestTools } from './tools/prep-digest.js';
import { RefChoiceTools } from './tools/ref-choices.js';
import { TarokkaService } from './tarokka/service.js';
import { HandoutsService, handleRecordHandoutSeen } from './handouts/service.js';
import { SecretTermsService } from './secret-terms.js';
import { GuardedWriteService } from './guarded-write/service.js';
import { AuditLog, VaultStore, WorldIdResolver, resolveDataDir } from './vault/index.js';
import { EventPump, eventPumpSettings } from './event-pump.js';
import { PlayLogPump, playLogSettings } from './play-log-pump.js';
import { UsageLog, handleRecordUsage } from './usage-log.js';
import { UsagePump } from './usage-pump.js';
import { ObsidianAutoRender, obsidianAutoRenderSettings } from './obsidian/auto-render.js';
import { ObsidianMirrorPump } from './obsidian/mirror-pump.js';
import { mirrorEnvSettings } from './obsidian/mirror-settings.js';
import { ObsidianMirrorTools } from './tools/obsidian-mirror.js';

// Control channel bind target. Defaults to the frozen loopback contract
// (127.0.0.1:31414) the stdio wrapper and dashboard expect, but is injectable so
// the backend can run as a standalone process on an alternate port for testing
// or a future remote-hosting topology. See `standalone.ts` / DETACH-PLAN Phase 6.
const CONTROL_HOST = process.env.MCP_CONTROL_HOST?.length
  ? process.env.MCP_CONTROL_HOST
  : '127.0.0.1';

const CONTROL_PORT = parseInt(
  process.env.MCP_CONTROL_PORT?.length ? process.env.MCP_CONTROL_PORT : '31414',
  10
);

// When the Foundry link is disabled (MCP_FOUNDRY_LINK=off) the backend serves the
// control channel ONLY — it does not bind the Foundry connector (WS 31415 / WebRTC
// 31416). Used to smoke-test the standalone entrypoint on an
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

  // Bridge vault (GM-only data off Foundry) + guarded writes (plan/apply/undo).
  const vaultStore = new VaultStore({ dataDir: resolveDataDir() });
  const worldIds = new WorldIdResolver(foundryClient);
  const auditLog = new AuditLog(vaultStore);
  // Obsidian notes, re-rendered after data changes (FOUNDRY_AI_OBSIDIAN_DIR; unset = off).
  const obsidianVaultDir = obsidianAutoRenderSettings().vaultDir;
  const obsidianRender = obsidianVaultDir
    ? new ObsidianAutoRender({
        store: vaultStore,
        audit: auditLog,
        vaultDir: obsidianVaultDir,
        logger,
        toolNames: () => allToolNames,
      })
    : null;
  // Filled once the tool list is built below; the usage note lists tools never run.
  let allToolNames: string[] = [];
  const renderObsidian = (worldId: string): void => obsidianRender?.schedule(worldId);
  // Usage log (I-084): dashboard and module usage events (FOUNDRY_AI_USAGE_LOG=off disables it).
  const usageLog = new UsageLog({
    store: vaultStore,
    worldIds,
    logger,
    onAppended: renderObsidian,
  });
  const guardedWrites = new GuardedWriteService({
    foundryClient,
    worldIds,
    store: vaultStore,
    audit: auditLog,
    logger,
    onRecorded: renderObsidian,
  });
  const guardedChangeTools = new GuardedChangeTools({ guardedWrites, foundryClient, logger });
  const tarokkaService = new TarokkaService({
    guardedWrites,
    store: vaultStore,
    worldIds,
    foundryClient,
  });
  const tarokkaTools = new TarokkaTools({ tarokka: tarokkaService, logger });
  const playSessionTools = new PlaySessionTools({
    worldIds,
    store: vaultStore,
    logger,
    onMarked: renderObsidian,
  });
  const playStatsTools = new PlayStatsTools({ worldIds, store: vaultStore, logger });
  const secretTerms = new SecretTermsService({ store: vaultStore });
  const handouts = new HandoutsService({
    guardedWrites,
    store: vaultStore,
    worldIds,
    foundryClient,
  });
  const playerViewTools = new PlayerViewTools({
    handouts,
    secretTerms,
    foundryClient,
    worldIds,
    logger,
  });
  const preflightTools = new PreflightTools({
    foundryClient,
    secretTerms,
    worldIds,
    playSession: playSessionTools,
    obsidianVaultDirSet: Boolean(obsidianVaultDir),
    logger,
  });
  const prepDigestTools = new PrepDigestTools({
    foundryClient,
    worldIds,
    store: vaultStore,
    handouts,
    preflight: preflightTools,
    guardedWrites,
    tarokka: tarokkaService,
    logger,
  });
  const partyTools = new PartyTools({ foundryClient, guardedWrites, logger });
  const ownershipTools = new OwnershipTools({ foundryClient, guardedWrites, logger });
  const livePlayTools = new LivePlayTools({ foundryClient, guardedWrites, logger });
  // O4 Foundry mirror: the pump starts with the Foundry link below (vault dir set only).
  const mirrorEnv = mirrorEnvSettings();
  for (const warning of mirrorEnv.warnings) logger.warn(warning);
  let mirrorPump: ObsidianMirrorPump | null = null;
  const obsidianMirrorTools = new ObsidianMirrorTools({
    store: vaultStore,
    worldIds,
    guardedWrites,
    status: () => mirrorPump?.status() ?? null,
    env: {
      vaultDirSet: Boolean(obsidianVaultDir),
      openBase: mirrorEnv.openBase,
      pollMs: mirrorEnv.pollMs,
      foundryUrl: mirrorEnv.foundryUrl,
    },
    logger,
  });
  logger.info('Bridge vault', { dataDir: vaultStore.dataDir });
  if (obsidianVaultDir) logger.info('Obsidian auto-render', { vaultDir: obsidianVaultDir });

  // Control-channel call_tool dispatch table (see tool-router.ts).
  const refChoiceTools = new RefChoiceTools({
    foundryClient,
    guardedWrites,
    logger,
  });

  const toolDeps = {
    characterTools,
    compendiumTools,
    sceneTools,
    actorCreationTools,
    questCreationTools,
    diceRollTools,
    campaignManagementTools,
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
    obsidianMirrorTools,
    sessionLogTools,
    combatResolutionTools,
    encounterTools,
    guardedChangeTools,
    tarokkaTools,
    playSessionTools,
    playStatsTools,
    playerViewTools,
    preflightTools,
    prepDigestTools,
    partyTools,
    livePlayTools,
    sceneControlTools,
    lootTools,
    diagnosticsTools,
    refChoiceTools,
  };
  const toolRouter = buildToolRouter(toolDeps);
  const allTools = collectToolDefinitions(toolDeps);
  allToolNames = allTools.map(t => t.name);

  // Start Foundry connector (owns app port 31415). Skipped in control-only mode
  // so the standalone entrypoint can be smoke-tested without binding 31415/31416.

  // Persistent session event log in the vault (FOUNDRY_AI_EVENT_LOG=off disables it), and the
  // play log (every roll and state change; FOUNDRY_AI_PLAY_LOG=off disables it).
  let eventPump: EventPump | null = null;
  let playLogPump: PlayLogPump | null = null;
  let usagePump: UsagePump | null = null;

  if (FOUNDRY_LINK_ENABLED) {
    foundryClient.connect().catch(e => {
      logger.error('Foundry connector failed to start', e);
    });
    const pumpSettings = eventPumpSettings();
    if (pumpSettings.enabled) {
      eventPump = new EventPump({
        foundryClient,
        worldIds,
        store: vaultStore,
        logger,
        intervalMs: pumpSettings.intervalMs,
        onAppended: renderObsidian,
      });
      eventPump.start();
    } else {
      logger.info('Session event log disabled (FOUNDRY_AI_EVENT_LOG=off)');
    }
    const playSettings = playLogSettings();
    if (playSettings.enabled) {
      playLogPump = new PlayLogPump({
        foundryClient,
        worldIds,
        store: vaultStore,
        logger,
        intervalMs: playSettings.intervalMs,
        onAppended: renderObsidian,
      });
      playLogPump.start();
    } else {
      logger.info('Play log disabled (FOUNDRY_AI_PLAY_LOG=off)');
    }
    if (usageLog.enabled) {
      usagePump = new UsagePump({
        foundryClient,
        worldIds,
        store: vaultStore,
        usageLog,
        logger,
        intervalMs: pumpSettings.intervalMs,
      });
      usagePump.start();
    } else {
      logger.info('Usage log disabled (FOUNDRY_AI_USAGE_LOG=off)');
    }
    // It writes only once the mirror settings say enabled (plan-obsidian-mirror).
    if (obsidianVaultDir) {
      mirrorPump = new ObsidianMirrorPump({
        foundryClient,
        worldIds,
        store: vaultStore,
        vaultDir: obsidianVaultDir,
        logger,
        pollMs: mirrorEnv.pollMs,
        openBase: mirrorEnv.openBase,
        foundryUrl: mirrorEnv.foundryUrl,
      });
      mirrorPump.start();
    }
  } else {
    logger.info('Foundry link disabled (MCP_FOUNDRY_LINK=off) — serving control channel only');
  }

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

          // Usage events from the dashboard (dashboard forced surface and who); not a tool, never
          // listed to Claude, and the stdio wrapper never forwards it.
          if (msg.method === 'record_usage') {
            const result = await handleRecordUsage(usageLog, msg.params);
            socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);

            continue;
          }

          // A player opened a handout on /player (I-039 seen log); not a tool, never listed to
          // Claude, and the stdio wrapper never forwards it.
          if (msg.method === 'record_handout_seen') {
            try {
              const result = await handleRecordHandoutSeen(handouts, msg.params);
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Bad request';
              socket.write(`${JSON.stringify({ id: msg.id, error: { message } })}\n`);
            }

            continue;
          }

          // Live write sweep helper (I-016): the dashboard's test route passes a scene snapshot,
          // combat or clean-up request for scripts/live-write-sweep.mjs to the module, which
          // refuses outside the test world. Not a tool, never listed to Claude, and the stdio
          // wrapper never forwards it.
          if (msg.method === 'live_sweep') {
            try {
              const result = await foundryClient.query(
                'foundry-mcp-bridge.liveSweep',
                (msg.params ?? {}) as Record<string, unknown>
              );
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Live sweep helper failed';
              socket.write(`${JSON.stringify({ id: msg.id, error: { message } })}\n`);
            }

            continue;
          }

          // Ready for session (D3, PB-17): the dashboard's GM route reads, turns on (`ready`) or
          // turns back off (`end`) tonight's switches in the module. Not a tool, never listed to
          // Claude, and the stdio wrapper never forwards it, so Claude cannot switch on its own
          // writes.
          if (msg.method === 'session_switches') {
            try {
              const params = (msg.params ?? {}) as Record<string, unknown>;
              const action = ['get', 'ready', 'end'].includes(String(params.action))
                ? String(params.action)
                : 'get';
              const result: unknown = await foundryClient.query(
                'foundry-mcp-bridge.sessionSwitches',
                {
                  action,
                }
              );
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Session switches failed';
              socket.write(`${JSON.stringify({ id: msg.id, error: { message } })}\n`);
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
    // A client that drops abruptly (ECONNRESET, e.g. a killed dashboard) must not
    // crash the backend: an 'error' event without a listener is fatal in Node.
    socket.on('error', error => {
      logger.debug('Control client socket error', { error: error.message });
    });
  });

  await new Promise<void>((resolve, reject) => {
    server.listen(CONTROL_PORT, CONTROL_HOST, () => {
      logger.info(`Backend control channel listening on ${CONTROL_HOST}:${CONTROL_PORT}`);

      resolve();
    });

    server.on('error', reject);
  });

  // Shutdown hooks

  process.on('SIGINT', () => {
    eventPump?.stop();
    playLogPump?.stop();
    usagePump?.stop();
    mirrorPump?.stop();
    obsidianRender?.stop();
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    eventPump?.stop();
    playLogPump?.stop();
    usagePump?.stop();
    mirrorPump?.stop();
    obsidianRender?.stop();
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });
}

// Check lock BEFORE any async operations
// If another instance is running, wait forever silently (don't exit)
// This prevents Claude Desktop from seeing a "server closed" error
const hasLock = acquireLock();

void (async function main(): Promise<void> {
  if (!hasLock) {
    // Spawned by a wrapper (one per Claude Desktop tool-set entry): exit, the wrapper connects to
    // the backend that holds the lock.
    if (isTruthyFlag(process.env[WRAPPER_SPAWNED_ENV])) process.exit(BACKEND_LOCK_HELD_EXIT_CODE);
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
