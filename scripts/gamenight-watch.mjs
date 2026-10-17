/**
 * Game-night watch (I-145): calls Foundry's /api/status every minute and tells Discord when Foundry
 * does not answer, answers slower than a limit, or is back. Runs on the PC; the Pi is not touched.
 *
 *   node scripts/gamenight-watch.mjs --url http://<pi>:30000            log only (dry run)
 *   node scripts/gamenight-watch.mjs --url http://localhost:30001 --post   post to the channel
 *
 * Options: --url (or GAMENIGHT_WATCH_URL), --interval seconds (60), --slow-ms (3000), --timeout-ms
 * (10000), --fail N misses in a row before "down" (2), --slow N slow answers in a row before "slow"
 * (3), --recover N good answers in a row before "back" (2), --env-file, --once (one probe, exit).
 *
 * Posting is opt-in (--post). Settings come from the bot's env file
 * (%APPDATA%\foundry-ai-tool\discord-bot.env), overridden by real environment variables:
 * DISCORD_TOKEN (the bot token, never printed), GAMENIGHT_WATCH_CHANNEL_ID (the channel to post in),
 * optional GAMENIGHT_WATCH_MENTION_IDS (comma separated user ids to ping, for the user and the GM).
 *
 * One message when it goes down or slow, one when it is back; nothing in between.
 */
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import { homedir } from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const DEFAULTS = {
  intervalSec: 60,
  slowMs: 3000,
  timeoutMs: 10000,
  failCount: 2,
  slowCount: 3,
  recoverCount: 2,
};

/** @returns {{mode:'up'|'slow'|'down', good:number, failRun:number, slowRun:number}} */
export function initialState() {
  return { mode: 'up', good: 0, failRun: 0, slowRun: 0 };
}

/**
 * The state machine. `probe` is `{ok:boolean, ms:number}` (ok false = no answer or an error status).
 * Returns the next state and an alert (`'down'`, `'slow'`, `'recovered'`) or null. Pure.
 * @param {ReturnType<typeof initialState>} state
 * @param {{ok:boolean, ms:number}} probe
 * @param {typeof DEFAULTS} cfg
 */
export function step(state, probe, cfg = DEFAULTS) {
  const failed = !probe.ok;
  const slow = probe.ok && probe.ms > cfg.slowMs;
  const good = probe.ok && !slow;
  // Runs in a row: misses, slow answers, good answers.
  const next = {
    ...state,
    good: good ? state.good + 1 : 0,
    failRun: failed ? state.failRun + 1 : 0,
    slowRun: slow ? state.slowRun + 1 : 0,
  };

  if (next.failRun >= cfg.failCount && state.mode !== 'down') {
    return { state: { ...next, mode: 'down' }, alert: 'down' };
  }
  // Back from "down" but too slow to call it recovered: say so once, then wait for fast answers.
  if (next.slowRun >= cfg.slowCount && state.mode === 'down') {
    return { state: { ...next, mode: 'slow' }, alert: 'slow-after-down' };
  }
  if (next.slowRun >= cfg.slowCount && state.mode === 'up') {
    return { state: { ...next, mode: 'slow' }, alert: 'slow' };
  }
  if (state.mode !== 'up' && next.good >= cfg.recoverCount) {
    return { state: { ...next, mode: 'up' }, alert: 'recovered' };
  }
  return { state: next, alert: null };
}

/** The Discord text for an alert. @param {string} alert @param {string} url @param {{ms:number, error?:string}} probe */
export function formatAlert(alert, url, probe, cfg = DEFAULTS, mentions = []) {
  const ping = mentions.map(id => `<@${id}>`).join(' ');
  const body =
    alert === 'down'
      ? `Foundry does not answer at ${url} (${probe.error ?? 'no answer'}).`
      : alert === 'slow' || alert === 'slow-after-down'
        ? `Foundry ${alert === 'slow-after-down' ? 'answers again, but slowly' : 'answers slowly'} at ${url}: ${probe.ms} ms, the limit is ${cfg.slowMs} ms.`
        : `Foundry answers again at ${url} (${probe.ms} ms).`;
  return ping ? `${ping} ${body}` : body;
}

/** One probe of `<url>/api/status`. Never throws. @returns {Promise<{ok:boolean, ms:number, error?:string}>} */
export async function probeFoundry(url, timeoutMs, fetchImpl = fetch) {
  const started = Date.now();
  try {
    // A redirect (for example a login page in front of Foundry) is a miss, not a healthy answer.
    const res = await fetchImpl(new URL('/api/status', url), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    if (!res.ok) return { ok: false, ms: Date.now() - started, error: `HTTP ${res.status}` };
    // Foundry answers 200 with active:false on the setup screen, when no world is running.
    const body = await res.json().catch(() => null);
    const ms = Date.now() - started;
    if (!body || body.active !== true) return { ok: false, ms, error: 'no world running' };
    return { ok: true, ms };
  } catch (err) {
    const timedOut =
      err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return {
      ok: false,
      ms: Date.now() - started,
      error: timedOut ? 'timed out' : 'connection failed',
    };
  }
}

/** Parse `KEY=value` lines (same rules as the bot's config). @param {string} text */
export function parseEnv(text) {
  /** @type {Record<string,string>} */
  const out = {};
  for (const raw of text.split(/\r?\n/)) {
    const line = raw.trim();
    if (!line || line.startsWith('#')) continue;
    const eq = line.indexOf('=');
    if (eq <= 0) continue;
    let value = line.slice(eq + 1).trim();
    if (value.length >= 2 && /^(['"]).*\1$/.test(value)) value = value.slice(1, -1);
    out[line.slice(0, eq).trim()] = value;
  }
  return out;
}

export function defaultEnvFile() {
  return path.join(
    process.env.APPDATA ?? path.join(homedir(), '.config'),
    'foundry-ai-tool',
    'discord-bot.env'
  );
}

/** Post one message through the bot. Never logs the token. */
export async function postToChannel({ token, channelId }, content, fetchImpl = fetch) {
  const res = await fetchImpl(`https://discord.com/api/v10/channels/${channelId}/messages`, {
    method: 'POST',
    headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json' },
    body: JSON.stringify({ content, allowed_mentions: { parse: ['users'] } }),
    signal: AbortSignal.timeout(15000),
  });
  if (!res.ok) throw new Error(`Discord answered HTTP ${res.status}`);
}

const SWITCHES = new Set(['post', 'once']);

/** `--post` and `--once` are switches (no value); every other flag takes a value. */
export function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    if (SWITCHES.has(key)) {
      o[key] = true;
      continue;
    }
    const nextVal = argv[i + 1];
    if (nextVal === undefined || nextVal.startsWith('--')) {
      throw new Error(`--${key} needs a value.`);
    }
    o[key] = nextVal;
    i++;
  }
  return o;
}

/** The address to show and post: http or https only, without a user name or password. */
export function safeUrl(raw) {
  const u = new URL(raw);
  if (u.protocol !== 'http:' && u.protocol !== 'https:')
    throw new Error('The address must start with http:// or https://.');
  u.username = '';
  u.password = '';
  return u.toString().replace(/\/$/, '');
}

/**
 * Post the queued alerts in order; stops at the first failure and returns what is still unsent, so a
 * Discord outage does not lose the "down" message (it is tried again on the next probe).
 * @param {string[]} pending @param {(text:string)=>Promise<void>} post @param {(msg:string)=>void} log
 */
export async function flushPending(pending, post, log = () => {}) {
  const rest = [...pending];
  while (rest.length > 0) {
    try {
      await post(rest[0]);
      rest.shift();
    } catch (err) {
      log(`could not post (will retry): ${err instanceof Error ? err.message : err}`);
      break;
    }
  }
  return rest;
}

/** Ask Discord whether the bot can see the channel. Returns an error text, or null when fine. */
export async function checkChannel({ token, channelId }, fetchImpl = fetch) {
  try {
    const res = await fetchImpl(`https://discord.com/api/v10/channels/${channelId}`, {
      headers: { Authorization: `Bot ${token}` },
      signal: AbortSignal.timeout(15000),
    });
    if (res.ok) return null;
    if ([401, 403, 404].includes(res.status)) {
      return `Discord answered HTTP ${res.status}: check the bot token, that the bot is in the server and the channel id.`;
    }
    return null; // a passing Discord problem: the posts retry on their own
  } catch {
    return null;
  }
}

/** Adds the time the alert was noticed when the post goes out late (after a Discord outage). */
export function withLateNote({ text, at }, now = Date.now()) {
  if (now - at < 30_000) return text;
  return `${text} (noticed ${new Date(at).toISOString().slice(11, 19)} UTC)`;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = typeof args['env-file'] === 'string' ? args['env-file'] : defaultEnvFile();
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const get = key => [process.env[key], fromFile[key]].find(v => v);
  const num = (name, dflt) => {
    if (args[name] === undefined) return dflt;
    const v = Number(args[name]);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`--${name} must be a positive number.`);
    return v;
  };
  const rawUrl = typeof args.url === 'string' ? args.url : get('GAMENIGHT_WATCH_URL');
  if (!rawUrl) {
    console.error('Give the Foundry address: --url http://host:port (or GAMENIGHT_WATCH_URL).');
    process.exit(2);
  }
  const url = safeUrl(rawUrl);
  const cfg = {
    intervalSec: num('interval', DEFAULTS.intervalSec),
    slowMs: num('slow-ms', DEFAULTS.slowMs),
    timeoutMs: num('timeout-ms', DEFAULTS.timeoutMs),
    failCount: num('fail', DEFAULTS.failCount),
    slowCount: num('slow', DEFAULTS.slowCount),
    recoverCount: num('recover', DEFAULTS.recoverCount),
  };
  const mentions = (get('GAMENIGHT_WATCH_MENTION_IDS') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);
  let target = null;
  if (args.post) {
    const token = get('DISCORD_TOKEN');
    const channelId = get('GAMENIGHT_WATCH_CHANNEL_ID');
    if (!token || !channelId) {
      console.error(`--post needs DISCORD_TOKEN and GAMENIGHT_WATCH_CHANNEL_ID in ${envFile}.`);
      process.exit(2);
    }
    target = { token, channelId };
    const refused = await checkChannel(target);
    if (refused) {
      console.error(refused);
      process.exit(2);
    }
  }
  console.log(
    `${stamp()} watching ${url} every ${cfg.intervalSec}s (${target ? 'posting to Discord' : 'dry run, log only'})`
  );

  let state = initialState();
  /** @type {string[]} */
  let pending = [];
  for (;;) {
    const probe = await probeFoundry(url, cfg.timeoutMs);
    const result = step(state, probe, cfg);
    state = result.state;
    console.log(
      `${stamp()} ${probe.ok ? 'ok' : 'FAIL'} ${probe.ms} ms${probe.error ? ` (${probe.error})` : ''} -> ${state.mode}`
    );
    if (result.alert) {
      const text = formatAlert(result.alert, url, probe, cfg, mentions);
      console.log(`${stamp()} alert ${result.alert}: ${text}`);
      if (target) pending.push({ text, at: Date.now() });
    }
    if (target && pending.length > 0) {
      pending = await flushPending(
        pending,
        a => postToChannel(target, withLateNote(a)),
        m => console.error(`${stamp()} ${m}`)
      );
    }
    if (args.once) {
      // Exit 1 when Foundry is not healthy or a post is still unsent, so a test can tell.
      if (!probe.ok || pending.length > 0) process.exitCode = 1;
      return;
    }
    await new Promise(r => setTimeout(r, cfg.intervalSec * 1000));
  }
}

const isMain = () => {
  try {
    return (
      !!process.argv[1] &&
      realpathSync(process.argv[1]) === realpathSync(fileURLToPath(import.meta.url))
    );
  } catch {
    return false;
  }
};

if (isMain()) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
