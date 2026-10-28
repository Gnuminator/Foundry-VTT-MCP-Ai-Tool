#!/usr/bin/env node
/**
 * The git pre-push hook (.husky/pre-push): runs the fast CI guards locally, so a +1 lint warning,
 * a new em dash or a type error is refused here with CI's own message, not after a CI run.
 *
 * Skipped when `npm run green` passed on exactly this tree (it records the tree hash in
 * `.git/green-ok`, see greenPassedOnThisTree in green.mjs). `SKIP_PREPUSH=1 git push ...` skips it by hand.
 * Measured on the user's PC: lint:ratchet 45 s, emdash:ratchet 1 s, typecheck 14 s.
 */
import { spawnSync } from 'node:child_process';
import { fileURLToPath } from 'node:url';
import {
  greenPassedOnThisTree,
  isEntryModule,
  portableNode22Dir,
  stepEnvironment,
} from './green.mjs';
import { withHeavyLock } from './heavy-lock.mjs';

/** The checks, in the order of the CI job. */
export const CHECKS = [
  { name: 'lint:ratchet', args: ['run', 'lint:ratchet'] },
  { name: 'emdash:ratchet', args: ['run', 'emdash:ratchet'] },
  { name: 'typecheck', args: ['run', 'typecheck'] },
];

/**
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, log?: (line: string) => void,
 *   passedGreen?: (cwd: string) => boolean,
 *   runCheck?: (check: { name: string, args: string[] }, cwd: string) => number }} [o]
 * @returns {number} the process exit code
 */
export function main(o = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    log = console.log,
    passedGreen = greenPassedOnThisTree,
    runCheck = defaultRunCheck,
  } = o;
  if (env.SKIP_PREPUSH === '1') {
    log('pre-push: skipped (SKIP_PREPUSH=1)');
    return 0;
  }
  if (passedGreen(cwd)) {
    log('pre-push: skipped, npm run green passed on this tree');
    return 0;
  }
  for (const check of CHECKS) {
    if (runCheck(check, cwd) !== 0) {
      log(
        `pre-push: ${check.name} failed, push refused (npm run green on the final commit runs everything CI runs)`
      );
      return 1;
    }
  }
  log('pre-push: OK, lint, em dash and type checks pass');
  return 0;
}

/** @param {{ name: string, args: string[] }} check @param {string} cwd */
function defaultRunCheck(check, cwd) {
  // One command string under the shell (an args array under a shell is DEP0190), as green.mjs does.
  const run = () => {
    const r = spawnSync(['npm', ...check.args].join(' '), {
      cwd,
      shell: true,
      stdio: 'inherit',
      env: stepEnvironment(process.env, portableNode22Dir()),
    });
    return r.status ?? 1;
  };
  // The 1 s em dash check is not worth a wait behind a green; lint and the type check are.
  return check.name === 'emdash:ratchet' ? run() : withHeavyLock(`pre-push ${check.name}`, run);
}

if (isEntryModule(process.argv[1], fileURLToPath(import.meta.url))) {
  process.exit(main());
}
