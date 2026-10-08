#!/usr/bin/env node
// SessionStart hook: alerts only (D-102 line 3). Silent when all is fine; otherwise at most nine
// short lines, one per alert:
//   - the main checkout's CLAUDE.md differs from the vault master (repo-docs/CLAUDE.md),
//   - somebody holds the test server lock (or it cannot be read, or a queue waits on a free lock),
//   - lanes of this project at 200k context or more (busy or waiting, not CLOSED),
//   - a session-notes run was missed or paused on the usage limit (the watchdog).
// It never prints the Waiting list (CLAUDE.md already loads it).
//
// The lanes and the watchdog come from the control center (GET 127.0.0.1:3200/snapshot.json,
// Gnuminator/control-center), else from a snapshot.json under 30 minutes old in its data folder.
// When neither answers and the control center is installed on this PC, one line says so. The
// lock is read straight from <test env root>/lock.json (written only by scripts/test-env/lock.ps1).
//
// Output: JSON with `systemMessage` (shown to the user) and `additionalContext` (for Claude), or
// nothing at all. A failure inside the hook prints nothing: a start hook must never block a start.
//
// Overrides (tests and checks): START_ALERTS_REPO, START_ALERTS_VAULT, START_ALERTS_TEST_ROOT,
// START_ALERTS_SNAPSHOT_URL (or "off"), START_ALERTS_SNAPSHOT_FILE, START_ALERTS_CC_DIR.

import { existsSync, readFileSync, statSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

export const MAX_LINES = 9;
export const LANE_ALERT = 200_000;
export const LANE_RED = 250_000;
const SNAPSHOT_MAX_AGE_MS = 30 * 60 * 1000;
const LOCK_OLD_MS = 4 * 60 * 60 * 1000;
const FETCH_TIMEOUT_MS = 3000;
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
    return 'CLAUDE.md is missing in the main checkout; the steward copies it from the vault master (repo-docs/CLAUDE.md).';
  if (normalizeDoc(repoText) === normalizeDoc(vaultText)) return null;
  const newer = (mtime(master) ?? 0) > (mtime(copy) ?? 0) ? 'the vault master' : 'the repo copy';
  return `CLAUDE.md differs from the vault master (newer: ${newer}); the steward syncs them (vault repo-docs/CLAUDE.md, pull first).`;
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
    return p ? { lanes: p.lanes, watchdog: p.panels?.watchdog } : null;
  }
  if (snap.lanes) return { lanes: snap.lanes, watchdog: snap.watchdog };
  return null;
}

export function lanesAlert(lanes) {
  const rows = Array.isArray(lanes?.rows) ? lanes.rows : [];
  const hot = rows
    .filter(r => r && !r.closed && r.state !== 'stale' && Number(r.context) >= LANE_ALERT)
    .sort((a, b) => b.context - a.context);
  if (!hot.length) return null;
  const shown = hot
    .slice(0, 3)
    .map(r => `${clip(r.title || r.sessionId, 45)} ${Math.round(r.context / 1000)}k`);
  const more = hot.length > 3 ? ` and ${hot.length - 3} more` : '';
  const red = hot.some(r => r.context >= LANE_RED) ? ' (250k or more: hand over now)' : '';
  return `Lanes over 200k context: ${shown.join(', ')}${more}${red}.`;
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
  snapshotUrl,
  snapshotFile,
  ccDir,
  now = new Date(),
  fetchImpl = fetch,
}) {
  const lines = [];
  const add = line => {
    if (line) lines.push(line);
  };
  add(claudeMdAlert({ repoRoot, vaultDir }));
  add(lockAlert(readLockFile(testEnvRoot), now));
  const { snap } = await loadSnapshot({ url: snapshotUrl, file: snapshotFile, now, fetchImpl });
  const part = foundryPart(snap);
  if (part) {
    add(lanesAlert(part.lanes));
    add(watchdogAlert(part.watchdog));
  } else if (ccDir && existsSync(ccDir)) {
    add(
      'Control center not answering on 127.0.0.1:3200: lane context and session notes not checked.'
    );
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
      additionalContext: `Start alerts (project SessionStart hook, D-102):\n${text}`,
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
