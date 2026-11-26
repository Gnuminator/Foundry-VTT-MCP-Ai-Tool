// @ts-check
import { riskyHits } from './risky.mjs';

/**
 * A fix round after an Opus review gets a review sized to the fix (D-101, amended 2026-11-26): when
 * an Opus note reviewed an earlier commit of the branch and everything the branch changed since
 * then touches no Opus-list path, a Sonnet Merge for the head is enough on a risky PR. The change
 * since the reviewed commit is read from the branch's own first-parent commits: a clean merge of
 * main adds nothing, and a conflict resolution counts by the files it resolved (`--cc`). A reviewed
 * commit that is not an ancestor of the head (a rebase) gives no relief. Any git error gives none.
 * @param {(cmd: string, args: string[], input?: string) => { status: number, stdout: string, stderr: string }} run
 * @param {import('./reviews.mjs').ReviewNote[]} notes @param {string} headSha
 * @returns {{ relief: true, from: string, files: string[] } | { relief: false, why: string }}
 */
export function fixRoundRelief(run, notes, headSha) {
  const head = headSha.toLowerCase();
  /** @type {string[]} */
  const opusHeads = [];
  for (const n of notes) {
    if (!n.opus) continue;
    for (const e of n.entries) if (e.head && e.head !== head) opusHeads.push(e.head);
  }
  if (opusHeads.length === 0) return { relief: false, why: 'no earlier Opus review' };
  /** The reviewed ancestor with the smallest change since it. @type {{ from: string, files: string[] } | null} */
  let best = null;
  for (const sha of [...new Set(opusHeads)]) {
    const anc = run('git', ['merge-base', '--is-ancestor', sha, head]);
    if (anc.status !== 0) continue;
    const log = run('git', [
      'log',
      '--first-parent',
      '--cc',
      '--name-only',
      '--no-renames',
      '--format=',
      `${sha}..${head}`,
    ]);
    if (log.status !== 0) return { relief: false, why: 'git log failed' };
    const files = [
      ...new Set(
        log.stdout
          .split(/\r?\n/)
          .map(l => l.trim())
          .filter(Boolean)
      ),
    ];
    if (best === null || files.length < best.files.length) best = { from: sha, files };
  }
  if (best === null) return { relief: false, why: 'no Opus-reviewed commit is an ancestor' };
  const hits = riskyHits(best.files);
  if (hits.length > 0) {
    return { relief: false, why: `the fix since ${best.from.slice(0, 7)} touches ${hits[0].file}` };
  }
  return { relief: true, from: best.from, files: best.files };
}

/**
 * The gate's use of fixRoundRelief for a risky PR: does the head still need an Opus Merge? An Opus
 * note that names the head itself keeps the rule; otherwise a fix round off the Opus list drops it.
 * @param {(cmd: string, args: string[], input?: string) => { status: number, stdout: string, stderr: string }} run
 * @param {import('./reviews.mjs').ReviewNote[]} notes @param {string} head
 * @returns {{ needOpus: boolean, notice?: string }}
 */
export function fixRoundNeedsOpus(run, notes, head) {
  if (notes.some(r => r.opus && r.entries.some(e => e.head === head))) return { needOpus: true };
  const fix = fixRoundRelief(run, notes, head);
  if (!fix.relief) return { needOpus: true };
  return {
    needOpus: false,
    notice: `review: fix round, a Sonnet review is enough: since the Opus review of ${fix.from.slice(0, 7)} the branch changed ${fix.files.length} file(s), none on the Opus list`,
  };
}
