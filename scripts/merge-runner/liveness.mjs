/**
 * Merge runner liveness: a heartbeat file beside the lock (~/.foundry-ai-tool/merge-runner.heartbeat.json)
 * that the runner rewrites every minute while it lives (a gate run can take half an hour, so a per-round
 * write would look dead) and once more on exit with the reason. `runnerLivenessLine` turns the lock,
 * the heartbeat and the clock into one alert line, or null when the runner is fine. Used by
 * `backlog.mjs status --planner` and the start hook (.claude/hooks/start-alerts.mjs).
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

export const HEARTBEAT_EVERY_MS = 60_000;
export const HEARTBEAT_STALE_MS = 15 * 60 * 1000;

/** @param {string} [home] */
export function runnerFiles(home = path.join(os.homedir(), '.foundry-ai-tool')) {
  return {
    lock: path.join(home, 'merge-runner.lock'),
    heartbeat: path.join(home, 'merge-runner.heartbeat.json'),
  };
}

/**
 * @param {string} file @param {{ pid: number, exit?: string, exitPost?: string }} o @param {number} [nowMs]
 */
export function writeHeartbeat(file, o, nowMs = Date.now()) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(
      file,
      JSON.stringify({
        pid: o.pid,
        at: nowMs,
        ...(o.exit ? { exit: o.exit } : {}),
        ...(o.exitPost ? { exitPost: o.exitPost } : {}),
      })
    );
  } catch {
    // liveness is information only; never stop the runner for it
  }
}

/**
 * The runner's side: read the previous heartbeat, wrap `post` so a repeated identical exit post
 * (a repeat trigger restarting a runner that stopped on a red main) reaches Discord once, and
 * beat every `everyMs` until `stop(exit)` writes the exit line.
 * The exit reason is the runner's last "exiting: <why>" log line (a clean --once end says so; no such
 * line means it crashed).
 * @template {{ post: (t: string) => void, log: (t: string) => void }} D
 * @param {string} lockFile the runner lock; the heartbeat file lies beside it
 * @param {D} base @param {boolean} once @param {number} [everyMs]
 */
export function startLiveness(lockFile, base, once, everyMs = HEARTBEAT_EVERY_MS) {
  const file = runnerFiles(path.dirname(lockFile)).heartbeat;
  const prev = readJson(file);
  let lastPost = '';
  let exit = once ? 'finished (--once)' : 'crashed';
  const beat = () => writeHeartbeat(file, { pid: process.pid });
  beat();
  const timer = setInterval(beat, everyMs);
  timer.unref();
  const deps = {
    ...base,
    post: (/** @type {string} */ t) => {
      lastPost = t;
      if (prev?.exitPost !== t) base.post(t);
    },
    log: (/** @type {string} */ t) => {
      if (t.startsWith('exiting: ')) exit = t.slice(9);
      base.log(t);
    },
  };
  return {
    deps,
    stop: () => {
      clearInterval(timer);
      writeHeartbeat(file, { pid: process.pid, exit, exitPost: lastPost });
    },
  };
}

/** @param {string} file */
function readJson(file) {
  try {
    return JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch {
    return null;
  }
}

/** @param {number} ms */
function ago(ms) {
  const m = Math.round(ms / 60_000);
  return m < 90 ? `${m} min` : `${Math.round(m / 60)} h`;
}

const RESTART = "Start-ScheduledTask -TaskName 'Foundry AI Tool merge runner'";

/**
 * @param {{ lockFile: string, heartbeatFile: string, nowMs?: number, isRunner?: (pid: number) => boolean }} o
 * @returns {string | null} one line, or null when the runner looks alive
 */
export function runnerLivenessLine(o) {
  const nowMs = o.nowMs ?? Date.now();
  const hb = readJson(o.heartbeatFile);
  const hbAge = typeof hb?.at === 'number' ? nowMs - hb.at : null;
  let pid = null;
  try {
    const n = Number(fs.readFileSync(o.lockFile, 'utf8').trim());
    if (Number.isInteger(n) && n > 0) pid = n;
  } catch {
    // no lock
  }
  const alive = pid !== null && (o.isRunner ?? (() => true))(pid);
  if (!alive) {
    const when = hbAge === null ? 'unknown time' : `${ago(hbAge)} ago`;
    if (typeof hb?.exit === 'string' && /main (is|went) red/.test(hb.exit)) {
      return `Merge runner stopped on a red main (${hb.exit}, ${when}); the scheduled task starts it again once main is green, or run ${RESTART}`;
    }
    const last = hbAge === null ? 'no heartbeat' : `last heartbeat ${when}`;
    const why = typeof hb?.exit === 'string' ? `, last exit: ${hb.exit}` : '';
    return `Merge runner is not running (${last}${why}); run ${RESTART}`;
  }
  if (hbAge === null || hbAge > HEARTBEAT_STALE_MS) {
    return `Merge runner (pid ${pid}) looks stuck: ${hbAge === null ? 'no heartbeat' : `heartbeat ${ago(hbAge)} old`}; check merge-runner.log`;
  }
  return null;
}
