// The server's background work, every 5 minutes whether the page is open or not: one scan that
// updates the measured Usage rows, the versions refresh when it is due (four times a day), and
// the vault push of the two Usage notes (at most hourly, only when the vault is clean).
//
//   runHousekeeping({ paths, forcePush }) -> the push state { state, detail, at }
//   startHousekeeping({ paths }) -> { stop }
import { buildSnapshot } from './snapshot.mjs';
import { loadUsageState, saveUsageState, syncUsageToVault } from './usage-log.mjs';

export const TICK_MS = 5 * 60 * 1000;

export async function runHousekeeping({ paths, forcePush = false, deps = {} }) {
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
