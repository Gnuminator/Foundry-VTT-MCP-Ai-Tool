/**
 * Where the Claude Desktop wrapper (`index.ts`) looks for the bridge backend,
 * and whether it may start one itself (PB-01).
 *
 * Pure functions, so the decision is testable without spawning anything.
 */

export interface ControlTarget {
  host: string;
  port: number;
  /** True only for a loopback host and no `MCP_NO_SPAWN`. */
  spawnAllowed: boolean;
}

const LOOPBACK_HOSTS = new Set(['127.0.0.1', '::1', '[::1]', 'localhost']);
const DEFAULT_HOST = '127.0.0.1';
const DEFAULT_PORT = 31414;

export function isLoopbackHost(host: string): boolean {
  return LOOPBACK_HOSTS.has(host.trim().toLowerCase());
}

export function isTruthyFlag(value: string | undefined): boolean {
  const v = value?.trim().toLowerCase();
  return v === '1' || v === 'true';
}

/**
 * Read `MCP_CONTROL_HOST` (default 127.0.0.1), `MCP_CONTROL_PORT` (default
 * 31414) and `MCP_NO_SPAWN`. A backend is never spawned when `MCP_NO_SPAWN` is
 * `1`/`true` or the host is not a loopback address (a backend started here
 * would not be the one at that address).
 */
export function resolveControlTarget(env: NodeJS.ProcessEnv = process.env): ControlTarget {
  const rawHost = env.MCP_CONTROL_HOST?.trim();
  const host = rawHost ? rawHost : DEFAULT_HOST;
  const parsed = Number.parseInt(env.MCP_CONTROL_PORT ?? '', 10);
  const port = Number.isInteger(parsed) && parsed >= 1 && parsed <= 65535 ? parsed : DEFAULT_PORT;
  return {
    host,
    port,
    spawnAllowed: !isTruthyFlag(env.MCP_NO_SPAWN) && isLoopbackHost(host),
  };
}

/**
 * Set on a backend the wrapper spawns. Such a backend exits with
 * `BACKEND_LOCK_HELD_EXIT_CODE` when another backend already holds the lock
 * (the wrapper then connects to that one); a backend started any other way
 * keeps its old behaviour and idles.
 */
export const WRAPPER_SPAWNED_ENV = 'FOUNDRY_AI_WRAPPER_SPAWNED';

export const BACKEND_LOCK_HELD_EXIT_CODE = 3;

/** The error every tool call gets when the bridge is missing and may not be spawned. */
export function bridgeUnreachableMessage(host: string, port: number): string {
  return `The Foundry AI Tool bridge is not reachable at ${host}:${port}. Start it (or check the address) and try again.`;
}
