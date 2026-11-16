// @ts-check
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REPO } from './constants.mjs';
import { checkNamer, runIdOf } from './ci.mjs';

/** The CI job that merges the shards' story renders into the artifact of the same name. */
const REPORT_CHECK = 'dashboard-visual-diff (report)';
const ARTIFACT = 'dashboard-visual-diff';

/** A `visual: accepted <n> <hash>` line (bullet and bold markers allowed). */
const ACCEPT = /^\s*(?:[-*]\s+)?(?:\*\*)?visual:(?:\*\*)?\s*accepted\s+(\d+)\s+([0-9a-f]{8})\b/i;

/**
 * The accepted lines of a review note's text. @param {string} text
 * @returns {{ n: number, hash: string }[]}
 */
export function acceptLines(text) {
  const out = [];
  for (const line of text.split(/\r?\n/)) {
    const m = ACCEPT.exec(line);
    if (m) out.push({ n: Number(m[1]), hash: m[2].toLowerCase() });
  }
  return out;
}

/**
 * The refusal for a head whose dashboard story shots differ from main's, or null. Reads the
 * `dashboard-visual-diff` artifact of the head's run; a differing set needs a review note for the
 * head with `visual: accepted <n> <hash>` matching that set. No report check (the path filter
 * skipped the visual job) or zero differences need nothing. A report job that is pending, failed
 * or has no artifact refuses: nobody could have looked.
 * @param {{ run: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string },
 *   rollup: any[], head: string, reviews: { entries: { head: string | null }[], visual?: { n: number, hash: string }[] }[] }} o
 * @returns {string | null}
 */
export function visualAcceptProblem({ run, rollup, head, reviews, carried = [] }) {
  const name = checkNamer(rollup);
  const reports = rollup
    .filter(c => name(c) === REPORT_CHECK)
    .sort((a, b) => (runIdOf(b) ?? 0) - (runIdOf(a) ?? 0));
  const check = reports[0];
  if (!check) return null;
  const status = String(check.status ?? '').toUpperCase();
  const conclusion = String(check.conclusion ?? '').toUpperCase();
  if (status && status !== 'COMPLETED') {
    return `visual: ${REPORT_CHECK} is still ${status.toLowerCase()}`;
  }
  if (conclusion === 'SKIPPED') return null;
  const runId = runIdOf(check);
  const link = runId === null ? 'its CI run' : `https://github.com/${REPO}/actions/runs/${runId}`;
  if (conclusion !== 'SUCCESS' || runId === null) {
    return `visual: ${REPORT_CHECK} did not succeed (${conclusion || 'no conclusion'}); rerun it (${link})`;
  }
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-visual-'));
  try {
    const got = run('gh', [
      'run',
      'download',
      String(runId),
      '-R',
      REPO,
      '-n',
      ARTIFACT,
      '-D',
      dir,
    ]);
    const file = path.join(dir, 'visual-diff.json');
    if (got.status !== 0 || !fs.existsSync(file)) {
      const why = (got.stderr || 'no visual-diff.json').trim().split(/\r?\n/)[0];
      return `visual: the ${ARTIFACT} artifact of run ${runId} cannot be read (${why}); rerun the report job (${link})`;
    }
    /** @type {any} */
    let report;
    try {
      report = JSON.parse(fs.readFileSync(file, 'utf8'));
    } catch {
      return `visual: ${ARTIFACT} visual-diff.json of run ${runId} is not valid JSON; rerun the report job (${link})`;
    }
    if (report.headSha && String(report.headSha).toLowerCase() !== head) {
      return `visual: the ${ARTIFACT} report is for ${String(report.headSha).slice(0, 8)}, not the head ${head.slice(0, 8)}; wait for CI on the head (${link})`;
    }
    const count = Number(report.count);
    const hash = String(report.hash ?? '').toLowerCase();
    if (!Number.isInteger(count) || !/^[0-9a-f]{8}$/.test(hash)) {
      return `visual: ${ARTIFACT} visual-diff.json of run ${runId} has no count or hash; rerun the report job (${link})`;
    }
    // Nothing compared (the base did not build, no shard rendered) or stories that could not
    // render: nobody can have looked, so this is no "no differences".
    const unseen = Number(report.compared) === 0 ? 'no story was compared' : null;
    const errors = Array.isArray(report.errors) ? report.errors.length : 0;
    if (unseen || errors > 0) {
      return `visual: ${unseen ?? `${errors} stor${errors === 1 ? 'y' : 'ies'} could not render`} in the ${ARTIFACT} report of run ${runId}; fix the render or rerun the report job (${link})`;
    }
    if (count === 0) return null;
    const accepted = reviews
      .filter(r => r.entries.some(e => e.head === head || (!!e.head && carried.includes(e.head))))
      .flatMap(r => r.visual ?? []);
    if (accepted.some(a => a.n === count && a.hash === hash)) return null;
    const stale =
      accepted.length > 0
        ? ` (the note's line is for another set: ${accepted.map(a => `${a.n} ${a.hash}`).join(', ')})`
        : '';
    return `visual: ${count} dashboard story shot${count === 1 ? '' : 's'} differ from main${stale}; open index.html in ${link} (artifact ${ARTIFACT}), then add "visual: accepted ${count} ${hash}" to the review note for head ${head.slice(0, 8)}`;
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}
