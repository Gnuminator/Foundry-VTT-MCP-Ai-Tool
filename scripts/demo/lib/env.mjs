// Paths, ports and local settings for demo takes. Mirrors scripts/test-env/config.ps1:
// the same defaults, overridable in scripts/test-env/local.json (Root and the ports).
// Demo-only settings (the OBS WebSocket password) live in scripts/demo/local.json,
// which is gitignored. Neither file's secrets are ever printed.

import { randomBytes } from 'node:crypto';
import { existsSync, readFileSync, writeFileSync } from 'node:fs';
import { dirname, join, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
export const DEMO_DIR = resolve(here, '..');
export const REPO_ROOT = resolve(DEMO_DIR, '..', '..');

/** The default demo world. reset-demo-world.ps1 refuses anything but demo worlds. */
export const DEMO_WORLD = 'ai-tool-demo';
const DEMO_WORLD_ID = /^ai-tool-demo(-[a-z0-9]+)*$/;

/**
 * The world takes run in: ai-tool-demo, or another demo world (ai-tool-demo-<name>) picked
 * with `--world`, which demo.mjs passes on in DEMO_WORLD_ID.
 */
export function demoWorld() {
  const world = process.env.DEMO_WORLD_ID || DEMO_WORLD;
  if (!DEMO_WORLD_ID.test(world)) {
    throw new Error(`Demo worlds are called ai-tool-demo or ai-tool-demo-<name>; got "${world}".`);
  }
  return world;
}

/** The demo world's users (no passwords; test server only). */
export const DEMO_USERS = { gm: 'GM', player: 'Player' };

/** Output sizes. The page is always laid out at 1920x1080 CSS pixels; scale makes it sharp. */
export const RESOLUTIONS = {
  1080: { width: 1920, height: 1080, scale: 1 },
  1440: { width: 2560, height: 1440, scale: 4 / 3 },
  2160: { width: 3840, height: 2160, scale: 2 },
};
export const CSS_SIZE = { width: 1920, height: 1080 };

const LIVE_PORTS = [31414, 31415, 31416];

function readJson(file) {
  return existsSync(file) ? JSON.parse(readFileSync(file, 'utf8')) : {};
}

/** The test environment, as config.ps1 resolves it. */
export function testEnv() {
  const local = readJson(join(REPO_ROOT, 'scripts', 'test-env', 'local.json'));
  const root = local.Root ?? 'C:\\FoundryTest';
  const env = {
    root,
    foundryPort: Number(local.FoundryPort ?? 30001),
    controlPort: Number(local.ControlPort ?? 31514),
    dashboardPort: Number(local.DashboardPort ?? 3100),
    demoRoot: join(root, 'demo'),
  };
  for (const port of [env.foundryPort, env.controlPort, env.dashboardPort]) {
    if (LIVE_PORTS.includes(port)) throw new Error(`Port ${port} is a live bridge port; refusing.`);
  }
  return {
    ...env,
    foundryUrl: `http://localhost:${env.foundryPort}`,
    dashboardUrl: `http://localhost:${env.dashboardPort}`,
    takesDir: join(env.demoRoot, 'takes'),
    profilesDir: join(env.demoRoot, 'browser-profiles'),
  };
}

const DEMO_LOCAL = join(DEMO_DIR, 'local.json');

/**
 * The demo's local settings: { obsPort, obsPassword }. With create: true a missing
 * password is generated and saved (the file is gitignored).
 */
export function demoLocal({ create = false } = {}) {
  const local = readJson(DEMO_LOCAL);
  if (!local.obsPassword && create) {
    local.obsPassword = randomBytes(18).toString('base64url');
    local.obsPort ??= 4455;
    writeFileSync(DEMO_LOCAL, `${JSON.stringify(local, null, 2)}\n`);
  }
  return { obsPort: Number(local.obsPort ?? 4455), obsPassword: local.obsPassword ?? '' };
}
