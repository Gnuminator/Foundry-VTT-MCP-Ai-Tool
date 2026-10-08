// The server's background work, every 5 minutes whether the page is open or not: one scan that
// updates the measured Usage rows, the versions refresh when it is due (four times a day), and
// the vault push of the two Usage notes (at most hourly, only when the vault is clean).
//
//   runHousekeeping({ paths, forcePush }) -> the push state { state, detail, at }
//   startHousekeeping({ paths }) -> { stop }
//
// One run at a time per data folder (`housekeeping.lock`), so `--usage-log` while the server
// runs cannot overwrite the other run's push bookkeeping. A lock older than 10 minutes is left
// over from a crash and is taken over.
import fs from 'node:fs';
import path from 'node:path';
import { buildSnapshot } from './snapshot.mjs';
import { loadUsageState, saveUsageState, syncUsageToVault } from './usage-log.mjs';

export const TICK_MS = 5 * 60 * 1000;
const STALE_LOCK_MS = 10 * 60 * 1000;

function takeLock(dataDir, nowMs) {
  fs.mkdirSync(dataDir, { recursive: true });
  const file = path.join(dataDir, 'housekeeping.lock');
  for (let attempt = 0; attempt < 2; attempt += 1) {
    try {
      fs.writeFileSync(file, String(process.pid), { flag: 'wx' });
      return () => fs.rmSync(file, { force: true });
    } catch (err) {
      if (err?.code !== 'EEXIST') throw err;
      let age = 0;
      try {
        age = nowMs - fs.statSync(file).mtimeMs;
      } catch {
        continue; // released meanwhile
      }
      if (age < STALE_LOCK_MS) return null;
      fs.rmSync(file, { force: true });
    }
  }
  return null;
}

export async function runHousekeeping({ paths, forcePush = false, deps = {} }) {
  const release = takeLock(paths.dataDir, Date.now());
  if (!release)
    return {
      state: 'waiting',
      detail: 'another housekeeping run is busy',
      at: new Date().toISOString(),
    };
  try {
    await (deps.buildSnapshot || buildSnapshot)({
      paths,
      force: true,
      withVersions: true,
      updateUsage: true,
    });
    const state = loadUsageState(paths.dataDir);
    await (deps.syncUsageToVault || syncUsageToVault)({
      state,
      vaultDir: paths.vaultDir,
      now: new Date(),
      force: forcePush,
    });
    saveUsageState(paths.dataDir, state);
    return state.push;
  } finally {
    release();
  }
}

export function startHousekeeping({ paths, intervalMs = TICK_MS, log = console.log }) {
  let running = false;
  let lastAt = null;
  const startedMs = Date.now();
  const tick = async () => {
    if (running) return;
    running = true;
    try {
      const push = await runHousekeeping({ paths });
      // Log only attempts made by this server run, once each (the state keeps older ones).
      const atMs = Date.parse(push?.at ?? '');
      if (push && push.at !== lastAt && atMs >= startedMs - 1000)
        log(`Usage notes: ${push.state} (${push.detail})`);
      lastAt = push?.at ?? null;
    } catch (err) {
      log(`Housekeeping failed: ${String(err?.message || err).slice(0, 150)}`);
    } finally {
      running = false;
    }
  };
  tick();
  const timer = setInterval(tick, intervalMs);
  timer.unref?.();
  return { stop: () => clearInterval(timer) };
}
