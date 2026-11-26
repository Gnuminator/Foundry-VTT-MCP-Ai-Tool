// @ts-check
/**
 * Registers the repo's git merge drivers in the shared git config (`.gitattributes` names them).
 * Run by `npm ci`'s prepare step; quiet and harmless outside a git checkout. The config is shared
 * by every worktree of the clone, so lanes and the merge runner's gate checkout all get it.
 */
import { execFileSync } from 'node:child_process';

/** The driver names `.gitattributes` uses and the command each runs (cwd: the worktree root). */
export const DRIVERS = {
  'line-baseline': 'node scripts/merge-drivers/merge-drivers.mjs baseline %O %A %B',
  'generated-docs': 'node scripts/merge-drivers/merge-drivers.mjs generated %O %A %B',
};

export function install() {
  for (const [name, cmd] of Object.entries(DRIVERS)) {
    execFileSync('git', ['config', `merge.${name}.name`, `Foundry AI Tool ${name}`], {
      stdio: 'ignore',
    });
    execFileSync('git', ['config', `merge.${name}.driver`, cmd], { stdio: 'ignore' });
  }
}

try {
  install();
} catch {
  /* not a git checkout */
}
