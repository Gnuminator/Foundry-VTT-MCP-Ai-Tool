/**
 * Game-night watch on the Pi (backlog watch-on-pi). The same state machine and Discord posting as
 * scripts/gamenight-watch.mjs (the PC watch, I-145), run as a systemd service next to Foundry:
 * stage 28 installs both files and the unit. It idles until a play session is marked (the bridge's
 * `get-play-session` says open), then every minute checks
 *
 *   foundry    Foundry's /api/status on the Pi (a world is running)
 *   dashboard  the co-GM dashboard's /api/health (and that it still reaches the bridge)
 *   bridge     the bridge reports the Foundry module's socket connected (link_status)
 *   recorder   the Discord recorder service is running (and its status endpoint, when set, lists no problem)
 *   public     the public address through Cloudflare Access, with a service token (off without the token)
 *
 * and posts to #gm-bot when the watch starts, when a check goes down, slow or comes back, and when
 * the session ends. No post carries an address, a query string or a token; the log shows host
 * names only.
 *
 *   node scripts/gamenight-watch-pi.mjs                 log only (dry run)
 *   node scripts/gamenight-watch-pi.mjs --post          post to the channel
 *   node scripts/gamenight-watch-pi.mjs --once --always one round of probes, no session needed
 *
 * Settings come from the real environment (the systemd unit loads discord-bot.env and
 * gamenight-watch.env) and, with --env-file, from a file: DISCORD_TOKEN, GAMENIGHT_WATCH_CHANNEL_ID,
 * GAMENIGHT_WATCH_MENTION_IDS (as the PC watch) and WATCH_FOUNDRY_URL, WATCH_DASHBOARD_URL,
 * WATCH_CONTROL_PORT, WATCH_PUBLIC_URL, CF_ACCESS_CLIENT_ID, CF_ACCESS_CLIENT_SECRET,
 * WATCH_RECORDER_UNIT, WATCH_RECORDER_STATUS_URL. Secrets are never printed.
 */
import { execFile } from 'node:child_process';
import { existsSync, readFileSync, realpathSync } from 'node:fs';
import net from 'node:net';
import { fileURLToPath } from 'node:url';

import {
  DEFAULTS,
  checkChannel,
  flushPending,
  initialState,
  parseArgs,
  parseEnv,
  postToChannel,
  probeFoundry,
  safeUrl,
  scrubUrls,
  step,
  withLateNote,
} from './gamenight-watch.mjs';

/** The session ends after this many closed readings in a row (one odd answer does not end it). */
export const END_AFTER = 2;

/** One check: key, the words used in posts, and how slow is slow (Infinity: never judged on speed). */
export const CHECKS = [
  { key: 'foundry', label: 'Foundry', slow: true },
  { key: 'dashboard', label: 'The dashboard', slow: true },
  { key: 'bridge', label: 'The bridge link to Foundry', slow: false },
  { key: 'recorder', label: 'The Discord recorder', slow: false },
  { key: 'public', label: 'The public address', slow: true },
];

/** The words for an alert, no address in them. @param {{key:string,label:string}} check */
export function formatCheckAlert(check, alert, probe, cfg = DEFAULTS, mentions = []) {
  const ping = mentions.map(id => `<@${id}>`).join(' ');
  const why = probe.error ? ` (${probe.error})` : '';
  const body =
    alert === 'down'
      ? `${check.label} is not working${why}.`
      : alert === 'slow' || alert === 'slow-after-down'
        ? `${check.label} ${alert === 'slow-after-down' ? 'answers again, but slowly' : 'answers slowly'}: ${probe.ms} ms, the limit is ${cfg.slowMs} ms.`
        : `${check.label} is working again.`;
  return ping ? `${ping} ${body}` : body;
}

/**
 * The session gate. `open` is true, false, or null (the bridge did not answer: nothing is learned).
 * Starts at once on an open session; ends after END_AFTER closed readings in a row. Pure.
 * @returns {{gate:{active:boolean, closedRun:number}, event:'started'|'ended'|null}}
 */
export function gateStep(gate, open) {
  if (open === null) return { gate, event: null };
  if (open) {
    return { gate: { active: true, closedRun: 0 }, event: gate.active ? null : 'started' };
  }
  if (!gate.active) return { gate: { active: false, closedRun: 0 }, event: null };
  const closedRun = gate.closedRun + 1;
  return closedRun >= END_AFTER
    ? { gate: { active: false, closedRun: 0 }, event: 'ended' }
    : { gate: { active: true, closedRun }, event: null };
}

/** The error word for a thrown error: fixed words only, so no address or header can leak. */
const failWord = err =>
  err instanceof Error && (err.name === 'TimeoutError' || err.name === 'AbortError')
    ? 'timed out'
    : 'no answer';

/** One JSON-lines call on the bridge's control port. Rejects on a refused connection, a timeout or junk. */
export function controlCall(port, host, method, params = {}, timeoutMs = 5000, netImpl = net) {
  return new Promise((resolve, reject) => {
    const socket = netImpl.createConnection({ host, port });
    let buffer = '';
    const done = (err, value) => {
      socket.destroy();
      if (err) reject(err);
      else resolve(value);
    };
    socket.setTimeout(timeoutMs, () => done(new Error('timed out')));
    socket.on('connect', () => socket.write(`${JSON.stringify({ id: 'watch', method, params })}\n`));
    socket.on('data', chunk => {
      buffer += chunk.toString('utf8');
      const nl = buffer.indexOf('\n');
      if (nl < 0) return;
      try {
        const msg = JSON.parse(buffer.slice(0, nl));
        if (msg.error) done(new Error('the bridge refused the call'));
        else done(null, msg.result);
      } catch {
        done(new Error('the bridge answered junk'));
      }
    });
    socket.on('error', () => done(new Error('no answer')));
  });
}

/** Is a play session marked open? true, false, or null when the bridge cannot say. */
export async function readSessionOpen(port, host = '127.0.0.1', call = controlCall) {
  try {
    // requestedBy: the bridge counts a call without one as an old wrapper (get-preflight shows it).
    const result = await call(port, host, 'call_tool', {
      name: 'get-play-session',
      args: {},
      requestedBy: 'gamenight-watch',
    });
    const text = result?.content?.[0]?.text;
    const parsed = typeof text === 'string' ? JSON.parse(text) : null;
    if (typeof parsed?.open !== 'boolean') return null;
    // A paper night has Foundry closed by design: nothing to watch. A bridge from before `mode` reads as live.
    return parsed.open && parsed.mode !== 'paper';
  } catch {
    return null;
  }
}

/** The bridge reports the Foundry module's socket connected. @returns {Promise<{ok:boolean, ms:number, error?:string}>} */
export async function probeBridgeLink(port, host = '127.0.0.1', call = controlCall) {
  const started = Date.now();
  try {
    const result = await call(port, host, 'link_status', {});
    const ms = Date.now() - started;
    return result?.module === 'connected'
      ? { ok: true, ms }
      : { ok: false, ms, error: 'the Foundry module is not connected to the bridge' };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: `the bridge ${failWord(err)}` };
  }
}

/** The dashboard's /api/health says ok and that its own link to the bridge is up. */
export async function probeDashboard(url, timeoutMs, fetchImpl = fetch) {
  const started = Date.now();
  try {
    const res = await fetchImpl(new URL('/api/health', url), {
      redirect: 'manual',
      signal: AbortSignal.timeout(timeoutMs),
    });
    const ms = Date.now() - started;
    if (!res.ok) return { ok: false, ms, error: `HTTP ${res.status}` };
    const body = await res.json().catch(() => null);
    if (!body || body.ok !== true) return { ok: false, ms, error: 'unhealthy answer' };
    if (body.controlChannel !== 'connected') {
      return { ok: false, ms, error: 'the dashboard has lost the bridge' };
    }
    return { ok: true, ms };
  } catch (err) {
    return { ok: false, ms: Date.now() - started, error: failWord(err) };
  }
}

/** Is the recorder's systemd unit active? @returns {Promise<boolean>} */
export function unitActive(unit, exec = execFile) {
  return new Promise(resolve => {
    exec('systemctl', ['is-active', '--quiet', unit], { timeout: 5000 }, err => resolve(!err));
  });
}

/**
 * The recorder runs: its unit is active and, when a status address is set, that lists no problem.
 * @param {{unit:string, statusUrl?:string, timeoutMs:number, isActive?:(u:string)=>Promise<boolean>, fetchImpl?:typeof fetch}} o
 */
export async function probeRecorder({ unit, statusUrl, timeoutMs, isActive = unitActive, fetchImpl = fetch }) {
  const started = Date.now();
  if (!(await isActive(unit))) {
    return { ok: false, ms: Date.now() - started, error: 'the recorder service is not running' };
  }
  if (statusUrl) {
    try {
      const res = await fetchImpl(statusUrl, {
        redirect: 'manual',
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!res.ok) return { ok: false, ms: Date.now() - started, error: `status HTTP ${res.status}` };
      const body = await res.json().catch(() => null);
      const problems = Array.isArray(body?.problems) ? body.problems.length : 0;
      if (problems > 0) {
        return {
          ok: false,
          ms: Date.now() - started,
          error: `the recorder reports ${problems} problem${problems === 1 ? '' : 's'}`,
        };
      }
    } catch (err) {
      return { ok: false, ms: Date.now() - started, error: `recorder status ${failWord(err)}` };
    }
  }
  return { ok: true, ms: Date.now() - started };
}

/** The public address through Cloudflare Access. Access turning the token away is its own wording. */
export async function probePublic(url, headers, timeoutMs, fetchImpl = fetch) {
  const probe = await probeFoundry(url, timeoutMs, fetchImpl, headers);
  if (probe.ok) return probe;
  if (/^HTTP (30[1-8]|401|403)$/.test(probe.error ?? '')) {
    return { ...probe, error: 'Cloudflare Access turned the service token away' };
  }
  return probe;
}

/** The Access headers, or null when either half is missing. Never logged. */
export function accessHeaders(get) {
  const id = get('CF_ACCESS_CLIENT_ID');
  const secret = get('CF_ACCESS_CLIENT_SECRET');
  return id && secret ? { 'CF-Access-Client-Id': id, 'CF-Access-Client-Secret': secret } : null;
}

const stamp = () => new Date().toISOString().replace('T', ' ').slice(0, 19);

/** "Foundry ok, Dashboard FAIL (...)" for the start post. */
export function summarize(results) {
  return results
    .map(({ check, probe }) =>
      probe.ok ? `${check.label}: ok` : `${check.label}: NOT OK (${probe.error ?? 'no answer'})`
    )
    .join('\n');
}

/**
 * One round. `rt` holds the live state; returns nothing, pushes texts onto rt.pending and logs.
 * Everything the network does comes in through rt (`readOpen`, `probes`), so a test needs no network.
 * @param {{
 *   cfg: typeof DEFAULTS, mentions: string[], gate: {active:boolean, closedRun:number},
 *   states: Record<string, ReturnType<typeof initialState>>, pending: {text:string, at:number}[],
 *   always: boolean, checks: typeof CHECKS, readOpen: () => Promise<boolean|null>,
 *   probes: Record<string, () => Promise<{ok:boolean, ms:number, error?:string}>>,
 *   log: (m:string)=>void, now?: () => number }} rt
 */
export async function tick(rt) {
  const now = rt.now ?? Date.now;
  const open = rt.always ? true : await rt.readOpen();
  const gated = gateStep(rt.gate, open);
  rt.gate = gated.gate;
  const active = rt.gate.active;
  if (gated.event === 'ended') {
    rt.log('session ended: watch idle');
    rt.pending.push({ text: 'Game-night watch stopped: the session is marked ended.', at: now() });
    return;
  }
  if (!active) return;

  const enabled = rt.checks.filter(c => rt.probes[c.key]);
  const results = await Promise.all(
    enabled.map(async check => ({ check, probe: await rt.probes[check.key]() }))
  );
  if (gated.event === 'started') {
    rt.log('session open: watch started');
    for (const c of enabled) rt.states[c.key] = initialState();
    const off = rt.checks.filter(c => !rt.probes[c.key]).map(c => c.label);
    const text =
      `Game-night watch started. ${summarize(results)}` +
      (off.length ? `\nNot checked: ${off.join(', ')}.` : '');
    rt.pending.push({ text: scrubUrls(text), at: now() });
  }
  for (const { check, probe } of results) {
    const cfg = check.slow ? rt.cfg : { ...rt.cfg, slowMs: Infinity };
    const out = step(rt.states[check.key] ?? initialState(), probe, cfg);
    rt.states[check.key] = out.state;
    rt.log(
      `${check.key} ${probe.ok ? 'ok' : 'FAIL'} ${probe.ms} ms${probe.error ? ` (${probe.error})` : ''} -> ${out.state.mode}`
    );
    if (out.alert) {
      const text = scrubUrls(formatCheckAlert(check, out.alert, probe, cfg, rt.mentions));
      rt.log(`alert ${check.key} ${out.alert}`);
      rt.pending.push({ text, at: now() });
    }
  }
  return { failed: results.filter(r => !r.probe.ok).length };
}

async function main() {
  const args = parseArgs(process.argv.slice(2));
  // --env-file takes one file or several, comma separated; a later file wins over an earlier one.
  const fromFile = {};
  if (typeof args['env-file'] === 'string') {
    for (const f of args['env-file'].split(',').filter(Boolean)) {
      if (existsSync(f)) Object.assign(fromFile, parseEnv(readFileSync(f, 'utf8')));
    }
  }
  const get = key => [process.env[key], fromFile[key]].find(v => v);
  const num = (name, dflt) => {
    if (args[name] === undefined) return dflt;
    const v = Number(args[name]);
    if (!Number.isFinite(v) || v <= 0) throw new Error(`--${name} must be a positive number.`);
    return v;
  };
  const cfg = {
    intervalSec: num('interval', DEFAULTS.intervalSec),
    slowMs: num('slow-ms', DEFAULTS.slowMs),
    timeoutMs: num('timeout-ms', DEFAULTS.timeoutMs),
    failCount: num('fail', DEFAULTS.failCount),
    slowCount: num('slow', DEFAULTS.slowCount),
    recoverCount: num('recover', DEFAULTS.recoverCount),
  };
  const port = Number(get('WATCH_CONTROL_PORT') ?? 31414);
  if (!Number.isInteger(port) || port < 1 || port > 65535) {
    console.error('WATCH_CONTROL_PORT must be a port number.');
    process.exit(2);
  }
  const foundryUrl = safeUrl(get('WATCH_FOUNDRY_URL') ?? 'http://127.0.0.1:30000');
  const dashboardUrl = safeUrl(get('WATCH_DASHBOARD_URL') ?? 'http://127.0.0.1:3000');
  const publicRaw = get('WATCH_PUBLIC_URL');
  const publicUrl = publicRaw ? safeUrl(publicRaw) : null;
  const headers = accessHeaders(get);
  const recorderStatus = get('WATCH_RECORDER_STATUS_URL');
  const recorderStatusUrl = recorderStatus ? safeUrl(recorderStatus) : undefined;
  const unit = get('WATCH_RECORDER_UNIT') ?? 'foundry-ai-tool-discord-bot.service';
  const mentions = (get('GAMENIGHT_WATCH_MENTION_IDS') ?? '')
    .split(',')
    .map(s => s.trim())
    .filter(Boolean);

  // The public check needs both: an address and the token. Say what is off, once, in the log.
  /** @type {Record<string, () => Promise<{ok:boolean, ms:number, error?:string}>>} */
  const probes = {
    foundry: () => probeFoundry(foundryUrl, cfg.timeoutMs),
    dashboard: () => probeDashboard(dashboardUrl, cfg.timeoutMs),
    bridge: () => probeBridgeLink(port),
    recorder: () =>
      probeRecorder({ unit, statusUrl: recorderStatusUrl, timeoutMs: cfg.timeoutMs }),
  };
  if (publicUrl && headers) probes.public = () => probePublic(publicUrl, headers, cfg.timeoutMs);

  let target = null;
  if (args.post) {
    const token = get('DISCORD_TOKEN');
    const channelId = get('GAMENIGHT_WATCH_CHANNEL_ID');
    if (!token || !channelId) {
      console.error('--post needs DISCORD_TOKEN and GAMENIGHT_WATCH_CHANNEL_ID in the environment.');
      process.exit(2);
    }
    target = { token, channelId };
    const refused = await checkChannel(target);
    if (refused) {
      console.error(refused);
      process.exit(2);
    }
  }
  const log = m => console.log(`${stamp()} ${m}`);
  log(
    `watching ${new URL(foundryUrl).host} every ${cfg.intervalSec}s (${target ? 'posting to Discord' : 'dry run, log only'}); checks: ${Object.keys(probes).join(', ')}${publicUrl && !headers ? '; public check off: no Access token' : ''}${!publicUrl ? '; public check off: no address' : ''}`
  );

  const rt = {
    cfg,
    mentions,
    gate: { active: false, closedRun: 0 },
    states: {},
    pending: [],
    always: Boolean(args.always),
    checks: CHECKS,
    readOpen: () => readSessionOpen(port),
    probes,
    log,
  };
  let stopping = false;
  const stop = async () => {
    if (stopping) return;
    stopping = true;
    if (target && rt.gate.active) {
      rt.pending.push({ text: 'Game-night watch stopped: the service is stopping.', at: Date.now() });
      await flushPending(rt.pending, a => postToChannel(target, a.text), () => {}).catch(() => {});
    }
    process.exit(0);
  };
  process.on('SIGTERM', stop);
  process.on('SIGINT', stop);

  for (;;) {
    const round = await tick(rt);
    if (target && rt.pending.length > 0) {
      rt.pending = await flushPending(
        rt.pending,
        a => postToChannel(target, withLateNote(a)),
        m => console.error(`${stamp()} ${m}`)
      );
    }
    if (args.once) {
      // Exit 1 when a probe failed this round or a post is still unsent, so a stage check can tell.
      if ((round?.failed ?? 0) > 0 || (target && rt.pending.length > 0)) process.exitCode = 1;
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
    console.error(err instanceof Error ? scrubUrls(err.message) : 'failed');
    process.exit(1);
  });
}
