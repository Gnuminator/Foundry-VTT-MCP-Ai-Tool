// @ts-check
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { REMOTE, ANNOUNCE_SCRIPT, ANNOUNCE_TIMEOUT_MS } from './constants.mjs';
import { firstLine } from './run.mjs';

/**
 * Post "#<n> <title>" to #pr-log, silently. Fire and forget with a short timeout: any problem is
 * one warning line, never a changed exit code.
 * @param {number} n @param {string} title @param {string} [cwd]
 * @returns {string} a warning, or '' when posted or skipped
 */
export function defaultAnnounce(n, title, cwd = process.cwd()) {
  const script = announceSource(cwd);
  if (!script) return '';
  try {
    const r = spawnSync(process.execPath, [script.file, 'pr', String(n), title || `PR ${n}`], {
      encoding: 'utf8',
      timeout: ANNOUNCE_TIMEOUT_MS,
      cwd,
    });
    if (r.status === 0) return '';
    const why = r.error?.message ?? (firstLine(r.stdout || r.stderr) || `exit ${r.status}`);
    return `Discord post for #${n} failed (${why})`;
  } finally {
    script.cleanup();
  }
}

/**
 * The sender to run: main's copy, or none (no post) when main has none or git fails. The checkout's
 * copy is never used: the PR's own code must not run with the bot token (the same rule as the gate's
 * own copy). The sender has no relative imports, so one temp file is enough.
 * @param {string} cwd
 * @returns {{ file: string, cleanup: () => void } | null}
 */
export function announceSource(cwd) {
  const git = spawnSync(
    'git',
    ['show', `${REMOTE}/main:${ANNOUNCE_SCRIPT.split(path.sep).join('/')}`],
    { encoding: 'utf8', cwd, timeout: ANNOUNCE_TIMEOUT_MS }
  );
  if (git.status === 0 && git.stdout) {
    const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-announce-'));
    const file = path.join(dir, 'announce.mjs');
    fs.writeFileSync(file, git.stdout);
    return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
  }
  return null;
}
