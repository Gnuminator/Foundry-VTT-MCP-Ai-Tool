// Runs `tsc --watch` for sync-module.ps1 -Watch and exits as soon as that pwsh is gone, so a hard
// kill of the watch (TaskStop, a closed window) never leaves a tsc behind that keeps rewriting dist/.
//
//   node tsc-watch-child.cjs <parent pid> <path to typescript/bin/tsc> <tsc args...>
const [parentPid, tscPath, ...args] = process.argv.slice(2);

setInterval(() => {
  try {
    process.kill(Number(parentPid), 0);
  } catch (err) {
    if (err.code === 'ESRCH') process.exit(0);
  }
}, 1000);

// tsc reads its arguments from process.argv.slice(2).
process.argv = [process.argv[0], tscPath, ...args];
require(tscPath);
