/**
 * Standalone bridge entrypoint.
 *
 * Runs the MCP backend as a long-lived, self-supervised process that does NOT
 * depend on Claude Desktop spawning it. The co-GM dashboard connects to its
 * control channel identically to the Claude-Desktop-spawned backend — this just
 * removes the hard dependency so the dashboard works with Claude Desktop closed.
 * (See DETACH-PLAN.md Phase 6 — A.)
 *
 * Design note: the backend (`backend.ts`) self-starts on import and reads its
 * bind config from env at module-load. So this entrypoint must (1) parse CLI
 * into env via the side-effect-free `standalone-config` module, THEN (2) dynamically
 * import the backend. The static imports here are intentionally limited to the
 * pure config/ping helpers so nothing starts before the env is wired.
 */
import {
  parseStandaloneArgs,
  applyStandaloneEnv,
  resolveControlTarget,
  STANDALONE_HELP,
} from './standalone-config.js';
import { waitForControlChannel } from './control-ping.js';

async function main(): Promise<void> {
  let opts;
  try {
    opts = parseStandaloneArgs(process.argv.slice(2));
  } catch (err) {
    console.error(`✗ ${err instanceof Error ? err.message : String(err)}\n`);
    console.error(STANDALONE_HELP);
    process.exit(2);
    return;
  }

  if (opts.help) {
    console.error(STANDALONE_HELP);
    process.exit(0);
    return;
  }

  applyStandaloneEnv(opts);
  const { host, port } = resolveControlTarget();
  const mode = opts.controlOnly
    ? 'control-only (no Foundry link)'
    : 'full (control + Foundry link)';

  console.error('─'.repeat(64));
  console.error(' foundry-mcp-bridge — standalone backend');
  console.error(`   control channel : ${host}:${port}`);
  console.error(`   mode            : ${mode}`);
  console.error('─'.repeat(64));

  // A light shutdown banner; backend.ts owns the actual lock release + exit.
  const onSignal = (sig: string): void => console.error(`\n${sig} received — shutting down…`);
  process.on('SIGINT', () => onSignal('SIGINT'));
  process.on('SIGTERM', () => onSignal('SIGTERM'));

  // Start the backend (self-starts on import now that env is wired).
  await import('./backend.js');

  // Report honest readiness by pinging the control channel.
  const ready = await waitForControlChannel(host, port, 15_000);
  if (ready) {
    console.error(`✓ control channel ready on ${host}:${port}`);
    if (!opts.controlOnly) {
      console.error('  waiting for the Foundry module to connect (ws 31415 / webrtc 31416)…');
    }
  } else {
    console.error(
      `✗ control channel did not come up on ${host}:${port} within 15s ` +
        `(another backend may already hold this port, or startup failed — check the backend log)`
    );
  }
}

void main();
