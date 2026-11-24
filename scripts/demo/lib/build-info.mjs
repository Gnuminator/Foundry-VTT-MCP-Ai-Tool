// Which build a take filmed: the repo commit and the dashboard version. demo.mjs writes it into
// take.json, compose copies it into `<cut>.builds.json`, and `olderThan` lists the chapters filmed
// before a given commit (a UI change), so a later check knows which takes to refilm.

import { spawnSync } from 'node:child_process';
import { readFileSync } from 'node:fs';
import { join } from 'node:path';

const git = (root, args) => spawnSync('git', args, { cwd: root, encoding: 'utf8' });

/** {commit, dirty, dashboardVersion} of the checkout at `root`; null fields when unknown. */
export function buildInfo(root) {
  let commit = null;
  let dirty = null;
  const head = git(root, ['rev-parse', 'HEAD']);
  if (head.status === 0) {
    commit = head.stdout.trim();
    const st = git(root, ['status', '--porcelain', '--untracked-files=no']);
    dirty = st.status === 0 ? st.stdout.trim() !== '' : null;
  }
  let dashboardVersion = null;
  try {
    const pkg = JSON.parse(
      readFileSync(join(root, 'packages', 'cogm-dashboard', 'package.json'), 'utf8')
    );
    dashboardVersion = pkg.version ?? null;
  } catch {
    // no dashboard package in this checkout
  }
  return { commit, dirty, dashboardVersion };
}

/** The `build` block of a take folder's take.json, or null (older takes carry none). */
export function readTakeBuild(takeDir) {
  try {
    const b = JSON.parse(readFileSync(join(takeDir, 'take.json'), 'utf8')).build;
    return b && typeof b === 'object' ? b : null;
  } catch {
    return null;
  }
}

/**
 * Chapters filmed before `commit`: those whose build commit is not `commit` or a descendant of it,
 * and those with no recorded build (unknown counts as older). `isAncestor(a, b)` says whether
 * commit a is an ancestor of (or equal to) b.
 * @param {{id: string, build: {commit?: string|null}|null}[]} chapters
 */
export function olderThan(chapters, commit, isAncestor) {
  return chapters.filter(c => {
    const filmed = c.build?.commit;
    return !filmed || !isAncestor(commit, filmed);
  });
}

/** True when `commit` exists in the checkout at `root`. */
export const hasCommit = (root, commit) =>
  git(root, ['rev-parse', '--verify', '--quiet', `${commit}^{commit}`]).status === 0;

/**
 * `isAncestor` for olderThan, backed by git in `root`. A filmed commit this checkout does not
 * have (a take from another PC) is unknown, not "older": it counts as not older, and `unknown`
 * collects it so the caller can say so.
 */
export const gitIsAncestor =
  (root, unknown = new Set()) =>
  (a, b) => {
    if (!hasCommit(root, b)) {
      unknown.add(b);
      return true;
    }
    return git(root, ['merge-base', '--is-ancestor', a, b]).status === 0;
  };
