// Session-notes watchdog (D-102): warns when a play-session recording has no notes run within 24 hours.
// Reads the sessions folder written by tools/session-notes (recordings are <date>_<time>-discord).
//
//   sessionsDirFrom(env) -> folder path (FVTT_SESSIONS_DIR or ~/Documents/FoundrySessions)
//   readWatchdog({ dir, now, limit }) -> { dir, state, lastPass, items: [{ name, state, finishedAt }] }
//   watchdogWarning(w) -> one warning line or null
//
// Only file existence, modified times, the `event` key of audit lines and whether notes.json has a
// `session` object are read. No campaign text ever reaches the result.
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const DAY_MS = 24 * 60 * 60 * 1000;
const AUDIO = /\.(ogg|oga|opus|flac|wav|mp3|m4a)$/i;
const AUDIT_TAIL_BYTES = 64 * 1024;

export function sessionsDirFrom(env = process.env) {
  return env.FVTT_SESSIONS_DIR || path.join(os.homedir(), 'Documents', 'FoundrySessions');
}

function clip(s) {
  return String(s).slice(0, 200);
}

function mtimeMs(file) {
  try {
    return fs.statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function isoOrNull(ms) {
  return ms === null ? null : new Date(ms).toISOString();
}

function hasAudio(folder) {
  try {
    const entries = fs.readdirSync(folder, { withFileTypes: true });
    return entries.some(e => e.isFile() && AUDIO.test(e.name));
  } catch {
    return false;
  }
}

function notesDone(folder) {
  try {
    const data = JSON.parse(fs.readFileSync(path.join(folder, 'notes', 'notes.json'), 'utf8'));
    return !!data && typeof data.session === 'object' && data.session !== null;
  } catch {
    return false;
  }
}

// The `event` of the last readable audit line, from the last 64 KB of the file only.
function lastAuditEvent(folder) {
  let fd = null;
  try {
    fd = fs.openSync(path.join(folder, 'notes', 'audit.jsonl'), 'r');
    const size = fs.fstatSync(fd).size;
    const start = Math.max(0, size - AUDIT_TAIL_BYTES);
    const buf = Buffer.alloc(size - start);
    fs.readSync(fd, buf, 0, buf.length, start);
    const lines = buf.toString('utf8').split('\n');
    if (start > 0) lines.shift();
    for (let i = lines.length - 1; i >= 0; i--) {
      try {
        const event = JSON.parse(lines[i])?.event;
        if (typeof event === 'string') return event;
      } catch {
        // a broken or cut-off line is skipped
      }
    }
    return null;
  } catch {
    return null;
  } finally {
    if (fd !== null) {
      try {
        fs.closeSync(fd);
      } catch {
        // nothing to do
      }
    }
  }
}

function itemFor(dir, name, nowMs) {
  const folder = path.join(dir, name);
  const finishedMs = mtimeMs(path.join(folder, 'raw', 'session.json'));
  const finishedAt = isoOrNull(finishedMs);
  const item = state => ({ name: clip(name), state, finishedAt });
  if (finishedMs === null) return item('recording');
  if (!hasAudio(folder)) return item('empty');
  if (notesDone(folder)) return item('done');
  if (lastAuditEvent(folder) === 'paused') return item('paused');
  return item(nowMs - finishedMs >= DAY_MS ? 'missed' : 'waiting');
}

export function readWatchdog({ dir, now = new Date(), limit = 10 } = {}) {
  const out = { dir: clip(dir ?? ''), state: 'no-folder', lastPass: null, items: [] };
  let names;
  try {
    names = fs
      .readdirSync(dir, { withFileTypes: true })
      .filter(e => e.isDirectory() && e.name.endsWith('-discord'))
      .map(e => e.name);
  } catch {
    return out;
  }
  out.lastPass = isoOrNull(mtimeMs(path.join(dir, 'auto.log')));
  if (names.length === 0) return { ...out, state: 'no-recordings' };

  const nowMs = now.getTime();
  const all = names
    .sort()
    .reverse()
    .map(name => itemFor(dir, name, nowMs));
  const has = state => all.some(i => i.state === state);
  let state = 'ok';
  if (has('missed')) state = 'missed';
  else if (has('paused')) state = 'paused';
  else if (has('waiting')) state = 'waiting';
  return { ...out, state, items: all.slice(0, Math.max(0, limit)) };
}

export function watchdogWarning(w) {
  const items = Array.isArray(w?.items) ? w.items : [];
  if (w?.state === 'missed') {
    const missed = items.filter(i => i.state === 'missed');
    const more = missed.length > 1 ? ` and ${missed.length - 1} more` : '';
    const name = missed[0]?.name ?? 'a recording';
    return `session notes missed for ${name}${more} (no run within 24 h)`;
  }
  if (w?.state === 'paused') {
    const name = items.find(i => i.state === 'paused')?.name ?? 'a recording';
    return `session notes paused on the usage limit for ${name}`;
  }
  return null;
}
