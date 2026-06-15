import express, { type Request, type Response } from 'express';
import { config, type Tone } from './config.js';
import { Logger } from './logger.js';
import { McpControlClient, ToolError, TimeoutError } from './feed/mcp-control-client.js';
import { PollingGameFeed } from './feed/polling-feed.js';
import type {
  BridgeStatus,
  CombatState,
  GameFeedHandlers,
  SessionEvent,
  WorldInfo,
} from './feed/types.js';
import { GameState } from './state.js';
import { CoGm } from './ai/anthropic-co-gm.js';
import { CommentaryEngine } from './ai/commentary.js';
import { ErrorCommentaryEngine } from './ai/error-commentary.js';
import { buildAskUserMessage } from './ai/prompt.js';
import { SseHub, type SseRedactor } from './sse.js';
import { resolveRole, isGm } from './auth.js';
import {
  redactCombatForPlayer,
  redactEventsForPlayer,
  redactStatusForPlayer,
  redactWorldForPlayer,
} from './redact.js';

/**
 * Co-GM dashboard server. Pulls the live game feed off the MCP control channel,
 * keeps a bounded view of state, streams AI commentary, and serves the browser
 * dashboard plus its SSE stream. Read-only against the game except for the one
 * explicit "post to chat" endpoint.
 */

const logger = new Logger(config.logLevel, 'cogm');

// --- Mutable runtime settings (controlled from the dashboard) ----------------
interface RuntimeSettings {
  paused: boolean;
  tone: Tone;
  model: string;
  commentOnErrors: boolean;
  /** Master switch for the write surface (GM Actions). Off by default for safety. */
  gmActionsEnabled: boolean;
}
const settings: RuntimeSettings = {
  paused: false,
  tone: config.defaultTone,
  model: config.anthropicModel,
  commentOnErrors: config.commentOnErrors,
  gmActionsEnabled: false,
};

// --- Core singletons ---------------------------------------------------------
const state = new GameState(config.maxEvents, config.maxErrors);
const coGm = new CoGm(config.anthropicApiKey, logger);
const sse = new SseHub(logger);
const client = new McpControlClient({
  host: config.mcpHost,
  port: config.mcpPort,
  logger,
  requestTimeoutMs: config.controlRequestTimeoutMs,
  connectTimeoutMs: config.controlConnectTimeoutMs,
  heartbeatIntervalMs: config.controlHeartbeatIntervalMs,
  stalenessThresholdMs: config.controlStalenessThresholdMs,
});

const commentary = new CommentaryEngine({
  coGm,
  state,
  logger,
  // AI commentary is GM-facing — never streamed to a player.
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
  // Diagnostics commentary is GM-facing — never streamed to a player.
  broadcast: (type: string, payload: unknown): void => sse.broadcast(type, payload, gmOnly),
  settings: {
    getModel: (): string => settings.model,
    isEnabled: (): boolean => settings.commentOnErrors,
  },
  minIntervalMs: config.errorCommentMinIntervalMs,
  debounceMs: config.commentDebounceMs,
  maxTokens: config.errorCommentMaxTokens,
});

// --- Live status / world -----------------------------------------------------
let currentStatus: BridgeStatus = {
  controlChannel: 'disconnected',
  foundry: 'unknown',
  lastError: null,
  lastPollAt: null,
};
let world: WorldInfo | null = null;
let firstCombatSeen = false;
let lastCombatJson = '';
let worldRefreshInflight = false;
let worldRetryTimer: NodeJS.Timeout | null = null;
let shuttingDown = false;

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
  };
}

function broadcastSettings(): void {
  // Settings are the GM control-panel state — never sent to a player stream.
  sse.broadcast('settings', settingsPayload(), gmOnly);
}

// --- Player/GM split: server-side redactors (Phase 6) ------------------------
// Each broadcast carries a redactor so a player's SSE stream is filtered HERE,
// not in the browser. `gmOnly` payloads are skipped entirely for players; the
// dual ones return a redacted shape (see redact.ts).
const gmOnly: SseRedactor = (payload, role) => (role === 'gm' ? payload : undefined);

const statusRedactor: SseRedactor = (payload, role) =>
  role === 'gm' ? payload : redactStatusForPlayer(payload as BridgeStatus);

const worldRedactor: SseRedactor = (payload, role) =>
  role === 'gm' ? payload : redactWorldForPlayer(payload as WorldInfo | null);

const combatRedactor: SseRedactor = (payload, role) => {
  if (role === 'gm') return payload;
  const { combat } = payload as { combat: CombatState | null };
  return { combat: redactCombatForPlayer(combat, config.playerView) };
};

const eventsRedactor: SseRedactor = (payload, role) => {
  if (role === 'gm') return payload;
  const { events, initial } = payload as { events: SessionEvent[]; initial?: boolean };
  return { events: redactEventsForPlayer(events), initial };
};

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

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

function readStr(value: unknown, fallback: string): string {
  return typeof value === 'string' ? value : fallback;
}

// --- GM Actions: tool proxy --------------------------------------------------
// The dashboard can invoke ANY bridge tool, but game-changing (write) tools are
// gated behind the master GM-Actions switch + an explicit confirm, and a small
// set of destructive tools needs a second confirm. Reads are always free.
const DESTRUCTIVE_TOOLS = new Set<string>([
  'delete-tokens',
  'delete-map-note',
  'delete-measured-template',
  'remove-actor-ownership',
  'clear-module-errors',
  'clear-stale-conditions',
]);
// Tools that read state but don't match the get-/list-/search-/measure- prefixes.
const READ_TOOLS_EXTRA = new Set<string>(['check-map-status', 'suggest-balanced-encounter']);

type ToolKind = 'read' | 'write' | 'destructive';

function classifyTool(name: string): ToolKind {
  if (DESTRUCTIVE_TOOLS.has(name)) return 'destructive';
  if (/^(get|list|search|measure)-/.test(name) || READ_TOOLS_EXTRA.has(name)) return 'read';
  return 'write';
}

interface ToolInfo {
  name: string;
  description: string;
  inputSchema: unknown;
  mutates: ToolKind;
}

let toolCatalog: ToolInfo[] | null = null;
let toolCatalogAt = 0;
const TOOL_CATALOG_TTL_MS = 60_000;

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
    title: readStr(r.title, 'Unknown world'),
    systemId: readStr(system.id, 'unknown'),
    systemVersion: readStr(system.version, ''),
    foundryVersion: readStr(foundry.version, ''),
    gmNames,
  };
}

async function refreshWorld(attempt = 0): Promise<void> {
  // Collapse concurrent triggers (transition + immediate poll) into one call.
  if (worldRefreshInflight) return;
  worldRefreshInflight = true;
  try {
    const raw = await client.callTool('get-world-info');
    world = mapWorld(raw);
    coGm.setWorld(world);
    sse.broadcast('world', world, worldRedactor);
    logger.info('World info loaded', { title: world.title, system: world.systemId });
  } catch (error) {
    logger.debug('world-info fetch failed', {
      error: error instanceof Error ? error.message : String(error),
    });
    // Bounded backoff retry while still reachable — NOT a per-poll storm.
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

// --- Feed handlers -----------------------------------------------------------
const handlers: GameFeedHandlers = {
  onStatus(status) {
    // World info only exists once Foundry is reachable. The control channel can
    // be up while Foundry connects later (or reconnects without dropping the
    // channel), so fetch world details on the transition INTO reachable. (A
    // failed fetch retries on its own bounded backoff inside refreshWorld — we
    // must NOT re-trigger per poll, which would storm the contended backend.)
    const wasReachable = currentStatus.foundry === 'reachable';
    const becameReachable = status.foundry === 'reachable' && !wasReachable;
    currentStatus = status;
    sse.broadcast('status', status, statusRedactor);
    if (becameReachable) {
      void refreshWorld();
    } else if (status.foundry !== 'reachable' && world !== null) {
      // Foundry dropped — invalidate stale world so the UI and the Co-GM whisper
      // path (which targets world.gmNames) never act on a world that may be gone.
      world = null;
      coGm.setWorld(null);
      sse.broadcast('world', null, worldRedactor);
    }
  },
  onEvents(events, meta) {
    const added = state.addEvents(events);
    if (added.length === 0) return;
    sse.broadcast('events', { events: added, initial: meta.initial }, eventsRedactor);
    if (!meta.initial) commentary.notifyEvents(added);
  },
  onErrors(errors, meta) {
    const added = state.addErrors(errors);
    if (added.length === 0) return;
    // Module diagnostics are GM-only.
    sse.broadcast('errors', { errors: added, initial: meta.initial }, gmOnly);
    if (!meta.initial) errorCommentary.notifyErrors(added);
  },
  onCombat(combat: CombatState | null) {
    const prevSignature = state.combatSignature();
    state.setCombat(combat);

    const json = JSON.stringify(combat);
    if (json !== lastCombatJson) {
      lastCombatJson = json;
      sse.broadcast('combat', { combat }, combatRedactor);
    }

    const signature = state.combatSignature();
    if (firstCombatSeen && signature !== null && signature !== prevSignature) {
      commentary.notifyCombatChange();
    }
    firstCombatSeen = true;
  },
};

const feed = new PollingGameFeed(client, handlers, {
  pollIntervalMs: config.pollIntervalMs,
  combatPollIntervalMs: config.combatPollIntervalMs,
  errorPollIntervalMs: config.errorPollIntervalMs,
  logger,
  backfillLimit: 25,
});

// --- HTTP / SSE --------------------------------------------------------------
const app = express();
app.use(express.json({ limit: '256kb' }));
app.use(express.static(config.publicDir));

// Clean URL for the read-only player view (the static file is also at /player.html).
app.get('/player', (_req: Request, res: Response) => {
  res.sendFile('player.html', { root: config.publicDir });
});

app.get('/api/health', (_req: Request, res: Response) => {
  res.json({
    ok: true,
    controlChannel: currentStatus.controlChannel,
    aiEnabled: coGm.enabled,
    splitEnabled: config.auth.splitEnabled,
  });
});

app.get('/api/state', (req: Request, res: Response) => {
  const role = resolveRole(req, config.auth);
  if (!role) {
    res.status(401).json({ error: 'Unauthorized' });
    return;
  }
  if (role === 'player') {
    res.json({
      role,
      status: redactStatusForPlayer(currentStatus),
      combat: redactCombatForPlayer(state.combat, config.playerView),
      events: redactEventsForPlayer(state.recentEvents),
      world: redactWorldForPlayer(world),
    });
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
  sse.add(res, role);
  const player = role === 'player';
  // Push the current snapshot immediately, redacted server-side for players.
  sse.send(res, 'role', { role });
  sse.send(res, 'status', player ? redactStatusForPlayer(currentStatus) : currentStatus);
  if (world) sse.send(res, 'world', player ? redactWorldForPlayer(world) : world);
  if (!player) sse.send(res, 'settings', settingsPayload()); // GM-only control state
  const combat = player ? redactCombatForPlayer(state.combat, config.playerView) : state.combat;
  if (combat) sse.send(res, 'combat', { combat });
  sse.send(res, 'events', {
    events: player ? redactEventsForPlayer(state.recentEvents) : state.recentEvents,
    initial: true,
  });
  if (!player) sse.send(res, 'errors', { errors: state.recentErrors, initial: true }); // GM-only
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
  // Commentary is GM-only — players never receive comment.* frames.
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

app.post('/api/control', requireGm, (req: Request, res: Response) => {
  const body = asRecord(req.body);
  const action = readStr(body.action, '');
  const value = body.value;

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
  const text = readStr(asRecord(req.body).text, '').trim();
  if (!text) {
    res.status(400).json({ error: 'A non-empty "text" is required.' });
    return;
  }

  const message = `🧠 Co-GM: ${text}`;
  const gmNames = world?.gmNames ?? [];
  const args: Record<string, unknown> =
    gmNames.length > 0
      ? { message, messageType: 'whisper', whisperTargets: gmNames }
      : { message, messageType: 'ooc' };

  void client
    .callTool('send-chat-message', args)
    .then(() => res.json({ ok: true, whisperedTo: gmNames }))
    .catch((error: unknown) => {
      res.status(502).json({
        error: error instanceof Error ? error.message : 'Failed to post to Foundry chat.',
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
  const args = asRecord(body.args);
  const mutates = classifyTool(name);

  if (mutates !== 'read') {
    if (!settings.gmActionsEnabled) {
      res.status(403).json({
        code: 'gm-actions-disabled',
        error: 'GM Actions are off. Turn on the GM Actions switch to run game-changing tools.',
      });
      return;
    }
    if (body.confirm !== true) {
      res.status(412).json({ code: 'confirm-required', mutates, error: 'Confirmation required.' });
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
    .callTool(name, args)
    .then(result => res.json({ ok: true, name, mutates, result }))
    .catch((error: unknown) => {
      const kind =
        error instanceof ToolError ? 'tool' : error instanceof TimeoutError ? 'timeout' : 'channel';
      res.status(kind === 'tool' ? 422 : 502).json({
        ok: false,
        name,
        kind,
        error: error instanceof Error ? error.message : 'Tool call failed.',
      });
    });
});

// --- Startup / shutdown ------------------------------------------------------
feed.start();

const server = app.listen(config.port, () => {
  logger.info(`Co-GM dashboard listening on http://localhost:${config.port}`, {
    mcp: `${config.mcpHost}:${config.mcpPort}`,
    model: config.anthropicModel,
    aiEnabled: coGm.enabled,
    playerGmSplit: config.auth.splitEnabled
      ? 'enabled (GM auth required; /player is read-only)'
      : 'disabled (single-user GM)',
  });
});

function shutdown(signal: string): void {
  if (shuttingDown) return; // idempotent — a second Ctrl-C is a no-op
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);
  coGm.abortActive();
  // End the long-lived SSE responses and stop their heartbeat first, otherwise
  // server.close() waits on them and never fires its callback.
  sse.close();
  feed.stop();
  server.close(() => process.exit(0));
  // Hard stop if connections linger.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
