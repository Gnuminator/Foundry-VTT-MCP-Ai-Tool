#!/usr/bin/env node
// SessionStart hook: alerts only (D-102 line 3). Silent when all is fine; otherwise at most ten
// short lines, one per alert:
//   - the main checkout's CLAUDE.md differs from the vault master (repo-docs/CLAUDE.md),
//   - the due "Waiting on the user" items (vault Waiting.md, D-122),
//   - somebody holds the test server lock (or it cannot be read, or a queue waits on a free lock),
//   - a session-notes run was missed or paused on the usage limit (the watchdog),
//   - main CI is red: the newest finished CI run on main failed (one or two `gh` calls; silent when
//     gh is missing, offline or answers anything unexpected).
//
// The watchdog comes from the control center (GET 127.0.0.1:3200/snapshot.json,
// Gnuminator/control-center), else from a snapshot.json under 30 minutes old in its data folder.
// When neither answers and the control center is installed on this PC, one line says so. The
// lock is read straight from <test env root>/lock.json (written only by scripts/test-env/lock.ps1).
//
// Output: JSON with `systemMessage` (shown to the user) and `additionalContext` (for Claude), or
// nothing at all. A failure inside the hook prints nothing: a start hook must never block a start.
//
// Overrides (tests and checks): START_ALERTS_REPO, START_ALERTS_VAULT, START_ALERTS_TEST_ROOT
// (and _B, _C for those servers), START_ALERTS_SNAPSHOT_URL (or "off"), START_ALERTS_SNAPSHOT_FILE, START_ALERTS_CC_DIR,
// START_ALERTS_MAIN_CI=off (skips the main CI check; the hook tests set it).

import { spawnSync } from 'node:child_process';
import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_LINES = 10;
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
const LOCK_OLD_MS = 4 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
const WAITING_NOTE = path.join('Dev', 'Foundry AI Tool', 'Waiting.md');
const WAITING_LEAD_DAYS = 7;
const WAITING_SHOWN = 4;
const CI_REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
const GH_TIMEOUT_MS = 4000;
const VAULT_MASTER = path.join('Dev', 'Foundry AI Tool', 'repo-docs', 'CLAUDE.md');

// A worktree belongs to the main checkout: its .git file reads "gitdir: <main>/.git/worktrees/<name>"
// (no git call). Without that file, a path under .claude/worktrees/ maps to the folder above.
export function mainCheckout(dir) {
  const git = readText(path.join(dir, '.git'));
  const g = git && /^gitdir:\s*(.+?)[\\/]\.git[\\/]worktrees[\\/][^\\/\r\n]+\s*$/m.exec(git);
  if (g) return path.resolve(dir, g[1]);
  const m = /[\\/]\.claude[\\/]worktrees[\\/]/.exec(dir);
  return m ? dir.slice(0, m.index) : dir;
}

function clip(s, n = 60) {
  const t = String(s ?? '')
    .replace(/\s+/g, ' ')
    .trim();
  return t.length > n ? `${t.slice(0, n - 3)}...` : t;
}

function readText(file) {
  try {
    return readFileSync(file, 'utf8');
  } catch {
    return null;
  }
}

function mtime(file) {
  try {
    return statSync(file).mtimeMs;
  } catch {
    return null;
  }
}

function normalizeDoc(text) {
  return text
    .replace(/^\uFEFF/, '')
    .replace(/\r\n/g, '\n')
    .replace(/\s+$/, '');
}

export function testEnvRootFor(repoRoot, env = process.env) {
  if (env.START_ALERTS_TEST_ROOT) return env.START_ALERTS_TEST_ROOT;
  try {
    const root = JSON.parse(
      readFileSync(path.join(repoRoot, 'scripts', 'test-env', 'local.json'), 'utf8')
    )?.Root;
    if (typeof root === 'string' && root) return root;
  } catch {
    // no local.json: the default
  }
  return process.platform === 'win32' ? 'C:\\FoundryTest' : path.join(os.homedir(), 'foundry-test');
}

// Root of test server B or C: START_ALERTS_TEST_ROOT_<name>, else none when START_ALERTS_TEST_ROOT
// is set (a test), else Root from local.<name>.json, else the default.
function testEnvRootOf(name, repoRoot, env) {
  const fromEnv = env[`START_ALERTS_TEST_ROOT_${name}`];
  if (fromEnv) return fromEnv;
  if (env.START_ALERTS_TEST_ROOT) return null;
  try {
    const root = JSON.parse(
      readFileSync(path.join(repoRoot, 'scripts', 'test-env', `local.${name}.json`), 'utf8')
    )?.Root;
    if (typeof root === 'string' && root) return root;
  } catch {
    // no local file: the default
  }
  return process.platform === 'win32'
    ? `C:\\FoundryTest${name}`
    : path.join(os.homedir(), `foundry-test-${name.toLowerCase()}`);
}

export function testEnvRootBFor(repoRoot, env = process.env) {
  return testEnvRootOf('B', repoRoot, env);
}

export function testEnvRootCFor(repoRoot, env = process.env) {
  return testEnvRootOf('C', repoRoot, env);
}

export function vaultDirFor(env = process.env) {
  if (env.START_ALERTS_VAULT) return env.START_ALERTS_VAULT;
  if (env.PROJECT_DASHBOARD_VAULT && env.PROJECT_DASHBOARD_VAULT !== 'off')
    return env.PROJECT_DASHBOARD_VAULT;
  return env.FOUNDRY_AI_OBSIDIAN_DIR || path.join(os.homedir(), 'Documents', 'Obsidian', 'vault');
}

// --- the alerts ----------------------------------------------------------------------------

export function claudeMdAlert({ repoRoot, vaultDir }) {
  const master = path.join(vaultDir, VAULT_MASTER);
  const vaultText = readText(master);
  if (vaultText === null) return null; // no vault on this PC: nothing to compare
  const copy = path.join(repoRoot, 'CLAUDE.md');
  const repoText = readText(copy);
  if (repoText === null)
    return 'CLAUDE.md is missing in the main checkout; the planner copies it from the vault master (repo-docs/CLAUDE.md).';
  if (normalizeDoc(repoText) === normalizeDoc(vaultText)) return null;
  const newer = (mtime(master) ?? 0) > (mtime(copy) ?? 0) ? 'the vault master' : 'the repo copy';
  return `CLAUDE.md differs from the vault master (newer: ${newer}); the planner syncs them (vault repo-docs/CLAUDE.md, pull first).`;
}

// --- the Waiting list (vault Waiting.md) ----------------------------------------------------

// Items are "## W<id> <title>" headings (id like 6 or 12b) with "- due: YYYY-MM-DD|none" and an
// optional "- from: YYYY-MM-DD" list line. Returns [{ id, title, due, from }]; dates are strings or null.
export function parseWaiting(text) {
  const items = [];
  try {
    let cur = null;
    for (const line of String(text ?? '').split(/\r?\n/)) {
      const h = /^##\s+W(\d+[a-z]?)\s+(.+?)\s*$/i.exec(line);
      if (h) {
        cur = { id: h[1].toLowerCase(), title: h[2], due: null, from: null };
        items.push(cur);
        continue;
      }
      if (/^#{1,2}\s/.test(line)) {
        cur = null;
        continue;
      }
      const d = cur && /^\s*[-*]\s+(due|from):\s*(\d{4}-\d{2}-\d{2})\b/i.exec(line);
      if (d && !cur[d[1].toLowerCase()]) cur[d[1].toLowerCase()] = d[2];
    }
  } catch {
    return [];
  }
  return items;
}

function dayNumber(iso) {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(iso || '');
  if (!m) return null;
  const t = Date.UTC(Number(m[1]), Number(m[2]) - 1, Number(m[3]));
  return Number.isFinite(t) ? Math.round(t / 86400000) : null;
}

function idOrder(a, b) {
  const [, na, sa] = /^(\d+)(.*)$/.exec(a) || [0, 0, a];
  const [, nb, sb] = /^(\d+)(.*)$/.exec(b) || [0, 0, b];
  return Number(na) - Number(nb) || sa.localeCompare(sb);
}

export function waitingAlert({ vaultDir, now = new Date() }) {
  try {
    const text = readText(path.join(vaultDir, WAITING_NOTE));
    if (text === null) return null;
    const today = Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()) / 86400000;
    const due = parseWaiting(text)
      .map(i => ({ ...i, dueDay: dayNumber(i.due), fromDay: dayNumber(i.from) }))
      .filter(
        i =>
          i.dueDay !== null &&
          today >= i.dueDay - WAITING_LEAD_DAYS &&
          (i.fromDay === null || today >= i.fromDay)
      )
      .sort((a, b) => a.dueDay - b.dueDay || idOrder(a.id, b.id));
    if (!due.length) return null;
    const shown = due.slice(0, WAITING_SHOWN).map(i => {
      const label = i.dueDay < today ? ', overdue' : i.dueDay === today ? ', today' : '';
      return `W${i.id} ${clip(i.title, 45)} (due ${i.due}${label})`;
    });
    const more = due.length > WAITING_SHOWN ? ` and ${due.length - WAITING_SHOWN} more due` : '';
    return `Waiting on the user (vault Waiting.md): ${shown.join(', ')}${more}.`;
  } catch {
    return null;
  }
}

export function readLockFile(testEnvRoot) {
  const file = path.join(testEnvRoot, 'lock.json');
  if (!existsSync(file)) return { state: 'free', queue: [] };
  const text = readText(file);
  try {
    const data = JSON.parse(String(text).replace(/^\uFEFF/, ''));
    if (!data || typeof data !== 'object' || Array.isArray(data)) throw new Error('not an object');
    const queue = Array.isArray(data.queue) ? data.queue : [];
    if (typeof data.holder === 'string' && data.holder) return { state: 'held', ...data, queue };
    return { state: 'free', queue };
  } catch {
    return { state: 'unreadable', queue: [] };
  }
}

function age(since, nowMs) {
  const t = Date.parse(since || '');
  if (!Number.isFinite(t)) return null;
  const mins = Math.max(0, Math.round((nowMs - t) / 60000));
  return mins < 90 ? `${mins} min` : `${Math.round(mins / 60)} h`;
}

export function lockAlert(lock, now = new Date()) {
  const nowMs = now.getTime();
  const queue = Array.isArray(lock?.queue) ? lock.queue : [];
  const waiting = queue.length
    ? `; ${queue.length} queued (next: ${clip(queue[0]?.holder, 40)})`
    : '';
  if (lock?.state === 'unreadable')
    return 'Test server lock: lock.json cannot be read; check with the other sessions before a live test.';
  if (lock?.state === 'held') {
    const held = age(lock.since, nowMs);
    const old =
      Number.isFinite(Date.parse(lock.since || '')) && nowMs - Date.parse(lock.since) >= LOCK_OLD_MS
        ? ' (over 4 h: maybe a crashed session)'
        : '';
    const about = [held, lock.purpose && `"${clip(lock.purpose, 50)}"`].filter(Boolean).join(', ');
    return `Test server lock: held by ${clip(lock.holder, 50)}${about ? ` (${about})` : ''}${old}${waiting}.`;
  }
  if (queue.length)
    return `Test server lock: free, but ${queue.length} queued (next: ${clip(queue[0]?.holder, 40)}).`;
  return null;
}

// The Foundry project's part of a snapshot: control center (version 3, projects[]) or the old
// in-repo project dashboard (version 2, top level).
export function foundryPart(snap) {
  if (!snap || typeof snap !== 'object') return null;
  if (Array.isArray(snap.projects)) {
    const p = snap.projects.find(x => x && x.pack === 'foundry');
    return p ? { watchdog: p.panels?.watchdog } : null;
  }
  if (snap.watchdog) return { watchdog: snap.watchdog };
  return null;
}

export function watchdogAlert(w) {
  const items = Array.isArray(w?.items) ? w.items : [];
  if (w?.state === 'missed') {
    const missed = items.filter(i => i.state === 'missed');
    const more = missed.length > 1 ? ` and ${missed.length - 1} more` : '';
    return `Session notes missed for ${clip(missed[0]?.name || 'a recording', 50)}${more} (no notes run within 24 h).`;
  }
  if (w?.state === 'paused') {
    const name = items.find(i => i.state === 'paused')?.name || 'a recording';
    return `Session notes paused on the usage limit for ${clip(name, 50)}.`;
  }
  return null;
}

// --- main CI (red main, planner skill) -------------------------------------------------------

// gh as a function: args in, stdout out, null on any failure (gh missing, offline, not logged in).
export function runGh(args) {
  try {
    const r = spawnSync('gh', args, { encoding: 'utf8', timeout: GH_TIMEOUT_MS, windowsHide: true });
    return r.error || r.status !== 0 ? null : r.stdout;
  } catch {
    return null;
  }
}

// The name of the first failing step of a run (gh run view --json jobs), else its failing job, else null.
function failedStep(gh, id) {
  try {
    const jobs = JSON.parse(gh(['run', 'view', String(id), '-R', CI_REPO, '--json', 'jobs']) ?? '');
    for (const job of jobs.jobs ?? []) {
      const step = (job.steps ?? []).find(s => String(s.conclusion).toLowerCase() === 'failure');
      if (step) return step.name;
      if (String(job.conclusion).toLowerCase() === 'failure') return job.name;
    }
  } catch {
    // no detail: the alert goes without the step
  }
  return null;
}

// "main CI red since <sha> (<step>)" when the newest finished CI run on main failed. Cancelled and
// skipped runs say nothing and are passed over. "Since" is the oldest run of the unbroken red streak.
export function mainRedAlert({ gh = runGh } = {}) {
  try {
    const out = gh([
      'run',
      'list',
      '-R',
      CI_REPO,
      '--workflow',
      'ci.yml',
      '--branch',
      'main',
      '--event',
      'push',
      '--status',
      'completed',
      '--limit',
      '15',
      '--json',
      'databaseId,conclusion,headSha',
    ]);
    if (!out) return null;
    const runs = JSON.parse(out).filter(
      r => r && !['cancelled', 'skipped'].includes(String(r.conclusion).toLowerCase())
    );
    const red = r =>
      ['failure', 'timed_out', 'startup_failure'].includes(String(r.conclusion).toLowerCase());
    if (!runs.length || !red(runs[0])) return null;
    let since = runs[0];
    for (const r of runs) {
      if (!red(r)) break;
      since = r;
    }
    const step = failedStep(gh, runs[0].databaseId);
    return `main CI red since ${String(since.headSha).slice(0, 8)}${step ? ` (${clip(step, 60)})` : ''}; see the red main step in the planner skill before merging.`;
  } catch {
    return null;
  }
}

// --- the snapshot --------------------------------------------------------------------------

export async function loadSnapshot({ url, file, now = new Date(), fetchImpl = fetch } = {}) {
  if (url) {
    const controller = new AbortController();
    const timer = setTimeout(() => controller.abort(), FETCH_TIMEOUT_MS);
    try {
      const res = await fetchImpl(url, { signal: controller.signal });
      if (res.ok) return { snap: await res.json(), source: 'control center' };
    } catch {
      // not running: try the file
    } finally {
      clearTimeout(timer);
    }
  }
  if (file) {
    const at = mtime(file);
    if (at !== null && now.getTime() - at <= SNAPSHOT_MAX_AGE_MS) {
      try {
        return { snap: JSON.parse(readFileSync(file, 'utf8')), source: 'snapshot file' };
      } catch {
        // a broken file counts as none
      }
    }
  }
  return { snap: null, source: null };
}

export async function collectAlerts({
  repoRoot,
  vaultDir,
  testEnvRoot,
  testEnvRootB = null,
  testEnvRootC = null,
  snapshotUrl,
  snapshotFile,
  ccDir,
  now = new Date(),
  fetchImpl = fetch,
  mainCi = null,
}) {
  const lines = [];
  const add = line => {
    if (line) lines.push(line);
  };
  if (mainCi) add(mainRedAlert({ gh: mainCi }));
  add(claudeMdAlert({ repoRoot, vaultDir }));
  add(waitingAlert({ vaultDir, now }));
  add(lockAlert(readLockFile(testEnvRoot), now));
  // Test servers B (kit runs) and C (scripts/test-env/servers.json) have a lock of their own.
  for (const [name, root] of [
    ['B', testEnvRootB],
    ['C', testEnvRootC],
  ]) {
    if (root)
      add(
        lockAlert(readLockFile(root), now)?.replace(/^Test server lock/, `Test server ${name} lock`)
      );
  }
  const { snap } = await loadSnapshot({ url: snapshotUrl, file: snapshotFile, now, fetchImpl });
  const part = foundryPart(snap);
  if (part) {
    add(watchdogAlert(part.watchdog));
  } else if (ccDir && existsSync(ccDir)) {
    add('Control center not answering on 127.0.0.1:3200: session notes not checked.');
  }
  return lines.slice(0, MAX_LINES);
}

export function formatOutput(lines) {
  if (!lines.length) return '';
  const text = lines.map(l => `- ${l}`).join('\n');
  return JSON.stringify({
    systemMessage: `Start alerts:\n${text}`,
    hookSpecificOutput: {
      hookEventName: 'SessionStart',
      additionalContext: `Start alerts (project SessionStart hook, D-102; Waiting items are raised by the planner, not by lanes):\n${text}`,
    },
  });
}

export function optionsFrom(env = process.env) {
  const projectDir = env.START_ALERTS_REPO || env.CLAUDE_PROJECT_DIR || process.cwd();
  const repoRoot = mainCheckout(projectDir);
  const dataDir =
    env.PROJECT_DASHBOARD_DATA || path.join(os.homedir(), '.foundry-ai-tool', 'project-dashboard');
  const url = env.START_ALERTS_SNAPSHOT_URL ?? 'http://127.0.0.1:3200/snapshot.json';
  return {
    repoRoot,
    vaultDir: vaultDirFor(env),
    testEnvRoot: testEnvRootFor(repoRoot, env),
    testEnvRootB: testEnvRootBFor(repoRoot, env),
    testEnvRootC: testEnvRootCFor(repoRoot, env),
    mainCi: env.START_ALERTS_MAIN_CI === 'off' ? null : runGh,
    snapshotUrl: url === 'off' ? null : url,
    snapshotFile: env.START_ALERTS_SNAPSHOT_FILE || path.join(dataDir, 'snapshot.json'),
    ccDir:
      env.START_ALERTS_CC_DIR ||
      path.join(os.homedir(), 'Documents', 'Claude Code', 'Projects', 'Control Center'),
  };
}

async function main() {
  try {
    const out = formatOutput(await collectAlerts(optionsFrom()));
    if (out) process.stdout.write(`${out}\n`);
  } catch {
    // never block a session start
  }
}

const self = fileURLToPath(import.meta.url);
if (
  process.argv[1] &&
  pathToFileURL(path.resolve(process.argv[1])).href === pathToFileURL(self).href
) {
  main();
}
