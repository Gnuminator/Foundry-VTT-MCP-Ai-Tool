#!/usr/bin/env node
/**
 * Heavy-check lock: a machine-wide (per Windows user) lock so that at most one heavy run (a lint
 * pass, a vitest suite, a build) goes at a time. `npm run green`, the pre-push hook, `lint:ratchet`
 * and the merge gate's drift check each take it around their heavy steps; the rest wait and print
 * one line saying who they wait for. Measured 2026-10-27: three lint-ratchet runs (1.2 to 2.9 GB
 * each) plus two drift checks took the 32 GB PC to 98% RAM and 80% CPU.
 *
 *   node scripts/heavy-lock.mjs run [--label NAME] -- COMMAND...   run COMMAND under the lock
 *   node scripts/heavy-lock.mjs status                             print who holds the slots
 *
 * Design:
 * - A slot is a folder `slot-N` under `<tmp>/foundry-ai-heavy-lock` (mkdir is atomic) with an
 *   `owner.json` (pid, label, start). A slot whose pid is dead, or older than 3 hours, is stale and
 *   taken over. HEAVY_LOCK_SLOTS sets how many slots there are (default 1).
 * - Re-entrant through the environment: the holder sets HEAVY_LOCK_HELD for its children, so
 *   `green` holding the lock for a step that runs `npm run lint:ratchet` does not wait on itself.
 * - It never blocks a run for ever: after 60 minutes of waiting (HEAVY_LOCK_MAX_WAIT_MIN) the run
 *   goes on without the lock and says so. A lock problem (read-only tmp, say) also only prints a
 *   line and runs unlocked: the lock is a courtesy, never a gate.
 * - The merge gate runs main's copy of drift-check.mjs, which may not import other repo files, so
 *   drift-check calls this file through the CLI (`run`), not as a module.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

export const HELD_ENV = 'HEAVY_LOCK_HELD';
const STALE_MS = 3 * 60 * 60 * 1000;
const FRESH_SLOT_MS = 15 * 1000;
const POLL_MS = 1000;
const REMIND_MS = 60 * 1000;

/** @param {Record<string, string | undefined>} [env] */
export function lockDir(env = process.env) {
  return env.HEAVY_LOCK_DIR || path.join(os.tmpdir(), 'foundry-ai-heavy-lock');
}

/** @param {Record<string, string | undefined>} [env] */
export function slotCount(env = process.env) {
  const n = Number(env.HEAVY_LOCK_SLOTS);
  return Number.isInteger(n) && n >= 1 ? n : 1;
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

/** @typedef {{ pid: number, label: string, start: number }} Owner */

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
  fs.rmSync(slot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
  return null;
}

/**
 * Take a slot, waiting while all are held. Returns a release function; with the lock already held
 * by a parent run (HELD_ENV) or a lock problem it returns a no-op.
 * @param {string} label
 * @param {{ env?: Record<string, string | undefined>, log?: (line: string) => void,
 *   sleep?: (ms: number) => void, now?: () => number, alive?: (pid: number) => boolean,
 *   maxWaitMs?: number }} [o]
 * @returns {{ release: () => void, waitedMs: number, held: boolean }}
 */
export function acquire(label, o = {}) {
  const {
    env = process.env,
    log = console.log,
    sleep = sleepSync,
    now = Date.now,
    alive = pidAlive,
  } = o;
  const maxWaitMs = o.maxWaitMs ?? (Number(env.HEAVY_LOCK_MAX_WAIT_MIN) || 60) * 60 * 1000;
  const noop = { release() {}, waitedMs: 0, held: false };
  if (env[HELD_ENV]) return noop;
  const dir = lockDir(env);
  const slots = slotCount(env);
  const began = now();
  let lastRemind = 0;
  try {
    fs.mkdirSync(dir, { recursive: true });
    for (;;) {
      /** @type {Owner | 'unknown' | null} */
      let blocker = null;
      for (let i = 0; i < slots; i++) {
        const slot = path.join(dir, `slot-${i}`);
        const state = inspectSlot(slot, now(), alive);
        if (state) {
          blocker ??= state;
          continue;
        }
        try {
          fs.mkdirSync(slot);
        } catch {
          blocker ??= 'unknown';
          continue;
        }
        fs.writeFileSync(
          path.join(slot, 'owner.json'),
          JSON.stringify({ pid: process.pid, label, start: now() })
        );
        let released = false;
        const release = () => {
          if (released) return;
          released = true;
          try {
            const owner = readOwner(slot);
            if (owner && owner.pid === process.pid) {
              fs.rmSync(slot, { recursive: true, force: true, maxRetries: 5, retryDelay: 50 });
            }
          } catch {
            // The next run treats a leftover as stale once the pid is gone.
          }
        };
        process.once('exit', release);
        const waitedMs = now() - began;
        if (lastRemind > 0) log(`heavy-lock: got the lock after ${Math.round(waitedMs / 1000)} s (${label})`);
        return { release, waitedMs, held: true };
      }
      const waited = now() - began;
      if (waited >= maxWaitMs) {
        log(`heavy-lock: waited ${Math.round(waited / 60000)} min, going on without the lock (${label})`);
        return noop;
      }
      if (lastRemind === 0 || now() - lastRemind >= REMIND_MS) {
        const who =
          blocker && blocker !== 'unknown'
            ? `${blocker.label} (pid ${blocker.pid}, running ${Math.round((now() - blocker.start) / 1000)} s)`
            : 'another heavy run';
        log(`heavy-lock: ${label} waits for ${who}; one heavy run at a time to spare RAM`);
        lastRemind = now();
      }
      sleep(POLL_MS);
    }
  } catch (e) {
    log(`heavy-lock: lock unavailable (${/** @type {Error} */ (e).message}), running without it`);
    return noop;
  }
}

/**
 * Run fn under the lock; children of fn see HELD_ENV and do not take it again.
 * @template T
 * @param {string} label @param {() => T} fn @param {Parameters<typeof acquire>[1]} [o]
 * @returns {T}
 */
export function withHeavyLock(label, fn, o = {}) {
  const env = o.env ?? process.env;
  const lock = acquire(label, o);
  const had = env[HELD_ENV];
  if (lock.held) env[HELD_ENV] = String(process.pid);
  try {
    return fn();
  } finally {
    if (lock.held) {
      if (had === undefined) delete env[HELD_ENV];
      else env[HELD_ENV] = had;
    }
    lock.release();
  }
}

/** @param {Record<string, string | undefined>} [env] */
export function status(env = process.env, now = Date.now(), alive = pidAlive) {
  const dir = lockDir(env);
  const lines = [];
  for (let i = 0; i < slotCount(env); i++) {
    const owner = readOwner(path.join(dir, `slot-${i}`));
    lines.push(
      owner && alive(owner.pid)
        ? `slot-${i}: ${owner.label} (pid ${owner.pid}, ${Math.round((now - owner.start) / 1000)} s)`
        : `slot-${i}: free`
    );
  }
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
    console.error('usage: heavy-lock.mjs run [--label NAME] -- COMMAND...  |  heavy-lock.mjs status');
    return 2;
  }
  const li = rest.indexOf('--label');
  const command = rest.slice(dash + 1);
  const label = li >= 0 && li < dash ? rest[li + 1] : command.slice(0, 3).join(' ');
  return withHeavyLock(label, () => {
    const r = spawnSync(command.join(' '), { shell: true, stdio: 'inherit', env: process.env });
    return r.status ?? 1;
  });
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main(process.argv.slice(2)));
}
