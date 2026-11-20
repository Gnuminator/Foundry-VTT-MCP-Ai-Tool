/**
 * The release step of the merge runner (item runner-starts-release). A `release-*` Backlog item
 * names what it waits for on its `- depends on:` line: PRs as `#<n>` and items as `item:<id>`.
 * When every one of them has merged the runner
 *   1. runs live:roundtrip on main (test server A's lock, the same worker as the merge train, but it
 *      neither reads nor resets the train),
 *   2. posts once in #pr-log and adds one due-today Waiting item "ready to tag",
 *   3. only with --release-session: starts a Sonnet release session (claude CLI, headless) that
 *      follows docs/dev/RELEASING.md and stops at the tag OK and the Pi OK. The spike (2026-11-17)
 *      showed that `claude -p --model <id> --session-id <uuid>` runs from a script and that
 *      `claude --resume <uuid>` continues it interactively, which is how the user answers.
 * It never tags, releases, deploys or touches the Pi, and writes nothing to Backlog.md.
 *
 * Pure: every outside action is a dependency (ReleaseDeps), so the tests drive it without a server.
 */
import { spawn as spawnProcess } from 'node:child_process';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { isMerged, itemRefs, parseBacklog } from '../backlog-items.mjs';

/** The holder name and session id for lock.ps1 (the train roundtrip uses its own). */
export const RELEASE_HOLDER = 'Merge runner (release roundtrip)';
export const RELEASE_SESSION = 'merge-runner-release';

/**
 * @typedef {{ id: string, title: string, prs: number[], items: string[] }} ReleaseItem
 * @typedef {{ status: number | null, stdout: string, stderr: string }} Ran
 * @typedef {{
 *   readDone: () => string,
 *   prMerged: (pr: number) => boolean | null,
 *   seen: (key: string) => boolean,
 *   mark: (key: string) => void,
 *   lock: (cmd: 'queue' | 'take' | 'release' | 'leave') => Ran,
 *   tip: () => string,
 *   lastRoundtrip: () => string | null,
 *   worker: (tip: string) => { code: number, output: string },
 *   stopServer: () => void,
 *   waiting: (key: string, title: string, text: string) => Ran,
 *   startSession?: (r: ReleaseItem, tip: string) => { id: string, error?: string },
 *   post: (text: string) => void,
 *   log: (line: string) => void,
 * }} ReleaseDeps
 */

/** @param {string} s @param {number} [n] */
const cut = (s, n = 240) => {
  const t = String(s).replace(/\s+/g, ' ').trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
};

/**
 * Open `release-*` items with at least one dependency.
 * @param {string} backlogText @returns {ReleaseItem[]}
 */
export function releaseItems(backlogText) {
  /** @type {ReleaseItem[]} */
  const out = [];
  for (const i of parseBacklog(backlogText).items) {
    if (!/^release-/.test(i.id) || isMerged(i)) continue;
    const dep = (i.fields.get('depends on') ?? []).join(' ');
    const prs = [...dep.matchAll(/(?:^|[\s,(])(?:PR\s*)?#(\d+)\b/gi)].map(m => Number(m[1]));
    const items = itemRefs(dep);
    if (prs.length + items.length) out.push({ id: i.id, title: i.title, prs, items });
  }
  return out;
}

/**
 * What a release still waits for: PRs not merged (or unknown) and items still open or not in the
 * done file. An empty list means it is unblocked.
 * @param {ReleaseItem} r @param {string} backlogText @param {string} doneText
 * @param {(pr: number) => boolean | null} prMerged @returns {string[]}
 */
export function stillWaiting(r, backlogText, doneText, prMerged) {
  const open = new Map(parseBacklog(backlogText).items.map(i => [i.id, i]));
  const waits = [];
  for (const pr of r.prs) if (prMerged(pr) !== true) waits.push(`#${pr}`);
  for (const id of r.items) {
    const item = open.get(id);
    const done = new RegExp(`^- \\d{4}-\\d{2}-\\d{2} ${id}:`, 'm').test(doneText);
    if (item ? !isMerged(item) : !done) waits.push(`item:${id}`);
  }
  return waits;
}

/** @param {ReleaseDeps} d */
export function makeReleaseRun(d) {
  let phase = /** @type {'idle' | 'queued'} */ ('idle');
  let current = '';
  let waited = 0;
  /** The main tip a roundtrip of this runner was green on (a failed Waiting write must not rerun it). */
  let greenTip = '';

  /** The roundtrip for one unblocked release, then the notice. @param {ReleaseItem} r */
  const hold = r => {
    const tip = d.tip();
    if (!/^[0-9a-f]{40}$/.test(tip)) {
      d.log('WARNING: main tip unreadable; the release roundtrip waits for the next round');
      return;
    }
    const failKey = `release-fail:${r.id}@${tip}`;
    /** @type {{ code: number, output: string } | undefined} */
    let ran;
    if (d.lastRoundtrip() === tip || greenTip === tip) {
      d.log(`${r.id}: live:roundtrip already green on ${tip.slice(0, 7)}`);
      ran = { code: 0, output: '' };
      if (phase === 'queued') {
        d.lock('leave');
        phase = 'idle';
      }
    } else {
      const t = d.lock('take');
      if (t.status !== 0) {
        if (waited++ % 15 === 0) d.log('waiting for test server A (held by another session)');
        return;
      }
      phase = 'idle';
      try {
        d.log(`holding test server A: live:roundtrip on ${tip.slice(0, 7)} for ${r.id}`);
        ran = d.worker(tip);
      } finally {
        if (!ran || ran.code !== 0) d.stopServer();
        const rel = d.lock('release');
        if (rel.status !== 0) {
          const why = cut(rel.stderr || rel.stdout);
          d.log(`WARNING: lock release failed (${why}); release it by hand`);
          d.post(
            `merge runner: could not release test server A's lock (${why}); release it by hand (lock.ps1 release -Session ${RELEASE_SESSION} -Force)`
          );
        }
      }
    }
    if (ran.code === 0) greenTip = tip;
    if (ran.code !== 0) {
      d.mark(failKey);
      const env = ran.code === 2;
      d.log(`${r.id}: live:roundtrip ${env ? 'could not run' : 'failed'} on ${tip.slice(0, 7)}`);
      // One red line per release item and kind of red (failed, could not run); later tips retry quietly.
      const postKey = `release-failpost:${r.id}:${env ? 'env' : 'fail'}`;
      if (d.seen(postKey)) return;
      d.post(
        `merge runner: ${r.id} is unblocked, but live:roundtrip ${env ? 'could not run (the test environment did not come up)' : 'failed'} on main ${tip.slice(0, 7)}; not ready to tag. ${cut(ran.output, 300)}`
      );
      d.mark(postKey);
      return;
    }
    const text = `${r.title}: everything it waits for has merged and live:roundtrip is green on main ${tip.slice(0, 7)}. Ready to tag (RELEASING.md: version, changelog fold, release PR, then the tag needs your OK, and the Pi update too).`;
    const w = d.waiting(`release-ready-${r.id}`, `${r.title}: ready to tag`, text);
    if (w.status !== 0) {
      // Not marked: tried again next round (the post below would repeat, so it waits for the write).
      d.log(`WARNING: Waiting line for ${r.id} not written (${cut(w.stderr || w.stdout, 200)})`);
      return;
    }
    d.mark(`release-ready:${r.id}`);
    d.log(`${r.id}: ready to tag (Waiting line added)`);
    let session = '';
    if (d.startSession) {
      const s = d.startSession(r, tip);
      session = s.error
        ? ` The release session did not start (${cut(s.error, 160)}).`
        : ` A Sonnet release session started; it stops at the tag OK and the Pi OK. Continue it with: claude --resume ${s.id}`;
    }
    d.post(
      `merge runner: ${r.id} is ready to tag: everything it waits for has merged and live:roundtrip is green on main ${tip.slice(0, 7)}. A Waiting item is added.${session}`
    );
  };

  return {
    phase: () => phase,
    /** The runner is going away: give up a queue place. */
    leave() {
      if (phase === 'queued') d.lock('leave');
      phase = 'idle';
    },
    /**
     * One round. Handles one unblocked release at a time. @param {string} backlogText
     */
    step(backlogText) {
      for (const r of releaseItems(backlogText)) {
        if (d.seen(`release-ready:${r.id}`)) continue;
        if (stillWaiting(r, backlogText, d.readDone(), d.prMerged).length) continue;
        const tip = d.tip();
        if (tip && d.seen(`release-fail:${r.id}@${tip}`)) continue;
        if (phase === 'idle' && d.lastRoundtrip() !== tip && greenTip !== tip) {
          const q = d.lock('queue');
          if (q.status !== 0) {
            d.log(
              `WARNING: could not queue for the test server lock (${cut(q.stderr || q.stdout)})`
            );
            return;
          }
          phase = 'queued';
          current = r.id;
          waited = 0;
          d.log(`${r.id} is unblocked: queued for test server A to run live:roundtrip`);
          return;
        }
        if (phase === 'queued' && current !== r.id) continue;
        current = r.id;
        hold(r);
        return;
      }
      if (phase === 'queued') {
        // The release was taken off the Backlog while queued.
        d.lock('leave');
        phase = 'idle';
      }
    },
  };
}

/**
 * One round's release step; an error is logged, never thrown (it must not stop the runner).
 * @param {{ step: (t: string) => void } | undefined} run
 * @param {{ readBacklog: () => string | null, log: (l: string) => void }} d
 */
export function releaseTick(run, d) {
  if (!run) return;
  try {
    const text = d.readBacklog();
    if (text !== null) run.step(text);
  } catch (e) {
    d.log(`WARNING: release step failed: ${cut(e instanceof Error ? e.message : String(e), 200)}`);
  }
}

/** The prompt of the optional release session. @param {ReleaseItem} r @param {string} tip */
export function releasePrompt(r, tip) {
  return [
    `You are the release session for Backlog item ${r.id} (${r.title}). Everything it waited for has merged and live:roundtrip is green on main ${tip}.`,
    'Follow CLAUDE.md and docs/dev/RELEASING.md steps 1 to 4: fold the changelog, set the version, check, open the release PR and let the merge runner land it (a ready line through backlog.mjs progress).',
    'STOP before step 5: do not tag, publish a release, post in Discord or touch the Orange Pi. Ask the user for the tag OK and the Pi OK through AskUserQuestion and wait for the answer.',
  ].join('\n');
}

/**
 * The real dependencies. The test-server pieces come from the train's (same worker, same gate
 * checkout); the lock uses its own session id so it never mixes with the train's queue place.
 * @param {{
 *   sh: (cmd: string, args: string[], o?: { cwd?: string, timeout?: number }) => Ran,
 *   stamp: (line: string) => void, repo: string,
 *   vaultGit: (args: string[]) => { status: number | null, stdout: string },
 *   train: import('./train-run.mjs').TrainDeps,
 *   deps: () => { post: (t: string) => void, backlog: (a: string[]) => Ran,
 *     noticeSeen?: (k: string) => boolean, noticeMark?: (k: string) => void },
 *   releaseSession?: boolean, repoRoot?: string,
 *   spawn?: (cmd: string, args: string[], o: { cwd: string }) => { error?: string },
 * }} o `deps` is the runner's own Deps (read lazily: it is built after these)
 * @returns {ReleaseDeps}
 */
export function makeReleaseDeps(o) {
  const repoRoot = o.repoRoot ?? path.resolve(fileURLToPath(import.meta.url), '..', '..', '..');
  const lockPs1 = `${repoRoot}/scripts/test-env/lock.ps1`;
  return {
    readDone: () => {
      const r = o.vaultGit(['show', '@{u}:Dev/Foundry AI Tool/Backlog done.md']);
      return r.status === 0 ? r.stdout : '';
    },
    prMerged: pr => {
      const r = o.sh('gh', [
        'pr',
        'view',
        String(pr),
        '-R',
        o.repo,
        '--json',
        'state',
        '--jq',
        '.state',
      ]);
      return r.status === 0 ? r.stdout.trim() === 'MERGED' : null;
    },
    seen: k => o.deps().noticeSeen?.(k) ?? false,
    mark: k => o.deps().noticeMark?.(k),
    lock: cmd => {
      const args = [
        '-NoProfile',
        '-File',
        lockPs1,
        cmd,
        '-Server',
        'A',
        '-Session',
        RELEASE_SESSION,
      ];
      if (cmd === 'queue' || cmd === 'take')
        args.push(
          '-Holder',
          RELEASE_HOLDER,
          '-Purpose',
          'release roundtrip (live:roundtrip on main)'
        );
      return o.sh('pwsh', args, { timeout: 120_000 });
    },
    tip: o.train.tip,
    lastRoundtrip: () => {
      try {
        return o.train.state().lastSha;
      } catch {
        return null;
      }
    },
    // Every write handler may have changed since the last release: sweep as well.
    worker: tip => o.train.worker(tip, true),
    stopServer: o.train.stopServer,
    waiting: (key, title, text) =>
      o.deps().backlog(['waiting', key, '--title', title, '--text', text]),
    startSession: o.releaseSession
      ? (r, tip) => {
          const id = globalThis.crypto.randomUUID();
          const spawn = o.spawn ?? defaultSpawn;
          const res = spawn(
            'claude',
            [
              '-p',
              releasePrompt(r, tip),
              '--model',
              'claude-sonnet-5-5',
              '--session-id',
              id,
              '-w',
              r.id,
              '--permission-mode',
              'acceptEdits',
            ],
            { cwd: repoRoot }
          );
          return res.error ? { id, error: res.error } : { id };
        }
      : undefined,
    post: t => o.deps().post(t),
    log: o.stamp,
  };
}

/** Starts the claude CLI detached; it outlives this round. @type {NonNullable<Parameters<typeof makeReleaseDeps>[0]['spawn']>} */
function defaultSpawn(cmd, args, o) {
  try {
    const child = spawnProcess(cmd, args, {
      cwd: o.cwd,
      detached: true,
      stdio: 'ignore',
      windowsHide: true,
    });
    child.on('error', () => {});
    child.unref();
    return {};
  } catch (e) {
    return { error: e instanceof Error ? e.message : String(e) };
  }
}
