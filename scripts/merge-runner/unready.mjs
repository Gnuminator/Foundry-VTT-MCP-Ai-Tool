/**
 * PRs that are ready in every way except the ready line: open, not a draft, CI green on the head,
 * and a Merge review note for that head, but no ready (or enqueued) progress line on any item. The
 * merge runner only acts on ready lines, so such a PR used to wait unseen. This module only finds
 * them and words the notice; it never writes a ready line (a lane or the planner does that).
 *
 * Review parsing is the gate's own (scripts/lane-merge/reviews.mjs). Whether a PR is risky (and so
 * needs an Opus note) is the gate's call; the notice says "Merge note for the head" and the gate
 * still decides.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { parseBacklog, parseProgress, parseReadyAll } from '../backlog-items.mjs';
import { findReviewNotes, judgeReviews } from '../lane-merge/reviews.mjs';
import { ciState } from '../planner-state.mjs';
import { enqueuedItems } from './queue.mjs';

/** The `gh pr list --json` fields this module reads. */
export const UNREADY_PR_FIELDS = 'number,title,headRefOid,isDraft,statusCheckRollup,body';

/**
 * Item ids named on `<key>:` lines of a PR body (`Backlog` closes the item, `Backlog-part` does not).
 * @param {string} body @param {string} [key]
 */
export function backlogIds(body, key = 'Backlog') {
  return [...String(body ?? '').matchAll(new RegExp(`^\\s*${key}:[ \\t]*(.+)$`, 'gim'))].flatMap(
    m =>
      m[1]
        .split(/[\s,]+/)
        .map(s => s.replace(/`/g, ''))
        .filter(s => /^[a-z0-9][a-z0-9-]*$/i.test(s))
  );
}

/**
 * Does the PR body name the item on a `Backlog-part: <id>` line (a PR that is one part of an item
 * that stays open)? `Backlog: <id>` closes the item; the part line wins only when both name it.
 * @param {string} body @param {string} id
 */
export function isPartOnly(body, id) {
  return backlogIds(body, 'Backlog-part').includes(id) && !backlogIds(body).includes(id);
}

/**
 * @typedef {{ number: number, title?: string, headRefOid: string, isDraft?: boolean, body?: string,
 *   statusCheckRollup?: any[] }} OpenPr
 * @typedef {{ pr: number, head: string, ids: string[], title: string, note: string,
 *   missing?: string[] }} Unready ids: the PR's Backlog items that exist; missing: ids it names that do not
 */

/**
 * @param {OpenPr[]} prs open PRs
 * @param {string} backlogText
 * @param {(pr: number) => import('../lane-merge/reviews.mjs').ReviewNote[] | null} notesFor
 * @returns {Unready[]}
 */
export function findUnready(prs, backlogText, notesFor) {
  /** PRs a ready or enqueued line already names: the runner handles those. */
  const handled = new Set(enqueuedItems(backlogText).map(e => e.pr));
  for (const [, progress] of parseProgress(backlogText)) {
    for (const r of parseReadyAll(progress)) handled.add(r.pr);
    // The runner's own refusal replaced the ready line: the lane has been told, no second notice.
    for (const line of progress.split('\n')) {
      const refused = /^(?:\d{4}-\d{2}-\d{2} )?PR #(\d+) refused by the merge gate/.exec(
        line.trim()
      );
      if (refused) handled.add(Number(refused[1]));
    }
  }
  const existing = new Set(parseBacklog(backlogText).items.map(i => i.id));
  /** @type {Unready[]} */
  const out = [];
  for (const p of prs) {
    if (p.isDraft || handled.has(p.number) || !/^[0-9a-f]{40}$/.test(p.headRefOid ?? '')) continue;
    if (ciState(p.statusCheckRollup ?? []) !== 'green') continue;
    const notes = notesFor(p.number);
    if (!notes?.length) continue;
    const verdict = judgeReviews(notes, p.headRefOid, false, {}, p.number);
    if (!verdict.ok) continue;
    const named = [...backlogIds(p.body ?? ''), ...backlogIds(p.body ?? '', 'Backlog-part')];
    out.push({
      pr: p.number,
      head: p.headRefOid,
      ids: named.filter(i => existing.has(i)),
      missing: named.filter(i => !existing.has(i)),
      title: String(p.title ?? '')
        .split(/\s+/)
        .slice(0, 10)
        .join(' '),
      note: verdict.detail,
    });
  }
  return out;
}

/** The command that writes the ready line. @param {Unready} u */
export function readyCommand(u) {
  const ready = id =>
    `node scripts/backlog.mjs progress ${id} --ready ${u.pr} --head ${u.head} --review "${u.note.split(', ')[0]}"`;
  if (u.ids.length) return ready(u.ids[0]);
  // No item to write the line on (progress fails with "no item with id"): add one first.
  return `no Backlog item exists for it; add one (node scripts/backlog.mjs add --id <slug> --size S --title <t> --board <area> --done-when <t>), then ${ready('<slug>')}`;
}

/** One line for `status --planner` and #pr-log. @param {Unready} u */
export function unreadyLine(u) {
  const item = u.ids.length
    ? `item ${u.ids.join(', ')}`
    : u.missing?.length
      ? `no such Backlog item: ${u.missing.join(', ')}`
      : 'no Backlog: line in the PR body';
  return `#${u.pr}${u.title ? ` ${u.title}` : ''} (${item}): open, CI green and a Merge note for head ${u.head.slice(0, 7)}, but no ready line; the runner skips it. To queue it: ${readyCommand(u)}`;
}

/** A once-only key per PR and head. @param {Unready} u */
export const unreadyKey = u => `unready${u.pr}@${u.head}`;

/**
 * One #pr-log line per PR and head, once: kept in `tried` for this run and, through the deps'
 * `noticeSeen`/`noticeMark`, across restarts. Posts nothing else and writes no Backlog line.
 * @param {{ unready?: (t: string) => Unready[], noticeSeen?: (k: string) => boolean,
 *   noticeMark?: (k: string) => void, post: (t: string) => void, log: (l: string) => void }} d
 * @param {string} backlogText @param {Set<string>} tried
 */
export function announceUnready(d, backlogText, tried) {
  for (const u of d.unready?.(backlogText) ?? []) {
    const key = unreadyKey(u);
    if (tried.has(key) || d.noticeSeen?.(key)) continue;
    // The usual handoff (note, then ready line) takes minutes: post only when a second round
    // still finds the PR in this state.
    if (!tried.has(`pending-${key}`)) {
      tried.add(`pending-${key}`);
      continue;
    }
    tried.add(key);
    d.log(`#${u.pr}: CI green and a Merge note for the head, but no ready line`);
    d.post(`merge runner: ${unreadyLine(u)}`);
    d.noticeMark?.(key);
  }
}

/**
 * The runner's real dependencies for the notice: open PRs from gh, review notes from the vault, and
 * a small file that remembers what was posted (a restart does not post it again).
 * @param {{ sh: (cmd: string, args: string[]) => { status: number | null, stdout: string }, repo: string,
 *   vault: string, file?: string }} o
 */
export function makeUnreadyDeps({ sh, repo, vault, file }) {
  const store = file ?? path.join(os.homedir(), '.foundry-ai-tool', 'merge-runner-notices.json');
  /** @returns {string[]} */
  const read = () => {
    try {
      const v = JSON.parse(fs.readFileSync(store, 'utf8'));
      return Array.isArray(v) ? v.map(String) : [];
    } catch {
      return [];
    }
  };
  return {
    /** @param {string} backlogText @returns {Unready[]} */
    unready: backlogText => {
      const r = sh('gh', ['pr', 'list', '-R', repo, '--json', UNREADY_PR_FIELDS, '-L', '100']);
      if (r.status !== 0) return [];
      try {
        return findUnready(JSON.parse(r.stdout), backlogText, n => findReviewNotes(vault, n));
      } catch {
        return [];
      }
    },
    noticeSeen: (/** @type {string} */ key) => read().includes(key),
    noticeMark: (/** @type {string} */ key) => {
      try {
        fs.mkdirSync(path.dirname(store), { recursive: true });
        fs.writeFileSync(store, JSON.stringify([...read(), key].slice(-1000)));
      } catch {
        // not remembered: it may be posted once more after a restart
      }
    },
  };
}

/**
 * The `status --planner` section. `prs` null: gh unavailable.
 * @param {OpenPr[] | null} prs @param {string} backlogText @param {string} vault vault root
 */
export function unreadySection(prs, backlogText, vault) {
  if (prs === null) return 'Ready but no ready line: gh not available';
  const found = findUnready(prs, backlogText, n => findReviewNotes(vault, n));
  return found.length
    ? [`Ready but no ready line (${found.length}):`, ...found.map(u => `- ${unreadyLine(u)}`)].join(
        '\n'
      )
    : 'Ready but no ready line: none';
}
