/**
 * Posts to the two read-only channels on the game server: #changelog (a short Danish line per
 * release or Pi deploy) and #pr-log (one line per PR merged to main).
 *
 * Plain Node with no dependencies and no build step, so the merge gate, the release steps and the Pi
 * stage can all run it as `node packages/discord-bot/announce/announce.mjs <kind> ...`. #pr-log posts
 * are sent with SUPPRESS_NOTIFICATIONS (flag 4096), so nobody gets a push or a desktop alert;
 * #changelog posts are normal (rare, and the server's notification setting decides). No post mentions
 * anyone (allowed_mentions parse is empty). A failure never throws to the caller: the CLI prints one warning line and exits 1,
 * and callers treat that as a warning only.
 *
 * Settings: DISCORD_TOKEN, DISCORD_CHANGELOG_CHANNEL_ID, DISCORD_PRLOG_CHANNEL_ID, from the real
 * environment first, then from discord-bot.env (PC: %APPDATA%\foundry-ai-tool\discord-bot.env, Pi:
 * /etc/foundry-ai-tool/discord-bot.env, or the file ANNOUNCE_ENV_FILE names).
 */
import { existsSync, readFileSync } from 'node:fs';
import { homedir } from 'node:os';
import { join } from 'node:path';
import { fileURLToPath } from 'node:url';

export const API = 'https://discord.com/api/v10';
export const SUPPRESS_NOTIFICATIONS = 4096;
export const REPO_URL = 'https://github.com/Gnuminator/Foundry-VTT-MCP-Ai-Tool';
export const MAX_CONTENT = 2000;
const TIMEOUT_MS = 8000;

/** @param {string} text @returns {Record<string, string>} */
export function parseEnv(text) {
  /** @type {Record<string, string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const i = line.indexOf('=');
    if (i < 1) continue;
    let value = line.slice(i + 1).trim();
    if (/^(["']).*\1$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, i).trim()] = value;
  }
  return out;
}

/** @param {Record<string, string | undefined>} env */
export function defaultEnvFile(env = process.env) {
  if (env.ANNOUNCE_ENV_FILE) return env.ANNOUNCE_ENV_FILE;
  if (process.platform === 'win32') {
    return join(env.APPDATA ?? join(homedir(), '.config'), 'foundry-ai-tool', 'discord-bot.env');
  }
  return '/etc/foundry-ai-tool/discord-bot.env';
}

/**
 * @param {Record<string, string | undefined>} env
 * @param {string} [envFile]
 * @returns {{ token: string, changelogChannel: string, prLogChannel: string }}
 */
export function loadSettings(env = process.env, envFile = defaultEnvFile(env)) {
  let fromFile = {};
  try {
    if (existsSync(envFile)) fromFile = parseEnv(readFileSync(envFile, 'utf8'));
  } catch {
    // An unreadable file is the same as no settings.
  }
  /** @param {string} key */
  const pick = key => env[key] || /** @type {Record<string, string>} */ (fromFile)[key] || '';
  return {
    token: pick('DISCORD_TOKEN'),
    changelogChannel: pick('DISCORD_CHANGELOG_CHANNEL_ID'),
    prLogChannel: pick('DISCORD_PRLOG_CHANNEL_ID'),
  };
}

/** One line for #pr-log: the PR number as a link, then the title. @param {number|string} n @param {string} title */
export function prLine(n, title) {
  const clean = String(title).replace(/\s+/g, ' ').trim().slice(0, 300);
  return `[#${n}](<${REPO_URL}/pull/${n}>) ${clean}`;
}

/** The Danish line for a Pi deploy. @param {string} version */
export function deployLine(version) {
  return `Serveren kører nu ${version}.`;
}

/**
 * Post one message; silent (no push or desktop alert) unless `silent` is false. Never mentions anyone.
 * Never throws.
 * @param {{ token: string, channelId: string, content: string, silent?: boolean,
 *   fetchImpl?: typeof fetch, timeoutMs?: number }} o
 * @returns {Promise<{ ok: true, id: string } | { ok: false, reason: string }>}
 */
export async function postMessage({
  token,
  channelId,
  content,
  silent = true,
  fetchImpl = globalThis.fetch,
  timeoutMs = TIMEOUT_MS,
}) {
  if (!token || !channelId) return { ok: false, reason: 'not configured' };
  const text = String(content).trim().slice(0, MAX_CONTENT);
  if (!text) return { ok: false, reason: 'empty message' };
  try {
    const res = await fetchImpl(`${API}/channels/${channelId}/messages`, {
      method: 'POST',
      headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
      body: JSON.stringify({
        content: text,
        ...(silent ? { flags: SUPPRESS_NOTIFICATIONS } : {}),
        allowed_mentions: { parse: [] },
      }),
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, reason: `Discord answered ${res.status}` };
    const body = /** @type {{ id?: string }} */ (await res.json().catch(() => ({})));
    return { ok: true, id: body.id ?? '' };
  } catch (e) {
    return { ok: false, reason: e instanceof Error ? e.message : String(e) };
  }
}

const USAGE =
  'usage: announce.mjs pr <number> <title...> | changelog <text...> | deploy <version>';

/**
 * @param {string[]} argv
 * @param {{ env?: Record<string, string | undefined>, envFile?: string, fetchImpl?: typeof fetch,
 *   log?: (line: string) => void, timeoutMs?: number }} [o]
 * @returns {Promise<number>} the exit code: 0 posted or not configured, 1 failed, 2 usage
 */
export async function runCli(argv, o = {}) {
  const { env = process.env, fetchImpl, log = console.log, timeoutMs } = o;
  const [kind, ...rest] = argv;
  /** @type {'prLog' | 'changelog'} */
  let target = 'changelog';
  let content = '';
  if (kind === 'pr' && rest.length >= 2 && /^\d+$/.test(rest[0])) {
    target = 'prLog';
    content = prLine(rest[0], rest.slice(1).join(' '));
  } else if (kind === 'changelog' && rest.length >= 1) {
    content = rest.join(' ');
  } else if (kind === 'deploy' && rest.length === 1) {
    content = deployLine(rest[0]);
  } else {
    log(`announce: ${USAGE}`);
    return 2;
  }
  const s = loadSettings(env, o.envFile);
  const channelId = target === 'prLog' ? s.prLogChannel : s.changelogChannel;
  if (!s.token || !channelId) {
    log(`announce: no Discord settings for ${kind}; nothing posted`);
    return 0;
  }
  // #pr-log is chatty, so it is silent; #changelog is rare and follows the server's notification setting.
  const r = await postMessage({
    token: s.token,
    channelId,
    content,
    silent: target === 'prLog',
    ...(fetchImpl ? { fetchImpl } : {}),
    ...(timeoutMs ? { timeoutMs } : {}),
  });
  if (r.ok) {
    log(`announce: posted ${kind} (message ${r.id})`);
    return 0;
  }
  log(`announce: WARNING ${kind} not posted (${r.reason})`);
  return 1;
}

if (process.argv[1] && fileURLToPath(import.meta.url) === process.argv[1]) {
  // exitCode, not process.exit: exiting with a socket still closing trips a libuv assertion on Windows.
  runCli(process.argv.slice(2)).then(
    code => {
      process.exitCode = code;
    },
    () => {
      process.exitCode = 1;
    }
  );
}
