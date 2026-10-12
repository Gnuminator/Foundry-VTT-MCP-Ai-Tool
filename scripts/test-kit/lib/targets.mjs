/**
 * Where the kit may run. The default target is `local`: one of this PC's test servers
 * (scripts/test-env/servers.json), picked with FOUNDRY_TEST_SERVER (A, the default: dashboard
 * 127.0.0.1:3100, Foundry 127.0.0.1:30001; B, where `kit:run` runs: 3101 and 30002). The live
 * bridge ports (31414 to 31416) are refused always, also in fake mode. The world must be one of
 * KIT_WORLDS.
 *
 * The only other target is `pi`, opt-in (`--target pi`), tools-only, in the Pi's throwaway world
 * `strahd-kit`: lib/pi-target.mjs holds its rules and reads its host and ports from a local
 * targets file outside the repo.
 */
import { existsSync, readFileSync } from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { DEFAULT_KIT_WORLD, KIT_WORLDS } from './contract.mjs';
import { EnvError } from './errors.mjs';
import { LOOPBACK_HOSTS, guardUrl } from './guard-url.mjs';
import { resolvePiTarget } from './pi-target.mjs';

export { LOOPBACK_HOSTS, guardUrl };

const here = path.dirname(fileURLToPath(import.meta.url));
const TEST_ENV_DIR = path.resolve(here, '..', '..', 'test-env');

/**
 * The test servers, as scripts/test-env/servers.json names them (the PowerShell scripts read the
 * same file): { A: { Root, HomeRoot, FoundryPort, ControlPort, LinkPort, DashboardPort }, B: ... }.
 * @type {Record<string, {Root: string, HomeRoot: string, FoundryPort: number, ControlPort: number, LinkPort: number, DashboardPort: number}>}
 */
export const TEST_SERVERS = JSON.parse(
  readFileSync(path.join(TEST_ENV_DIR, 'servers.json'), 'utf8')
);

/** Server A's dashboard port and Foundry URL (the everyday test server). */
export const TEST_DASHBOARD_PORT = TEST_SERVERS.A.DashboardPort;
export const TEST_FOUNDRY_URL = `http://127.0.0.1:${TEST_SERVERS.A.FoundryPort}`;

/**
 * The test server the kit talks to: FOUNDRY_TEST_SERVER (A or B, any case), else A.
 * @param {Record<string, string | undefined>} [env]
 */
export function testServerName(env = process.env) {
  const name = String(env.FOUNDRY_TEST_SERVER || 'A')
    .trim()
    .toUpperCase();
  if (!Object.hasOwn(TEST_SERVERS, name)) {
    throw new EnvError(
      `unknown test server "${env.FOUNDRY_TEST_SERVER}" (FOUNDRY_TEST_SERVER; servers.json has ${Object.keys(TEST_SERVERS).join(', ')})`
    );
  }
  return name;
}

/**
 * The ports of one test server.
 * @param {string} [name] default: testServerName(env)
 * @param {Record<string, string | undefined>} [env]
 * @returns {{name: string, foundryPort: number, controlPort: number, linkPort: number, dashboardPort: number}}
 */
export function testServer(name, env = process.env) {
  const n = name ? String(name).toUpperCase() : testServerName(env);
  const s = TEST_SERVERS[n];
  if (!s)
    throw new EnvError(
      `unknown test server "${name}" (servers.json has ${Object.keys(TEST_SERVERS).join(', ')})`
    );
  return {
    name: n,
    foundryPort: s.FoundryPort,
    controlPort: s.ControlPort,
    linkPort: s.LinkPort,
    dashboardPort: s.DashboardPort,
  };
}

/**
 * Resolves a target. `world` defaults to DEFAULT_KIT_WORLD (`strahd-kit` for the pi target) and
 * must be in KIT_WORLDS. The `pi` target is opt-in only and has more guards (see
 * {@link resolvePiTarget}): `notGameNight` is the user's explicit "today is not a game night".
 * @param {{name?: string, fake?: boolean, fakeBase?: string, world?: string | null, notGameNight?: boolean, env?: Record<string, string | undefined>}} [opts]
 * @returns {{name: string, dashboard: string, foundry: string, world: string, server?: string, host?: string, dashboardTokenFile?: string, kitGmPasswordFile?: string, kitGmUser?: string}}
 */
export function resolveTarget({
  name = 'local',
  fake = false,
  fakeBase,
  world,
  notGameNight = false,
  env = process.env,
} = {}) {
  if (name === 'pi') {
    return resolvePiTarget({ world: world ?? undefined, fake, notGameNight, env });
  }
  if (world === undefined || world === null) world = DEFAULT_KIT_WORLD;
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
  if (name !== 'local') {
    throw new EnvError(`unknown target "${name}" (only "local" and "pi" exist)`);
  }
  const server = testServer(undefined, env);
  const dashboard = guardUrl(env.COGM_BASE || `http://127.0.0.1:${server.dashboardPort}`, {
    label: 'COGM_BASE',
    port: server.dashboardPort,
  });
  return {
    name: 'local',
    server: server.name,
    dashboard,
    foundry: `http://127.0.0.1:${server.foundryPort}`,
    world,
  };
}

/** The kit's own folder: manifests, reports, licensed scenarios. Shared by the test servers. */
export function kitHome(env = process.env) {
  return env.TEST_KIT_HOME || 'C:\\FoundryTest\\test-kit';
}

/**
 * Where the kit manifests of a server's kit worlds live: `<kit home>/worlds` for server A,
 * `<kit home>/worlds-<name>` for the others (each server has its own copy of the worlds).
 * @param {Record<string, string | undefined>} [env]
 */
export function kitWorldsDir(env = process.env) {
  const name = testServerName(env);
  return path.join(kitHome(env), name === 'A' ? 'worlds' : `worlds-${name}`);
}

/**
 * The test Foundry's data folder: `<Root>\data`. Root comes from scripts/test-env/local.json for
 * server A and local.<name>.json for the others (key Root only; the file also holds an admin
 * password, so nothing else is read or kept), else from servers.json.
 * @param {string} [repoRoot]
 * @param {Record<string, string | undefined>} [env]
 */
export function foundryDataDir(repoRoot = path.resolve(here, '..', '..', '..'), env = process.env) {
  const name = testServerName(env);
  let root = TEST_SERVERS[name].Root;
  const local = name === 'A' ? 'local.json' : `local.${name}.json`;
  const file = path.join(repoRoot, 'scripts', 'test-env', local);
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
