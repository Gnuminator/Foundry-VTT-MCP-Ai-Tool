// Shared by the hook tests' timing checks (guard-remote-commands, guard-shell-edits, warn-control-bytes).

/**
 * The fastest of up to three runs of `fn`, in ms, stopping early once a run is under `limitMs`. A
 * check that is really slow (the old regexes took 100 ms to 30 s) is slow on every run; a loaded
 * CPU (the ARM64 container suite under QEMU, a busy `npm run green`) only delays one of them, so
 * the best run measures the check and not the scheduler. A single timed run failed at 207 ms
 * against a 200 ms bound.
 */
export function bestMs(fn, limitMs) {
  let best = Infinity;
  for (let run = 0; run < 3 && best >= limitMs; run++) {
    const t = performance.now();
    fn();
    best = Math.min(best, performance.now() - t);
  }
  return best;
}
