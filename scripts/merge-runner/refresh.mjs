/**
 * The merge runner refreshes a lane branch that the gate refused only because it is behind main
 * (a conflict-free merge, or a moved package-lock.json): it merges `aitool/main` into the branch in
 * the gate checkout, pushes the merge commit and hands back the new head. The review of the old
 * head carries to the new one by patch id (the gate checks that), because a clean merge of main
 * changes no line of the lane's own patch.
 *
 * Generated tool reference pages (docs/reference/tools.md, docs/reference/tools/) are the one thing
 * it does resolve: a conflict only in those files is settled by taking the lane's side and running
 * `npm run docs:tools`, and a drift refusal whose only failed guard is the mcp-server tests
 * (a stale tool reference after main added a tool) gets the same regeneration. The regenerated
 * pages go into the merge commit; the gate leaves them out of its patch id, so the review carries.
 *
 * It never forces anything and never resolves any other conflict: a real conflict, a lockfile that
 * `npm install --package-lock-only` would still change, a fork PR, a draft, or a branch that
 * already carries one of the runner's own refresh commits (so a PR that keeps failing for another
 * reason is not merged again and again) stay refusals for the lane to fix.
 */
import { readyOrEnqueuedPr } from '../backlog-items.mjs';

/** @param {string} s @param {number} max */
const oneLine = (s, max) => String(s).replace(/\s+/g, ' ').trim().slice(0, max);

/** Subject of the merge commit; its presence in the head's own subject stops a second refresh. */
export const REFRESH_SUBJECT = 'Merge aitool/main (merge runner refresh)';

/**
 * Gate refusals that merging main can cure: not mergeable or conflicting, and a drift refusal that
 * names no guard (drift-check runs its guards on a trial merge of main, so a named guard fails the
 * same after a real merge; the unnamed one is the moved lockfile, checked again below).
 */
export const REFRESHABLE =
  /^pr: mergeable is |merge conflicts|^drift: drift-check failed(?! \(guards:)|^drift: drift-check failed \(guards: mcp-server tests \([^()]*tool reference[^()]*\)\) \(log /i;

/** The drift refusal whose only failed guard is the one that checks the generated tool reference. */
const TOOL_DOCS_DRIFT =
  /^drift: drift-check failed \(guards: mcp-server tests \([^()]*tool reference[^()]*\)\) \(log /i;

/** Generated pages `npm run docs:tools` rewrites; the gate's patch id ignores the same paths. */
export const GENERATED_DOCS = /^docs\/reference\/(tools\.md|tools\/[^/]+\.md)$/;

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
 * @returns {{ refusal: string } | { args: string[], log: string, post: string, postFailed: string }}
 */
export function refreshStep(refresh, r, reason, progress) {
  const fr = refresh?.(r, reason, progress);
  if (!fr?.head) return { refusal: fr?.why ? `${reason} (${fr.why})` : reason };
  const review = reviewOf(progress, r.pr);
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
    postFailed: `merge runner: merged main into #${r.pr}'s branch (${was} to ${now}) but could not write the ready line; a lane or the planner writes a ready line for ${fr.head}`,
  };
}

/**
 * The `review <path>` part of PR `pr`'s ready line in an item's progress, or ''. An item with two
 * PRs has two lines: the last one is not necessarily this PR's (L1).
 * @param {string | undefined} progress @param {number} [pr]
 */
export function reviewOf(progress, pr) {
  const lines = (progress ?? '').split('\n');
  const last =
    (pr === undefined ? undefined : lines.find(l => readyOrEnqueuedPr(l) === pr)) ??
    lines.at(-1) ??
    '';
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
    'headRefName,headRefOid,baseRefName,isCrossRepository,isDraft,state',
  ]);
  /** @type {{ headRefName?: string, headRefOid?: string, baseRefName?: string, isCrossRepository?: boolean, isDraft?: boolean, state?: string }} */
  let info;
  try {
    info = JSON.parse(pv.stdout);
  } catch {
    return no('the PR could not be read');
  }
  if (pv.status !== 0 || !info?.headRefName) return no('the PR could not be read');
  if (info.state !== 'OPEN' || info.isDraft || info.isCrossRepository)
    return no('not an open, same-repo, non-draft PR');
  if (info.baseRefName !== 'main' || info.headRefOid !== o.head)
    return no('the PR is not based on main, or its head is not the ready head');

  const base = git(['merge-base', main, o.head]).stdout.trim();
  const lockMoved =
    base !== '' && git(['diff', '--quiet', base, main, '--', 'package-lock.json']).status !== 0;
  // A drift refusal that names no guard is the moved lockfile; with the lock unmoved merging cannot help.
  const toolDocs = TOOL_DOCS_DRIFT.test(o.reason);
  if (/^drift: /i.test(o.reason) && !lockMoved && !toolDocs)
    return no('drift refusal, but package-lock.json did not move');
  // Back to the old head, and no half-written generated page left behind (reset keeps untracked files).
  const restore = () => {
    git(['merge', '--abort']);
    git(['reset', '-q', '--hard', o.head]);
    git(['clean', '-fdq', '--', 'docs/reference']);
  };
  const fail = (/** @type {string} */ why) => {
    restore();
    return no(why);
  };
  // An old head that main already contains would fast-forward, and the amend below would rewrite main's tip.
  if (git(['merge-base', '--is-ancestor', o.head, main]).status === 0)
    return no('the head is already part of main');
  let regen = toolDocs;
  let regenChanged = false;
  const merged = git(
    [...IDENT, 'merge', '--no-ff', '--no-verify', '--no-edit', '-m', REFRESH_SUBJECT, main],
    5 * 60_000
  );
  const mergePending = merged.status !== 0;
  if (mergePending) {
    const files = git(['diff', '--name-only', '--diff-filter=U'])
      .stdout.split(/\r?\n/)
      .filter(Boolean);
    if (files.length === 0 || !files.every(f => GENERATED_DOCS.test(f))) {
      return fail(
        files.length > 0
          ? `a real conflict in ${files.slice(0, 5).join(', ')}: the lane has to resolve it`
          : `git merge failed (${oneLine(merged.stderr || merged.stdout, 160)})`
      );
    }
    // Only generated pages conflict: take the lane's side, regenerate below, then commit.
    regen = true;
    if (
      git(['checkout', '--ours', '--', ...files]).status !== 0 ||
      git(['add', '--', ...files]).status !== 0
    )
      return fail('the generated tool pages could not be staged');
  }
  if (regen) {
    const gen =
      process.platform === 'win32'
        ? o.run('cmd.exe', ['/d', '/s', '/c', 'npm run docs:tools'], {
            cwd: o.checkout,
            timeout: NPM_TIMEOUT,
          })
        : o.run('npm', ['run', 'docs:tools'], { cwd: o.checkout, timeout: NPM_TIMEOUT });
    if (gen.status !== 0)
      return fail(`npm run docs:tools failed (${oneLine(gen.stderr || gen.stdout, 160)})`);
    // One add per path: git refuses the whole call when one pathspec matches nothing.
    git(['add', '--', 'docs/reference/tools.md']);
    git(['add', '--', 'docs/reference/tools']);
    // --no-verify: the repo's pre-commit hook must not run (or rewrite pages) in the unattended gate checkout.
    if (mergePending) {
      if (git([...IDENT, 'commit', '--no-verify', '--no-edit', '-m', REFRESH_SUBJECT]).status !== 0)
        return fail('the merge commit could not be written');
    } else if (git(['diff', '--cached', '--quiet']).status !== 0) {
      regenChanged = true;
      if (git([...IDENT, 'commit', '--no-verify', '--amend', '--no-edit']).status !== 0)
        return fail('the regenerated tool pages could not be committed');
    }
    // A tool-reference refusal that regeneration does not cure is not the pages' fault: no push.
    if (toolDocs && !mergePending && !regenChanged && !lockMoved)
      return fail('regenerating the tool pages changed nothing');
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
      restore();
      return no(
        npm.status !== 0
          ? `npm install --package-lock-only failed (${oneLine(npm.stderr || npm.stdout, 160)})`
          : 'the merged package-lock.json would still change; the lane has to regenerate it'
      );
    }
  }
  const head = git(['rev-parse', 'HEAD']).stdout.trim();
  // Never a force: the lease only lets the push through while the remote branch is exactly the old head.
  const ref = `refs/heads/${info.headRefName}`;
  const pushed = o.run(
    'git',
    ['push', `--force-with-lease=${ref}:${o.head}`, 'aitool', `${head}:${ref}`],
    { cwd: o.checkout, timeout: TIMEOUT }
  );
  restore();
  if (pushed.status !== 0)
    return no(`the push failed (${oneLine(pushed.stderr || pushed.stdout, 160)})`);
  return { head };
}
