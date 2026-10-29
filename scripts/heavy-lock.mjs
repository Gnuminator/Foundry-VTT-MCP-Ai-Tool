#!/usr/bin/env node
/**
 * Heavy-check lock: a machine-wide (per Windows user) lock so that only a few heavy runs (a lint
 * pass, a vitest suite, a build) go at a time. `npm run green`, the pre-push hook, `lint:ratchet`
 * and the merge gate's drift check take it; the rest wait in line and print one line saying who
 * they wait for. Measured 2026-10-27: three lint-ratchet runs (1.2 to 2.9 GB each) plus two drift
 * checks took the 32 GB PC to 98% RAM and 80% CPU.
 *
 *   node scripts/heavy-lock.mjs run [--label NAME] [--priority high] -- COMMAND...
 *   node scripts/heavy-lock.mjs status        who holds the slots, who waits, the settings
 *
 * Design:
 * - A slot is a folder `slot-N` under `<tmp>/foundry-ai-heavy-lock` (mkdir is atomic) with an
 *   `owner.json` (pid, label, start; newer runs add since, beat, step, priority). A slot whose pid
 *   is dead, or whose `start` is older than 1 hour, is stale and taken over. A long holder (a whole
 *   green run) calls beat() between steps, which moves `start` on, so a run that keeps beating is
 *   never stale (an older copy of this file, still on some lane branches, reads `start` the same way).
 * - Waiters queue in order (FIFO): each writes a ticket under `queue/`, named so that the names sort
 *   by priority, then by arrival. Only the first live ticket may take a slot; a ticket whose pid is
 *   dead or that has not been touched for 5 minutes is dropped. The merge gate's drift check and the
 *   pre-push hook queue with priority `high`: they are short and someone is waiting on them.
 * - How many slots: HEAVY_LOCK_SLOTS, else `slots` in ~/.foundry-ai-tool/heavy-lock.json
 *   (HEAVY_LOCK_CONFIG moves it), else 3. The file is read on every poll, so a change applies to
 *   the next run and to runs already waiting, with no restart of Claude Desktop.
 * - Free RAM: the first slot is always free to take; another one only while the PC has `peakGb`
 *   free for each run that holds a slot, plus `minFreeGb` for everything else. Both can be set in
 *   the file (defaults below, from a measured green run).
 * - Re-entrant through the environment: the holder sets HEAVY_LOCK_HELD for its children, so
 *   `green` holding the lock for a step that runs `npm run lint:ratchet` does not wait on itself.
 * - It never blocks a run for ever: after 3 hours of waiting (HEAVY_LOCK_MAX_WAIT_MIN) the run
 *   goes on without the lock and says so. A lock problem (read-only tmp, say) also only prints a
 *   line and runs unlocked: the lock is a courtesy, never a gate.
 * - Each slot taken is logged as one JSON line in `admissions.jsonl` (wait, free RAM, slots), so the
 *   settings can be tuned from what happened.
 * - The merge gate runs main's copy of drift-check.mjs, which may not import other repo files, so
 *   drift-check calls this file through the CLI (`run`), not as a module.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELD_ENV = 'HEAVY_LOCK_HELD';
const STALE_MS = 60 * 60 * 1000;
/** Set once a run gave up waiting: the rest of that process then does not wait again. */
let gaveUp = false;
/** For tests: forget a give-up. */
export function resetGaveUp() {
  gaveUp = false;
}
const FRESH_SLOT_MS = 15 * 1000;
const POLL_MS = 1000;
const REMIND_MS = 60 * 1000;
/** A waiter touches its ticket this often; a ticket untouched for TICKET_STALE_MS is dropped. */
const TICKET_TOUCH_MS = 30 * 1000;
const TICKET_STALE_MS = 5 * 60 * 1000;
const GB = 2 ** 30;
// peakGb: one green alone peaked at 5.2 GB (the Playwright e2e step; lint-ratchet 3.3 GB), 2026-10-30.
export const DEFAULTS = { slots: 3, minFreeGb: 2, peakGb: 5, maxWaitMin: 180 };

/** @param {Record<string, string | undefined>} [env] */
export function lockDir(env = process.env) {
  return env.HEAVY_LOCK_DIR || path.join(os.tmpdir(), 'foundry-ai-heavy-lock');
}

/** @param {Record<string, string | undefined>} [env] */
export function configPath(env = process.env) {
  return env.HEAVY_LOCK_CONFIG || path.join(os.homedir(), '.foundry-ai-tool', 'heavy-lock.json');
}

/**
 * The settings for this poll: environment first, then the file, then the defaults. A bad value
 * falls through to the next source.
 * @param {Record<string, string | undefined>} [env]
 * @returns {{ slots: number, slotsFrom: 'env' | 'file' | 'default', minFreeGb: number, peakGb: number, maxWaitMin: number }}
 */
export function readConfig(env = process.env) {
  /** @type {Record<string, unknown>} */
  let file = {};
  try {
    const parsed = JSON.parse(fs.readFileSync(configPath(env), 'utf8'));
    if (parsed && typeof parsed === 'object') file = parsed;
  } catch {
    // No file, or not JSON: the defaults.
  }
  /** @param {unknown} v @param {number} min */
  const num = (v, min) => {
    if (v === undefined || v === null || v === '') return null;
    const n = Number(v);
    return Number.isFinite(n) && n >= min ? n : null;
  };
  /** @param {unknown} v */
  const int = v => {
    const n = num(v, 1);
    return n !== null && Number.isInteger(n) ? n : null;
  };
  const envSlots = int(env.HEAVY_LOCK_SLOTS);
  const fileSlots = int(file.slots);
  return {
    slots: envSlots ?? fileSlots ?? DEFAULTS.slots,
    slotsFrom: envSlots !== null ? 'env' : fileSlots !== null ? 'file' : 'default',
    minFreeGb: num(env.HEAVY_LOCK_MIN_FREE_GB, 0) ?? num(file.minFreeGb, 0) ?? DEFAULTS.minFreeGb,
    peakGb: num(file.peakGb, 0) ?? DEFAULTS.peakGb,
    maxWaitMin: num(env.HEAVY_LOCK_MAX_WAIT_MIN, 0) ?? num(file.maxWaitMin, 0) ?? DEFAULTS.maxWaitMin,
  };
}

/** @param {Record<string, string | undefined>} [env] */
export function slotCount(env = process.env) {
  return readConfig(env).slots;
}

/** @param {number} ms */
export function sleepSync(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/** @param {number} pid */
export function pidAlive(pid) {
  try {
    process.kill(pid, 0);
    return true;
  } catch (e) {
    return /** @type {NodeJS.ErrnoException} */ (e).code === 'EPERM';
  }
}

/**
 * @typedef {{ pid: number, label: string, start: number, since?: number, step?: string,
 *   priority?: string }} Owner
 */

/** @param {string} slot @returns {Owner | null} */
function readOwner(slot) {
  try {
    return JSON.parse(fs.readFileSync(path.join(slot, 'owner.json'), 'utf8'));
  } catch {
    return null;
  }
}

/**
 * Is this slot folder held by a live run? A stale one is removed.
 * @param {string} slot @param {number} now @param {(pid: number) => boolean} alive
 * @returns {Owner | 'unknown' | null} the owner, 'unknown' for a slot just created, null when free
 */
function inspectSlot(slot, now, alive) {
  const owner = readOwner(slot);
  if (!owner) {
    let age = Infinity;
    try {
      age = now - fs.statSync(slot).mtimeMs;
    } catch {
      return null;
    }
    if (age < FRESH_SLOT_MS) return 'unknown';
  } else if (alive(owner.pid) && now - owner.start < STALE_MS) {
    return owner;
  }
  // Another waiter may have taken the slot over between the read and now: look again before removing.
  const again = readOwner(slot);
  if ((again?.pid ?? null) !== (owner?.pid ?? null) || (again?.start ?? 0) !== (owner?.start ?? 0)) {
    return again ?? 'unknown';
  }
  fs.rmSync(slot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  return null;
}

/**
 * The slot folders that exist (also above the slot count, which may have been lowered while a run
 * held a high slot), each with its state.
 * @param {string} dir @param {number} now @param {(pid: number) => boolean} alive
 */
function slotStates(dir, now, alive) {
  /** @type {{ index: number, state: Owner | 'unknown' }[]} */
  const held = [];
  for (const name of fs.readdirSync(dir)) {
    const m = /^slot-(\d+)$/.exec(name);
    if (!m) continue;
    const state = inspectSlot(path.join(dir, name), now, alive);
    if (state) held.push({ index: Number(m[1]), state });
  }
  return held;
}

/** @param {'high' | 'normal' | undefined} priority */
function priorityDigit(priority) {
  return priority === 'high' ? '0' : '1';
}

/**
 * The live tickets in queue order (stale ones removed).
 * @param {string} qdir @param {number} now @param {(pid: number) => boolean} alive
 * @returns {string[]} ticket file names
 */
function liveTickets(qdir, now, alive) {
  const names = fs.readdirSync(qdir).filter(n => n.endsWith('.json')).sort();
  return names.filter(name => {
    const pid = Number(name.split('-')[2]);
    let mtime = 0;
    try {
      mtime = fs.statSync(path.join(qdir, name)).mtimeMs;
    } catch {
      return false;
    }
    if (alive(pid) && now - mtime < TICKET_STALE_MS) return true;
    fs.rmSync(path.join(qdir, name), { force: true });
    return false;
  });
}

/** @param {number} bytes */
const gb = bytes => (bytes / GB).toFixed(1);

/**
 * Take a slot, waiting in line while none may be taken. Returns a release function and a beat
 * function (call it between steps of a long hold); with the lock already held by a parent run
 * (HELD_ENV) or a lock problem both are no-ops.
 * @param {string} label
 * @param {{ env?: Record<string, string | undefined>, log?: (line: string) => void,
 *   sleep?: (ms: number) => void, now?: () => number, alive?: (pid: number) => boolean,
 *   freemem?: () => number, maxWaitMs?: number, priority?: 'high' | 'normal' }} [o]
 * @returns {{ release: () => void, beat: (step?: string) => void, waitedMs: number, held: boolean }}
 */
export function acquire(label, o = {}) {
  const {
    env = process.env,
    log = console.log,
    sleep = sleepSync,
    now = Date.now,
    alive = pidAlive,
    freemem = os.freemem,
    priority = 'normal',
  } = o;
  const noop = { release() {}, beat() {}, waitedMs: 0, held: false };
  // A parent run that holds the lock marks its children; a marker whose process is gone is ignored.
  const marker = Number(env[HELD_ENV]);
  if (marker && alive(marker)) return noop;
  const dir = lockDir(env);
  const qdir = path.join(dir, 'queue');
  const began = now();
  let lastRemind = 0;
  let ticket = '';
  const dropTicket = () => {
    if (ticket) fs.rmSync(ticket, { force: true });
    ticket = '';
  };
  try {
    fs.mkdirSync(qdir, { recursive: true });
    const name = `${priorityDigit(priority)}-${String(began).padStart(15, '0')}-${process.pid}-${Math.random().toString(36).slice(2, 8)}.json`;
    ticket = path.join(qdir, name);
    fs.writeFileSync(ticket, JSON.stringify({ pid: process.pid, label, since: began, priority }));
    process.once('exit', dropTicket);
    let lastTouch = began;
    for (;;) {
      const t = now();
      const cfg = readConfig(env);
      const maxWaitMs = gaveUp ? 0 : (o.maxWaitMs ?? cfg.maxWaitMin * 60 * 1000);
      const held = slotStates(dir, t, alive);
      const tickets = liveTickets(qdir, t, alive);
      const place = tickets.indexOf(name);
      const free = freemem();
      // Every holder keeps room for its expected peak: a green holds for its whole run and peaks late
      // (the test suites), so RAM free while it type-checks says little. Counting a holder that is
      // at its peak already errs on the safe side.
      const roomGb = free / GB - held.length * cfg.peakGb;
      const slotFree = held.length < cfg.slots;
      const ramOk = held.length === 0 || roomGb >= cfg.minFreeGb;
      // place < 0: the ticket went missing (cleared by hand, say); go on as if first in line.
      if ((place <= 0 || tickets.length === 0) && slotFree && ramOk) {
        const taken = new Set(held.map(h => h.index));
        for (let i = 0; i < cfg.slots; i++) {
          if (taken.has(i)) continue;
          const slot = path.join(dir, `slot-${i}`);
          try {
            fs.mkdirSync(slot);
          } catch {
            continue;
          }
          const start = now();
          /** @type {Owner} */
          const owner = { pid: process.pid, label, start, since: start, priority };
          fs.writeFileSync(path.join(slot, 'owner.json'), JSON.stringify(owner));
          dropTicket();
          process.off('exit', dropTicket);
          const waitedMs = start - began;
          logAdmission(dir, {
            at: new Date(start).toISOString(),
            label,
            priority,
            slot: i,
            waitedS: Math.round(waitedMs / 1000),
            freeGb: Number(gb(free)),
            inUse: held.length + 1,
            slots: cfg.slots,
            slotsFrom: cfg.slotsFrom,
          });
          let released = false;
          const release = () => {
            if (released) return;
            released = true;
            process.off('exit', release);
            try {
              const current = readOwner(slot);
              if (current && current.pid === process.pid) {
                fs.rmSync(slot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
              }
            } catch {
              // The next run treats a leftover as stale once the pid is gone.
            }
          };
          /** @param {string} [step] */
          const beat = step => {
            if (released) return;
            try {
              const current = readOwner(slot);
              if (!current || current.pid !== process.pid) return;
              const next = { ...current, start: now(), ...(step ? { step } : {}) };
              fs.writeFileSync(path.join(slot, 'owner.json'), JSON.stringify(next));
            } catch {
              // A missed beat only matters after an hour without one.
            }
          };
          process.once('exit', release);
          if (lastRemind > 0) {
            log(`heavy-lock: got the lock after ${Math.round(waitedMs / 1000)} s (${label}; slot ${i + 1} of ${cfg.slots}, ${gb(free)} GB free)`);
          }
          return { release, beat, waitedMs, held: true };
        }
      }
      const waited = t - began;
      if (waited >= maxWaitMs) {
        log(`heavy-lock: waited ${Math.round(waited / 60000)} min, going on without the lock (${label})`);
        gaveUp = true;
        dropTicket();
        return noop;
      }
      if (lastRemind === 0 || t - lastRemind >= REMIND_MS) {
        const first = held.find(h => h.state !== 'unknown')?.state;
        const who =
          first && first !== 'unknown'
            ? `${first.label}${first.step ? ` (${first.step})` : ''} (pid ${first.pid}, running ${Math.round((t - (first.since ?? first.start)) / 1000)} s)`
            : 'another heavy run';
        const why = !slotFree
          ? `${held.length} of ${cfg.slots} slots in use (slots from ${cfg.slotsFrom})`
          : !ramOk
            ? `${gb(free)} GB free, another run needs ${held.length * cfg.peakGb + cfg.minFreeGb} GB`
            : 'runs ahead in line';
        log(`heavy-lock: ${label} waits for ${who}; number ${Math.max(place, 0) + 1} in line, ${why}`);
        lastRemind = t;
      }
      if (t - lastTouch >= TICKET_TOUCH_MS) {
        const d = new Date(t);
        fs.utimesSync(ticket, d, d);
        lastTouch = t;
      }
      sleep(POLL_MS);
    }
  } catch (e) {
    dropTicket();
    log(`heavy-lock: lock unavailable (${/** @type {Error} */ (e).message}), running without it`);
    return noop;
  }
}

/** Append one admission to the log; the log is cut back when it passes 1 MB. @param {string} dir @param {object} entry */
function logAdmission(dir, entry) {
  const file = path.join(dir, 'admissions.jsonl');
  try {
    if (fs.statSync(file).size > 1024 * 1024) fs.renameSync(file, `${file}.old`);
  } catch {
    // No log yet.
  }
  try {
    fs.appendFileSync(file, `${JSON.stringify(entry)}\n`);
  } catch {
    // The log is for tuning only.
  }
}

/**
 * Run fn under the lock; children of fn see HELD_ENV and do not take it again. fn gets the beat
 * function, for a long hold.
 * @template T
 * @param {string} label @param {(beat: (step?: string) => void) => T} fn @param {Parameters<typeof acquire>[1]} [o]
 * @returns {T}
 */
export function withHeavyLock(label, fn, o = {}) {
  const env = o.env ?? process.env;
  const lock = acquire(label, o);
  const had = env[HELD_ENV];
  if (lock.held) env[HELD_ENV] = String(process.pid);
  try {
    return fn(lock.beat);
  } finally {
    if (lock.held) {
      if (had === undefined) delete env[HELD_ENV];
      else env[HELD_ENV] = had;
    }
    lock.release();
  }
}

/**
 * @param {Record<string, string | undefined>} [env]
 * @param {number} [now] @param {(pid: number) => boolean} [alive] @param {() => number} [freemem]
 */
export function status(env = process.env, now = Date.now(), alive = pidAlive, freemem = os.freemem) {
  const dir = lockDir(env);
  const cfg = readConfig(env);
  const lines = [
    `settings: ${cfg.slots} slots (from ${cfg.slotsFrom === 'file' ? configPath(env) : cfg.slotsFrom}), another run needs ${cfg.peakGb} GB per running one plus ${cfg.minFreeGb} GB free, ${gb(freemem())} GB free now`,
  ];
  /** @type {Map<number, Owner>} */
  const owners = new Map();
  let names = [];
  try {
    names = fs.readdirSync(dir);
  } catch {
    // No lock folder yet: every slot is free.
  }
  for (const name of names) {
    const m = /^slot-(\d+)$/.exec(name);
    const owner = m ? readOwner(path.join(dir, name)) : null;
    if (m && owner && alive(owner.pid)) owners.set(Number(m[1]), owner);
  }
  const top = Math.max(cfg.slots, ...[...owners.keys()].map(i => i + 1));
  for (let i = 0; i < top; i++) {
    const owner = owners.get(i);
    lines.push(
      owner
        ? `slot-${i}: ${owner.label}${owner.step ? ` (${owner.step})` : ''} (pid ${owner.pid}, ${Math.round((now - (owner.since ?? owner.start)) / 1000)} s)`
        : `slot-${i}: free`
    );
  }
  let tickets = [];
  try {
    tickets = fs.readdirSync(path.join(dir, 'queue')).filter(n => n.endsWith('.json')).sort();
  } catch {
    // Nobody waits.
  }
  tickets.forEach((name, n) => {
    try {
      const t = JSON.parse(fs.readFileSync(path.join(dir, 'queue', name), 'utf8'));
      if (alive(t.pid)) lines.push(`waiting ${n + 1}: ${t.label} (pid ${t.pid}, ${Math.round((now - t.since) / 1000)} s${name.startsWith('0-') ? ', high priority' : ''})`);
    } catch {
      // A ticket that went away while listing.
    }
  });
  return lines;
}

/** @param {string[]} argv @returns {number} */
export function main(argv) {
  const [cmd, ...rest] = argv;
  if (cmd === 'status') {
    for (const line of status()) console.log(line);
    return 0;
  }
  const dash = rest.indexOf('--');
  if (cmd !== 'run' || dash < 0 || dash === rest.length - 1) {
    console.error('usage: heavy-lock.mjs run [--label NAME] [--priority high] -- COMMAND...  |  heavy-lock.mjs status');
    return 2;
  }
  const li = rest.indexOf('--label');
  const pi = rest.indexOf('--priority');
  const command = rest.slice(dash + 1);
  const label = li >= 0 && li < dash ? rest[li + 1] : command.slice(0, 3).join(' ');
  const priority = pi >= 0 && pi < dash && rest[pi + 1] === 'high' ? 'high' : 'normal';
  return withHeavyLock(
    label,
    () => {
      const r = spawnSync(command.join(' '), { shell: true, stdio: 'inherit', env: process.env });
      return r.status ?? (r.signal ? 130 : 1);
    },
    { priority }
  );
}

/**
 * Is this module the script node was started with? Real paths on both sides, so a junction or a
 * drive-letter case cannot turn into a silent exit 0 (as green.mjs isEntryModule; not imported,
 * because green imports this file).
 * @param {string | undefined} argv1 @param {string} self
 */
export function isEntryModule(argv1, self) {
  if (!argv1) return false;
  const norm = (/** @type {string} */ p) => {
    let r;
    try {
      r = fs.realpathSync(p);
    } catch {
      r = path.resolve(p);
    }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(argv1) === norm(self);
}

const self = fileURLToPath(import.meta.url);
if (isEntryModule(process.argv[1], self)) {
  // Ctrl+C reaches the child too; staying alive lets the lock be released and the code passed on.
  process.on('SIGINT', () => {});
  process.exit(main(process.argv.slice(2)));
} else if (process.argv[1] && path.basename(process.argv[1]).toLowerCase() === path.basename(self).toLowerCase()) {
  console.error(`heavy-lock: started as ${process.argv[1]} but this module is ${self}`);
  process.exit(1);
}
