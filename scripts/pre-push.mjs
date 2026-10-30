#!/usr/bin/env node
/**
 * The git pre-push hook (.husky/pre-push): runs the fast guards that need no heavy lock, so a new
 * em dash is refused here with CI's own message. The lint ratchet and the typecheck are not run
 * here any more (the user, 2026-10-30): CI runs both on every PR push and is the green for a lane,
 * and measured on 2026-10-30 the hook queued for the heavy-check lock a median 22 minutes for them.
 * `npm run green -- --quick` typechecks what a branch touched when you want the answer before
 * pushing.
 *
 * Skipped when `npm run green` passed on exactly the tree being pushed (green records the tree hash
 * in `.git/green-ok`, uncommitted edits included, see greenPassedOnThisTree in green.mjs). Git hands
 * the hook the remote as two arguments and the pushed refs on stdin; every pushed commit must have
 * the green tree, so edits made after the commit do not make the hook run again. Started without
 * those arguments (an older .husky/pre-push), it falls back to "clean tree, HEAD has the green tree".
 * `SKIP_PREPUSH=1 git push ...` skips it by hand.
 * Measured on the user's PC: emdash:ratchet 1 s.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import { fileURLToPath } from 'node:url';
import {
  greenPassedOnThisTree,
  isEntryModule,
  portableNode22Dir,
  stepEnvironment,
} from './green.mjs';

/** The checks: only guards that are fast and need no lock. */
export const CHECKS = [{ name: 'emdash:ratchet', args: ['run', 'emdash:ratchet'] }];

const ZERO = /^0+$/;

/**
 * The commits a push sends, from the lines git writes to the hook's stdin
 * (`<local ref> <local sha> <remote ref> <remote sha>`); a deleted ref (local sha all zeros) sends none.
 * @param {string} text
 * @returns {string[]}
 */
export function pushedCommits(text) {
  return text
    .split(/\r?\n/)
    .map(l => l.trim().split(/\s+/))
    .filter(f => f.length >= 4 && /^[0-9a-f]{40,64}$/.test(f[1]) && !ZERO.test(f[1]))
    .map(f => f[1]);
}

/**
 * @param {{ cwd?: string, env?: Record<string, string | undefined>, log?: (line: string) => void,
 *   commits?: string[],
 *   passedGreen?: (cwd: string, commits: string[]) => boolean,
 *   runCheck?: (check: { name: string, args: string[] }, cwd: string) => number }} [o]
 * @returns {number} the process exit code
 */
export function main(o = {}) {
  const {
    cwd = process.cwd(),
    env = process.env,
    log = console.log,
    commits = [],
    passedGreen = greenPassedOnThisTree,
    runCheck = defaultRunCheck,
  } = o;
  if (env.SKIP_PREPUSH === '1') {
    log('pre-push: skipped (SKIP_PREPUSH=1)');
    return 0;
  }
  if (passedGreen(cwd, commits)) {
    log('pre-push: skipped, npm run green passed on this tree');
    return 0;
  }
  for (const check of CHECKS) {
    if (runCheck(check, cwd) !== 0) {
      log(`pre-push: ${check.name} failed, push refused`);
      return 1;
    }
  }
  log('pre-push: OK, em dash check passes (CI runs lint and typecheck on the PR head)');
  return 0;
}

/** @param {{ name: string, args: string[] }} check @param {string} cwd */
function defaultRunCheck(check, cwd) {
  // One command string under the shell (an args array under a shell is DEP0190), as green.mjs does.
  const r = spawnSync(['npm', ...check.args].join(' '), {
    cwd,
    shell: true,
    stdio: 'inherit',
    env: stepEnvironment(process.env, portableNode22Dir()),
  });
  return r.status ?? 1;
}

if (isEntryModule(process.argv[1], fileURLToPath(import.meta.url))) {
  // Git starts the hook as `pre-push <remote> <url>` with the refs on stdin; only then is stdin read
  // (a hand-started run could otherwise wait on a terminal).
  let commits = [];
  if (process.argv.length >= 4) {
    try {
      commits = pushedCommits(fs.readFileSync(0, 'utf8'));
    } catch {
      // No stdin: the clean-tree check.
    }
  }
  process.exit(main({ commits }));
}
