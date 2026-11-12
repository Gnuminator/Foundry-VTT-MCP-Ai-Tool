#!/usr/bin/env node
// @ts-check
/**
 * Merge gate (D-122): a lane merges its own pull request through this script. Every check runs
 * before anything is changed; each failure is one line. The end is either
 *
 *   lane:merge: merged #312 at 1a2b3c4; merge train 2/4
 *   lane:merge: NOT merged #312        (then one line per failed check, the notices, and last
 *   lane:merge: refused because ...     every reason on one line; exit 1)
 *
 * A release PR (the changelog fold plus version bumps, docs/dev/RELEASING.md) passes the changelog
 * check without a fragment; see releasePr.
 *
 *   npm run lane:merge -- <PR>                         check, then merge
 *   npm run lane:merge -- <PR> --dry-run               all checks, no merge, no train write
 *   npm run lane:merge -- <PR> --wait-ci               first wait (up to 30 minutes) until every CI check
 *                                                      on the head commit has finished, then the gate
 *   npm run lane:merge -- <PR> --no-changelog "reason" no changelog.d fragment on purpose
 *   npm run lane:merge -- --vault DIR                  Obsidian vault (default: env
 *                                                      FOUNDRY_AI_OBSIDIAN_DIR, else ~/Documents/Obsidian/vault)
 *   npm run lane:merge -- --train                      print the merge train
 *   npm run lane:merge -- --train-reset <sha>          a green live:roundtrip ran on main at <sha>
 *                                                      (must be the tip of aitool/main)
 *
 * The checks, in order: (a) the PR is open, not a draft, based on main and mergeable; (b) every CI
 * check passed, including each check the branch ruleset requires (read from the GitHub API);
 * (c) every review note for the head commit says Merge (full 40-character sha), and one of them is
 * an Opus review when the PR touches a risky area (RISKY_CATEGORIES, D-101); when no note names the
 * head, the verdicts of reviewed commits whose patch is unchanged carry (carriedReviews: the
 * `git patch-id --verbatim` of the diff from the merge base with main, at both commits; any error
 * refuses, never carries); (d) a changelog.d
 * fragment; (e) this checkout is the PR head, clean, and drift-check passes; (f) the merge train
 * (D-121) has room. The merge is `gh pr merge --merge --match-head-commit <head>`.
 *
 * The gate does not trust the branch it judges: when this file differs from aitool/main's copy, the
 * script runs main's copy instead (a temp file, same arguments), and drift-check runs from main's
 * copy too. The changed files come from `git diff` against the merge base, not from gh (which stops
 * at 100 files). All gh, git, node and npm calls go through one injectable `run(cmd, args)`.
 *
 * --wait-ci (waitForCi) polls the PR in this one process, so nobody has to come back once CI is done.
 * It ends the run at once when a check fails (exit 3, the check named), when the head commit
 * changes (exit 4, "head moved"), or after WAIT_TIMEOUT_MS (exit 5). When every check has finished
 * green it runs the gate above, unchanged, which merges or refuses with the reason (exit 0 or 1).
 *
 * The merge train is per PC: its state file lives in ~/.foundry-ai-tool, so lanes on another PC
 * count their own merges. A lock file next to it serialises the read-check-merge-write.
 *
 * Every merge, --train-reset and refusal (not --dry-run) also writes the train state to the vault
 * note `Dev/Foundry AI Tool/Merge train.md` for the PM board: pull, commit only that file, push.
 * A vault problem is a WARNING line; it never fails or undoes a merge.
 */
import os from 'node:os';
import { fileURLToPath } from 'node:url';
import { entryDecision, runEntry, relaunchFromMain, verdictLine } from './lane-merge/relaunch.mjs';
import { defaultRun } from './lane-merge/run.mjs';
import { main } from './lane-merge/main.mjs';

export {
  TRAIN_SIZE,
  REPO,
  WAIT_TIMEOUT_MS,
  WAIT_POLL_MS,
  EXIT_CI_FAILED,
  EXIT_HEAD_MOVED,
  EXIT_WAIT_TIMEOUT,
} from './lane-merge/constants.mjs';
export {
  RISKY_CATEGORIES,
  riskyListLines,
  TRAIN_PATTERNS,
  globToRegExp,
  matchesAny,
  riskyHits,
  isTrainRelevant,
} from './lane-merge/risky.mjs';
export {
  parseReviewNote,
  findReviewNotes,
  reviewNamingRule,
  unreadPrNotes,
  opusNotesForHead,
  patchIdAt,
  carriedReviews,
  judgeReviews,
} from './lane-merge/reviews.mjs';
export {
  requiredContexts,
  supersededCancelled,
  latestChecks,
  rollupProblems,
  waitForCi,
} from './lane-merge/ci.mjs';
export { hasChangelogFragment, releasePr, parseNameStatus } from './lane-merge/changelog.mjs';
export {
  readTrain,
  writeTrain,
  TRAIN_NOTE_PATH,
  refusalCauses,
  refusalBody,
  renderTrainNote,
  publishTrainNote,
  acquireLock,
} from './lane-merge/train.mjs';
export { defaultAnnounce, announceSource } from './lane-merge/announce.mjs';
export { defaultRun } from './lane-merge/run.mjs';
export { parseArgs } from './lane-merge/args.mjs';
export {
  relaunchFromMain,
  refusedBecause,
  verdictLine,
  runEntry,
  isEntryModule,
  entryDecision,
} from './lane-merge/relaunch.mjs';
export { hasRelativeImports } from './lane-merge/drift.mjs';
export { main } from './lane-merge/main.mjs';

const self = fileURLToPath(import.meta.url);
const decision = entryDecision(process.argv[1], self);
if (decision === 'run') {
  process.exit(
    runEntry({
      argv: process.argv.slice(2),
      relaunch: () =>
        relaunchFromMain({
          argv: process.argv.slice(2),
          run: defaultRun,
          selfPath: self,
          env: process.env,
          tmpdir: os.tmpdir(),
          log: console.log,
        }),
      runMain: fetched => main({ fetched }),
      log: console.log,
    })
  );
} else if (decision === 'mismatch') {
  console.error(
    `lane:merge: started as ${process.argv[1]} but this module is ${self}; not running`
  );
  if (process.argv.includes('--wait-ci')) {
    console.log(verdictLine(1, 'started under another name; not running'));
  }
  process.exit(1);
}
