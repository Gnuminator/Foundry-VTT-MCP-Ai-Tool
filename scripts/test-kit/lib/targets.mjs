/**
 * Where the kit may run. The only real target is `local`: the test dashboard on 127.0.0.1:3100
 * and the test Foundry on 127.0.0.1:30001. The live bridge ports (31414 to 31416) are refused
 * always, also in fake mode. The world must be one of KIT_WORLDS.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_KIT_WORLD, KIT_WORLDS, LIVE_BRIDGE_PORTS } from './contract.mjs';
import { EnvError } from './errors.mjs';

export const TEST_DASHBOARD_PORT = 3100;
export const TEST_FOUNDRY_URL = 'http://127.0.0.1:30001';
export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

const here = path.dirname(fileURLToPath(import.meta.url));

/**
 * Parses a URL, refuses the live bridge ports, and (optionally) anything but loopback.
 * @param {string} raw
 * @param {{label: string, loopbackOnly?: boolean, port?: number}} opts
 * @returns {string} normalised `http://host:port` (localhost becomes 127.0.0.1)
 */
function guardUrl(raw, { label, loopbackOnly = true, port: onlyPort }) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvError(`REFUSED: ${label} "${raw}" is not a URL.`);
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (LIVE_BRIDGE_PORTS.includes(port)) {
    throw new EnvError(
      `REFUSED: port ${port} is the live bridge. The test kit never uses it (${label}).`
    );
  }
  if (loopbackOnly && !LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new EnvError(`REFUSED: ${label} ${url.host} is not on this machine (loopback only).`);
  }
  if (onlyPort !== undefined && port !== onlyPort) {
    throw new EnvError(
      `REFUSED: ${label} ${url.host} is not the test dashboard. Only port ${onlyPort} is allowed.`
    );
  }
  // 127.0.0.1 rather than localhost: localhost tries IPv6 first and is slow on Windows.
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  return `${url.protocol}//${host}:${port}`;
}

/**
 * Resolves a target. `world` defaults to DEFAULT_KIT_WORLD and must be in KIT_WORLDS.
 * @param {{name?: string, fake?: boolean, fakeBase?: string, world?: string, env?: Record<string, string | undefined>}} [opts]
 * @returns {{name: string, dashboard: string, foundry: string, world: string}}
 */
export function resolveTarget({
  name = 'local',
  fake = false,
  fakeBase,
  world = DEFAULT_KIT_WORLD,
  env = process.env,
} = {}) {
  if (!KIT_WORLDS.includes(world)) {
    throw new EnvError(
      `REFUSED: world "${world}" is not a kit world. The kit only builds in: ${KIT_WORLDS.join(', ')}.`
    );
  }
  if (fake) {
    if (!fakeBase) throw new EnvError('fake mode needs the fake dashboard base URL');
    const base = guardUrl(fakeBase, { label: 'fake dashboard' });
    return { name: 'fake', dashboard: base, foundry: base, world };
  }
  // A future `pi` target goes here: read host and port from a local targets file (never the
  // repo), run the same guardUrl checks (live bridge ports refused), and require an explicit
  // opt-in flag. Not implemented on purpose: the kit runs on this PC only for now.
  if (name !== 'local') {
    throw new EnvError(`unknown target "${name}" (only "local" exists)`);
  }
  const dashboard = guardUrl(env.COGM_BASE || `http://127.0.0.1:${TEST_DASHBOARD_PORT}`, {
    label: 'COGM_BASE',
    port: TEST_DASHBOARD_PORT,
  });
  return { name: 'local', dashboard, foundry: TEST_FOUNDRY_URL, world };
}

/** The kit's own folder: manifests, reports, licensed scenarios. */
export function kitHome(env = process.env) {
  return env.TEST_KIT_HOME || 'C:\\FoundryTest\\test-kit';
}

/**
 * The test Foundry's data folder: `<Root>\data`. Root comes from scripts/test-env/local.json
 * (key Root only; the file also holds an admin password, so nothing else is read or kept).
 * @param {string} [repoRoot]
 */
export function foundryDataDir(repoRoot = path.resolve(here, '..', '..', '..')) {
  let root = 'C:\\FoundryTest';
  const file = path.join(repoRoot, 'scripts', 'test-env', 'local.json');
  try {
    if (existsSync(file)) {
      const parsed = JSON.parse(readFileSync(file, 'utf8'));
      if (parsed && typeof parsed.Root === 'string' && parsed.Root.trim()) root = parsed.Root;
    }
  } catch {
    /* unreadable or not JSON: use the default */
  }
  return path.join(root, 'data');
}
