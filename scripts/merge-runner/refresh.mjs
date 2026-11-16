/**
 * The merge runner refreshes a lane branch that the gate refused only because it is behind main
 * (a conflict-free merge, or a moved package-lock.json): it merges `aitool/main` into the branch in
 * the gate checkout, pushes the merge commit and hands back the new head. The review of the old
 * head carries to the new one by patch id (the gate checks that), because a clean merge of main
 * changes no line of the lane's own patch.
 *
 * It never forces anything and never resolves a conflict: a real conflict, a lockfile that
 * `npm install --package-lock-only` would still change, a fork PR, a draft, or a branch that
 * already carries one of the runner's own refresh commits (so a PR that keeps failing for another
 * reason is not merged again and again) stay refusals for the lane to fix.
 */
/** @param {string} s @param {number} max */
const oneLine = (s, max) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);

/** Subject of the merge commit; its presence in the head's own subject stops a second refresh. */
export const REFRESH_SUBJECT = 'Merge aitool/main (merge runner refresh)';

/** Gate refusals that merging main can cure: not mergeable, drift (incl. a moved lockfile), stale base. */
export const REFRESHABLE =
  /^pr: mergeable is |^drift: |merge conflicts|base branch policy|branch is behind|out[- ]of[- ]date/i;

const IDENT = [
  '-c',
  'user.name=Merge runner',
  '-c',
  'user.email=merge-runner@users.noreply.github.com',
];
const TIMEOUT = 120_000;
const NPM_TIMEOUT = 10 * 60_000;

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} Ran
 * @typedef {(cmd: string, args: string[], o?: { cwd?: string, timeout?: number }) => Ran} Run
 * @typedef {{ head?: string, why?: string }} Refreshed `head`: the pushed merge commit; `why`: not refreshed
 */

/**
 * The dependency the runner's round calls.
 * @typedef {(r: { pr: number, head: string }, reason: string, progress?: string) => Refreshed | null} Refresh
 * @param {{ checkout: string, run: Run, repo: string, mainRef: string }} o
 * @returns {Refresh}
 */
export const makeRefresh = o => (r, reason) => {
  try {
    return refreshBranch({ ...o, pr: r.pr, head: r.head, reason, gh: args => o.run('gh', args) });
  } catch (e) {
    return { why: `not refreshed: ${e instanceof Error ? e.message : String(e)}` };
  }
};

/**
 * What the round does with a refusal: refresh when it can, then either the ready line for the new
 * head (same review note, written only while the old line stands) or the refusal text.
 * @param {Refresh | undefined} refresh
 * @param {{ id: string, pr: number, head: string }} r @param {string} reason @param {string | undefined} progress
 * @returns {{ refusal: string } | { args: string[], log: string, post: string }}
 */
export function refreshStep(refresh, r, reason, progress) {
  const fr = refresh?.(r, reason, progress);
  if (!fr?.head) return { refusal: fr?.why ? `${reason} (${fr.why})` : reason };
  const review = reviewOf(progress);
  const [was, now] = [r.head.slice(0, 7), fr.head.slice(0, 7)];
  return {
    args: [
      'progress',
      r.id,
      '--ready',
      String(r.pr),
      '--head',
      fr.head,
      ...(review ? ['--review', review] : []),
      '--if-ready',
      `${r.pr}@${r.head}`,
    ],
    log: `#${r.pr} (${r.id}): merged main into the branch, new head ${now}`,
    post: `merge runner: merged main into #${r.pr}'s branch (${was} to ${now}); the gate runs again once CI is green`,
  };
}

/** The `review <path>` part of an item's ready line, or ''. @param {string | undefined} progress */
export function reviewOf(progress) {
  const last = (progress ?? '').split('\n').at(-1) ?? '';
  return /, review (.+)$/.exec(last.trim())?.[1].trim() ?? '';
}

/**
 * @param {{ checkout: string, pr: number, head: string, reason: string, run: Run,
 *   gh: (args: string[]) => Ran, repo: string, mainRef?: string }} o
 * @returns {Refreshed | null} null: not a refusal this can cure
 */
export function refreshBranch(o) {
  const main = o.mainRef ?? 'aitool/main';
  if (!REFRESHABLE.test(o.reason)) return null;
  const git = (/** @type {string[]} */ args, timeout = TIMEOUT) =>
    o.run('git', args, { cwd: o.checkout, timeout });
  const no = (/** @type {string} */ why) => ({ why: `not refreshed: ${why}` });
  // The checkout is the gate's: detached at the head, clean (prepare checked both).
  if (git(['rev-parse', 'HEAD']).stdout.trim() !== o.head)
    return no('the gate checkout moved off the head');
  if (git(['status', '--porcelain']).stdout.trim()) return no('the gate checkout is not clean');
  if (git(['merge-base', '--is-ancestor', main, o.head]).status === 0)
    return no('the head already contains main');
  if (git(['log', '-1', '--format=%s', o.head]).stdout.includes(REFRESH_SUBJECT)) {
    return no('main was already merged in by the runner once');
  }
  const pv = o.gh([
    'pr',
    'view',
    String(o.pr),
    '-R',
    o.repo,
    '--json',
    'headRefName,isCrossRepository,isDraft,state',
  ]);
  /** @type {{ headRefName?: string, isCrossRepository?: boolean, isDraft?: boolean, state?: string }} */
  let info;
  try {
    info = JSON.parse(pv.stdout);
  } catch {
    return no('the PR could not be read');
  }
  if (pv.status !== 0 || !info?.headRefName) return no('the PR could not be read');
  if (info.state !== 'OPEN' || info.isDraft || info.isCrossRepository)
    return no('not an open, same-repo, non-draft PR');

  const base = git(['merge-base', main, o.head]).stdout.trim();
  const lockMoved =
    base !== '' && git(['diff', '--quiet', base, main, '--', 'package-lock.json']).status !== 0;
  const merged = git([...IDENT, 'merge', '--no-edit', '-m', REFRESH_SUBJECT, main], 5 * 60_000);
  if (merged.status !== 0) {
    const files = git(['diff', '--name-only', '--diff-filter=U'])
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    git(['merge', '--abort']);
    git(['reset', '-q', '--hard', o.head]);
    return no(
      files.length > 0
        ? `a real conflict in ${files.slice(0, 5).join(', ')}: the lane has to resolve it`
        : `git merge failed (${oneLine(merged.stderr || merged.stdout, 160)})`
    );
  }
  if (lockMoved) {
    const npm =
      process.platform === 'win32'
        ? o.run('cmd.exe', ['/d', '/s', '/c', 'npm install --package-lock-only --ignore-scripts'], {
            cwd: o.checkout,
            timeout: NPM_TIMEOUT,
          })
        : o.run('npm', ['install', '--package-lock-only', '--ignore-scripts'], {
            cwd: o.checkout,
            timeout: NPM_TIMEOUT,
          });
    const changed = git(['status', '--porcelain', '--', 'package-lock.json']).stdout.trim();
    if (npm.status !== 0 || changed) {
      git(['checkout', '-q', '--', 'package-lock.json']);
      git(['reset', '-q', '--hard', o.head]);
      return no(
        npm.status !== 0
          ? `npm install --package-lock-only failed (${oneLine(npm.stderr || npm.stdout, 160)})`
          : 'the merged package-lock.json would still change; the lane has to regenerate it'
      );
    }
  }
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  // A plain push: it only succeeds as a fast-forward of the branch the lane left at the old head.
  const pushed = o.run('git', ['push', 'aitool', `${head}:refs/heads/${info.headRefName}`], {
    cwd: o.checkout,
    timeout: TIMEOUT,
  });
  git(['reset', '-q', '--hard', o.head]);
  if (pushed.status !== 0)
    return no(
      `the push failed (${oneLine(pushed.stderr || pushed.stdout, 160)}); the lane may have pushed meanwhile`
    );
  return { head };
}
