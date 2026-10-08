// Reads the test server lock (<test env root>/lock.json), written only by scripts/test-env/lock.ps1.
//
//   readLock(testEnvRoot, { scriptPath, now }) ->
//     { state: 'no-script'|'free'|'held'|'unreadable', holder, session, since, purpose, old, queue }
//
// `old` (on the holder and each queue entry) marks an entry over 4 hours old: probably a crashed
// session (lock.ps1 take -Force takes over). A lock.json that cannot be read is 'unreadable', never
// 'free'.
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = path.resolve(HERE, '..', '..', 'test-env', 'lock.ps1');
const OLD_MS = 4 * 60 * 60 * 1000;

function isOld(since, nowMs) {
  const t = Date.parse(since || '');
  return Number.isFinite(t) && nowMs - t >= OLD_MS;
}

function text(v) {
  if (typeof v !== 'string' || v === '') return null;
  return v.length > 120 ? v.slice(0, 120) : v;
}

function entry(e, nowMs) {
  const o = e && typeof e === 'object' ? e : {};
  return {
    holder: text(o.holder),
    session: text(o.session),
    since: text(o.since),
    purpose: text(o.purpose),
    old: isOld(o.since, nowMs),
  };
}

export function readLock(testEnvRoot, { scriptPath = DEFAULT_SCRIPT, now = new Date() } = {}) {
  const nowMs = now.getTime();
  const empty = {
    state: 'free',
    holder: null,
    session: null,
    since: null,
    purpose: null,
    old: false,
    queue: [],
  };
  if (!fs.existsSync(scriptPath)) return { ...empty, state: 'no-script' };

  const file = path.join(testEnvRoot, 'lock.json');
  if (!fs.existsSync(file)) return empty;
  let data = null;
  try {
    // lock.ps1 writes UTF-8 without a BOM; strip one anyway.
    const parsed = JSON.parse(fs.readFileSync(file, 'utf8').replace(/^\uFEFF/, ''));
    if (parsed && typeof parsed === 'object' && !Array.isArray(parsed)) data = parsed;
  } catch {
    data = null;
  }
  if (!data) return { ...empty, state: 'unreadable' };

  const queue = Array.isArray(data.queue) ? data.queue.slice(0, 20).map(e => entry(e, nowMs)) : [];
  const holder = text(data.holder);
  if (holder === null) return { ...empty, queue };
  return {
    state: 'held',
    holder,
    session: text(data.session),
    since: text(data.since),
    purpose: text(data.purpose),
    old: isOld(data.since, nowMs),
    queue,
  };
}
