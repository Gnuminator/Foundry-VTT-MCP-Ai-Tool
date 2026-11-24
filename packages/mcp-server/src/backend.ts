import * as os from 'os';

import * as path from 'path';

import * as net from 'net';

import { acquireLock, releaseLock } from './backend-lock.js';

import {
  BACKEND_LOCK_HELD_EXIT_CODE,
  WRAPPER_SPAWNED_ENV,
  isTruthyFlag,
} from './control-target.js';

import { buildToolRouter, collectToolDefinitions, DETACHED_TOOLS } from './tool-router.js';
import { RepeatGuard } from './repeat-guard.js';
import { createAiChangesAnnouncer, createModuleRequestHandler } from './module-requests.js';

import { config } from './config.js';

import {
  DEFAULT_CONTROL_PORT,
  MAX_REQUESTER_LENGTH,
  sessionsDirFrom,
  unknownToolMessage,
} from '@gnuminator/shared';
import { TOOL_VERSION, USAGE_LOG_FILE_RE } from '@gnuminator/shared';
import type { ToolResultPayload, UsageEvent } from '@gnuminator/shared';

import { createControlReader } from './control-reader.js';
import { Logger } from './logger.js';

import { FoundryClient } from './foundry-client.js';

import { createTools, guardedChangesModule, playerModule } from './tools/index.js';
import { splitPlayerTools } from './tool-sets.js';
import { remoteGmCall, remoteGmList, remoteGmSet } from './remote-gm.js';
import {
  PLAYER_CONFIG_ENV,
  PLAYER_DASHBOARD_TOOL_NAMES,
  handlePlayerTool,
  readExtraDenyTerms,
} from './tools/player.js';
import { GameEventHub } from './game-event-hub.js';
import { WrapperRegistry } from './wrapper-registry.js';
import {
  ToolCallLog,
  buildCallLine,
  errorText,
  recordedCallLine,
  gmCaller,
  skillFields,
  type CallCaller,
} from './tool-call-log.js';
import type { ToolResultLike } from './tool-router.js';
import { ClientsFile, handleWhoUsesWhat } from './who-uses-what.js';
import { TarokkaService } from './tarokka/service.js';
import { handleDowntime } from './downtime/store.js';
import { HandoutsService, handleRecordHandoutSeen } from './handouts/service.js';
import { DIRECT_WRITE_TIMEOUT_MS, queryTimeoutContext } from './direct-write-timeout.js';
import { createDraftsStore, draftsControlReply } from './drafts/store.js';
import { createOmensStore, omensControlReply } from './omens/store.js';
import { SecretTermsService } from './secret-terms.js';
import { isBatchRider } from './guarded-write/rider-undo.js';
import { GuardedWriteService } from './guarded-write/service.js';
import { UndoPlanner } from './guarded-write/undo-planner.js';
import { AuditLog, VaultStore, WorldIdResolver, resolveDataDir } from './vault/index.js';
import { EventPump, eventPumpSettings } from './event-pump.js';
import { PlayLogPump, playLogSettings } from './play-log-pump.js';
import type { PumpHealthSnapshot } from './pump-health.js';
import { ChangeJournalPump, changeJournalSettings } from './change-journal-pump.js';
import { ChangeHistory, journalLinks } from './change-history.js';
import { UsageLog, handleRecordUsage } from './usage-log.js';
import { handlePlayerPortrait, PortraitError } from './player-portrait.js';
import {
  handleCharacterSheet,
  handlePlayerRoll,
  handleFeatureSwitches,
  handleSessionSwitches,
  type FoundryQuery,
} from './session-control.js';
import { SessionNotesService, controlError, handleSessionNotes } from './session-notes/index.js';
import { UsagePump } from './usage-pump.js';
import { ObsidianAutoRender, obsidianAutoRenderSettings } from './obsidian/auto-render.js';
import { EveryoneNotes } from './obsidian/everyone-notes.js';
import { ObsidianMirrorPump } from './obsidian/mirror-pump.js';
import { messageOf } from './types/server-types.js';
import { mirrorEnvSettings } from './obsidian/mirror-settings.js';
import { ObsidianQuestImportTools } from './tools/obsidian-quest-import.js';

// Control channel bind target. Defaults to the frozen loopback contract
// (127.0.0.1:31414) the stdio wrapper and dashboard expect, but is injectable so
// the backend can run as a standalone process on an alternate port for testing
// or a future remote-hosting topology. See `standalone.ts` / DETACH-PLAN Phase 6.
const CONTROL_HOST = process.env.MCP_CONTROL_HOST?.length
  ? process.env.MCP_CONTROL_HOST
  : '127.0.0.1';

const CONTROL_PORT = parseInt(
  process.env.MCP_CONTROL_PORT?.length
    ? process.env.MCP_CONTROL_PORT
    : String(DEFAULT_CONTROL_PORT),
  10
);

// When the Foundry link is disabled (MCP_FOUNDRY_LINK=off) the backend serves the
// control channel ONLY: it does not bind the Foundry connector (WS 31415).
// Used to smoke-test the standalone entrypoint on an
// alternate port without colliding with a live bridge. Default: enabled (full backend).
const FOUNDRY_LINK_ENABLED = !/^(off|false|0|no)$/i.test(process.env.MCP_FOUNDRY_LINK ?? '');

async function startBackend(): Promise<void> {
  // Logger: file output allowed; avoid stdout noise

  const logger = new Logger({
    level: config.logLevel,

    format: config.logFormat,

    enableConsole: false,

    enableFile: true,

    // LOG_FILE_PATH puts the log somewhere that survives a restart (the Pi unit sets it); the
    // default is the temp folder, which a service with PrivateTmp loses at every restart.
    filePath: config.logFilePath || path.join(os.tmpdir(), 'foundry-mcp-server', 'mcp-server.log'),
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

  // wait-for-game-event (I-001): the event pumps publish here, the tool sleeps on it.
  const gameEventHub = new GameEventHub();

  // Bridge vault (GM-only data off Foundry) + guarded writes (plan/apply/undo).
  const vaultStore = new VaultStore({ dataDir: resolveDataDir() });
  const worldIds = new WorldIdResolver(foundryClient, { dataDir: vaultStore.dataDir });
  const auditLog = new AuditLog(vaultStore);
  // Obsidian notes, re-rendered after data changes (FOUNDRY_AI_OBSIDIAN_DIR; unset = off).
  const obsidianVaultDir = obsidianAutoRenderSettings().vaultDir;
  const obsidianRender = obsidianVaultDir
    ? new ObsidianAutoRender({
        store: vaultStore,
        audit: auditLog,
        vaultDir: obsidianVaultDir,
        logger,
        toolNames: (): string[] => allToolNames,
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
  // One line per tool call with who made it (D-146): names, sets and counts, never arguments or results.
  const callLog = new ToolCallLog({ dataDir: vaultStore.dataDir });
  const recordCall = (
    tool: string,
    startedAt: number,
    result: ToolResultLike | undefined,
    caller: CallCaller
  ): void => {
    try {
      const line = buildCallLine(tool, startedAt, result, Date.now(), caller);
      // The call log keeps only the class; the message goes to the backend log once.
      if (!line.ok) {
        logger.warn('Tool call failed', {
          tool: line.tool,
          class: line.err,
          message: errorText(result).slice(0, 500),
        });
      }
      void callLog.record(line).catch(() => undefined);
    } catch {
      // logging never breaks a tool call
    }
  };
  const clientsFile = new ClientsFile(vaultStore.dataDir, usageLog.enabled);
  const loadWorldUsageEvents = async (): Promise<UsageEvent[]> => {
    const worldId = await worldIds.current().catch(() => null);
    if (!worldId) return [];
    const files = (await vaultStore.list(worldId, 'sessions'))
      .filter(f => USAGE_LOG_FILE_RE.test(f))
      .sort()
      .slice(-90);
    const out: UsageEvent[] = [];
    for (const file of files) {
      for (const line of await vaultStore.readLines(worldId, 'sessions', file)) {
        const e = line as Partial<UsageEvent> | null;
        if (e && typeof e.t === 'number' && typeof e.name === 'string' && e.who) {
          out.push(e as UsageEvent);
        }
      }
    }
    return out;
  };
  // Everyone's daily notes in the GM vault (I-109 PR 6); made below once the change history exists.
  let everyoneNotes: EveryoneNotes | null = null;
  const guardedWrites = new GuardedWriteService({
    foundryClient,
    worldIds,
    store: vaultStore,
    audit: auditLog,
    logger,
    onRecorded: (worldId: string): void => {
      renderObsidian(worldId);
      everyoneNotes?.schedule(worldId);
    },
  });
  // Everyone's recent changes (I-109): the change-journal pump fills the vault, this index reads it.
  // The pump starts below once the Foundry link does; `list-changes` pulls the newest records through it.
  const changeJournalConfig = changeJournalSettings();
  let changeJournalPump: ChangeJournalPump | null = null;
  const changeHistory = new ChangeHistory({
    store: vaultStore,
    worldIds,
    guardedWrites,
    logger,
    maxChars: changeJournalConfig.maxBytes,
    ...(FOUNDRY_LINK_ENABLED && changeJournalConfig.enabled
      ? journalLinks((): ChangeJournalPump | null => changeJournalPump)
      : {}),
  });
  if (FOUNDRY_LINK_ENABLED && changeJournalConfig.enabled) {
    // humanActions fetches the newest records first: the rider arrives a moment after the write.
    guardedWrites.batchRiders = async (changeId): Promise<Array<{ uuid: string }>> => {
      await changeHistory.humanActions();
      return (await changeHistory.aiFollowUps(changeId)).filter(r => isBatchRider(r));
    };
  }
  if (obsidianVaultDir && changeJournalConfig.enabled) {
    everyoneNotes = new EveryoneNotes({ changeHistory, vaultDir: obsidianVaultDir, logger });
  }
  const undoPlanner = new UndoPlanner({
    changeHistory,
    guardedWrites,
    audit: auditLog,
    worldIds,
    foundryClient,
  });
  const tarokkaService = new TarokkaService({
    guardedWrites,
    store: vaultStore,
    worldIds,
    foundryClient,
  });
  const secretTerms = new SecretTermsService({ store: vaultStore });
  const handouts = new HandoutsService({
    guardedWrites,
    store: vaultStore,
    worldIds,
    foundryClient,
  });
  const omens = createOmensStore(vaultStore, worldIds, secretTerms);
  // Draft tray (I-069): publishing posts to Foundry chat through the existing chat bridge query.
  const drafts = createDraftsStore(vaultStore, worldIds, secretTerms, async post => {
    // Longer wait like other direct writes; a lost answer keeps the draft out of "publish again".
    const reply = (await queryTimeoutContext.run({ timeoutMs: DIRECT_WRITE_TIMEOUT_MS }, () =>
      foundryClient.query('foundry-mcp-bridge.sendChatMessage', {
        message: post.message,
        messageType: post.whisperTargets ? 'whisper' : 'ic',
        ...(post.whisperTargets ? { whisperTargets: post.whisperTargets } : {}),
      })
    )) as { success?: boolean; error?: string; warning?: string } | undefined;
    if (reply?.success === false) throw new Error(reply.error || 'Failed to send chat message');
    // A whisper target that matches no Foundry user goes to the GMs only: not delivered.
    if (reply?.warning) throw new Error(`Not delivered: ${reply.warning}`);
  });
  // Session notes into Foundry (recap lane, D-087): staged by the pipeline, put automatically.
  const sessionNotes = new SessionNotesService({
    foundryClient,
    worldIds,
    store: vaultStore,
    audit: auditLog,
    guardedWrites,
    handouts,
    logger,
  });
  const wrapperRegistry = new WrapperRegistry();
  // Filled when the pumps start below; get-preflight reads their health through it.
  const pumpHealthSources: Array<() => PumpHealthSnapshot> = [];
  // O4 Foundry mirror: the pump starts with the Foundry link below (vault dir set only).
  const mirrorEnv = mirrorEnvSettings();
  for (const warning of mirrorEnv.warnings) logger.warn(warning);
  let mirrorPump: ObsidianMirrorPump | null = null;
  const obsidianQuestImportTools = new ObsidianQuestImportTools({
    vaultDir: obsidianVaultDir ?? null,
    worldIds,
    guardedWrites,
    logger,
  });
  logger.info('Bridge vault', { dataDir: vaultStore.dataDir });
  if (obsidianVaultDir) logger.info('Obsidian auto-render', { vaultDir: obsidianVaultDir });

  // Every tool family, built from the modules in tools/index.ts with the services above.
  const toolDeps = createTools({
    foundryClient,
    logger,
    systemRegistry,
    gameEventHub,
    guardedWrites,
    worldIds,
    store: vaultStore,
    changeHistory,
    undoPlanner,
    tarokka: tarokkaService,
    secretTerms,
    handouts,
    omens,
    drafts,
    onPlaySessionMarked: renderObsidian,
    wrapperStatus: () => wrapperRegistry.status(),
    pumpHealth: (): PumpHealthSnapshot[] => pumpHealthSources.map(source => source()),
    obsidianVaultDir,
    sessionsDir: sessionsDirFrom(process.env.FVTT_SESSIONS_DIR),
    mirrorStatus: (): ReturnType<ObsidianMirrorPump['status']> | null =>
      mirrorPump?.status() ?? null,
    mirrorEnv: {
      vaultDirSet: Boolean(obsidianVaultDir),
      openBase: mirrorEnv.openBase,
      pollMs: mirrorEnv.pollMs,
      foundryUrl: mirrorEnv.foundryUrl,
    },
    playerExtraDenyTerms: (): string[] => readExtraDenyTerms(process.env[PLAYER_CONFIG_ENV]),
  });
  const guardedChangeTools = toolDeps.get(guardedChangesModule);
  // The player set (D-136): runs only through the `player_tool` control message below.
  const playerTools = toolDeps.get(playerModule);

  // Control-channel call_tool dispatch table (see tool-router.ts).
  const toolRouter = buildToolRouter(toolDeps);
  // The same write twice within 3 s (a double click) answers with the first result (repeat-guard.ts).
  const repeatGuard = new RepeatGuard();
  // Dashboard-only routes (O6): callable through call_tool by the dashboard's GM proxy, but not
  // MCP tools (no definition, in no tool set), so buildToolRouter's one-route-per-tool test and
  // the tool-set size budgets stay as they are. They are not listed to Claude, but not walled off
  // either, so each must be harmless alone (this one plans only; applying needs confirm).
  toolRouter['plan-obsidian-quest-import'] = (args: unknown): Promise<unknown> =>
    obsidianQuestImportTools.handlePlanObsidianQuestImport(args);
  // A `module-request` from the linked browser runs through the same dispatch table as the
  // control channel's call_tool (MODULE_REQUEST_TOOLS only; an undo records who asked).
  foundryClient.setModuleRequestHandler(
    createModuleRequestHandler({
      toolRouter,
      repeatGuard,
      guardedChangeTools,
      guardedWrites,
      tarokkaPositionRevealed: async position => {
        const reading = (await tarokkaService.getReading()).reading;
        return reading?.positions.find(p => p.position === position)?.revealed === true;
      },
    })
  );
  // After every recorded apply or undo, and every Handouts queue change (which records nothing),
  // the module's windows fetch again.
  const announceAiChanges = createAiChangesAnnouncer(foundryClient, logger);
  guardedWrites.addRecordedListener(announceAiChanges);
  handouts.addQueueChangedListener(announceAiChanges);
  // The player tools are not listed to any other control client (see splitPlayerTools).
  const { listed: allTools, player: playerToolDefinitions } = splitPlayerTools(
    collectToolDefinitions(toolDeps)
  );
  allToolNames = allTools.map(t => t.name);

  // Start Foundry connector (owns app port 31415). Skipped in control-only mode
  // so the standalone entrypoint can be smoke-tested without binding 31415.

  // Persistent session event log in the vault (FOUNDRY_AI_EVENT_LOG=off disables it), and the
  // play log (every roll and state change; FOUNDRY_AI_PLAY_LOG=off disables it).
  let eventPump: EventPump | null = null;
  let playLogPump: PlayLogPump | null = null;
  let usagePump: UsagePump | null = null;

  if (FOUNDRY_LINK_ENABLED) {
    foundryClient.connect().catch(e => {
      logger.error('Foundry connector failed to start', e);
    });
    sessionNotes.start();
    const pumpSettings = eventPumpSettings();
    if (pumpSettings.enabled) {
      eventPump = new EventPump({
        foundryClient,
        worldIds,
        store: vaultStore,
        logger,
        intervalMs: pumpSettings.intervalMs,
        onAppended: renderObsidian,
        onEvents: (_worldId, events): void => gameEventHub.publishSessionEvents(events),
      });
      const pump = eventPump;
      pumpHealthSources.push(() => pump.health.snapshot());
      eventPump.start();
    } else {
      logger.info('Session event log disabled (FOUNDRY_AI_EVENT_LOG=off)');
    }
    const playSettings = playLogSettings();
    gameEventHub.setSources({
      sessionEvents: pumpSettings.enabled,
      playLog: playSettings.enabled,
    });
    if (playSettings.enabled) {
      playLogPump = new PlayLogPump({
        foundryClient,
        worldIds,
        store: vaultStore,
        logger,
        intervalMs: playSettings.intervalMs,
        onAppended: renderObsidian,
        onRecords: (_worldId, records): void => gameEventHub.publishPlayRecords(records),
      });
      const pump = playLogPump;
      pumpHealthSources.push(() => pump.health.snapshot());
      playLogPump.start();
    } else {
      logger.info('Play log disabled (FOUNDRY_AI_PLAY_LOG=off)');
    }
    // The change journal (I-109; FOUNDRY_AI_CHANGE_JOURNAL=off disables it): every change anyone made.
    if (changeJournalConfig.enabled) {
      changeJournalPump = new ChangeJournalPump({
        foundryClient,
        worldIds,
        store: vaultStore,
        logger,
        intervalMs: changeJournalConfig.intervalMs,
        maxBytes: changeJournalConfig.maxBytes,
        onAppended: (worldId, records): void => {
          changeHistory.addRecords(worldId, records);
          everyoneNotes?.schedule(worldId);
        },
      });
      changeJournalPump.start();
    } else {
      logger.info('Change journal disabled (FOUNDRY_AI_CHANGE_JOURNAL=off)');
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
    logger.info('Foundry link disabled (MCP_FOUNDRY_LINK=off), serving control channel only');
  }

  // Control channel (TCP JSON-lines)

  let nextConnectionId = 0;
  const server = net.createServer(socket => {
    socket.setEncoding('utf8');
    const connectionId = (nextConnectionId += 1);
    // Set by the `hello` of the co-GM dashboard: every call on this connection is the dashboard's
    // (its background reads too), not the GM's Claude.
    let dashboardConnection = false;
    socket.on('close', () => wrapperRegistry.close(connectionId));

    // Aborts the long waits (wait-for-game-event) of a connection that closed.
    const socketAbort = new AbortController();
    socket.on('close', () => socketAbort.abort());

    // Closes the socket on anything that is not a JSON-lines client (an HTTP POST from a web page).
    const reader = createControlReader(socket, logger);

    const onControlData = async (chunk: string): Promise<void> => {
      for (const msg of reader.read(chunk)) {
        // A later chunk was refused (HTTP, junk) while this one was still being dispatched.
        if (socket.destroyed) break;
        try {
          if (msg.method === 'ping') {
            socket.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);

            continue;
          }

          // Whether the Foundry module's socket is connected (the Assistant GM's link check on the Pi).
          if (msg.method === 'link_status') {
            socket.write(
              `${JSON.stringify({
                id: msg.id,
                result: { ok: true, module: foundryClient.getConnectionState() },
              })}\n`
            );

            continue;
          }

          // The stdio wrapper says which version and build it is (a wrapper from before this sends
          // none). get-preflight reads the registry in-process; `wrapper_status` serves the same view.
          if (msg.method === 'hello') {
            wrapperRegistry.hello(connectionId, msg.params);
            const hp = (msg.params ?? {}) as {
              version?: unknown;
              client?: unknown;
              install?: unknown;
              autoUpdate?: unknown;
            };
            if (hp.client === 'dashboard') dashboardConnection = true;
            else {
              void clientsFile.record({
                piece: 'connectors',
                who: 'gm',
                install: hp.install,
                autoUpdate: hp.autoUpdate,
                version: hp.version,
              });
            }
            socket.write(`${JSON.stringify({ id: msg.id, result: { ok: true } })}\n`);

            continue;
          }

          // The connected connectors, names and versions only (read-only; the same object
          // get-preflight reads).
          if (msg.method === 'wrapper_status') {
            socket.write(`${JSON.stringify({ id: msg.id, result: wrapperRegistry.status() })}\n`);

            continue;
          }

          if (msg.method === 'list_tools') {
            socket.write(`${JSON.stringify({ id: msg.id, result: { tools: allTools } })}\n`);

            continue;
          }

          // The player tool definitions, for the dashboard's /mcp/player `tools/list`.
          if (msg.method === 'list_player_tools') {
            socket.write(
              `${JSON.stringify({ id: msg.id, result: { tools: playerToolDefinitions } })}\n`
            );

            continue;
          }

          if (msg.method === 'call_tool') {
            const { name, args, requestedBy } = (msg.params || {}) as {
              name: string;
              args?: unknown;
              requestedBy?: unknown;
            };

            if (typeof requestedBy !== 'string')
              wrapperRegistry.toolCallWithoutRequester(connectionId);

            const startedAt = Date.now();
            // The dashboard says hello as `dashboard` (and names `requestedBy` on its writes); a
            // connector (the GM's Claude) does neither.
            const caller = gmCaller(dashboardConnection, requestedBy, String(name), args);
            const runCall = async (): Promise<void> => {
              try {
                // Own keys only: a name such as "constructor" must not reach Object.prototype.
                const route =
                  typeof name === 'string' && Object.hasOwn(toolRouter, name)
                    ? toolRouter[name]
                    : undefined;
                if (typeof route !== 'function') {
                  throw new Error(unknownToolMessage(String(name)));
                }
                // The dashboard says who asked (a GM's undo there is theirs, not the AI's).
                const requester =
                  typeof requestedBy === 'string'
                    ? requestedBy.trim().slice(0, MAX_REQUESTER_LENGTH)
                    : '';
                // Guarded routes must not read `signal`: a joined second caller would share the first socket's abort.
                const result: unknown = await repeatGuard.run(name, args, requester, () =>
                  route(args, {
                    ...(requester ? { requestedBy: requester } : {}),
                    signal: socketAbort.signal,
                  })
                );

                const payload: ToolResultPayload = {
                  content: [
                    {
                      type: 'text',
                      text: typeof result === 'string' ? result : JSON.stringify(result),
                    },
                  ],
                };

                // An older connector gets one outdated line, appended to a successful answer.
                if (!socket.destroyed) {
                  const notice = wrapperRegistry.noticeFor(
                    connectionId,
                    Date.now(),
                    payload.content[0]?.text.length ?? 0
                  );
                  if (notice !== null) payload.content.push({ type: 'text', text: notice });
                }

                if (!socket.destroyed) {
                  socket.write(`${JSON.stringify({ id: msg.id, result: payload })}\n`);
                }
                recordCall(String(name), startedAt, payload, caller);
              } catch (e: unknown) {
                const errorMessage = e instanceof Error ? e.message : 'Unknown error occurred';
                recordCall(
                  String(name),
                  startedAt,
                  { content: [{ type: 'text', text: `Error: ${errorMessage}` }], isError: true },
                  caller
                );

                if (!socket.destroyed) {
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
              }
            };
            // Lines that arrive in the same chunk run in order; a long wait must not hold up the
            // lines behind it, so only this tool is not awaited.
            if (DETACHED_TOOLS.has(name)) void runCall();
            else await runCall();

            continue;
          }

          // Which version a person's piece runs (the dashboard's player and Obsidian sightings, the
          // wrapper's Claude client name); names and versions only. Not a tool, never listed.
          if (msg.method === 'record_client') {
            const ok = await clientsFile.record(msg.params);
            socket.write(`${JSON.stringify({ id: msg.id, result: { ok } })}\n`);

            continue;
          }

          // A call the dashboard answered itself (a player's get-my-handouts or get-my-play-stats):
          // the line for the call log, with the tool name checked against that fixed list.
          if (msg.method === 'record_call') {
            const line = recordedCallLine(msg.params, PLAYER_DASHBOARD_TOOL_NAMES);
            if (line) void callLog.record(line).catch(() => undefined);
            socket.write(`${JSON.stringify({ id: msg.id, result: { ok: line !== null } })}\n`);

            continue;
          }

          // The "who uses what" report (counts per person); read-only, GM dashboard only.
          if (msg.method === 'who_uses_what') {
            const result = await handleWhoUsesWhat(
              {
                dataDir: vaultStore.dataDir,
                clients: clientsFile,
                usageEvents: loadWorldUsageEvents,
                toolNames: (): string[] => allToolNames,
                current: TOOL_VERSION,
              },
              msg.params
            );
            socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);

            continue;
          }

          // Usage events from the dashboard (dashboard forced surface and who); not a tool, never
          // listed to Claude, and the stdio wrapper never forwards it.
          if (msg.method === 'record_usage') {
            const result: unknown = await handleRecordUsage(usageLog, msg.params);
            socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);

            continue;
          }

          // A player opened a handout on /player (I-039 seen log); not a tool, never listed to
          // Claude, and the stdio wrapper never forwards it.
          if (msg.method === 'record_handout_seen') {
            try {
              const result: unknown = await handleRecordHandoutSeen(handouts, msg.params);
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Bad request';
              socket.write(`${JSON.stringify({ id: msg.id, error: { message } })}\n`);
            }

            continue;
          }

          if (msg.method === 'drafts') {
            socket.write(
              `${JSON.stringify(await draftsControlReply(drafts, msg.id, msg.params))}\n`
            );
            continue;
          }

          if (msg.method === 'omens') {
            socket.write(`${JSON.stringify(await omensControlReply(omens, msg.id, msg.params))}\n`);
            continue;
          }

          // Downtime inbox (I-180): the dashboard passes the mapped user id; not a tool, never forwarded.
          if (msg.method === 'downtime') {
            try {
              // Vault only, so it also works between sessions with no GM client joined.
              const worldId = await worldIds.currentOrLastKnown();
              const result: unknown = await handleDowntime(vaultStore, worldId, msg.params);
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Bad request';
              socket.write(`${JSON.stringify({ id: msg.id, error: { message } })}\n`);
            }

            continue;
          }

          // Live write sweep helper (I-016): the dashboard's test route passes a scene snapshot,
          // combat, concentration, switches, fixture, playlist-state or clean-up request for
          // scripts/live-write-sweep.mjs to the module, which refuses outside the test worlds. Not a tool, never listed to Claude, and the stdio
          // wrapper never forwards it.
          if (msg.method === 'live_sweep') {
            try {
              const result: unknown = await foundryClient.query(
                'foundry-mcp-bridge.liveSweep',
                msg.params ?? {}
              );
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Live sweep helper failed';
              socket.write(`${JSON.stringify({ id: msg.id, error: { message } })}\n`);
            }

            continue;
          }

          // The dashboard's switch views (session-control.ts): Ready for session (D3, PB-17) reads,
          // turns on or turns back off tonight's switches; the feature cards (I-064) read every
          // feature switch. Not tools, never listed to Claude, and the stdio wrapper never forwards
          // them, so Claude cannot switch on its own writes.
          // My character (I-096) reads one player's character sheets the same way; the dashboard
          // passes the user id it mapped from the player's link key.
          if (
            msg.method === 'session_switches' ||
            msg.method === 'feature_switches' ||
            msg.method === 'character_sheet' ||
            msg.method === 'player_roll'
          ) {
            const query: FoundryQuery = (method, data) => foundryClient.query(method, data ?? {});
            try {
              const result: unknown =
                msg.method === 'session_switches'
                  ? await handleSessionSwitches(query, msg.params)
                  : msg.method === 'feature_switches'
                    ? await handleFeatureSwitches(query)
                    : msg.method === 'character_sheet'
                      ? await handleCharacterSheet(query, msg.params)
                      : await handlePlayerRoll(query, msg.params);
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'Switches failed';
              socket.write(`${JSON.stringify({ id: msg.id, error: { message } })}\n`);
            }

            continue;
          }

          // The remote GM connector (item remote-gm-connector): the dashboard's /mcp/<set> routes
          // forward a GM whom Cloudflare Access has signed in. The set comes from the path, the
          // tools are that set's only, and each call runs the same route as a stdio entry's.
          if (msg.method === 'remote_gm_list' || msg.method === 'remote_gm_call') {
            const rp = (msg.params ?? {}) as { set?: unknown; name?: unknown; args?: unknown };
            const rset = remoteGmSet(rp.set);
            if (!rset) {
              socket.write(
                `${JSON.stringify({ id: msg.id, error: { message: 'Unknown set' } })}\n`
              );
              continue;
            }
            if (msg.method === 'remote_gm_list') {
              socket.write(
                `${JSON.stringify({ id: msg.id, result: remoteGmList(allTools, rset) })}\n`
              );
              continue;
            }
            const answer = async (): Promise<void> => {
              const result = await remoteGmCall(
                {
                  allTools,
                  run: (n, a) =>
                    repeatGuard.run(n, a, '', () => {
                      const route = Object.hasOwn(toolRouter, n) ? toolRouter[n] : undefined;
                      if (typeof route !== 'function') {
                        throw new Error(unknownToolMessage(n));
                      }
                      return route(a, { signal: socketAbort.signal });
                    }),
                  record: (tool, startedAt, r) =>
                    recordCall(tool, startedAt, r, { who: 'gm', via: 'connector' }),
                },
                rset,
                rp.name,
                rp.args
              );
              if (!socket.destroyed) socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            };
            // A long wait (wait-for-game-event) must not hold up the lines behind it.
            if (typeof rp.name === 'string' && DETACHED_TOOLS.has(rp.name)) void answer();
            else await answer();

            continue;
          }

          // A player's own Claude (D-136): the dashboard's /mcp/player route sends the verified
          // Foundry user id in `params.userId`; the tool arguments are untrusted and never carry
          // one. Only the player tools run here, all read-only. Not a call_tool route, never
          // listed to Claude, and the stdio wrapper never forwards it.
          if (msg.method === 'player_tool') {
            const startedAt = Date.now();
            const result = await handlePlayerTool(playerTools, msg.params);
            const pp = (msg.params ?? {}) as { tool?: unknown; args?: unknown; userId?: unknown };
            const ptool = typeof pp.tool === 'string' ? pp.tool : 'unknown';
            recordCall(ptool, startedAt, result, {
              who: 'player',
              ...(typeof pp.userId === 'string' ? { userId: pp.userId } : {}),
              via: 'connector',
              ...skillFields(ptool, pp.args),
            });
            socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);

            continue;
          }

          // "Upload my portrait" (player-portrait.ts): the dashboard's player page sends a
          // player's picture for a character they own. Not a tool, never listed to Claude.
          if (msg.method === 'player_portrait') {
            try {
              const result = await handlePlayerPortrait(
                foundryClient,
                guardedWrites,
                msg.params,
                logger
              );
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              const message = e instanceof Error ? e.message : 'The picture was not saved.';
              const error =
                e instanceof PortraitError ? { message, code: 'portrait' } : controlError(e);
              socket.write(`${JSON.stringify({ id: msg.id, error })}\n`);
            }

            continue;
          }

          // Session notes (recap lane, D-087; session-notes/control.ts): the pipeline stages and
          // polls, the dashboard's GM routes list, preview, put and approve. Not a tool, never
          // listed to Claude, and the stdio wrapper never forwards it.
          if (msg.method === 'session_notes') {
            try {
              const result = await handleSessionNotes(sessionNotes, msg.params);
              socket.write(`${JSON.stringify({ id: msg.id, result })}\n`);
            } catch (e: unknown) {
              socket.write(`${JSON.stringify({ id: msg.id, error: controlError(e) })}\n`);
            }

            continue;
          }

          // Unknown method

          socket.write(`${JSON.stringify({ id: msg.id, error: { message: 'Unknown method' } })}\n`);
        } catch (e: unknown) {
          try {
            socket.write(
              `${JSON.stringify({ error: { message: messageOf(e) || 'Bad request' } })}\n`
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
    changeJournalPump?.stop();
    usagePump?.stop();
    mirrorPump?.stop();
    obsidianRender?.stop();
    everyoneNotes?.stop();
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });

  process.on('SIGTERM', () => {
    eventPump?.stop();
    playLogPump?.stop();
    changeJournalPump?.stop();
    usagePump?.stop();
    mirrorPump?.stop();
    obsidianRender?.stop();
    everyoneNotes?.stop();
    foundryClient.disconnect();
    releaseLock();
    process.exit(0);
  });
}

// Check lock BEFORE any async operations
// If another instance is running, wait forever silently (don't exit)
// This prevents Claude Desktop from seeing a "server closed" error
const hasLock = acquireLock(CONTROL_PORT);

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
  } catch (e: unknown) {
    console.error('Failed to start backend:', messageOf(e) || e);

    releaseLock();

    process.exit(1);
  }
})();
