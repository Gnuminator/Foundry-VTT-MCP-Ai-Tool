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
 * the PR description. When the gate says
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
import { backlogIds as runnerIds } from './merge-runner/unready.mjs';

/** @import { Run } from './lane-merge/run.mjs' */

/**
 * The reasons in a gate refusal, from its last line (`lane:merge: refused because (1) a (2) b`),
 * which the gate builds from the failures alone: no notices, no drift log tail. One reason stays one.
 * @param {string} output @returns {string[]}
 */
export function gateProblems(output) {
  const last = output
    .split(/\r?\n/)
    .filter(l => /^lane:merge: refused because /.test(l))
    .at(-1);
  if (!last) return [];
  const text = last.replace(/^lane:merge: refused because /, '').trim();
  if (!/^\(1\) /.test(text)) return [text];
  return text
    .split(/\s*\(\d+\) /)
    .map(s => s.trim())
    .filter(Boolean);
}

/**
 * The command that fixes each drift guard (names are the `name` fields in drift-check's CHECKS),
 * so a refusal says what to run and not only which guard failed. A guard with no generator gets
 * the by-hand advice.
 * @type {Array<[RegExp, string]>}
 */
export const DRIFT_FIXES = [
  [/^lint baseline/, 'npm run lint:ratchet -- --update'],
  [/^em-dash baseline/, 'npm run emdash:ratchet -- --update'],
  [/^line baseline/, 'npm run line:ratchet -- --update'],
  [/^unused baseline/, 'npm run unused:ratchet -- --update'],
  [/^usage catalog/, 'npm run usage:catalog'],
  [/^mcp-server tests/, 'npm run docs:tools'],
  [/^changelog fragments/, 'npm run changelog:check'],
];

/**
 * Failing guard names from a gate refusal, or from raw drift-check output (`raw`, `  FAIL <guard>` lines).
 * @param {string} output @param {boolean} [raw] @returns {string[]}
 */
export function driftGuards(output, raw = false) {
  // The gate's refusal names them: `drift: drift-check failed (guards: a, b (x, y)) (log ...`.
  const named = output.match(/drift-check failed \(guards: (.+?)\)(?: \[infra[^\]]*\])? \(log /);
  // Raw drift-check output (when /ready ran it itself) has one `  FAIL <guard>` line per guard.
  if (!named) {
    return raw ? [...output.matchAll(/^ {2}FAIL (.+?)\s*$/gm)].map(m => m[1]) : [];
  }
  /** @type {string[]} */
  const out = [];
  let depth = 0;
  let cur = '';
  for (const ch of named[1] + ',') {
    if (ch === '(') depth++;
    if (ch === ')') depth--;
    if (ch === ',' && depth === 0) {
      if (cur.trim()) out.push(cur.trim());
      cur = '';
    } else cur += ch;
  }
  return out;
}

/**
 * One line per failing guard with the exact command to run, then the reminder to commit, push and
 * run /ready again. Empty when no guard failed.
 * @param {string[]} guards @returns {string[]}
 */
export function driftAdvice(guards) {
  if (guards.length === 0) return [];
  const lines = guards.map(g => {
    const hit = DRIFT_FIXES.find(([re]) => re.test(g));
    return `drift (${g}): ${hit ? `run \`${hit[1]}\`` : 'fix by hand (see the drift-check log)'}`;
  });
  lines.push('drift: after the fix, merge aitool/main, commit, push, then run /ready again');
  return lines;
}

/** The Backlog ids a PR description names, once each (`Backlog` and `Backlog-part` lines). @param {string} body */
export function backlogIds(body) {
  return [...new Set([...runnerIds(body), ...runnerIds(body, 'Backlog-part')])];
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
  const from = named.length ? named : notes;
  // An Opus note wins (a risky PR needs it), else the newest by name.
  const name = (from.some(n => n.opus) ? from.filter(n => n.opus) : from)
    .map(n => n.name)
    .sort()
    .at(-1);
  if (!name || !fs.existsSync(handoff)) return null;
  for (const dir of fs.readdirSync(handoff).sort().reverse()) {
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
    if (a === '--item' || a === '--vault') {
      const v = argv[++i];
      if (!v || v.startsWith('--')) {
        log(`lane:ready: usage: ${a} needs a value`);
        return 2;
      }
      if (a === '--item') item = v;
      else vaultArg = v;
    } else if (a === '--check') check = true;
    else if (/^\d+$/.test(a) && prArg === null) prArg = a;
    else {
      log(
        'lane:ready: usage: node scripts/lane-ready.mjs [<PR>] [--item <id>] [--vault DIR] [--check]'
      );
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
      `lane:ready: NOT ready: no pull request found${prArg ? ` for #${prArg}` : ' for this branch'}; push the branch and open a PR first`
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
    let guards = driftGuards(output);
    // The gate runs drift-check last and skips it once anything else failed; run it here so one
    // list shows everything that would refuse the head.
    if (/drift-check not run/.test(output) && guards.length === 0) {
      const d = run('npm', ['run', 'drift:check']);
      guards = driftGuards(`${d.stdout}\n${d.stderr}`, true);
      if (d.status !== 0 && guards.length === 0) {
        missing.push('drift: drift-check failed; run `npm run drift:check` by hand');
      }
    }
    missing.push(...driftAdvice(guards));
  }

  if (missing.length > 0) {
    log(
      `lane:ready: NOT ready #${n}: ${missing.length} thing${missing.length === 1 ? '' : 's'} missing`
    );
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
    log(
      `lane:ready: NOT ready #${n}: the ready line was not written: ${(w.stderr || w.stdout).trim().split(/\r?\n/)[0]}`
    );
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
