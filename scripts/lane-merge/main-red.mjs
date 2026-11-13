// @ts-check
import { firstLine } from './run.mjs';

/** @import { Run } from './run.mjs' */

/** Conclusions that say nothing about main's health (a superseded or skipped run). */
const NEUTRAL = new Set(['cancelled', 'skipped', 'neutral', 'stale']);

/**
 * The text of an `Unblocks main:` line with real content, or null. Same shape as `Live check:`:
 * a bullet or bold is fine; an empty line, a placeholder or an HTML comment is not.
 * @param {string} body
 */
export function unblocksMainLine(body) {
  const text = String(body ?? '').replace(/<!--[\s\S]*?(-->|$)/g, '');
  for (const raw of text.split(/\r?\n/)) {
    const m =
      /^\s*(?:[-*]\s+)?(?:unblocks main:|\*\*unblocks main:\*\*|\*\*unblocks main\*\*:)\s*(.*)$/i.exec(
        raw
      );
    if (!m) continue;
    const t = m[1].trim();
    if (/[a-z0-9]{3}/i.test(t) && !/^<[^>]*>$/.test(t)) return t;
  }
  return null;
}

/**
 * The refusal when main's last completed push run of ci.yml failed, or null. A PR whose body has
 * an `Unblocks main:` line is the fix and may merge. Unreadable run data refuses too.
 * @param {Run} run @param {string} body
 * @returns {string | null}
 */
export function mainRedProblem(run, body) {
  if (unblocksMainLine(body) !== null) return null;
  const r = run('gh', [
    'run',
    'list',
    '--branch',
    'main',
    '--event',
    'push',
    '--workflow',
    'ci.yml',
    '--limit',
    '20',
    '--json',
    'databaseId,status,conclusion,headSha,url',
  ]);
  if (r.status !== 0) {
    return `main red: cannot read main's CI runs (gh run list failed: ${firstLine(r.stderr || r.stdout) || 'no output'}); refusing`;
  }
  /** @type {any[]} */
  let runs;
  try {
    runs = JSON.parse(r.stdout);
    if (!Array.isArray(runs)) throw new Error('not a list');
  } catch {
    return 'main red: gh run list answered something that is not a list of runs; refusing';
  }
  const last = runs.find(
    x => x.status === 'completed' && !NEUTRAL.has(String(x.conclusion ?? '').toLowerCase())
  );
  if (!last || String(last.conclusion).toLowerCase() === 'success') return null;
  const sha = String(last.headSha ?? '').slice(0, 7);
  return `main red: main's last completed push run of ci.yml failed (${last.conclusion}; run ${last.databaseId}${sha ? ` at ${sha}` : ''}${last.url ? `, ${last.url}` : ''}); merge only the fix: a PR whose description has an "Unblocks main: <what it fixes>" line`;
}
