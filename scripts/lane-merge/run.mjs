// @ts-check
import { spawnSync } from 'node:child_process';
import { GH_TIMEOUT_MS, VAULT_GIT_TIMEOUT_MS } from './constants.mjs';

/**
 * The real `run`: gh, git, node and npm. `npm` is a .cmd file on Windows, so it goes through the
 * shell as one command string (an args array under a shell is deprecated, DEP0190).
 * `input` is written to the command's stdin (git patch-id reads the diff there).
 * @param {string} cmd @param {string[]} args @param {string} [input]
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function defaultRun(cmd, args, input) {
  const r =
    cmd === 'npm' && process.platform === 'win32'
      ? spawnSync(['npm', ...args].join(' '), {
          encoding: 'utf8',
          shell: true,
          maxBuffer: 256 * 1024 * 1024,
        })
      : spawnSync(cmd, args, {
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
          ...(input === undefined ? {} : { input }),
          // one hung gh call must not hang a background --wait-ci forever
          ...(cmd === 'gh' ? { timeout: GH_TIMEOUT_MS } : {}),
          // the vault's git (the merge train note) must neither hang nor ask for a login
          ...(cmd === 'git' && args[0] === '-C'
            ? { timeout: VAULT_GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
            : {}),
          // the same for the repo's own fetches (main, and a reviewed commit the carry needs)
          ...(cmd === 'git' && args[0] === 'fetch'
            ? { timeout: VAULT_GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
            : {}),
        });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? r.error?.message ?? '',
  };
}

/** @param {string} text */
export const firstLine = text => text.trim().split(/\r?\n/)[0] ?? '';

/** The shell-free runner type of `run`. @typedef {(cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }} Run */

/** Line endings must not make two copies of a file differ. @param {string} text */
export const lf = text => text.replace(/\r\n/g, '\n');
