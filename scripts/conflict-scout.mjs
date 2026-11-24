#!/usr/bin/env node
// @ts-check
/**
 * conflict-scout (Backlog item `conflict-scout`): where will my PR collide, before I start.
 *
 *   node scripts/conflict-scout.mjs <backlog id> [--files a,b,c] [--hours 24] [--json]
 *   node scripts/conflict-scout.mjs --files a,b,c
 *   node scripts/conflict-scout.mjs --replay [--log <merge-runner.log>] [--since YYYY-MM-DD] [--until YYYY-MM-DD]
 *
 * Takes the files the work will touch (the item's `- touches:` line, or --files), lists the open PRs
 * and the PRs merged in the last 24 hours that change any of them, names the hot files (tool maps,
 * checks.mjs, baselines, generated docs) and says go, wait for #N, or split. `backlog.mjs claim`
 * prints this after a claim. Advice only: it never blocks and exits 0 whatever it finds.
 *
 * `--replay` reads the merge runner's "has merge conflicts" refusals, and for each such PR asks what
 * the scout would have said when work began (the first commit), with the files the PR ended up
 * changing (hindsight: a lane knows its files only roughly at claim time); it counts the PR as
 * flagged when a PR that really collided (merged between that start and the refusal, sharing any
 * file, hot files included) was named.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseBacklog } from './backlog-items.mjs';
import { REPO } from './planner-state.mjs';

const HOUR = 3600 * 1000;

/** Files every busy lane ends up touching: a collision on these is expected, not a reason to wait. */
export const HOT_PATTERNS = [
  /^packages\/mcp-server\/src\/tools\/modules\//,
  /^packages\/mcp-server\/src\/tool-sets\.ts$/,
  /^packages\/foundry-module\/src\/write-gate\.ts$/,
  /^scripts\/checks\.mjs$/,
  /^scripts\/(lint|line|em-dash)-baseline\.json$/,
  /^docs\/reference\/tools/,
  /^package-lock\.json$/,
  /^CHANGELOG\.md$/,
];

/** @param {string} f */
export const isHot = f => HOT_PATTERNS.some(re => re.test(f.replace(/\\/g, '/')));

/**
 * @typedef {{number: number, title?: string, createdAt: string, mergedAt?: string|null,
 *   closedAt?: string|null, files: string[]}} Pr
 */

/** A PR file path equals a claimed path, or lies under a claimed folder (`dir/` or `dir/*`). @param {string} file @param {string} claim */
export function fileMatches(file, claim) {
  const f = file.replace(/\\/g, '/');
  const c = claim.replace(/\\/g, '/').replace(/\*+$/, '');
  if (c.endsWith('/')) return f.startsWith(c);
  return f === c;
}

/**
 * What the scout says at time `at`: PRs open then and PRs merged in the `hours` before, each with the
 * files it shares with `files`.
 * @param {{files: string[], at: Date, prs: Pr[], hours?: number, self?: number}} o
 */
export function scout({ files, at, prs, hours = 24, self }) {
  const t = at.getTime();
  const out = [];
  for (const pr of prs) {
    if (pr.number === self) continue;
    const created = Date.parse(pr.createdAt);
    const ended = Date.parse(pr.mergedAt || pr.closedAt || '') || Infinity;
    const merged = pr.mergedAt ? Date.parse(pr.mergedAt) : null;
    /** @type {'open'|'recent'|null} */
    let kind = null;
    if (created <= t && ended > t) kind = 'open';
    else if (merged !== null && merged <= t && merged > t - hours * HOUR) kind = 'recent';
    if (!kind) continue;
    const shared = [...new Set(pr.files.filter(f => files.some(c => fileMatches(f, c))))];
    if (!shared.length) continue;
    out.push({
      number: pr.number,
      title: pr.title ?? '',
      kind,
      shared,
      hot: shared.filter(isHot),
      plain: shared.filter(f => !isHot(f)),
    });
  }
  const open = out.filter(o => o.kind === 'open');
  const waitFor = open.filter(o => o.plain.length);
  const hotFiles = [...new Set(out.flatMap(o => o.hot))];
  /** @type {'go'|'wait'|'split'} */
  let verdict = 'go';
  if (waitFor.length >= 3) verdict = 'split';
  else if (waitFor.length) verdict = 'wait';
  return { verdict, colliding: out, waitFor: waitFor.map(o => o.number), hotFiles };
}

/** @param {ReturnType<typeof scout>} r */
export function formatScout(r) {
  const lines = [];
  if (!r.colliding.length) {
    lines.push(
      'conflict-scout: go. No open PR and no merge in the last 24 hours touches those files.'
    );
  } else {
    const head =
      r.verdict === 'go'
        ? r.colliding.some(c => c.plain.length)
          ? 'go, but PRs or merges touched these files: merge main first'
          : 'go, expect a merge of main (only hot files overlap)'
        : r.verdict === 'wait'
          ? `wait for ${r.waitFor.map(n => `#${n}`).join(', ')}, or work on files they do not touch`
          : `split: ${r.waitFor.map(n => `#${n}`).join(', ')} all touch the same files; cut the item so the parts avoid them`;
    lines.push(`conflict-scout: ${head}.`);
    for (const c of r.colliding) {
      const show = (c.plain.length ? c.plain : c.hot).slice(0, 4).join(', ');
      lines.push(
        `  #${c.number} ${c.kind === 'open' ? 'open' : 'merged recently'}: ${show}${c.shared.length > 4 ? ' ...' : ''} (${c.title.slice(0, 60)})`
      );
    }
  }
  if (r.hotFiles.length) lines.push(`  hot files in play: ${r.hotFiles.slice(0, 6).join(', ')}`);
  return lines.join('\n');
}

/** @param {string[]} args */
function gh(args) {
  const r = spawnSync('gh', args, {
    encoding: 'utf8',
    timeout: 15000,
    maxBuffer: 64 * 1024 * 1024,
  });
  if (r.status !== 0) return null;
  try {
    return JSON.parse(r.stdout);
  } catch {
    return null;
  }
}

/** @param {any[]|null} raw @returns {Pr[]} */
function toPrs(raw) {
  return (raw ?? []).map(p => ({
    number: p.number,
    title: p.title,
    createdAt: p.createdAt,
    mergedAt: p.mergedAt,
    closedAt: p.closedAt,
    files: (p.files ?? []).map((/** @type {{path: string}} */ f) => f.path),
  }));
}

const FIELDS = 'number,title,createdAt,mergedAt,closedAt,files';

/** Open PRs plus those merged in the last `hours`. */
export function livePrs(hours = 24) {
  const since = new Date(Date.now() - hours * HOUR).toISOString().slice(0, 10);
  const open = gh(['pr', 'list', '--repo', REPO, '--state', 'open', '-L', '100', '--json', FIELDS]);
  const merged = gh([
    'pr',
    'list',
    '--repo',
    REPO,
    '--state',
    'merged',
    '--search',
    `merged:>=${since}`,
    '-L',
    '200',
    '--json',
    FIELDS,
  ]);
  if (open === null) return null;
  return toPrs([...open, ...(merged ?? [])]);
}

/** The files an item names in `- touches:` (paths and folders; prose words are ignored). @param {string} text @param {string} id */
export function touchesOf(text, id) {
  const item = parseBacklog(text).items.find(i => i.id === id);
  if (!item) return [];
  const raw = (item.fields.get('touches') ?? []).join(' ');
  return raw
    .split(/[\s,;]+/)
    .map(s => s.replace(/^[`'"(]+|[`'")\.]+$/g, ''))
    .filter(s => /[\\/]/.test(s) || /\.\w{1,5}$/.test(s));
}

/** PR numbers refused for merge conflicts, with the first refusal time. @param {string} logText @param {string} since @param {string} until */
export function conflictRefusals(logText, since, until) {
  /** @type {Map<number, string>} */
  const m = new Map();
  for (const line of logText.split(/\r?\n/)) {
    const x = /^merge-runner: (\S+)\s+wait-ci: #(\d+) has merge conflicts/.exec(line);
    if (!x) continue;
    const day = x[1].slice(0, 10);
    if (day < since || day > until) continue;
    if (!m.has(+x[2])) m.set(+x[2], x[1]);
  }
  return m;
}

/** @param {{since: string, until: string, log: string}} o */
function replay({ since, until, log }) {
  const refusals = conflictRefusals(fs.readFileSync(log, 'utf8'), since, until);
  const pad = (/** @type {string} */ d) =>
    new Date(Date.parse(d) - 3 * 86400000).toISOString().slice(0, 10);
  const all = toPrs(
    gh([
      'pr',
      'list',
      '--repo',
      REPO,
      '--state',
      'all',
      '--search',
      `created:${pad(since)}..${until}`,
      '-L',
      '500',
      '--json',
      FIELDS,
    ])
  );
  let flagged = 0;
  let either = 0;
  for (const [n, refusedAt] of refusals) {
    const pr = all.find(p => p.number === n);
    const v = gh(['pr', 'view', String(n), '--repo', REPO, '--json', 'commits']);
    const dates = (v?.commits ?? [])
      .map((/** @type {{committedDate?: string}} */ c) => c.committedDate)
      .filter(Boolean)
      .sort();
    const start = dates[0] ?? pr?.createdAt;
    if (!pr || !start) {
      console.log(`#${n}: no data`);
      continue;
    }
    const r = scout({ files: pr.files, at: new Date(start), prs: all, self: n });
    const real = all.filter(
      p =>
        p.number !== n &&
        p.mergedAt &&
        Date.parse(p.mergedAt) > Date.parse(start) &&
        Date.parse(p.mergedAt) <= Date.parse(refusedAt) &&
        p.files.some(f => pr.files.includes(f))
    );
    const named = r.colliding.filter(c => real.some(p => p.number === c.number));
    const ok = named.length > 0;
    if (ok) flagged++;
    // The same question again when the PR was opened: catches PRs that began after the claim.
    const again = scout({
      files: pr.files,
      at: new Date(pr.createdAt),
      prs: all,
      self: n,
    }).colliding.filter(c => real.some(p => p.number === c.number));
    if (ok || again.length) either++;
    console.log(
      `#${n} ${(pr.title ?? '').slice(0, 40)}: started ${start.slice(0, 16)}, refused ${refusedAt.slice(0, 16)}; real colliders ${real.map(p => '#' + p.number).join(' ') || 'none found'}; scout ${r.verdict} naming ${r.colliding.map(c => '#' + c.number).join(' ') || 'nobody'} -> ${ok ? 'FLAGGED' : 'missed'}${!ok && again.length ? ` (a second run at PR open names ${again.map(c => '#' + c.number).join(' ')})` : ''}`
    );
  }
  console.log(
    `replay: flagged ${flagged} of ${refusals.size} at claim time; ${either} of ${refusals.size} counting a second run when the PR opens`
  );
}

/**
 * What `backlog.mjs claim` prints after a claim: the scout for the item's `touches` line.
 * Never throws; no advice is not an error. @param {string} id @param {string} vault
 */
export function claimAdvice(id, vault) {
  try {
    const s = spawnSync(process.execPath, [fileURLToPath(import.meta.url), id], {
      encoding: 'utf8',
      timeout: 45000,
      env: { ...process.env, FOUNDRY_AI_OBSIDIAN_DIR: vault },
    });
    return (s.stdout || 'conflict-scout: no advice.').trimEnd();
  } catch {
    return 'conflict-scout: no advice.';
  }
}

/** @param {string[]} argv */
export function main(argv) {
  /** @type {Record<string, string|boolean>} */
  const flags = {};
  const pos = [];
  for (let i = 0; i < argv.length; i++) {
    if (argv[i].startsWith('--')) {
      const k = argv[i].slice(2);
      const next = argv[i + 1];
      if (next !== undefined && !next.startsWith('--') && k !== 'replay' && k !== 'json')
        flags[k] = argv[++i];
      else flags[k] = true;
    } else pos.push(argv[i]);
  }
  if (flags.replay) {
    replay({
      since: String(flags.since ?? '2026-11-12'),
      until: String(flags.until ?? '2026-11-16'),
      log: String(flags.log ?? path.join(os.homedir(), '.foundry-ai-tool', 'merge-runner.log')),
    });
    return 0;
  }
  let files =
    typeof flags.files === 'string'
      ? flags.files
          .split(',')
          .map(s => s.trim())
          .filter(Boolean)
      : [];
  const id = pos[0];
  if (id && !files.length) {
    const vault =
      process.env.FOUNDRY_AI_OBSIDIAN_DIR ||
      path.join(os.homedir(), 'Documents', 'Obsidian', 'vault');
    try {
      files = touchesOf(
        fs.readFileSync(path.join(vault, 'Dev', 'Foundry AI Tool', 'Backlog.md'), 'utf8'),
        id
      );
    } catch {
      /* no vault: fall through to the message below */
    }
  }
  if (!files.length) {
    console.log(
      'conflict-scout: no files to check (the item has no `- touches:` line); pass --files a,b to check.'
    );
    return 0;
  }
  const prs = livePrs(Number(flags.hours ?? 24));
  if (!prs) {
    console.log('conflict-scout: gh did not answer, no advice.');
    return 0;
  }
  const r = scout({ files, at: new Date(), prs, hours: Number(flags.hours ?? 24) });
  console.log(flags.json ? JSON.stringify(r, null, 2) : formatScout(r));
  return 0;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exitCode = main(process.argv.slice(2));
}
