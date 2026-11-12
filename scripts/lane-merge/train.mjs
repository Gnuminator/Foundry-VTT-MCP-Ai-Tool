// @ts-check
import { randomBytes } from 'node:crypto';
import fs from 'node:fs';
import path from 'node:path';
import { TRAIN_SIZE } from './constants.mjs';
import { firstLine } from './run.mjs';

/** @typedef {{ lastRoundtrip: { sha: string, at: string } | null, since: { pr: number, sha: string, at: string }[] }} TrainState */

export const TRAIN_FIX = 'fix it or run npm run lane:merge -- --train-reset <sha>';

/**
 * The merge train state; an empty train when the file does not exist yet. A file that is not JSON,
 * not an object, or whose `since` is not a list is refused (it is not read as an empty train).
 * @param {string} file @returns {TrainState}
 */
export function readTrain(file) {
  if (!fs.existsSync(file)) return { lastRoundtrip: null, since: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`train file unreadable (${file}): ${TRAIN_FIX}`, { cause: e });
  }
  const last = data?.lastRoundtrip;
  const lastOk = last === null || last === undefined || (typeof last === 'object' && last.sha);
  if (!data || typeof data !== 'object' || !Array.isArray(data.since) || !lastOk) {
    throw new Error(`train file unreadable (${file}): ${TRAIN_FIX}`);
  }
  return { lastRoundtrip: last ?? null, since: data.since };
}

/** @param {string} file @param {TrainState} state */
export function writeTrain(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Vault note the PM board reads for the merge train (board README, "Merge train.md"). */
export const TRAIN_NOTE_PATH = 'Dev/Foundry AI Tool/Merge train.md';

/** @typedef {{ kind: 'merge' | 'reset' | 'refusal', pr?: number, at: string, reasons?: string[], driftGuards?: string[], carriedFrom?: string[] }} TrainEvent */

/** Longest reason line kept in a train commit body. */
export const REASON_MAX = 160;

/**
 * The cause tag of each refusal line: the word before its first colon (`ci`, `review`, `drift`,
 * `train`, `pr`, `local`, `changelog`, `files`, `merge`, `wait-ci`), `other` when a line has none. Each
 * tag once, in order, so refusals can be counted by cause from the commit subjects.
 * A `ci` line is split into `ci-failing`, `ci-pending`, `ci-missing` and `ci-rules`; a `wait-ci` line
 * into `wait-ci-failing`, `-timeout`, `-head-moved` and `-other`; a `drift` line into one
 * `drift-<guard name>` per failing guard, which the caller passes as data (guard names hold commas
 * and parentheses, so they are not parsed back out of the text).
 * @param {string[]} reasons @param {string[]} [driftGuards] @returns {string[]}
 */
export function refusalCauses(reasons, driftGuards = []) {
  const slug = (/** @type {string} */ s) =>
    s
      .toLowerCase()
      .replace(/[^a-z0-9]+/g, '-')
      .replace(/^-|-$/g, '');
  /** @type {string[]} */
  const tags = [];
  for (const r of reasons) {
    const word = /^([a-z][a-z-]*):/.exec(r)?.[1] ?? 'other';
    if (word === 'ci') {
      // one ci line can carry several problems: failing, pending, required but not reported
      if (/\bfailing:/.test(r)) tags.push('ci-failing');
      if (/\bpending:|no checks reported/.test(r)) tags.push('ci-pending');
      if (/required but not reported/.test(r)) tags.push('ci-missing');
      if (!/\bfailing:|\bpending:|no checks reported|required but not reported/.test(r))
        tags.push('ci-rules');
    } else if (word === 'wait-ci') {
      if (/CI failed on/.test(r)) tags.push('wait-ci-failing');
      else if (/timed out/.test(r)) tags.push('wait-ci-timeout');
      else if (/head moved/.test(r)) tags.push('wait-ci-head-moved');
      else tags.push('wait-ci-other');
    } else if (word === 'drift') {
      const names = driftGuards.map(g => slug(g)).filter(Boolean);
      if (names.length > 0) tags.push(...names.map(n => `drift-${n}`));
      else tags.push('drift');
    } else tags.push(word);
  }
  return [...new Set(tags)];
}

/**
 * The reason lines of a refusal as a commit body: one line each, the first line of the failure only
 * (drift-check output is not copied), cut to REASON_MAX characters, nothing that is not a plain line.
 * @param {string[]} reasons @returns {string}
 */
export function refusalBody(reasons) {
  return reasons
    .map(r =>
      r
        .split(/\r?\n/)[0]
        .replace(/\p{Cc}/gu, ' ')
        .replace(/ \(log [^)]*\)/, '') // the drift log path (a temp file of this PC) says nothing in a shared commit
        .trim()
    )
    .filter(Boolean)
    .map(r => (r.length > REASON_MAX ? `${r.slice(0, REASON_MAX - 3)}...` : r))
    .join('\n');
}

/**
 * The vault note text: `key: value` lines in a frontmatter, numbers, a commit hash, a result word
 * and ISO dates only (the board never copies free text, and no secrets belong here). A reset only
 * ever follows a green live:roundtrip, so the recorded result is always green.
 * @param {TrainState} state @param {TrainEvent} event @param {string} updated
 */
export function renderTrainNote(state, event, updated) {
  const lines = ['type: merge-train', `updated: ${updated}`, `count: ${state.since.length}`];
  lines.push(`limit: ${TRAIN_SIZE}`);
  if (state.lastRoundtrip) {
    lines.push(`last-roundtrip-sha: ${state.lastRoundtrip.sha}`);
    lines.push(`last-roundtrip: ${state.lastRoundtrip.at}`);
    lines.push('last-roundtrip-result: green');
  }
  lines.push(`last-event: ${event.kind}`);
  if (event.pr !== undefined) lines.push(`last-event-pr: ${event.pr}`);
  // A merge whose review note named an earlier commit with the same patch (carriedReviews).
  const carried = (event.carriedFrom ?? []).filter(s => /^[0-9a-f]{40}$/.test(s));
  if (carried.length > 0) lines.push(`last-event-verdict-carried-from: ${carried.join(' ')}`);
  lines.push(`last-event-at: ${event.at}`);
  return `---\n${lines.join('\n')}\n---\n\nWritten by scripts/lane-merge.mjs on every merge, --train-reset and refusal. Do not edit by hand.\n`;
}

/**
 * Write the merge train note into the vault and push it (vault rules: pull first, commit only that
 * file, push). Never throws and never undoes anything: every problem comes back as a warning text
 * (empty when all went well). A vault that is not a git checkout writes nothing.
 * @param {{ vault: string, state: TrainState, event: TrainEvent, run: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }, now: () => Date }} o
 * @returns {string}
 */
export function publishTrainNote({ vault, state, event, run, now }) {
  const file = path.join(vault, ...TRAIN_NOTE_PATH.split('/'));
  const git = (/** @type {string[]} */ ...a) => run('git', ['-C', vault, ...a]);
  const why = (/** @type {{ stderr: string, stdout: string }} */ r) =>
    firstLine(r.stderr || r.stdout) || 'failed';
  try {
    // no vault checkout on this PC (or --vault points elsewhere): nothing to publish, not a problem
    if (!fs.existsSync(path.join(vault, '.git'))) return '';
    // Pull without touching anyone else's work: no rebase and no autostash, so nothing is ever left
    // half done in the shared vault. Fetch plus a fast-forward works with a dirty tree.
    const sync = () => {
      git('restore', '--staged', '--worktree', '--', TRAIN_NOTE_PATH); // an earlier failed try; fine to fail
      const fetched = git('fetch');
      if (fetched.status !== 0) return `vault fetch failed (${why(fetched)})`;
      const merged = git('merge', '--ff-only', '@{u}');
      return merged.status === 0 ? '' : `vault pull failed (${why(merged)})`;
    };
    const label = event.kind === 'reset' ? 'reset' : `${event.kind} #${event.pr}`;
    const causes =
      event.kind === 'refusal' ? refusalCauses(event.reasons ?? [], event.driftGuards ?? []) : [];
    const subject = `Merge train: ${label}, ${state.since.length}/${TRAIN_SIZE}${
      causes.length > 0 ? ` [${causes.join(', ')}]` : ''
    }`;
    const body =
      event.kind === 'refusal'
        ? refusalBody(event.reasons ?? [])
        : event.carriedFrom?.length
          ? `verdict carried from ${event.carriedFrom.join(', ')}`
          : '';
    let pushError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const synced = sync();
      if (synced) return `merge train note not written: ${synced}`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderTrainNote(state, event, now().toISOString()));
      const added = git('add', '--', TRAIN_NOTE_PATH);
      if (added.status !== 0) return `merge train note not committed (${why(added)})`;
      const committed = git(
        'commit',
        '-m',
        subject,
        ...(body ? ['-m', body] : []),
        '--',
        TRAIN_NOTE_PATH
      );
      if (committed.status !== 0) return `merge train note not committed (${why(committed)})`;
      const pushed = git('push');
      if (pushed.status === 0) return '';
      pushError = why(pushed);
      // Take our own commit back, so the vault is left as it was and the next try starts clean.
      git('reset', '--soft', 'HEAD~1');
      git('restore', '--staged', '--', TRAIN_NOTE_PATH);
    }
    return `merge train note not pushed (${pushError})`;
  } catch (e) {
    return `merge train note not written (${e instanceof Error ? e.message : String(e)})`;
  }
}

/** Wait without spinning. @param {number} ms */
export function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * An exclusive lock next to the train file (`<file>.lock`, created with `wx`). A lock older than
 * `staleMs` (default 10 minutes) belongs to a killed run and is taken over by a rename to a unique
 * name (one rename wins), then `wx` again. Waits up to `timeoutMs`. `afterStaleSeen` is a test hook
 * that runs between seeing a stale lock and taking it over; `afterTaken` runs between the rename
 * and the link back. The lock file holds a random token and the release removes only a lock with
 * its own token.
 * @param {string} file
 * @param {{ staleMs?: number, timeoutMs?: number, now?: () => number, wait?: (ms: number) => void,
 *   afterStaleSeen?: () => void, afterTaken?: () => void }} [opts]
 * @returns {() => void} release
 */
export function acquireLock(file, opts = {}) {
  const { staleMs = 10 * 60 * 1000, timeoutMs = 20_000, now = Date.now, wait = sleep } = opts;
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const started = now();
  let lastError = '';
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      const token = randomBytes(8).toString('hex');
      fs.writeSync(
        fd,
        JSON.stringify({ pid: process.pid, token, at: new Date(now()).toISOString() })
      );
      fs.closeSync(fd);
      // Release removes only the lock this run wrote: if the lock was displaced and another run
      // holds the path now, its token differs and it stays.
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock);
        } catch {
          /* already gone, or not ours */
        }
      };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
    try {
      if (now() - fs.statSync(lock).mtimeMs > staleMs) {
        opts.afterStaleSeen?.();
        // Take over by renaming the stale lock to a name only this run uses: of several runs that
        // saw the same stale lock, one rename wins and the others get ENOENT and retry. (A plain
        // unlink let the second run delete the first run's fresh lock, and both went in.)
        const taken = `${lock}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
        fs.renameSync(lock, taken);
        if (now() - fs.statSync(taken).mtimeMs > staleMs) {
          fs.unlinkSync(taken);
          continue;
        }
        // The lock was replaced by a live one between our stat and rename: we moved someone's fresh
        // lock. Put it back (link fails if another run already took the free slot) and wait.
        opts.afterTaken?.();
        const raceWarning = () =>
          process.stderr.write(
            'lane:merge: lock race: a run may be in the merge train without the lock; check merge-train.json\n'
          );
        try {
          fs.linkSync(taken, lock);
        } catch (e) {
          if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST') {
            // Another run took the free slot: both it and the run whose lock we moved may be in.
            raceWarning();
          } else {
            // No hard links here (FAT32, some network shares): copy the lock back with an exclusive
            // create (a rename would silently overwrite a third run's lock). EEXIST means a third
            // run took the free slot: warn like above. A vanished source is ENOENT: retry.
            try {
              fs.copyFileSync(taken, lock, fs.constants.COPYFILE_EXCL);
            } catch (e2) {
              if (/** @type {NodeJS.ErrnoException} */ (e2).code !== 'EEXIST') throw e2;
              raceWarning();
            }
          }
        }
        fs.unlinkSync(taken);
      }
    } catch (e) {
      // The holder released it between our two calls: try again. Any other error is kept for the
      // timeout message and waits like a busy lock, so it can never spin at full speed.
      if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') continue;
      lastError = /** @type {NodeJS.ErrnoException} */ (e).code ?? 'error';
    }
    if (now() - started >= timeoutMs) {
      throw new Error(
        `another lane:merge holds ${lock} (delete it if no merge is running)${lastError ? ` [last error ${lastError}]` : ''}`
      );
    }
    wait(200);
  }
}
