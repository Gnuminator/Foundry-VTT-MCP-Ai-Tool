/**
 * Restarts the TEST dashboard (slice 4, the login split pass). The split is read from the environment
 * when the dashboard starts (GM_DASHBOARD_TOKEN, PLAYER_DASHBOARD_TOKEN), so checking the login needs
 * a restart: `stop.ps1 -Only dashboard`, then `start.ps1 -Only dashboard` with the tokens in the child's
 * environment (start.ps1's service inherits the calling process's environment). With `null` the tokens
 * are taken out of the child's environment, so the dashboard comes back in the normal single user mode.
 *
 * Only the test dashboard port is allowed (3100); the live bridge ports are refused. The tokens are
 * only ever put in the child's environment of start.ps1 (stop.ps1 gets none): never in an argument, a
 * log line or an error message. Nothing is stopped unless this checkout has a built dashboard to start
 * again, and stop.ps1 itself kills the recorded pid only when it owns the dashboard port.
 */
import { execFile } from 'node:child_process';
import { existsSync } from 'node:fs';
import path from 'node:path';
import { LIVE_BRIDGE_PORTS } from './contract.mjs';
import { EnvError } from './errors.mjs';
import { TEST_DASHBOARD_PORT } from './targets.mjs';

/** The environment variables that turn the player/GM split on. */
export const SPLIT_ENV_KEYS = ['GM_DASHBOARD_TOKEN', 'PLAYER_DASHBOARD_TOKEN'];

/** The built dashboard server start.ps1 runs, relative to the repo root. */
export const DASHBOARD_SERVER = ['packages', 'cogm-dashboard', 'dist', 'server.js'];

/**
 * Refuses every port but the test dashboard's (and always the live bridge ports).
 * @param {number} port
 */
export function assertTestDashboardPort(port) {
  if (LIVE_BRIDGE_PORTS.includes(port)) {
    throw new EnvError(`REFUSED: port ${port} is the live bridge. The test kit never restarts it.`);
  }
  if (port !== TEST_DASHBOARD_PORT) {
    throw new EnvError(
      `REFUSED: port ${port} is not the test dashboard. Only port ${TEST_DASHBOARD_PORT} may be restarted.`
    );
  }
}

/**
 * The port of a dashboard URL such as http://127.0.0.1:3100.
 * @param {string} url
 */
export function portOfUrl(url) {
  let parsed;
  try {
    parsed = new URL(url);
  } catch {
    throw new EnvError(`REFUSED: "${url}" is not a dashboard URL.`);
  }
  return Number(parsed.port || (parsed.protocol === 'https:' ? 443 : 80));
}

/**
 * The environment for the restarted dashboard: the caller's own, with the two split variables set to
 * the given tokens, or removed when `tokens` is null.
 * @param {Record<string, string | undefined>} base
 * @param {{gmToken: string, playerToken: string} | null | undefined} tokens
 * @returns {Record<string, string | undefined>}
 */
export function dashboardEnv(base, tokens) {
  const env = { ...base };
  for (const key of SPLIT_ENV_KEYS) delete env[key];
  if (tokens) {
    const { gmToken, playerToken } = tokens;
    if (typeof gmToken !== 'string' || !gmToken || typeof playerToken !== 'string' || !playerToken) {
      throw new EnvError('the split needs a GM token and a player token (both non-empty text)');
    }
    if (gmToken === playerToken) {
      throw new EnvError('the GM token and the player token must differ');
    }
    env.GM_DASHBOARD_TOKEN = gmToken;
    env.PLAYER_DASHBOARD_TOKEN = playerToken;
  }
  return env;
}

/**
 * The PowerShell arguments that run one test-env script for the dashboard only.
 * @param {string} repoRoot
 * @param {'stop' | 'start'} which
 * @returns {string[]}
 */
export function scriptArgs(repoRoot, which) {
  const script = path.join(repoRoot, 'scripts', 'test-env', `${which}.ps1`);
  return ['-NoProfile', '-NonInteractive', '-File', script, '-Only', 'dashboard'];
}

/**
 * Runs pwsh with the given arguments and environment.
 * @param {string[]} args
 * @param {Record<string, string | undefined>} env
 * @param {string} cwd
 * @returns {Promise<{code: number, stdout: string, stderr: string}>}
 */
export function runPwsh(args, env, cwd) {
  return new Promise(resolve => {
    execFile(
      'pwsh',
      args,
      { env: /** @type {NodeJS.ProcessEnv} */ (env), cwd, timeout: 120000, windowsHide: true },
      (error, stdout, stderr) => {
        const code = error ? (typeof error.code === 'number' ? error.code : 1) : 0;
        resolve({
          code,
          stdout: String(stdout),
          stderr: String(stderr || (error ? error.message : '')),
        });
      }
    );
  });
}

/**
 * Whether the dashboard on that port answers /api/health (which needs no login, also in the split).
 * @param {number} port
 */
export async function probeDashboard(port) {
  try {
    const res = await fetch(`http://127.0.0.1:${port}/api/health`, {
      signal: AbortSignal.timeout(2000),
    });
    return res.status === 200;
  } catch {
    return false;
  }
}

/**
 * @param {() => Promise<boolean>} fn
 * @param {number} timeoutMs
 * @param {number} pollMs
 */
async function until(fn, timeoutMs, pollMs) {
  const deadline = Date.now() + timeoutMs;
  for (;;) {
    if (await fn()) return true;
    if (Date.now() >= deadline) return false;
    await new Promise(resolve => setTimeout(resolve, pollMs));
  }
}

/**
 * Restarts the test dashboard in the split mode (both tokens) or the normal mode (null).
 * @param {{gmToken: string, playerToken: string} | null} tokens
 * @param {{
 *   repoRoot: string,
 *   port?: number,
 *   env?: Record<string, string | undefined>,
 *   run?: typeof runPwsh,
 *   probe?: typeof probeDashboard,
 *   timeoutMs?: number,
 *   downTimeoutMs?: number,
 *   pollMs?: number,
 *   exists?: (file: string) => boolean
 * }} opts
 * @returns {Promise<void>}
 */
export async function restartDashboard(tokens, opts) {
  const {
    repoRoot,
    port = TEST_DASHBOARD_PORT,
    env = process.env,
    run = runPwsh,
    probe = probeDashboard,
    timeoutMs = 60000,
    downTimeoutMs = 15000,
    pollMs = 500,
    exists = existsSync,
  } = opts;
  assertTestDashboardPort(port);
  const childEnv = dashboardEnv(env, tokens);
  const mode = tokens ? 'split' : 'normal';

  // start.ps1 serves the dashboard from this checkout: without a build here it would throw after the
  // stop and leave the dashboard down. Say so before anything is stopped.
  const server = path.join(repoRoot, ...DASHBOARD_SERVER);
  if (!exists(server)) {
    throw new EnvError(
      `REFUSED: the dashboard is not built in ${repoRoot} (${DASHBOARD_SERVER.join('/')} is missing), so start.ps1 could not bring it back. Run "npm run build" there first; the running dashboard was left alone.`
    );
  }

  // stop.ps1 needs no token; it kills the recorded pid only when that pid owns the dashboard port,
  // and refuses (exit 1, "REFUSED: ..." on stderr) when another process has the port or the pid.
  const stopped = await run(scriptArgs(repoRoot, 'stop'), dashboardEnv(env, null), repoRoot);
  if (stopped.code !== 0) {
    throw new EnvError(
      `could not stop the test dashboard (stop.ps1 exited ${stopped.code}): ${stopped.stderr.trim().slice(0, 400)}`
    );
  }
  const down = await until(async () => !(await probe(port)), downTimeoutMs, pollMs);
  if (!down) {
    throw new EnvError(
      `the dashboard on port ${port} is still answering after stop.ps1: it was not started by scripts/test-env/start.ps1, so the kit cannot restart it (start it that way and run again)`
    );
  }

  const started = await run(scriptArgs(repoRoot, 'start'), childEnv, repoRoot);
  if (started.code !== 0) {
    throw new EnvError(
      `could not start the test dashboard in ${mode} mode (start.ps1 exited ${started.code}): ${started.stderr.trim().slice(0, 300)}`
    );
  }
  const up = await until(() => probe(port), timeoutMs, pollMs);
  if (!up) {
    throw new EnvError(
      `the test dashboard did not answer on port ${port} within ${Math.round(timeoutMs / 1000)} s after the restart in ${mode} mode (see the dashboard log in the test environment's logs folder)`
    );
  }
}
