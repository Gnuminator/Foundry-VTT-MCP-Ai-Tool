import { config } from './config.js';
import { Logger } from './logger.js';
import { McpControlClient } from './feed/mcp-control-client.js';
import { PollingGameFeed } from './feed/polling-feed.js';
import { CoGm } from './ai/anthropic-co-gm.js';
import { bindRefusal } from './bind-policy.js';
import { createDashboard } from './app.js';

/**
 * Co-GM dashboard server. Pulls the live game feed off the MCP control channel,
 * keeps a bounded view of state, streams AI commentary, and serves the browser
 * dashboard plus its SSE streams. Read-only against the game except for the
 * explicit "post to chat" endpoint and the confirmed GM Actions. The app itself
 * (routes, state, player projection) lives in `app.ts`; this file wires the
 * real control client, feed and listener.
 */

const logger = new Logger(config.logLevel, 'cogm');
const coGm = new CoGm(config.anthropicApiKey, logger);
const client = new McpControlClient({
  host: config.mcpHost,
  port: config.mcpPort,
  logger,
  requestTimeoutMs: config.controlRequestTimeoutMs,
  connectTimeoutMs: config.controlConnectTimeoutMs,
  heartbeatIntervalMs: config.controlHeartbeatIntervalMs,
  stalenessThresholdMs: config.controlStalenessThresholdMs,
});

const dashboard = createDashboard({ config, logger, client, coGm });

const feed = new PollingGameFeed(client, dashboard.handlers, {
  pollIntervalMs: config.pollIntervalMs,
  combatPollIntervalMs: config.combatPollIntervalMs,
  errorPollIntervalMs: config.errorPollIntervalMs,
  logger,
  backfillLimit: 25,
});

// --- Startup / shutdown ------------------------------------------------------
const refusal = bindRefusal(config.host, config.auth.gmToken);
if (refusal) {
  logger.error(refusal);
  process.exit(1);
}

feed.start();
dashboard.start();

const server = dashboard.app.listen(config.port, config.host, () => {
  logger.info(`Dashboard listening on http://${config.host}:${config.port}`, {
    mcp: `${config.mcpHost}:${config.mcpPort}`,
    model: config.anthropicModel,
    aiEnabled: coGm.enabled,
    playerGmSplit: config.auth.splitEnabled
      ? 'enabled (GM auth required; /player is read-only)'
      : 'disabled (single-user GM)',
  });
});

let shuttingDown = false;
function shutdown(signal: string): void {
  if (shuttingDown) return; // idempotent: a second Ctrl-C is a no-op
  shuttingDown = true;
  logger.info(`Received ${signal}, shutting down`);
  // End the long-lived SSE responses and stop background work first, otherwise
  // server.close() waits on them and never fires its callback.
  dashboard.close();
  feed.stop();
  server.close(() => process.exit(0));
  // Hard stop if connections linger.
  setTimeout(() => process.exit(0), 2000).unref();
}

process.on('SIGINT', () => shutdown('SIGINT'));
process.on('SIGTERM', () => shutdown('SIGTERM'));
