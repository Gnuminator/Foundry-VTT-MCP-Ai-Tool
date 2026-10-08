// Reads the test server lock (<test env root>/lock.json), written only by scripts/test-env/lock.ps1.
//
//   readLock(testEnvRoot, { scriptPath }) -> { state: 'no-script'|'free'|'held', holder, session, since, purpose, queue }
import fs from 'node:fs';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const HERE = path.dirname(fileURLToPath(import.meta.url));
const DEFAULT_SCRIPT = path.resolve(HERE, '..', '..', 'test-env', 'lock.ps1');

function text(v) {
  if (typeof v !== 'string' || v === '') return null;
  return v.length > 120 ? v.slice(0, 120) : v;
}

function entry(e) {
  const o = e && typeof e === 'object' ? e : {};
  return {
    holder: text(o.holder),
    session: text(o.session),
    since: text(o.since),
    purpose: text(o.purpose),
  };
}

export function readLock(testEnvRoot, { scriptPath = DEFAULT_SCRIPT } = {}) {
  const empty = {
    state: 'free',
    holder: null,
    session: null,
    since: null,
    purpose: null,
    queue: [],
  };
  if (!fs.existsSync(scriptPath)) return { ...empty, state: 'no-script' };

  let data = null;
  try {
    const parsed = JSON.parse(fs.readFileSync(path.join(testEnvRoot, 'lock.json'), 'utf8'));
    if (parsed && typeof parsed === 'object') data = parsed;
  } catch {
    data = null;
  }
  if (!data) return empty;

  const queue = Array.isArray(data.queue) ? data.queue.slice(0, 20).map(entry) : [];
  const holder = text(data.holder);
  if (holder === null) return { ...empty, queue };
  return {
    state: 'held',
    holder,
    session: text(data.session),
    since: text(data.since),
    purpose: text(data.purpose),
    queue,
  };
}
