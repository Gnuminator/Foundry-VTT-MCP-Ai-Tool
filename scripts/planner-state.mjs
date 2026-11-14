/**
 * `backlog.mjs status --planner`: the planner's state on one screen. The pure formatters live
 * here; `scripts/backlog.mjs` gathers the inputs (vault files, `gh`) and prints the result.
 *
 * Sections after the ordinary `status` text: accepted items nobody claimed, open PRs (CI and the
 * review verdict for the head), the merge train, main's CI and the Waiting items that are due.
 * Why these: the planner-life measurement (vault `Design/Usage measurements 2026-11.md`, item 4)
 * found Backlog and state reads to be the largest block of a planner's context; gate output and
 * review notes are small, so they are not expanded here.
 */

import { parseWaiting } from '../.claude/hooks/start-alerts.mjs';
import fs from 'node:fs';
import path from 'node:path';
import { spawnSync } from 'node:child_process';
import { itemRefs, parseBacklog } from './backlog-items.mjs';

/** The repo gh must ask: never whatever remote the current folder happens to have. */
export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';

export const UNCLAIMED_DAYS = 3;
export const WAITING_LEAD_DAYS = 7;
export const LEDGER_LIMIT = 10;
export const LEDGER_OLD_DAYS = 30;

/** @param {string} iso */
export const dayNumber = iso => {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  return m ? Math.round(Date.UTC(+m[1], +m[2] - 1, +m[3]) / 86400000) : null;
};

/** @param {string} iso true for a calendar date: 2026-13-45 and 2026-02-30 are not */
const realDate = iso => {
  const n = dayNumber(iso);
  return n !== null && new Date(n * 86400000).toISOString().slice(0, 10) === iso;
};

/**
 * Accepted (`user verdict accept` in the source line) free items nobody claimed for more than
 * `UNCLAIMED_DAYS`. The age counts from the newest date in the source line; an item whose source
 * has no date is listed with "age unknown" because it cannot be shown to be young.
 * @param {string} backlogText @param {string} today YYYY-MM-DD
 */
export function unclaimedAccepted(backlogText, today) {
  const p = parseBacklog(backlogText);
  const now = dayNumber(today) ?? 0;
  const open = new Set(p.items.map(i => i.id));
  const out = [];
  for (const i of p.items) {
    const source = (i.fields.get('source') ?? []).join(' ');
    if (!i.id || !/user verdict accept/i.test(source)) continue;
    if ((i.fields.get('claimed') ?? []).length) continue;
    if (/\b(merged|fixed)\b/i.test((i.fields.get('progress') ?? []).at(-1) ?? '')) continue;
    // A blocked item cannot be claimed yet, so it is not "unclaimed for N days".
    if ((i.fields.get('blocked by') ?? []).flatMap(itemRefs).some(r => open.has(r))) continue;
    const dates = [...source.matchAll(/\d{4}-\d{2}-\d{2}/g)].map(m => dayNumber(m[0]) ?? 0);
    const days = dates.length ? now - Math.max(...dates) : null;
    if (days !== null && days <= UNCLAIMED_DAYS) continue;
    out.push({ id: i.id, days });
  }
  return out.map(
    o => `- ${o.id}: accepted, unclaimed for ${o.days ?? 'an unknown number of'} days`
  );
}

/**
 * The newest review note per PR. `notes` are `{ file, text }` for files named `<PR>-...review...md`.
 * Newest = highest round number in the name (`-round2`), the plain name being round 1.
 * @param {{ file: string, text: string }[]} notes @param {number} pr @param {string} [head]
 */
export function newestNote(notes, pr, head) {
  const mine = notes
    .map(n => {
      const m = /^(\d+)-(opus-)?review(?:-round(\d+))?(?:-delta(\d*))?\.md$/.exec(
        n.file.split(/[\\/]/).pop() ?? ''
      );
      if (!m || Number(m[1]) !== pr) return null;
      const delta = m[4] === undefined ? 0 : Number(m[4] || 1);
      return { ...n, round: Number(m[3] ?? 1), delta, opus: !!m[2] };
    })
    .filter(x => x !== null);
  mine.sort((a, b) => b.round - a.round || b.delta - a.delta || Number(b.opus) - Number(a.opus));
  // The note written for the head wins whatever its name; else the newest by name.
  const forHead = head
    ? mine.find(
        n =>
          [...n.text.matchAll(/^Head reviewed:\s*([0-9a-f]{40})/gim)]
            .at(-1)?.[1]
            .toLowerCase() === head.toLowerCase()
      )
    : undefined;
  return forHead ?? mine[0];
}

/**
 * Verdict of one note against a head sha.
 * @param {{ text: string } | undefined} note @param {string} head
 */
export function verdictFor(note, head) {
  if (!note) return 'no review note';
  const heads = [...note.text.matchAll(/^Head reviewed:\s*([0-9a-f]{40})/gim)].map(m => m[1]);
  const verdict =
    /##\s*Verdict[\s\S]*?\*\*([^*]+)\*\*/i.exec(note.text)?.[1]?.trim().replace(/\.$/, '') ?? '?';
  const reviewed = heads.at(-1);
  if (!reviewed) return `note has no Head reviewed line (${verdict})`;
  if (reviewed.toLowerCase() !== head.toLowerCase())
    return `${verdict} for old head ${reviewed.slice(0, 8)}`;
  return `${verdict} (head)`;
}

/**
 * CI state from `gh` statusCheckRollup entries (check runs and status contexts).
 * @param {any[]} rollup
 */
export function ciState(rollup) {
  if (!rollup?.length) return 'no checks';
  const bad = ['FAILURE', 'TIMED_OUT', 'CANCELLED', 'ERROR', 'ACTION_REQUIRED', 'STARTUP_FAILURE'];
  let pending = 0;
  for (const c of rollup) {
    const r = String(c.conclusion || c.state || '').toUpperCase();
    if (bad.includes(r)) return `red (${c.name || c.context || 'a check'})`;
    if (c.status && String(c.status).toUpperCase() !== 'COMPLETED') pending++;
    else if (!r || r === 'PENDING' || r === 'EXPECTED') pending++;
  }
  return pending ? `pending (${pending} of ${rollup.length})` : 'green';
}

/**
 * @param {any[] | null} prs `gh pr list --json number,title,headRefOid,isDraft,statusCheckRollup`
 * @param {{ file: string, text: string }[]} notes
 */
export function prTable(prs, notes) {
  if (prs === null) return ['Open PRs: gh not available'];
  const out = [`Open PRs (${prs.length}):`];
  for (const pr of prs) {
    const title = String(pr.title).split(/\s+/).slice(0, 8).join(' ');
    const draft = pr.isDraft ? ' draft,' : '';
    out.push(
      `- #${pr.number} ${title}:${draft} CI ${ciState(pr.statusCheckRollup)}, review ${verdictFor(newestNote(notes, pr.number, pr.headRefOid), pr.headRefOid)}`
    );
  }
  return out;
}

/** @param {string} text Merge train.md */
export function trainLine(text) {
  const fm = /^---\r?\n([\s\S]*?)\r?\n---/.exec(text)?.[1] ?? '';
  const get = (/** @type {string} */ k) => new RegExp(`^${k}:\\s*(.*)$`, 'm').exec(fm)?.[1].trim();
  if (!get('count')) return 'Merge train: not readable';
  const last = get('last-event');
  return `Merge train: ${get('count')} of ${get('limit') ?? '?'}${last ? `, last ${last} PR #${get('last-event-pr') ?? '?'} at ${get('last-event-at') ?? '?'}` : ''}; last roundtrip ${get('last-roundtrip-result') ?? '?'} at ${(get('last-roundtrip-sha') ?? '?').slice(0, 8)}`;
}

/** @param {any | null} run newest `ci.yml` run on main */
export function mainLine(run) {
  if (!run) return "Main's CI: unknown (gh not available)";
  const state = run.status === 'completed' ? run.conclusion : run.status;
  return `Main's CI: ${state} at ${String(run.headSha ?? '').slice(0, 8)}`;
}

/** @param {string} waitingText @param {string} today YYYY-MM-DD */
export function dueWaiting(waitingText, today) {
  const now = dayNumber(today) ?? 0;
  const due = parseWaiting(waitingText)
    .map(i => ({ ...i, d: dayNumber(i.due ?? ''), f: dayNumber(i.from ?? '') }))
    .filter(i => i.d !== null && now >= i.d - WAITING_LEAD_DAYS && (i.f === null || now >= i.f))
    .sort((a, b) => (a.d ?? 0) - (b.d ?? 0));
  if (!due.length) return 'Waiting due: none';
  return [
    `Waiting due (${due.length}):`,
    ...due.map(i => {
      const late = (i.d ?? 0) < now ? ', overdue' : '';
      return `- W${i.id} ${i.title.split(/\s+/).slice(0, 8).join(' ')} (${i.due}${late})`;
    }),
  ].join('\n');
}

/**
 * The newest review note of each PR, read from every `Handoff/Reviews <date>` folder of the vault.
 * Only the chosen note per PR is read.
 * @param {string} devDir vault `Dev/Foundry AI Tool` @param {number[]} prs
 */
export function gatherNotes(devDir, prs) {
  const handoff = path.join(devDir, 'Handoff');
  /** @type {{ file: string, text: string, full: string }[]} */
  const names = [];
  try {
    for (const d of fs.readdirSync(handoff).filter(n => /^Reviews \d{4}-\d{2}-\d{2}$/.test(n)))
      for (const f of fs.readdirSync(path.join(handoff, d)))
        names.push({ file: f, text: '', full: path.join(handoff, d, f) });
  } catch {
    return [];
  }
  const out = [];
  for (const pr of prs) {
    // Every note of the PR is read (a handful): the one for the head may be a delta note.
    for (const n of names)
      if (new RegExp(`^${pr}-.*review.*\\.md$`).test(n.file))
        out.push({ file: n.file, text: fs.readFileSync(n.full, 'utf8') });
  }
  return out;
}

/** @param {string[]} args @returns {any | null} parsed JSON from gh, or null */
export function ghJson(args) {
  const r = spawnSync('gh', args, { encoding: 'utf8', timeout: 60000 });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/**
 * Lows ledgers over `LEDGER_LIMIT` lines: count and how many lines are older than a month. A
 * ledger line is a `- YYYY-MM-DD ...` bullet. Sweeping stays a planner call (the user, 2026-11-13).
 * @param {string} lowsDir @param {string} today YYYY-MM-DD
 */
export function ledgerLines(lowsDir, today) {
  /** @type {string[]} */
  let files;
  try {
    files = fs.readdirSync(lowsDir).filter(f => f.endsWith('.md'));
  } catch {
    return 'Lows ledgers: not readable';
  }
  const now = dayNumber(today);
  const over = [];
  for (const f of files.sort()) {
    let text;
    try {
      text = fs.readFileSync(path.join(lowsDir, f), 'utf8');
    } catch {
      continue; // a folder named *.md or an unreadable file is not a ledger
    }
    const lines = text
      .split(/\r?\n/)
      .filter(l => /^- \d{4}-\d{2}-\d{2}\b/.test(l) && realDate(l.slice(2, 12)));
    if (lines.length <= LEDGER_LIMIT) continue;
    const old = lines.filter(l => {
      const d = dayNumber(l.slice(2, 12));
      return d !== null && now !== null && now - d > LEDGER_OLD_DAYS;
    }).length;
    over.push(`- ${f.slice(0, -3)}: ${lines.length} lines, ${old} older than a month`);
  }
  return over.length
    ? [
        `Lows ledgers over ${LEDGER_LIMIT} lines (${over.length}); a sweep is a planner call:`,
        ...over,
      ].join('\n')
    : `Lows ledgers over ${LEDGER_LIMIT} lines: none`;
}

/**
 * The extra sections of `status --planner`.
 * @param {{ devDir: string, backlog: string, today: string, gh?: (a: string[]) => any }} o
 */
export function plannerSections(o) {
  const gh = o.gh ?? ghJson;
  const read = (/** @type {string} */ f) => {
    try {
      return fs.readFileSync(path.join(o.devDir, f), 'utf8');
    } catch {
      return null;
    }
  };
  const prs = gh([
    'pr',
    'list',
    '-R',
    REPO,
    '--json',
    'number,title,headRefOid,isDraft,statusCheckRollup',
  ]);
  const runs = gh([
    'run',
    'list',
    '-R',
    REPO,
    '--branch',
    'main',
    '-w',
    'ci.yml',
    '-L',
    '1',
    '--json',
    'status,conclusion,headSha',
  ]);
  const unclaimed = unclaimedAccepted(o.backlog, o.today);
  return [
    unclaimed.length
      ? [`Accepted, unclaimed (${unclaimed.length}):`, ...unclaimed].join('\n')
      : 'Accepted, unclaimed: none',
    prTable(
      prs,
      gatherNotes(
        o.devDir,
        (prs ?? []).map((/** @type {any} */ p) => p.number)
      )
    ).join('\n'),
    trainLine(read('Merge train.md') ?? ''),
    mainLine(runs?.[0] ?? null),
    ledgerLines(path.join(o.devDir, 'Lows'), o.today),
    (() => {
      const w = read('Waiting.md');
      return w === null ? 'Waiting due: not readable' : dueWaiting(w, o.today);
    })(),
  ];
}
