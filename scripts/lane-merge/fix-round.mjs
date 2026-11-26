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

/**
 * A fingerprint of the PR's patch at `sha` limited to `files`: its `git patch-id` plus the file
 * modes and statuses (patch-id ignores mode lines). Null on any git problem.
 * @param {GitRun} run @param {string} base @param {string} sha @param {string[]} files
 * @returns {string | null}
 */
function riskyPatch(run, base, sha, files) {
  const spec = ['--', ...files.map(f => `:(literal)${f}`)];
  const flags = ['--no-renames', '--no-color', '--no-ext-diff', '--no-textconv', '--no-relative'];
  const diff = run('git', ['diff', '--binary', '--full-index', ...flags, base, sha, ...spec]);
  const raw = run('git', ['diff', '--raw', '--no-abbrev', ...flags, base, sha, ...spec]);
  if (diff.status !== 0 || raw.status !== 0) return null;
  const modes = raw.stdout
    .split(/\r?\n/)
    .filter(Boolean)
    .map(l => l.replace(/^:(\d+) (\d+) [0-9a-f]+ [0-9a-f]+ /, '$1 $2 '))
    .join('\n');
  if (diff.stdout.trim() === '') return `empty|${modes}`;
  const pid = run('git', ['patch-id', '--verbatim'], diff.stdout);
  const id = /^([0-9a-f]{40})\s/.exec(pid.stdout)?.[1];
  return id ? `${id}|${modes}` : null;
}

/**
 * True when an Opus note names an Opus-list file in one of its H or M findings: a Merge after fixes
 * from it may mean an unfixed finding on a risky file, so it opens no relief.
 * @param {import('./reviews.mjs').ReviewNote} note
 */
function riskyFindings(note) {
  let inFinding = false;
  for (const line of (note.text ?? '').split(/\r?\n/)) {
    if (/^#{1,6}\s+\**[HM]\d+\b|^\**[HM]\d+[.:)\s]/.test(line)) inFinding = true;
    else if (/^#{1,6}\s/.test(line)) inFinding = false;
    if (!inFinding) continue;
    // Every path-like run after a start or a slash counts, so an absolute path (even one with
    // spaces), a backslash path and a file without an extension all reach the Opus-list match.
    const text = line.replace(/\\/g, '/');
    for (let i = 0; i < text.length; i++) {
      if (i > 0 && text[i - 1] !== '/' && /[\w@./-]/.test(text[i - 1])) continue;
      const m = /^[\w@./-]+/.exec(text.slice(i));
      if (m && riskyHits([m[0]]).length > 0) return true;
    }
  }
  return false;
}

/** @param {string | null} verdict */
const verdictWord = verdict =>
  verdict
    ? verdict
        .replace(/\*\*/g, '')
        .replace(/[.\s]+$/, '')
        .toLowerCase()
    : '';

/**
 * A fix round after an Opus review gets a review sized to the fix (D-152, amends D-101): when an
 * Opus note reviewed an earlier commit of this PR and the PR's own patch on every Opus-list file
 * is the same at that commit and at the head, a Sonnet Merge for the head is enough on a risky PR.
 * The comparison is by content (git patch-id of the PR patch limited to the risky files, plus file
 * modes), not by history, so merge direction, conflict resolutions and rebases cannot hide a risky
 * change; a clean merge of main that leaves the PR's risky patch alone keeps the relief.
 * What opens it: an Opus entry saying Merge, or Merge after fixes when that note's H and M
 * findings name no Opus-list file. What closes it: any Opus entry that is not a Merge verdict
 * (Do not merge) on the same risky patch as the head. Nothing to compare (no Opus-list file in
 * either patch) and any git error give no relief.
 * @param {GitRun} run
 * @param {import('./reviews.mjs').ReviewNote[]} notes @param {string} headSha @param {string} [mainRef]
 * @returns {{ relief: true, from: string, files: string[] } | { relief: false, why: string }}
 */
export function fixRoundRelief(run, notes, headSha, mainRef = MAIN) {
  const head = headSha.toLowerCase();
  /** @type {{ sha: string, open: boolean }[]} */
  const entries = [];
  for (const n of notes) {
    if (!n.opus) continue;
    const risky = riskyFindings(n);
    for (const e of n.entries) {
      if (!e.head || e.head === head) continue;
      const v = verdictWord(e.verdict);
      entries.push({ sha: e.head, open: v === 'merge' || (v === 'merge after fixes' && !risky) });
    }
  }
  if (entries.length === 0) return { relief: false, why: 'no earlier Opus review' };
  const atHead = riskyFilesAt(run, head, mainRef);
  if (!atHead) return { relief: false, why: 'git could not read the head' };
  /** @type {Map<string, { files: string[], same: boolean } | null>} */
  const cache = new Map();
  const compare = (/** @type {string} */ sha) => {
    if (!cache.has(sha)) {
      const atSha = riskyFilesAt(run, sha, mainRef);
      const files = atSha ? [...new Set([...atHead.files, ...atSha.files])] : [];
      const a = atSha && files.length > 0 ? riskyPatch(run, atSha.base, sha, files) : null;
      const h = a === null ? null : riskyPatch(run, atHead.base, head, files);
      cache.set(sha, a === null || h === null ? null : { files, same: a === h });
    }
    return cache.get(sha) ?? null;
  };
  // An Opus entry that is not a Merge verdict, on the head's own risky patch, vetoes the relief.
  for (const x of entries) {
    if (x.open) continue;
    const c = compare(x.sha);
    if (c === null) {
      return { relief: false, why: `cannot compare the Opus review at ${x.sha.slice(0, 7)}` };
    }
    if (c.same) {
      return {
        relief: false,
        why: `Opus reviewed this patch at ${x.sha.slice(0, 7)} and did not clear it (Do not merge, or Merge after fixes with a finding on an Opus-list file)`,
      };
    }
  }
  let why = 'the PR patch on the Opus list changed since every Opus-reviewed commit';
  for (const x of entries) {
    if (!x.open) continue;
    const c = compare(x.sha);
    if (c?.same) return { relief: true, from: x.sha, files: c.files };
    if (c)
      why = `the PR patch on ${c.files[0]} (or another Opus-list file) differs from the Opus-reviewed ${x.sha.slice(0, 7)}`;
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
