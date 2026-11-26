// @ts-check
import { riskyHits } from './risky.mjs';
import { MAIN } from './constants.mjs';

/** @typedef {(cmd: string, args: string[], input?: string) => { status: number, stdout: string, stderr: string }} GitRun */

/**
 * The Opus-list files a commit's PR patch (merge base with main to the commit) touches.
 * @param {GitRun} run @param {string} sha @param {string} mainRef
 * @returns {{ base: string, files: string[] } | null}
 */
function riskyFilesAt(run, sha, mainRef) {
  const mb = run('git', ['merge-base', mainRef, sha]);
  const base = mb.stdout.trim();
  if (mb.status !== 0 || !/^[0-9a-f]{40}$/.test(base)) return null;
  const names = run('git', [
    'diff',
    '--name-only',
    '-z',
    '--no-renames',
    '--no-relative',
    base,
    sha,
  ]);
  if (names.status !== 0) return null;
  const files = names.stdout.split('\0').filter(f => f && riskyHits([f]).length > 0);
  return { base, files };
}

/** `git patch-id` of the PR's patch at `sha` limited to `files` ('' when the patch is empty). @param {GitRun} run */
function riskyPatchId(run, base, sha, files) {
  if (files.length === 0) return '';
  const diff = run('git', [
    'diff',
    '--binary',
    '--full-index',
    '--no-renames',
    '--no-color',
    '--no-ext-diff',
    '--no-textconv',
    '--no-relative',
    base,
    sha,
    '--',
    ...files.map(f => `:(literal)${f}`),
  ]);
  if (diff.status !== 0) return null;
  if (diff.stdout.trim() === '') return '';
  const pid = run('git', ['patch-id', '--verbatim'], diff.stdout);
  return /^([0-9a-f]{40})\s/.exec(pid.stdout)?.[1] ?? null;
}

/**
 * A fix round after an Opus review gets a review sized to the fix (D-152, amends D-101): when an
 * Opus note reviewed an earlier commit of this PR and the PR's own patch on every Opus-list file
 * is the same at that commit and at the head, a Sonnet Merge for the head is enough on a risky PR.
 * The comparison is by content (git patch-id of the PR patch limited to the risky files, as in
 * patchIdAt), not by history, so merge direction, conflict resolutions and rebases cannot hide a
 * risky change; a clean merge of main that does not touch the PR's risky patch keeps the relief.
 * Only Opus entries that said Merge or Merge after fixes count (a Do not merge opens nothing).
 * Any git error gives no relief.
 * @param {GitRun} run
 * @param {import('./reviews.mjs').ReviewNote[]} notes @param {string} headSha @param {string} [mainRef]
 * @returns {{ relief: true, from: string, files: string[] } | { relief: false, why: string }}
 */
export function fixRoundRelief(run, notes, headSha, mainRef = MAIN) {
  const head = headSha.toLowerCase();
  /** @type {string[]} */
  const opusHeads = [];
  for (const n of notes) {
    if (!n.opus) continue;
    for (const e of n.entries) {
      const v = e.verdict
        ? e.verdict
            .replace(/\*\*/g, '')
            .replace(/[.\s]+$/, '')
            .toLowerCase()
        : '';
      if (e.head && e.head !== head && (v === 'merge' || v === 'merge after fixes')) {
        opusHeads.push(e.head);
      }
    }
  }
  if (opusHeads.length === 0) return { relief: false, why: 'no earlier Opus review' };
  const atHead = riskyFilesAt(run, head, mainRef);
  if (!atHead) return { relief: false, why: 'git could not read the head' };
  let why = 'the PR patch on the Opus list changed since every Opus-reviewed commit';
  for (const sha of [...new Set(opusHeads)]) {
    const atSha = riskyFilesAt(run, sha, mainRef);
    if (!atSha) continue;
    const files = [...new Set([...atHead.files, ...atSha.files])];
    const a = riskyPatchId(run, atSha.base, sha, files);
    const h = riskyPatchId(run, atHead.base, head, files);
    if (a === null || h === null) continue;
    if (a === h) return { relief: true, from: sha, files };
    why = `the PR patch on ${files[0]} (or another Opus-list file) differs from the Opus-reviewed ${sha.slice(0, 7)}`;
  }
  return { relief: false, why };
}

/**
 * The gate's use of fixRoundRelief for a risky PR: does the head still need an Opus Merge? An Opus
 * note that names the head itself keeps the rule; otherwise a fix round off the Opus list drops it.
 * @param {GitRun} run
 * @param {import('./reviews.mjs').ReviewNote[]} notes @param {string} head
 * @returns {{ needOpus: boolean, notice?: string }}
 */
export function fixRoundNeedsOpus(run, notes, head) {
  if (notes.some(r => r.opus && r.entries.some(e => e.head === head))) return { needOpus: true };
  const fix = fixRoundRelief(run, notes, head);
  if (!fix.relief) return { needOpus: true };
  return {
    needOpus: false,
    notice: `review: fix round, a Sonnet review is enough: the PR patch on the Opus list is the same as in the Opus-reviewed ${fix.from.slice(0, 7)}`,
  };
}
