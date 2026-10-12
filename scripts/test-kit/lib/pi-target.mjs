/**
 * The opt-in `pi` target: the kit runs its tools-only scenarios through the co-GM dashboard of the
 * Orange Pi, against the Pi's throwaway world `strahd-kit`. It answers "which bridge tools need a
 * canvas" (backlog I-028), because the Pi's GM browser has none (core.noCanvas).
 *
 * On the Pi, the stage `kit-session.sh MODE=up` launches strahd-kit, makes a GM user `Kit GM` and
 * starts a headless browser that joins as it and holds the bridge link, so the PC needs no GM
 * browser of its own for this slice.
 *
 * Where the Pi is comes from a local targets file outside the repo (default
 * `%LOCALAPPDATA%\\foundry-ai-tool\\kit-targets.json`, env KIT_TARGETS_FILE overrides it). The file
 * holds host and ports and the paths of two secret files, never a secret itself; the loader
 * accepts only those keys. Secrets (the dashboard token, the Kit GM password) are read from their
 * files at the moment they are used and never enter a target object, a report or an error message.
 */
import { readFileSync } from 'node:fs';
import { lookup as dnsLookup } from 'node:dns/promises';
import os from 'node:os';
import path from 'node:path';
import { KIT_GM_USER } from './contract.mjs';
import { EnvError } from './errors.mjs';
import { guardUrl } from './guard-url.mjs';

/** The only world the pi target uses. */
export const PI_WORLD = 'strahd-kit';

/** What a missing key in the `pi` entry falls back to. */
export const PI_DEFAULTS = Object.freeze({
  host: 'foundry-pi',
  dashboardPort: 3000,
  foundryPort: 30000,
});

/** The keys the `pi` entry may have; any other key is refused. */
export const PI_KEYS = [
  'host',
  'dashboardPort',
  'foundryPort',
  'dashboardTokenFile',
  'kitGmPasswordFile',
];

/** The longest secret the kit reads from a file. */
export const MAX_SECRET_LENGTH = 200;

export const NOT_GAME_NIGHT_MESSAGE =
  "REFUSED: pass --not-game-night to confirm today is not a game night (the planner's rule: the kit never runs on the Pi on a game-night day)";

const SHAPE_HELP = `The file holds host and ports only, nothing secret (the two *File keys are optional paths on this PC, each to a file holding one line):
{"pi": {"host": "foundry-pi", "dashboardPort": 3000, "foundryPort": 30000, "dashboardTokenFile": "C:\\\\path\\\\to\\\\dashboard-token.txt", "kitGmPasswordFile": "C:\\\\path\\\\to\\\\kit-gm-password.txt"}}`;

/**
 * The targets file's path: env KIT_TARGETS_FILE, else `%LOCALAPPDATA%\foundry-ai-tool\kit-targets.json`.
 * @param {Record<string, string | undefined>} [env]
 */
export function kitTargetsFile(env = process.env) {
  if (env.KIT_TARGETS_FILE && env.KIT_TARGETS_FILE.trim()) return env.KIT_TARGETS_FILE.trim();
  if (!env.LOCALAPPDATA) {
    throw new EnvError(
      `LOCALAPPDATA is not set, so the targets file cannot be found: set KIT_TARGETS_FILE.\n${SHAPE_HELP}`
    );
  }
  return path.join(env.LOCALAPPDATA, 'foundry-ai-tool', 'kit-targets.json');
}

/**
 * What "this PC" is: its host name and every address of its network cards. Injectable for tests.
 * @typedef {{hostname?: string, interfaces?: NodeJS.Dict<os.NetworkInterfaceInfo[]>}} LocalIdentity
 */

/**
 * Whether an IP address is loopback, unspecified or one of this PC's own addresses (the LAN
 * address, the Tailscale address, IPv4-mapped IPv6 included).
 * @param {string} address
 * @param {LocalIdentity} [local]
 */
export function isLocalAddress(address, { interfaces = os.networkInterfaces() } = {}) {
  const a = address
    .toLowerCase()
    .replace(/^\[|\]$/g, '')
    .replace(/%.*$/, '')
    .replace(/^::ffff:/, '');
  if (a === '::1' || a === '::' || a === '0.0.0.0' || /^127\./.test(a)) return true;
  return Object.values(interfaces).some(list =>
    (list ?? []).some(i => i.address.toLowerCase().replace(/%.*$/, '') === a)
  );
}

/**
 * Whether a hostname (as the URL parser normalises it: IPv4 forms like 127.1 or 0x7f000001
 * already come out as 127.0.0.1) is this PC: loopback, one of its addresses, its host name, or a
 * name whose first label is its host name (`<pc>.<tailnet>.ts.net`).
 * @param {string} hostname
 * @param {LocalIdentity} [local]
 */
export function isThisPc(hostname, local = {}) {
  const h = hostname.toLowerCase();
  const own = (local.hostname ?? os.hostname()).toLowerCase();
  return (
    h === 'localhost' ||
    h.endsWith('.localhost') ||
    h === '[::1]' ||
    h === own ||
    h.split('.')[0] === own.split('.')[0] ||
    isLocalAddress(h, local)
  );
}

/**
 * The name check, with the network: the Pi host is looked up (every address) and refused when any
 * of them is this PC's. A name that does not resolve is an EnvError too: the run needs the Pi.
 * @param {string} host
 * @param {LocalIdentity & {lookup?: (host: string, opts: {all: true}) => Promise<Array<{address: string}>>}} [opts]
 */
export async function assertRemoteHost(host, { lookup = dnsLookup, ...local } = {}) {
  /** @type {Array<{address: string}>} */
  let found;
  try {
    found = await lookup(host, { all: true });
  } catch {
    throw new EnvError(
      `The Pi host ${host} cannot be resolved (is Tailscale connected? check pi.host in the targets file).`
    );
  }
  if (!Array.isArray(found) || !found.length) {
    throw new EnvError(`The Pi host ${host} cannot be resolved (no address).`);
  }
  for (const { address } of found) {
    if (isLocalAddress(address, local)) {
      throw new EnvError(
        `REFUSED: the pi target must be another machine, but ${host} resolves to ${address}, an address of this PC.`
      );
    }
  }
}

/** A key name safe to show in a message. @param {string} key */
function shownKey(key) {
  return `"${key.replace(/[^\w.-]/g, '?').slice(0, 40)}"`;
}

/** @param {unknown} p */
function isAbsolutePath(p) {
  return typeof p === 'string' && (path.win32.isAbsolute(p) || path.posix.isAbsolute(p));
}

/**
 * Reads and checks the `pi` entry of the targets file. Host and ports only; any other key makes
 * the load fail with an error that names the key and never its value. Nothing in an error message
 * comes from the file's text (not even a JSON parse message, which can quote it).
 * @param {Record<string, string | undefined>} [env]
 * @returns {{file: string, host: string, dashboardPort: number, foundryPort: number, dashboardTokenFile?: string, kitGmPasswordFile?: string}}
 */
export function loadPiConfig(env = process.env) {
  const file = kitTargetsFile(env);
  let text;
  try {
    text = readFileSync(file, 'utf8');
  } catch {
    throw new EnvError(
      `The pi target needs the targets file ${file}, which cannot be read.\n${SHAPE_HELP}`
    );
  }
  /** @type {any} */
  let data;
  try {
    data = JSON.parse(text);
  } catch {
    throw new EnvError(`The targets file ${file} is not valid JSON.\n${SHAPE_HELP}`);
  }
  const entry = data && typeof data === 'object' ? data.pi : undefined;
  if (!entry || typeof entry !== 'object' || Array.isArray(entry)) {
    throw new EnvError(`The targets file ${file} has no "pi" entry.\n${SHAPE_HELP}`);
  }
  for (const key of Object.keys(entry)) {
    if (!PI_KEYS.includes(key)) {
      throw new EnvError(
        `REFUSED: ${file}: the pi entry has an unknown key ${shownKey(key)}. Only ${PI_KEYS.join(', ')} are allowed; secrets stay in their own files.`
      );
    }
  }
  const host = entry.host === undefined ? PI_DEFAULTS.host : entry.host;
  if (
    typeof host !== 'string' ||
    host.length > 253 ||
    !/^[A-Za-z0-9]([A-Za-z0-9.-]*[A-Za-z0-9])?$/.test(host)
  ) {
    throw new EnvError(
      `${file}: pi.host must be a hostname or an IPv4 address (letters, digits, dots and hyphens only).`
    );
  }
  /** @param {'dashboardPort' | 'foundryPort'} key */
  const port = key => {
    const v = entry[key] === undefined ? PI_DEFAULTS[key] : entry[key];
    if (!Number.isInteger(v) || v < 1 || v > 65535) {
      throw new EnvError(`${file}: pi.${key} must be a whole number from 1 to 65535.`);
    }
    return /** @type {number} */ (v);
  };
  /** @param {'dashboardTokenFile' | 'kitGmPasswordFile'} key */
  const secretPath = key => {
    if (entry[key] === undefined) return undefined;
    if (!isAbsolutePath(entry[key])) {
      throw new EnvError(`${file}: pi.${key} must be the absolute path of a file on this PC.`);
    }
    return /** @type {string} */ (entry[key]);
  };
  /** @type {ReturnType<typeof loadPiConfig>} */
  const config = {
    file,
    host,
    dashboardPort: port('dashboardPort'),
    foundryPort: port('foundryPort'),
  };
  const tokenFile = secretPath('dashboardTokenFile');
  if (tokenFile) config.dashboardTokenFile = tokenFile;
  const passwordFile = secretPath('kitGmPasswordFile');
  if (passwordFile) config.kitGmPasswordFile = passwordFile;
  return config;
}

/**
 * Resolves the pi target. Every refusal is an EnvError starting with `REFUSED:`: fake mode, a
 * world other than strahd-kit, no `--not-game-night`, a host that is this PC, a live bridge port,
 * an unknown key in the targets file. The returned object holds file paths for the secrets and
 * never a secret.
 * @param {{world?: string, fake?: boolean, notGameNight?: boolean, env?: Record<string, string | undefined>}} [opts]
 * @returns {{name: 'pi', dashboard: string, foundry: string, world: string, host: string, dashboardTokenFile?: string, kitGmPasswordFile?: string, kitGmUser: string}}
 */
export function resolvePiTarget({
  world,
  fake = false,
  notGameNight = false,
  env = process.env,
} = {}) {
  if (fake) {
    throw new EnvError(
      'REFUSED: the pi target never runs in fake mode (the fake is on this PC only).'
    );
  }
  if (world !== undefined && world !== PI_WORLD) {
    throw new EnvError(
      `REFUSED: the pi target runs only in the throwaway world "${PI_WORLD}", not ${JSON.stringify(world)}.`
    );
  }
  if (notGameNight !== true) throw new EnvError(NOT_GAME_NIGHT_MESSAGE);
  const cfg = loadPiConfig(env);
  let hostname;
  try {
    hostname = new URL(`http://${cfg.host}:1`).hostname;
  } catch {
    throw new EnvError(`${cfg.file}: pi.host "${cfg.host}" is not a usable hostname or address.`);
  }
  if (isThisPc(hostname)) {
    throw new EnvError(
      `REFUSED: the pi target must be another machine, but ${cfg.host} is this PC (loopback or its own name).`
    );
  }
  const dashboard = guardUrl(`http://${hostname}:${cfg.dashboardPort}`, {
    label: 'pi dashboard',
    loopbackOnly: false,
  });
  const foundry = guardUrl(`http://${hostname}:${cfg.foundryPort}`, {
    label: 'pi Foundry',
    loopbackOnly: false,
  });
  return {
    name: 'pi',
    dashboard,
    foundry,
    world: PI_WORLD,
    host: hostname,
    ...(cfg.dashboardTokenFile ? { dashboardTokenFile: cfg.dashboardTokenFile } : {}),
    ...(cfg.kitGmPasswordFile ? { kitGmPasswordFile: cfg.kitGmPasswordFile } : {}),
    kitGmUser: KIT_GM_USER,
  };
}

/**
 * The part of a target that goes into a report: where it is, never a file path or a secret.
 * @param {{name: string, host?: string, dashboard: string, foundry: string, world: string}} target
 */
export function reportTarget(target) {
  return {
    name: target.name,
    ...(target.host ? { host: target.host } : {}),
    dashboard: target.dashboard,
    foundry: target.foundry,
    world: target.world,
  };
}

/**
 * One secret from a file on this PC: trimmed, one line, 1 to {@link MAX_SECRET_LENGTH}
 * characters. The error names the FILE, never the content.
 * @param {string} file
 * @returns {string}
 */
export function readSecretFile(file) {
  let raw;
  try {
    raw = readFileSync(file, 'utf8');
  } catch {
    throw new EnvError(`The secret file ${file} cannot be read.`);
  }
  const secret = raw.replace(/^\uFEFF/, '').trim();
  if (!secret) throw new EnvError(`The secret file ${file} is empty.`);
  if (/[\r\n]/.test(secret)) throw new EnvError(`The secret file ${file} must hold one line only.`);
  if (secret.length > MAX_SECRET_LENGTH) {
    throw new EnvError(`The secret file ${file} is longer than ${MAX_SECRET_LENGTH} characters.`);
  }
  return secret;
}

/**
 * The Kit GM's password, read from the file named in the targets file.
 * @param {{kitGmPasswordFile?: string}} target
 */
export function readKitGmPassword(target) {
  if (!target.kitGmPasswordFile) {
    throw new EnvError('The targets file has no pi.kitGmPasswordFile (the Kit GM password file).');
  }
  return readSecretFile(target.kitGmPasswordFile);
}

/**
 * The dashboard token from the file named in the targets file, or null when none is named (the
 * dashboard client then falls back to the COGM_TOKEN environment variable).
 * @param {{dashboardTokenFile?: string}} target
 * @returns {string | null}
 */
export function readDashboardToken(target) {
  return target.dashboardTokenFile ? readSecretFile(target.dashboardTokenFile) : null;
}

/**
 * The check before a pi run: the Pi's Foundry answers, runs a world, and that world is
 * strahd-kit. `GET <foundry>/api/status` (JSON with `active` and `world`).
 * @param {{foundry: string}} target
 * @param {{fetchImpl?: typeof fetch, timeoutMs?: number}} [opts]
 * @returns {Promise<{active: boolean, world: string}>}
 */
export async function piPreflight(target, { fetchImpl = fetch, timeoutMs = 10000 } = {}) {
  const url = `${target.foundry}/api/status`;
  const startHint = `start the kit session first (kit-session.sh MODE=up, docs/dev/PI-SETUP.md)`;
  let res;
  try {
    res = await fetchImpl(url, { signal: AbortSignal.timeout(timeoutMs) });
  } catch {
    throw new EnvError(
      `The Pi's Foundry does not answer at ${target.foundry} (is the Pi up and Tailscale connected?)`
    );
  }
  if (!res.ok) {
    throw new EnvError(
      `The Pi's Foundry at ${target.foundry} answered HTTP ${res.status} on /api/status.`
    );
  }
  /** @type {any} */
  let status;
  try {
    status = await res.json();
  } catch {
    throw new EnvError(
      `The Pi's Foundry at ${target.foundry} did not answer /api/status with JSON.`
    );
  }
  if (!status || typeof status !== 'object' || status.active !== true) {
    throw new EnvError(
      `The Pi's Foundry at ${target.foundry} is not running a world: ${startHint}`
    );
  }
  if (status.world !== PI_WORLD) {
    const shown = typeof status.world === 'string' ? status.world.slice(0, 60) : '(none)';
    throw new EnvError(`REFUSED: the Pi is launching '${shown}', not ${PI_WORLD}: ${startHint}`);
  }
  return { active: true, world: status.world };
}
