#!/usr/bin/env node
// @ts-check
/**
 * The ready command (`/ready` in a lane): from a clean, pushed PR branch, either write the ready
 * line the merge runner acts on or print one list of everything that is missing.
 *
 *   node scripts/lane-ready.mjs [<PR>] [--item <backlog id>] [--vault DIR] [--check]
 *
 * The PR defaults to the one of the current branch. The checks are the gate's own: this runs
 * `scripts/lane-merge.mjs <PR> --dry-run` (which relaunches main's copy of the gate, so the branch
 * cannot change what it judges) and adds what the gate does not look at: a `Backlog: <id>` line in
 * the PR description and an item this lane has claimed. When the gate says
 * `lane:merge: OK #<PR>` the ready line is written with `backlog.mjs progress <id> --ready <PR>
 * --head <sha> --review <note>`; `--check` stops before the write. Exit 0 ready, 1 not ready.
 * Never edits the gate; reuses it by running it. Tests: scripts/lane-ready.test.mjs.
 */
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { defaultRun } from './lane-merge/run.mjs';
import { findReviewNotes } from './lane-merge/reviews.mjs';

/** @import { Run } from './lane-merge/run.mjs' */

/**
 * The reasons in a gate refusal: the lines between `NOT merged` and the one-line summary, minus the
 * notices (`lane:merge: ...`) and the log tail details.
 * @param {string} output @returns {string[]}
 */
export function gateProblems(output) {
  const lines = output.split(/\r?\n/);
  const start = lines.findIndex(l => /^lane:merge: NOT merged/.test(l));
  if (start < 0) return [];
  const out = [];
  for (const l of lines.slice(start + 1)) {
    if (/^lane:merge: refused because/.test(l)) break;
    if (/^lane:merge: /.test(l) || !l.trim()) continue;
    out.push(l.trim());
  }
  return out.length ? out : lines.filter(l => /^lane:merge: refused because/.test(l));
}

/** The Backlog ids a PR description names (`Backlog: a, b` or `Backlog-part: a`). @param {string} body */
export function backlogIds(body) {
  const ids = [];
  for (const m of body.matchAll(/^\s*Backlog(?:-part)?:\s*(.+)$/gim)) {
    ids.push(...m[1].split(/[,\s]+/).filter(s => /^[a-z0-9][a-z0-9-]*$/.test(s)));
  }
  return ids;
}

/**
 * The vault-relative path of the review note for a head (the newest note that names it).
 * @param {string} vault @param {number} pr @param {string} head
 * @returns {string | null}
 */
export function reviewNotePath(vault, pr, head) {
  const handoff = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff');
  const notes = findReviewNotes(vault, pr) ?? [];
  const named = notes.filter(n => n.entries.some(e => e.head === head));
  const pick = (named.length ? named : notes).map(n => n.name).sort();
  const name = pick.at(-1);
  if (!name || !fs.existsSync(handoff)) return null;
  for (const dir of fs.readdirSync(handoff)) {
    if (dir.startsWith('Reviews ') && fs.existsSync(path.join(handoff, dir, name))) {
      return `Handoff/${dir}/${name}`;
    }
  }
  return null;
}

/**
 * @param {{ argv?: string[], run?: Run, log?: (l: string) => void, env?: Record<string, string | undefined>, home?: string, repoRoot?: string }} [o]
 * @returns {number}
 */
export function main(o = {}) {
  const {
    argv = process.argv.slice(2),
    run = defaultRun,
    log = console.log,
    env = process.env,
    home = os.homedir(),
    repoRoot = path.resolve(fileURLToPath(new URL('..', import.meta.url))),
  } = o;
  /** @type {string | null} */
  let prArg = null;
  /** @type {string | null} */
  let item = null;
  /** @type {string | null} */
  let vaultArg = null;
  let check = false;
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    if (a === '--item') item = argv[++i] ?? null;
    else if (a === '--vault') vaultArg = argv[++i] ?? null;
    else if (a === '--check') check = true;
    else if (/^\d+$/.test(a) && prArg === null) prArg = a;
    else {
      log('lane:ready: usage: node scripts/lane-ready.mjs [<PR>] [--item <id>] [--vault DIR] [--check]');
      return 2;
    }
  }
  const vault =
    vaultArg ?? env.FOUNDRY_AI_OBSIDIAN_DIR ?? path.join(home, 'Documents', 'Obsidian', 'vault');
  const view = run('gh', [
    'pr',
    'view',
    ...(prArg ? [prArg] : []),
    '--json',
    'number,headRefOid,headRefName,isDraft,state,body',
  ]);
  /** @type {any} */
  let pr = null;
  try {
    pr = view.status === 0 ? JSON.parse(view.stdout) : null;
  } catch {
    /* handled below */
  }
  if (!pr) {
    log(
      `lane:ready: NOT ready: no pull request found${prArg ? ` for #${prArg}` : ' for this branch'}; push the branch and open a draft PR first`
    );
    return 1;
  }
  const n = Number(pr.number);
  const head = String(pr.headRefOid ?? '').toLowerCase();
  /** @type {string[]} */
  const missing = [];

  const ids = backlogIds(String(pr.body ?? ''));
  const id = item ?? (ids.length === 1 ? ids[0] : null);
  if (!id) {
    missing.push(
      ids.length > 1
        ? `backlog: the PR names ${ids.length} items (${ids.join(', ')}); pass --item <id>`
        : 'backlog: the PR description has no `Backlog: <id>` line (add it, or pass --item <id>)'
    );
  }

  // The gate's own dry run: relaunches main's copy, so this branch cannot change what it judges.
  const gateArgs = [path.join(repoRoot, 'scripts', 'lane-merge.mjs'), String(n), '--dry-run'];
  if (vaultArg) gateArgs.push('--vault', vaultArg);
  const gate = run('node', gateArgs);
  const output = `${gate.stdout}\n${gate.stderr}`;
  const passed = gate.status === 0 && new RegExp(`^lane:merge: OK #${n}\\b`, 'm').test(output);
  if (!passed) {
    const found = gateProblems(output);
    missing.push(
      ...(found.length
        ? found
        : [`gate: the dry run ended with exit ${gate.status} and no reason; run it by hand`])
    );
  }

  if (missing.length > 0) {
    log(`lane:ready: NOT ready #${n}: ${missing.length} thing${missing.length === 1 ? '' : 's'} missing`);
    for (const m of missing) log(`  - ${m}`);
    return 1;
  }
  const note = reviewNotePath(vault, n, head);
  if (check) {
    log(`lane:ready: ready #${n} at ${head.slice(0, 7)} (--check: no line written)`);
    return 0;
  }
  const args = [
    path.join(repoRoot, 'scripts', 'backlog.mjs'),
    'progress',
    /** @type {string} */ (id),
    '--ready',
    String(n),
    '--head',
    head,
    ...(note ? ['--review', note] : []),
  ];
  const w = run('node', args);
  if (w.status !== 0) {
    log(`lane:ready: NOT ready #${n}: the ready line was not written: ${(w.stderr || w.stdout).trim().split(/\r?\n/)[0]}`);
    return 1;
  }
  log(
    `lane:ready: ready #${n} at ${head.slice(0, 7)}; progress line written on ${id}${note ? ` (review ${note})` : ''}; keep the branch pushed and stop`
  );
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
