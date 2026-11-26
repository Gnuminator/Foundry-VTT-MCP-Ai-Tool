#!/usr/bin/env node
// `npm run token:budget` (idea 4.12): groups the per-session token totals that the Stop hook
// (.claude/hooks/budget.mjs) keeps into one total per branch and PR, and writes the vault note
// `Dev/Foundry AI Tool/Token budget.md` that the PM board shows per PR.
//
//   node scripts/dev/token-budget.mjs [--stdout] [--out <file>] [--limit <tokens>] [--check]
//
// A branch maps to its newest PR with `gh pr list --state all`; a branch with no PR yet shows as
// `pr: none`. Sessions that share a branch (a handover successor) add up. Sessions not touched for
// 14 days are left out. Lines in the note, one per branch, newest activity first:
//
//   - branch: claude/x | pr: 1373 | tokens: 14200000 | limit: 18000000 | sessions: 2 | updated: <ISO>
//
// `--check` prints, per session, the hook's last context reading next to nothing else: compare it
// with `get_usage` "context.tokensUsed" of that session (the measured 10% check in the PR).
//
// Overrides (tests): TOKEN_BUDGET_STATE_DIR, TOKEN_BUDGET_LIMIT, TOKEN_BUDGET_GH=off,
// FOUNDRY_AI_OBSIDIAN_DIR (vault root).

import { execFile } from 'node:child_process';
import { mkdirSync, readFileSync, readdirSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import { limitFor, mTokens, stateDirFor } from '../../.claude/hooks/budget.mjs';

export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
export const MAX_AGE_DAYS = 14;

export function loadStates(env = process.env, now = Date.now()) {
  const dir = stateDirFor(env);
  let names = [];
  try {
    names = readdirSync(dir).filter(n => n.endsWith('.json'));
  } catch {
    return [];
  }
  const out = [];
  for (const name of names) {
    try {
      const s = JSON.parse(readFileSync(path.join(dir, name), 'utf8'));
      const t = Date.parse(s.updated);
      if (!Number.isFinite(t) || now - t > MAX_AGE_DAYS * 86_400_000) continue;
      if (typeof s.tokens === 'number') out.push(s);
    } catch {
      // a half-written or foreign file
    }
  }
  return out;
}

// prs: [{ number, headRefName }] newest first; the first PR of a branch wins.
export function group(states, prs = []) {
  const prOf = new Map();
  for (const p of prs) if (!prOf.has(p.headRefName)) prOf.set(p.headRefName, p.number);
  const byBranch = new Map();
  for (const s of states) {
    const branch = s.branch || '(unknown)';
    const g = byBranch.get(branch) ?? { branch, tokens: 0, sessions: 0, updated: '' };
    g.tokens += s.tokens;
    g.sessions += 1;
    if (s.updated > g.updated) g.updated = s.updated;
    byBranch.set(branch, g);
  }
  return [...byBranch.values()]
    .map(g => ({ ...g, pr: prOf.get(g.branch) ?? null }))
    .sort((a, b) => (a.updated < b.updated ? 1 : -1));
}

export function noteText(groups, limit, now = new Date()) {
  const lines = [
    '---',
    `generated: ${now.toISOString()}`,
    `limit: ${limit}`,
    '---',
    '# Token budget',
    '',
    'Per branch and PR, from the Stop hook `.claude/hooks/budget.mjs` (`npm run token:budget`).',
    'Tokens are context tokens per API response, counted like `npm run usage:week`.',
    '',
  ];
  for (const g of groups) {
    lines.push(
      `- branch: ${g.branch} | pr: ${g.pr ?? 'none'} | tokens: ${g.tokens} | limit: ${limit} | sessions: ${g.sessions} | updated: ${g.updated}`
    );
  }
  return `${lines.join('\n')}\n`;
}

export function fetchPrs(env = process.env) {
  if (env.TOKEN_BUDGET_GH === 'off') return Promise.resolve([]);
  return new Promise(resolve => {
    execFile(
      'gh',
      ['pr', 'list', '-R', REPO, '--state', 'all', '--limit', '300', '--json', 'number,headRefName'],
      { maxBuffer: 16 * 1024 * 1024 },
      (err, stdout) => {
        if (err) return resolve([]);
        try {
          resolve(JSON.parse(stdout));
        } catch {
          resolve([]);
        }
      }
    );
  });
}

export function noteFileFor(env = process.env) {
  const vault = env.FOUNDRY_AI_OBSIDIAN_DIR || path.join(os.homedir(), 'Documents', 'Obsidian', 'vault');
  return path.join(vault, 'Dev', 'Foundry AI Tool', 'Token budget.md');
}

async function main() {
  const argv = process.argv.slice(2);
  const opt = f => {
    const i = argv.indexOf(f);
    return i >= 0 ? argv[i + 1] : undefined;
  };
  const env = { ...process.env };
  if (opt('--limit')) env.TOKEN_BUDGET_LIMIT = opt('--limit');
  const limit = limitFor(env);
  const states = loadStates(env);
  if (argv.includes('--check')) {
    for (const s of states) {
      console.log(
        `${s.sessionId}\tbranch ${s.branch}\ttotal ${mTokens(s.tokens)}\tlast context ${s.lastContext ?? 'n/a'}`
      );
    }
    return;
  }
  const groups = group(states, await fetchPrs(env));
  const text = noteText(groups, limit);
  if (argv.includes('--stdout')) {
    process.stdout.write(text);
    return;
  }
  const out = opt('--out') || noteFileFor(env);
  mkdirSync(path.dirname(out), { recursive: true });
  writeFileSync(out, text);
  console.log(`token-budget: ${groups.length} branches written to ${out}`);
}

const self = fileURLToPath(import.meta.url);
if (process.argv[1] && pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href) {
  main().catch(e => {
    console.error(e.message);
    process.exit(1);
  });
}
