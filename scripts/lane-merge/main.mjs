// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  TRAIN_SIZE,
  REMOTE,
  MAIN,
  REPO,
  TAIL_LINES,
  WAIT_TIMEOUT_MS,
  WAIT_POLL_MS,
  EXIT_HEAD_MOVED,
  ENV_FETCHED,
  PR_FIELDS,
} from './constants.mjs';
import { riskyHits, isTrainRelevant } from './risky.mjs';
import {
  findReviewNotes,
  reviewNamingRule,
  unreadPrNotes,
  opusNotesForHead,
  carriedReviews,
  judgeReviews,
} from './reviews.mjs';
import { requiredContexts, rollupProblems, waitForCi } from './ci.mjs';
import { hasChangelogFragment, releasePr, parseNameStatus } from './changelog.mjs';
import { readTrain, writeTrain, publishTrainNote, sleep, acquireLock } from './train.mjs';
import { defaultAnnounce } from './announce.mjs';
import { defaultRun, firstLine, lf } from './run.mjs';
import { parseArgs } from './args.mjs';
import { refusedBecause } from './relaunch.mjs';
import { runDrift } from './drift.mjs';

/** The entry file (scripts/lane-merge.mjs): the gate compares main's copy with it. */
const ENTRY_PATH = fileURLToPath(new URL('../lane-merge.mjs', import.meta.url));

/** @typedef {import('./run.mjs').Run} Run */
/** @typedef {import('./train.mjs').TrainState} TrainState */
/** @typedef {import('./train.mjs').TrainEvent} TrainEvent */
/** @typedef {import('./reviews.mjs').ReviewNote} ReviewNote */

/**
 * Runs the gate.
 * @param {{
 *   argv?: string[], run?: Run, log?: (line: string) => void, env?: Record<string, string | undefined>,
 *   home?: string, tmpdir?: string, now?: () => Date, fetched?: boolean, selfPath?: string, lockTimeoutMs?: number,
 *   sleep?: (ms: number) => void, clock?: () => number, waitPollMs?: number, waitTimeoutMs?: number,
 *   progress?: (line: string) => void, announce?: (n: number, title: string) => string,
 * }} [options] `announce` posts to #pr-log after a merge and returns a warning or ''; the real one
 * runs only with the real `run`, so tests never post. `progress` gets live lines that are not part of the verdict (stderr by default).
 * @returns {number} the process exit code
 */
export function main(options = {}) {
  const {
    argv = process.argv.slice(2),
    run = defaultRun,
    log = console.log,
    env = process.env,
    home = os.homedir(),
    tmpdir = os.tmpdir(),
    now = () => new Date(),
    fetched: fetchedBefore = env[ENV_FETCHED] === '1',
    selfPath = ENTRY_PATH,
    lockTimeoutMs = 20_000,
    sleep: pause = sleep,
    clock = Date.now,
    waitPollMs = WAIT_POLL_MS,
    waitTimeoutMs = WAIT_TIMEOUT_MS,
    progress = line => console.error(line),
    announce = run === defaultRun ? defaultAnnounce : () => '',
  } = options;
  const args = parseArgs(argv);
  if (args.error) {
    log(`lane:merge: ${args.error}`);
    return 2;
  }
  let fetched = fetchedBefore;
  const statePath = args.state ?? path.join(home, '.foundry-ai-tool', 'merge-train.json');
  const short = (/** @type {string} */ sha) => sha.slice(0, 7);
  /** git fetch aitool main, once per run. @returns {string | null} an error, or null */
  const fetchMain = () => {
    if (fetched) return null;
    const f = run('git', ['fetch', REMOTE, 'main']);
    return f.status === 0 ? null : firstLine(f.stderr || f.stdout) || 'failed';
  };
  const message = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
  const vault =
    args.vault ?? env.FOUNDRY_AI_OBSIDIAN_DIR ?? path.join(home, 'Documents', 'Obsidian', 'vault');
  /**
   * Write the train state to the vault note. A failure is a warning text, never a failed merge.
   * @param {TrainState} state @param {TrainEvent['kind']} kind @param {number} [pr] @param {string[]} [reasons] @param {string[]} [driftGuards] @param {string[]} [carriedFrom]
   */
  const recordTrain = (state, kind, pr, reasons, driftGuards, carriedFrom) => {
    const warn = publishTrainNote({
      vault,
      state,
      event: {
        kind,
        ...(pr === undefined ? {} : { pr }),
        ...(reasons === undefined ? {} : { reasons }),
        ...(driftGuards === undefined ? {} : { driftGuards }),
        ...(carriedFrom?.length ? { carriedFrom } : {}),
        at: now().toISOString(),
      },
      run,
      now,
    });
    return warn ? `WARNING: ${warn}` : '';
  };

  if (args.train) {
    try {
      const state = readTrain(statePath);
      const last = state.lastRoundtrip
        ? `last live:roundtrip at ${short(state.lastRoundtrip.sha)} (${state.lastRoundtrip.at})`
        : 'no live:roundtrip recorded';
      const since = state.since.map(s => `#${s.pr}@${short(s.sha)}`).join(', ') || 'none';
      log(
        `lane:merge: merge train ${state.since.length}/${TRAIN_SIZE}; ${last}; merged since: ${since}`
      );
      return 0;
    } catch (e) {
      log(`lane:merge: ${message(e)}`);
      return 1;
    }
  }
  if (args.trainReset !== null) {
    const sha = args.trainReset.toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) {
      log('lane:merge: --train-reset needs a commit sha (7 to 40 hex characters)');
      return 2;
    }
    const fetchError = fetchMain();
    if (fetchError) {
      log(`lane:merge: train not reset: git fetch ${REMOTE} main failed (${fetchError})`);
      return 1;
    }
    const tip = run('git', ['rev-parse', MAIN]);
    const tipSha = tip.stdout.trim().toLowerCase();
    if (tip.status !== 0 || !tipSha.startsWith(sha)) {
      log(
        `lane:merge: train not reset: ${short(sha)} is not the tip of ${MAIN} (${tipSha ? short(tipSha) : 'unknown'}); run live:roundtrip on the newest main`
      );
      return 1;
    }
    let release;
    try {
      release = acquireLock(statePath, { timeoutMs: lockTimeoutMs });
      writeTrain(statePath, { lastRoundtrip: { sha: tipSha, at: now().toISOString() }, since: [] });
    } catch (e) {
      log(`lane:merge: train not reset: ${message(e)}`);
      return 1;
    } finally {
      release?.();
    }
    log(`lane:merge: merge train reset at ${short(tipSha)}; merge train 0/${TRAIN_SIZE}`);
    const resetWarning = recordTrain(
      { lastRoundtrip: { sha: tipSha, at: now().toISOString() }, since: [] },
      'reset'
    );
    if (resetWarning) log(`lane:merge: ${resetWarning}`);
    return 0;
  }

  const n = /** @type {number} */ (args.pr);
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const details = [];
  /** @type {string[]} */
  const notes = [];
  // The train lock, held from before the merge until it is written. A refusal drops it before any
  // vault I/O, so a slow vault never keeps other lanes waiting.
  /** @type {(() => void) | null} */
  let release = null;
  /** Names of the guards drift-check reported as failing, for the refusal tags. @type {string[]} */
  const driftGuards = [];
  const finish = (code = 1) => {
    release?.();
    release = null;
    log(`lane:merge: NOT merged #${n}`);
    for (const f of failures) log(f);
    for (const line of notes) log(`lane:merge: ${line}`);
    for (const d of details) log(d);
    if (!args.dryRun) {
      try {
        const warn = recordTrain(readTrain(statePath), 'refusal', n, failures, driftGuards);
        if (warn) log(`lane:merge: ${warn}`);
      } catch (e) {
        log(`lane:merge: WARNING: merge train note not written (${message(e)})`);
      }
    }
    // Last, so a `tail` of the output always shows why, not only the notices above.
    log(refusedBecause(failures));
    return code;
  };

  // --wait-ci: wait for every CI check on the head commit, then run the gate below unchanged.
  /** @type {string | null} */
  let waitedHead = null;
  if (args.waitCi) {
    log(
      `lane:merge: --wait-ci: waiting up to ${Math.round(waitTimeoutMs / 60000)} minutes for CI on #${n}`
    );
    const waited = waitForCi({
      pr: n,
      run,
      log,
      sleep: pause,
      clock,
      pollMs: waitPollMs,
      timeoutMs: waitTimeoutMs,
    });
    if (!waited.ok) {
      failures.push(waited.reason);
      return finish(waited.code);
    }
    waitedHead = waited.head;
    // The wait can take half an hour: main may have moved, and with it the merge base, drift-check
    // and the gate itself. Fetch again, and refuse when the gate on main is no longer this file.
    const refetch = run('git', ['fetch', REMOTE, 'main']);
    if (refetch.status !== 0) {
      failures.push(
        `wait-ci: git fetch ${REMOTE} main failed after the wait (${firstLine(refetch.stderr || refetch.stdout) || 'failed'})`
      );
      return finish();
    }
    fetched = true;
    const onMain = run('git', ['show', `${MAIN}:scripts/lane-merge.mjs`]);
    if (onMain.status === 0) {
      let mine = null;
      try {
        mine = fs.readFileSync(selfPath, 'utf8');
      } catch {
        /* refused below */
      }
      if (mine === null || lf(onMain.stdout) !== lf(mine)) {
        failures.push(
          `wait-ci: the gate on ${MAIN} changed during the wait (or this copy cannot be read); start again`
        );
        return finish();
      }
    }
  }

  // a. The PR itself.
  const view = run('gh', ['pr', 'view', String(n), '--json', PR_FIELDS]);
  /** @type {any} */
  let pr = null;
  if (view.status === 0) {
    try {
      pr = JSON.parse(view.stdout);
    } catch {
      /* reported below */
    }
  }
  if (!pr) {
    failures.push(
      `pr: gh pr view ${n} failed: ${firstLine(view.stderr || view.stdout) || 'no output'}`
    );
    return finish();
  }
  const head = String(pr.headRefOid ?? '').toLowerCase();
  if (waitedHead !== null && head !== waitedHead) {
    failures.push(
      `wait-ci: head moved from ${short(waitedHead)} to ${short(head)} after the wait; start again`
    );
    return finish(EXIT_HEAD_MOVED);
  }
  if (pr.state !== 'OPEN') failures.push(`pr: #${n} is ${pr.state}, not OPEN`);
  if (pr.isDraft) failures.push(`pr: #${n} is a draft; mark it ready for review`);
  if (pr.baseRefName !== 'main') failures.push(`pr: base is ${pr.baseRefName}, not main`);
  if (pr.mergeable !== 'MERGEABLE') {
    failures.push(
      `pr: mergeable is ${pr.mergeable}; merge main into the branch and resolve conflicts`
    );
  }

  // b. CI: every check green, and every check the branch ruleset requires present.
  const rules = run('gh', ['api', `repos/${REPO}/rules/branches/main`]);
  const required = rules.status === 0 ? requiredContexts(rules.stdout) : null;
  if (required === null) {
    failures.push(
      rules.status === 0
        ? 'ci: the branch ruleset lists no required status checks (or gh api answered something else); refusing'
        : `ci: cannot read the required checks from the branch ruleset (gh api failed: ${firstLine(rules.stderr || rules.stdout)}); refusing`
    );
  }
  const rollup = pr.statusCheckRollup ?? [];
  if (rollup.length === 0) failures.push('ci: no checks reported for this PR yet');
  else {
    const { failing, pending, missing } = rollupProblems(rollup, required ?? []);
    const parts = [];
    if (failing.length > 0) parts.push(`failing: ${failing.join(', ')}`);
    if (pending.length > 0) parts.push(`pending: ${pending.join(', ')}`);
    if (missing.length > 0) parts.push(`required but not reported: ${missing.join(', ')}`);
    if (parts.length > 0) failures.push(`ci: ${parts.join('; ')}`);
  }

  // The changed files come from the local checkout (gh stops at 100 files and drops renamed-from
  // paths); gh's list is a cross-check, and the union is judged.
  // Only when this checkout is the PR head: any other checkout would list another branch's files
  // (the local check below refuses it anyway), so then gh's list is all there is.
  const local = run('git', ['rev-parse', 'HEAD']);
  const localHead = local.stdout.trim().toLowerCase();
  const atHead = local.status === 0 && localHead === head;
  const fetchError = atHead ? fetchMain() : null;
  /** @type {{ path: string, changeType?: string }[]} */
  let localFiles = [];
  /** @type {string | null} */
  let filesError = fetchError ? `git fetch ${REMOTE} main failed: ${fetchError}` : null;
  /** The merge base, once the local diff is read. @type {string | null} */
  let mergeBase = null;
  if (atHead && !filesError) {
    const base = run('git', ['merge-base', MAIN, 'HEAD']);
    const diff =
      base.status === 0
        ? run('git', [
            'diff',
            '-z',
            '--no-color',
            '--name-status',
            '--no-renames',
            base.stdout.trim(),
            'HEAD',
          ])
        : base;
    if (base.status !== 0 || diff.status !== 0) {
      filesError = `git merge-base/diff against ${MAIN} failed: ${firstLine(diff.stderr || diff.stdout)}`;
    } else {
      localFiles = parseNameStatus(diff.stdout);
      mergeBase = base.stdout.trim();
    }
  }
  const ghFiles = (pr.files ?? []).map((/** @type {any} */ f) => ({ ...f, path: String(f.path) }));
  const files = [
    ...localFiles,
    ...ghFiles.filter(
      (/** @type {{ path: string }} */ g) => !localFiles.some(l => l.path === g.path)
    ),
  ];
  const paths = files.map(f => f.path);

  // c. Review notes for the head commit.
  /** The reviewed shas whose verdict carried to the head, when no note names it. @type {string[]} */
  let carriedFrom = [];
  const hits = riskyHits(paths);
  /** @type {ReviewNote[] | null} */
  let reviews = null;
  try {
    reviews = findReviewNotes(vault, n);
  } catch (e) {
    failures.push(`review: cannot read the vault ${vault}: ${message(e)}`);
  }
  // No note names the head: an earlier reviewed commit with the same patch carries its verdict.
  // Only for well-formed notes (a malformed one refuses anyway); any error carries nothing.
  /** @type {{ carried?: string[], carryError?: string | null }} */
  let carry = {};
  const namesHead = (reviews ?? []).some(r => r.entries.some(e => e.head === head));
  if (reviews && !namesHead && !reviews.some(r => r.malformed.length > 0)) {
    const mainError = fetchMain();
    if (mainError) {
      carry = { carried: [], carryError: `git fetch ${REMOTE} main failed: ${mainError}` };
    } else {
      try {
        carry = carriedReviews(run, reviews, head);
      } catch (e) {
        carry = { carried: [], carryError: message(e) };
      }
    }
  }
  // The notice says whether the Opus note it asks for is there, so it never reads as a refusal
  // when it is (the review: line, if any, says what is wrong).
  const opusFound = opusNotesForHead(reviews ?? [], head, carry.carried ?? []);
  const opusState = opusFound.length ? `found (${opusFound.join(', ')})` : 'missing';
  for (const h of hits) {
    notes.push(
      `risky (${h.name}): ${h.file}; an Opus review is required; Opus note for head ${short(head)}: ${opusState}`
    );
  }
  if (reviews === null) {
    if (!failures.some(f => f.startsWith('review:'))) {
      failures.push(`review: vault not found at ${vault} (pass --vault DIR)`);
    }
  } else {
    const verdict = judgeReviews(reviews, head, hits.length > 0, carry);
    if (verdict.ok && verdict.carriedFrom?.length) {
      carriedFrom = verdict.carriedFrom;
      notes.push(
        `review: verdict carried from ${carriedFrom.join(', ')} (${verdict.detail}): the PR's patch at head ${short(head)} is the same (git patch-id)`
      );
    }
    if (!verdict.ok) {
      let hint = '';
      // No note counted: say how a note must be named, and which notes of this PR were not read.
      if (/^no review note for head |^only a Sonnet review /.test(verdict.detail)) {
        /** @type {string[]} */
        let skipped = [];
        try {
          skipped = unreadPrNotes(vault, n);
        } catch {
          /* the hint is extra; the refusal stands without it */
        }
        hint = `; ${reviewNamingRule(n)}`;
        if (skipped.length) hint += `; not read (no "review" in the name): ${skipped.join(', ')}`;
      }
      failures.push(`review: ${verdict.detail}${hint}`);
    }
  }

  // d. Changelog fragment, or a release PR (it folds the fragments into CHANGELOG.md instead).
  if (args.noChangelog === null && !hasChangelogFragment(files)) {
    // Only from the local diff: the file contents at the merge base and the head are read by git.
    const release =
      atHead && mergeBase && paths.includes('CHANGELOG.md')
        ? releasePr(files, (rev, file) => {
            const shown = run('git', ['show', `${rev === 'base' ? mergeBase : head}:${file}`]);
            return shown.status === 0 ? shown.stdout : null;
          })
        : null;
    if (release?.release) {
      notes.push(
        'changelog: a release PR (only the fold and version bumps), so no fragment is needed'
      );
    } else {
      failures.push(
        `changelog: no added or changed changelog.d/*.md fragment (or pass --no-changelog "reason")${
          release ? `; not a release PR: ${release.why}` : ''
        }`
      );
    }
  }

  // e. This checkout is the PR head and clean.
  const status = run('git', ['status', '--porcelain']);
  let localOk = true;
  if (local.status !== 0 || localHead !== head) {
    localOk = false;
    failures.push(
      `local: this checkout is at ${localHead ? short(localHead) : 'unknown'}, the PR head is ${short(head)}; check out ${pr.headRefName} and pull it`
    );
  }
  if (status.status !== 0 || status.stdout.trim() !== '') {
    localOk = false;
    const count = status.stdout.split(/\r?\n/).filter(Boolean).length;
    failures.push(
      `local: the working tree is not clean (${count} change${count === 1 ? '' : 's'}); commit or stash first`
    );
  }
  if (filesError) failures.push(`files: cannot list what the PR changes locally: ${filesError}`);

  // f. Merge train (read now for the early refusal; read again under the lock before the merge).
  const trainRelevant = isTrainRelevant(paths);
  /** @type {TrainState} */
  let train = { lastRoundtrip: null, since: [] };
  try {
    train = readTrain(statePath);
  } catch (e) {
    failures.push(`train: ${message(e)}`);
  }
  const trainFull = () =>
    `train: merge train full (${train.since.length}/${TRAIN_SIZE}): the planner runs npm run live:roundtrip on main, then npm run lane:merge -- --train-reset <sha>`;
  if (trainRelevant && train.since.length >= TRAIN_SIZE) failures.push(trainFull());

  // e (continued). drift-check, the slow one: only when everything above passed.
  if (failures.length === 0 && localOk) {
    // Its output is captured, so a wait for the heavy-check lock would be silent until the end.
    progress(
      'lane:merge: drift-check runs now; it may first wait for the heavy-check lock (node scripts/heavy-lock.mjs status shows who holds it)'
    );
    const drift = runDrift(run, tmpdir, notes);
    const logFile = path.join(tmpdir, `lane-merge-${n}-drift-${now().getTime()}.log`);
    const output = `${drift.stdout}${drift.stderr}`;
    try {
      fs.writeFileSync(logFile, output);
    } catch {
      /* the tail below still shows the output */
    }
    if (drift.status !== 0) {
      // drift-check logs "  FAIL <guard name>" per failing guard; the names go into the refusal reason
      const guards = [...output.matchAll(/^ {2}FAIL (.+?)\s*$/gm)].map(m => m[1]);
      driftGuards.push(...guards);
      failures.push(
        `drift: drift-check failed${guards.length > 0 ? ` (guards: ${guards.join(', ')})` : ''} (log ${logFile}); last lines below`
      );
      details.push(...output.replace(/\s+$/, '').split(/\r?\n/).slice(-TAIL_LINES));
    }
  } else if (failures.length > 0) {
    notes.push('drift-check not run: it is slow, so it runs once the other checks pass');
  }

  if (failures.length > 0) return finish();
  for (const line of notes) log(`lane:merge: ${line}`);

  // g. Merge.
  const sha7 = short(head);
  const extras = `${args.noChangelog === null ? '' : `; no changelog: ${args.noChangelog}`}${
    carriedFrom.length ? `; verdict carried from ${carriedFrom.map(short).join(', ')}` : ''
  }`;
  if (args.dryRun) {
    log(
      `lane:merge: OK #${n} at ${sha7} (dry run, nothing merged); merge train ${train.since.length}/${TRAIN_SIZE}${extras}`
    );
    return 0;
  }
  // A module PR takes the train lock around read, merge and write, so two lanes cannot both pass
  // at 3/4.
  let warning = '';
  try {
    if (trainRelevant) {
      try {
        release = acquireLock(statePath, { timeoutMs: lockTimeoutMs });
        train = readTrain(statePath);
      } catch (e) {
        failures.push(`train: ${message(e)}`);
        return finish();
      }
      if (train.since.length >= TRAIN_SIZE) {
        failures.push(trainFull());
        return finish();
      }
    }
    const merge = run('gh', ['pr', 'merge', String(n), '--merge', '--match-head-commit', head]);
    if (merge.status !== 0) {
      failures.push(
        `merge: gh pr merge exited ${merge.status}: ${firstLine(merge.stderr || merge.stdout)}`
      );
      return finish();
    }
    if (trainRelevant) {
      train.since.push({ pr: n, sha: head, at: now().toISOString() });
      try {
        writeTrain(statePath, train);
      } catch (e) {
        warning = `; WARNING: merge train not recorded (${message(e)})`;
      }
    }
  } finally {
    release?.();
  }
  const k = train.since.length;
  const advice =
    trainRelevant && k === TRAIN_SIZE - 1
      ? '; run live:roundtrip before the next module merge'
      : '';
  log(
    `lane:merge: merged #${n} at ${sha7}; merge train ${k}/${TRAIN_SIZE}${advice}${extras}${warning}`
  );
  // After the merged line, so a slow or hanging vault push never hides a merge that happened.
  const noteWarning = recordTrain(train, 'merge', n, undefined, undefined, carriedFrom);
  if (noteWarning) log(`lane:merge: ${noteWarning}`);
  // The Discord post is a courtesy: a failure is a warning line and never changes the exit code.
  try {
    const postWarning = announce(n, String(pr.title ?? ''));
    if (postWarning) log(`lane:merge: WARNING ${postWarning}`);
  } catch (e) {
    log(`lane:merge: WARNING Discord post failed (${message(e)})`);
  }
  return 0;
}
