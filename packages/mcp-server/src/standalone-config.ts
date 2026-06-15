/**
 * Standalone-bridge launch configuration — argument parsing and environment
 * wiring for `standalone.ts`.
 *
 * This module is deliberately **pure plumbing**: it has no side effects on import
 * and does NOT import `backend.ts` (which self-starts on import). That separation
 * is what lets it be unit-tested without spinning up a real backend, and lets the
 * entrypoint apply CLI → env BEFORE dynamically importing the backend.
 *
 * See DETACH-PLAN.md Phase 6 (A — decouple the bridge from Claude Desktop).
 */

export interface StandaloneOptions {
  /** Control-channel bind host (→ MCP_CONTROL_HOST). */
  host?: string;
  /** Control-channel bind port (→ MCP_CONTROL_PORT). */
  port?: number;
  /**
   * Serve the control channel only — skip the Foundry connector (WS 31415 /
   * WebRTC 31416) and ComfyUI (→ MCP_FOUNDRY_LINK=off). Used for health checks,
   * tool introspection, and the standalone smoke test on an alternate port.
   */
  controlOnly: boolean;
  /** Print help and exit. */
  help: boolean;
}

export const STANDALONE_HELP = `foundry-mcp-bridge — standalone backend

Runs the MCP control channel + Foundry connector as a long-lived process,
independent of Claude Desktop. The co-GM dashboard connects to its control
channel exactly as it does to the Claude-Desktop-spawned backend.

Usage:
  node dist/standalone.js [options]

Options:
  --host <addr>     Control-channel bind host   (default 127.0.0.1, env MCP_CONTROL_HOST)
  --port <n>        Control-channel bind port    (default 31414,     env MCP_CONTROL_PORT)
  --control-only    Serve the control channel only — do NOT bind the Foundry
                    connector (31415/31416) or start ComfyUI. (env MCP_FOUNDRY_LINK=off)
  -h, --help        Show this help and exit

Notes:
  - Defaults match the frozen loopback contract, so with no flags this is the same
    backend Claude Desktop would spawn — just started by you instead.
  - Do NOT bind the live 31414 from a second process while Claude Desktop's backend
    is running; use --port for an alternate instance.
`;

function parsePort(raw: string): number {
  const n = Number.parseInt(raw, 10);
  if (!Number.isInteger(n) || n < 1 || n > 65535) {
    throw new Error(`Invalid --port "${raw}" (expected an integer 1-65535)`);
  }
  return n;
}

/**
 * Parse argv (the slice after `node script.js`) into StandaloneOptions.
 * Supports `--flag value` and `--flag=value` forms. Throws on malformed input.
 */
export function parseStandaloneArgs(argv: string[]): StandaloneOptions {
  const opts: StandaloneOptions = { controlOnly: false, help: false };

  for (let i = 0; i < argv.length; i++) {
    const arg = argv[i];
    const eq = arg.indexOf('=');
    const key = eq >= 0 ? arg.slice(0, eq) : arg;
    const inlineValue = eq >= 0 ? arg.slice(eq + 1) : undefined;
    const takeValue = (): string => {
      if (inlineValue !== undefined) return inlineValue;
      const next = argv[i + 1];
      if (next === undefined || next.startsWith('--')) {
        throw new Error(`Option ${key} requires a value`);
      }
      i++;
      return next;
    };

    switch (key) {
      case '--host':
        opts.host = takeValue();
        break;
      case '--port':
        opts.port = parsePort(takeValue());
        break;
      case '--control-only':
        opts.controlOnly = true;
        break;
      case '-h':
      case '--help':
        opts.help = true;
        break;
      default:
        throw new Error(`Unknown option: ${arg}`);
    }
  }

  return opts;
}

/**
 * Apply parsed options to `process.env` so the backend (imported afterwards)
 * reads them. Only sets the vars the caller actually provided, so an unset flag
 * falls through to the backend's own defaults / any pre-existing env.
 */
export function applyStandaloneEnv(
  opts: StandaloneOptions,
  env: NodeJS.ProcessEnv = process.env
): void {
  if (opts.host !== undefined) env.MCP_CONTROL_HOST = opts.host;
  if (opts.port !== undefined) env.MCP_CONTROL_PORT = String(opts.port);
  if (opts.controlOnly) env.MCP_FOUNDRY_LINK = 'off';
}

/** Effective control-channel target after env is applied — for banners + readiness ping. */
export function resolveControlTarget(env: NodeJS.ProcessEnv = process.env): {
  host: string;
  port: number;
} {
  return {
    host: env.MCP_CONTROL_HOST || '127.0.0.1',
    port: Number.parseInt(env.MCP_CONTROL_PORT || '31414', 10),
  };
}
