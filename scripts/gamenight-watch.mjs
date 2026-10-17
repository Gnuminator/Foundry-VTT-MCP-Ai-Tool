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
import { existsSync, readFileSync } from 'node:fs';
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
      : alert === 'slow'
        ? `Foundry answers slowly at ${url}: ${probe.ms} ms, the limit is ${cfg.slowMs} ms.`
        : `Foundry answers again at ${url} (${probe.ms} ms).`;
  return ping ? `${ping} ${body}` : body;
}

/** One probe of `<url>/api/status`. Never throws. @returns {Promise<{ok:boolean, ms:number, error?:string}>} */
export async function probeFoundry(url, timeoutMs, fetchImpl = fetch) {
  const started = Date.now();
  try {
    const res = await fetchImpl(new URL('/api/status', url), { signal: AbortSignal.timeout(timeoutMs) });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    return { ok: true, ms };
  } catch (err) {
    const timedOut = err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError');
    return { ok: false, ms: Date.now() - started, error: timedOut ? 'timed out' : 'connection failed' };
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
  return path.join(process.env.APPDATA ?? path.join(homedir(), '.config'), 'foundry-ai-tool', 'discord-bot.env');
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

function parseArgs(argv) {
  /** @type {Record<string, string|boolean>} */
  const o = {};
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (!a.startsWith('--')) continue;
    const key = a.slice(2);
    const nextVal = argv[i + 1];
    if (nextVal === undefined || nextVal.startsWith('--')) o[key] = true;
    else {
      o[key] = nextVal;
      i++;
    }
  }
  return o;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

async function main() {
  const args = parseArgs(process.argv.slice(2));
  const envFile = typeof args['env-file'] === 'string' ? args['env-file'] : defaultEnvFile();
  const fromFile = existsSync(envFile) ? parseEnv(readFileSync(envFile, 'utf8')) : {};
  const get = key => [process.env[key], fromFile[key]].find(v => v);
  const num = (name, dflt) => {
    const v = Number(args[name]);
    return Number.isFinite(v) && v > 0 ? v : dflt;
  };
  const url = typeof args.url === 'string' ? args.url : get('GAMENIGHT_WATCH_URL');
  if (!url) {
    console.error('Give the Foundry address: --url http://host:port (or GAMENIGHT_WATCH_URL).');
    process.exit(2);
  }
  const cfg = {
    intervalSec: num('interval', DEFAULTS.intervalSec),
    slowMs: num('slow-ms', DEFAULTS.slowMs),
    timeoutMs: num('timeout-ms', DEFAULTS.timeoutMs),
    failCount: num('fail', DEFAULTS.failCount),
    slowCount: num('slow', DEFAULTS.slowCount),
    recoverCount: num('recover', DEFAULTS.recoverCount),
  };
  const mentions = (get('GAMENIGHT_WATCH_MENTION_IDS') ?? '').split(',').map(s => s.trim()).filter(Boolean);
  let target = null;
  if (args.post) {
    const token = get('DISCORD_TOKEN');
    const channelId = get('GAMENIGHT_WATCH_CHANNEL_ID');
    if (!token || !channelId) {
      console.error(`--post needs DISCORD_TOKEN and GAMENIGHT_WATCH_CHANNEL_ID in ${envFile}.`);
      process.exit(2);
    }
    target = { token, channelId };
  }
  console.log(`${stamp()} watching ${url} every ${cfg.intervalSec}s (${target ? 'posting to Discord' : 'dry run, log only'})`);

  let state = initialState();
  for (;;) {
    const probe = await probeFoundry(url, cfg.timeoutMs);
    const result = step(state, probe, cfg);
    state = result.state;
    console.log(`${stamp()} ${probe.ok ? 'ok' : 'FAIL'} ${probe.ms} ms${probe.error ? ` (${probe.error})` : ''} -> ${state.mode}`);
    if (result.alert) {
      const text = formatAlert(result.alert, url, probe, cfg, mentions);
      console.log(`${stamp()} alert ${result.alert}: ${text}`);
      if (target) {
        try {
          await postToChannel(target, text);
        } catch (err) {
          console.error(`${stamp()} could not post: ${err instanceof Error ? err.message : err}`);
        }
      }
    }
    if (args.once) return;
    await new Promise(r => setTimeout(r, cfg.intervalSec * 1000));
  }
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  main().catch(err => {
    console.error(err instanceof Error ? err.message : err);
    process.exit(1);
  });
}
