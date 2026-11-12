#!/usr/bin/env node
/**
 * Merge runner (D-140, D-141): merges ready PRs without a model, so no planner has to stand by.
 *
 *   node scripts/merge-runner.mjs [--once] [--interval <s>] [--vault <dir>] [--checkout <dir>]
 *
 * A Windows scheduled task starts it at logon (scripts/register-merge-runner.ps1) from the main
 * checkout. Each round it reads vault Backlog.md from the upstream branch (fetch, `git show @{u}:`,
 * never the shared working tree) and takes every item whose progress line is a ready line
 * (`PR #<n> ready, head <40-hex sha>`, written by `backlog.mjs progress <id> --ready`; parseReady),
 * one PR at a time, in Backlog order:
 *
 *   - main's last finished CI run (push, ci.yml) is red, or cannot be read: post one line, exit 3.
 *     Nothing is merged and the ready lines stay.
 *   - the PR is already merged: `backlog.mjs done`. Closed: a refusal (below).
 *   - the PR head is not the sha of the ready line: a refusal. The gate never judges a head the
 *     ready line did not name.
 *   - else the gate checkout (default: the sibling folder `<main checkout>-gate`, a built worktree
 *     outside .claude/worktrees) is checked to be its own top level and clean, the head is checked
 *     out detached, `npm ci` runs when package-lock.json changed since the last install, and main's
 *     copy of scripts/lane-merge.mjs runs there as `<PR> --wait-ci --vault <vault>`, nothing else
 *     (GATE_FLAGS: never a dry run, a force, a skip or a train reset). The gate posts its own
 *     #pr-log line on a merge.
 *       merged (a `lane:merge: merged #<PR>` line, exit 0): `backlog.mjs done <id> <PR> --sha <head>`.
 *       merge train full: post "merge train full: ask a session to run live:roundtrip", exit 3; the
 *         ready line stays, so the next logon or a manual start after `--train-reset` merges it.
 *       CI still running after the gate's wait (exit 5): left for the next round.
 *       any other refusal: `backlog.mjs progress <id> "PR #<n> refused by the merge gate: <why>"`
 *         (that replaces the ready line, so it is not tried again until a lane writes a new one)
 *         and one #pr-log line.
 *     A checkout problem (not the PR's fault) posts one line and exits 3.
 *
 * It never runs `live:roundtrip` or `--train-reset`; a session does that on demand (D-141). A lock
 * file (~/.foundry-ai-tool/merge-runner.lock, the holder's pid) lets one runner run; a second one
 * exits 1 at once. A vault write that fails is logged; the PR is not tried again in this run.
 * Discord lines go through main's copy of the bot's announce sender (`pr-note`, #pr-log, silent).
 *
 * Exit codes: 0 --once finished, 1 another runner holds the lock, 2 usage, 3 stopped (main red,
 * merge train full, checkout problem). Every log line starts with `merge-runner:` and a time.
 */
import { spawnSync } from 'node:child_process';
import { createHash } from 'node:crypto';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import { parseProgress, parseReady } from './backlog-items.mjs';
import { pidAlive } from './heavy-lock.mjs';
import { readUpstreamBacklog } from './planner-wake.mjs';

export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';
const MAIN = 'aitool/main';
export const DEFAULT_INTERVAL = 120;
/** The gate waits up to 30 minutes for CI; the whole gate run gets a little more. */
const GATE_TIMEOUT_MS = 40 * 60 * 1000;
const NPM_CI_TIMEOUT_MS = 20 * 60 * 1000;
const SHORT_TIMEOUT_MS = 120_000;
/** The only flags the runner ever passes to the gate, after the PR number. */
export const GATE_FLAGS = ['--wait-ci'];
export const EXIT_STOPPED = 3;
/** The gate's exit code for "CI did not finish in time" (lane-merge.mjs EXIT_WAIT_TIMEOUT). */
const GATE_WAIT_TIMEOUT = 5;
export const TRAIN_FULL_LINE = 'merge train full: ask a session to run live:roundtrip';
/** Written into the gate checkout's node_modules after an `npm ci`: the package-lock.json hash. */
const LOCK_STAMP = path.join('node_modules', '.merge-runner-lock-hash');
const here = path.dirname(fileURLToPath(import.meta.url));

/** One line: newlines folded, at most `max` characters. @param {string} s @param {number} [max] */
export const oneLine = (s, max = 400) => {
  const t = String(s)
    .replace(/\s*\r?\n\s*/g, ' ')
    .trim();
  return t.length > max ? `${t.slice(0, max - 3)}...` : t;
};

/**
 * Ready items in Backlog order.
 * @param {string} backlogText
 * @returns {{ id: string, pr: number, head: string }[]}
 */
export function readyItems(backlogText) {
  const out = [];
  for (const [id, progress] of parseProgress(backlogText)) {
    const r = parseReady(progress);
    if (r) out.push({ id, ...r });
  }
  return out;
}

/**
 * Main's state from `gh run list --json conclusion,headSha` (newest first, finished push runs of
 * ci.yml). Cancelled and skipped runs are passed over (a newer push cancels the older run).
 * @param {string} json
 * @returns {{ red: boolean, sha: string, why: string }}
 */
export function mainState(json) {
  /** @type {{ conclusion?: string, headSha?: string }[]} */
  let runs;
  try {
    runs = JSON.parse(json);
  } catch {
    return { red: true, sha: '', why: 'main CI unreadable (gh answered no JSON)' };
  }
  const run = Array.isArray(runs)
    ? runs.find(r => !['cancelled', 'skipped', 'neutral'].includes(String(r.conclusion)))
    : undefined;
  if (!run) return { red: true, sha: '', why: 'no finished CI run on main to judge' };
  const sha = String(run.headSha ?? '').slice(0, 7);
  if (run.conclusion === 'success') return { red: false, sha, why: '' };
  return { red: true, sha, why: `main is red at ${sha} (CI ${run.conclusion})` };
}

/**
 * What a gate run ended with.
 * @param {number} code @param {string} output @param {number} pr
 * @returns {{ kind: 'merged' | 'train-full' | 'wait' | 'refused', reason: string }}
 */
export function gateOutcome(code, output, pr) {
  const lines = output.split(/\r?\n/);
  if (code === 0 && lines.some(l => l.startsWith(`lane:merge: merged #${pr} `))) {
    return { kind: 'merged', reason: '' };
  }
  const because = lines.filter(l => l.startsWith('lane:merge: refused because ')).at(-1);
  const verdict = lines.filter(l => l.startsWith('lane:merge: wait-ci ended: ')).at(-1);
  const reason = because
    ? because.slice('lane:merge: refused because '.length)
    : verdict
      ? verdict.slice('lane:merge: wait-ci ended: '.length)
      : `the gate ended with exit ${code} and no reason line`;
  if (/merge train full/.test(because ?? '')) return { kind: 'train-full', reason };
  if (code === GATE_WAIT_TIMEOUT) return { kind: 'wait', reason };
  return { kind: 'refused', reason };
}

/** @param {string} p */
const norm = p => {
  const r = path.resolve(p).replace(/[\\/]+$/, '');
  return process.platform === 'win32' ? r.toLowerCase() : r;
};

/**
 * @typedef {{ status: number, stdout: string, stderr: string }} Ran
 * @typedef {{
 *   readBacklog: () => string | null,
 *   gh: (args: string[]) => Ran,
 *   prepare: (o: { pr: number, head: string }) => string | null,
 *   gate: (pr: number) => Ran,
 *   backlog: (args: string[]) => Ran,
 *   post: (text: string) => void,
 *   log: (line: string) => void,
 * }} Deps
 */

/**
 * One round over the ready lines. `tried` holds `<PR>@<sha>` already handled in this run, so a
 * failed vault write cannot make the gate run twice on one head.
 * @param {Deps} d @param {Set<string>} tried
 * @returns {{ stop: string | null, merged: number[] }}
 */
export function round(d, tried) {
  /** @type {number[]} */
  const merged = [];
  const text = d.readBacklog();
  if (text === null) return { stop: null, merged };
  const ready = readyItems(text).filter(r => !tried.has(`${r.pr}@${r.head}`));
  if (!ready.length) return { stop: null, merged };

  /** @param {string} id @param {string[]} args @param {string} what */
  const write = (id, args, what) => {
    const r = d.backlog(args);
    if (r.status !== 0) {
      d.log(`WARNING: ${what} for ${id} not written (${oneLine(r.stderr || r.stdout, 200)})`);
    }
  };
  /** @param {{ id: string, pr: number }} r @param {string} why */
  const refuse = (r, why) => {
    const reason = oneLine(why, 300);
    d.log(`#${r.pr} (${r.id}) not merged: ${reason}`);
    write(r.id, ['progress', r.id, `PR #${r.pr} refused by the merge gate: ${reason}`], 'progress');
    d.post(`merge runner: #${r.pr} not merged: ${reason}`);
  };

  for (const r of ready) {
    // Main is read before each PR: an earlier merge in this round may have turned it red.
    const runs = d.gh([
      'run',
      'list',
      '-R',
      REPO,
      '--branch',
      'main',
      '-w',
      'ci.yml',
      '--event',
      'push',
      '--status',
      'completed',
      '-L',
      '10',
      '--json',
      'conclusion,headSha',
    ]);
    const main =
      runs.status === 0
        ? mainState(runs.stdout)
        : { red: true, sha: '', why: `main CI unreadable (${oneLine(runs.stderr, 200)})` };
    if (main.red) {
      d.log(`stopped: ${main.why}; nothing merged`);
      d.post(
        `merge runner stopped: ${main.why}; ask a session to fix main, then start the runner again`
      );
      return { stop: main.why, merged };
    }

    const view = d.gh(['pr', 'view', String(r.pr), '-R', REPO, '--json', 'state,headRefOid']);
    if (view.status !== 0) {
      d.log(`#${r.pr}: gh pr view failed (${oneLine(view.stderr, 200)}); next round`);
      continue;
    }
    /** @type {{ state?: string, headRefOid?: string }} */
    let pr;
    try {
      pr = JSON.parse(view.stdout);
    } catch {
      d.log(`#${r.pr}: gh pr view answered no JSON; next round`);
      continue;
    }
    const key = `${r.pr}@${r.head}`;
    if (pr.state === 'MERGED') {
      tried.add(key);
      d.log(`#${r.pr} (${r.id}) is already merged; marking it done`);
      write(r.id, ['done', r.id, String(r.pr), '--sha', r.head, '--by', 'merge-runner'], 'done');
      continue;
    }
    if (pr.state !== 'OPEN') {
      tried.add(key);
      refuse(r, `PR #${r.pr} is ${String(pr.state ?? 'unknown').toLowerCase()}`);
      continue;
    }
    if (pr.headRefOid !== r.head) {
      tried.add(key);
      refuse(
        r,
        `the head moved from ${r.head.slice(0, 7)} to ${String(pr.headRefOid ?? '?').slice(0, 7)} since the ready line; the lane writes a new ready line once the new head is reviewed`
      );
      continue;
    }

    const problem = d.prepare(r);
    if (problem) {
      d.log(`stopped: gate checkout: ${problem}`);
      d.post(
        `merge runner stopped: gate checkout problem (${oneLine(problem, 200)}); #${r.pr} waits`
      );
      return { stop: `gate checkout: ${problem}`, merged };
    }
    d.log(`#${r.pr} (${r.id}): running main's gate on ${r.head.slice(0, 7)}`);
    const g = d.gate(r.pr);
    const out = gateOutcome(g.status, `${g.stdout}\n${g.stderr}`, r.pr);
    if (out.kind === 'merged') {
      tried.add(key);
      merged.push(r.pr);
      d.log(`#${r.pr} (${r.id}) merged`);
      write(r.id, ['done', r.id, String(r.pr), '--sha', r.head, '--by', 'merge-runner'], 'done');
    } else if (out.kind === 'train-full') {
      d.log(`stopped: ${TRAIN_FULL_LINE} (#${r.pr} waits)`);
      d.post(`${TRAIN_FULL_LINE} (#${r.pr} waits; start the runner again after the train reset)`);
      return { stop: 'merge train full', merged };
    } else if (out.kind === 'wait') {
      d.log(`#${r.pr}: CI still running (${oneLine(out.reason, 200)}); next round`);
    } else {
      tried.add(key);
      refuse(r, out.reason);
    }
  }
  return { stop: null, merged };
}

// ---- the real dependencies ---------------------------------------------------------------------

/** @param {string} cmd @param {string[]} args @param {{ cwd?: string, timeout?: number }} [o] @returns {Ran} */
function sh(cmd, args, o = {}) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    maxBuffer: 64 * 1024 * 1024,
    timeout: o.timeout ?? SHORT_TIMEOUT_MS,
    cwd: o.cwd,
    env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
  });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? r.error?.message ?? '',
  };
}

/**
 * Get the gate checkout to the PR head: its own top level (an emptied worktree folder falls
 * through to the main checkout), clean, the head fetched and checked out detached, and `npm ci`
 * when package-lock.json changed since the last install. Returns a problem, or null.
 * @param {string} checkout @param {{ pr: number, head: string }} r
 * @param {(cmd: string, args: string[], o?: { cwd?: string, timeout?: number }) => Ran} [run]
 */
export function prepareCheckout(checkout, r, run = sh) {
  const git = (/** @type {string[]} */ args, timeout = SHORT_TIMEOUT_MS) =>
    run('git', args, { cwd: checkout, timeout });
  if (!fs.existsSync(checkout)) return `${checkout} does not exist`;
  const top = git(['rev-parse', '--show-toplevel']);
  if (top.status !== 0 || norm(top.stdout.trim()) !== norm(checkout)) {
    return `${checkout} is not its own git checkout (top level ${top.stdout.trim() || 'unknown'})`;
  }
  const dirty = git(['status', '--porcelain']);
  if (dirty.status !== 0 || dirty.stdout.trim()) return `${checkout} is not clean`;
  const fetched = git(['fetch', '-q', 'aitool', 'main', `refs/pull/${r.pr}/head`], 300_000);
  if (fetched.status !== 0) return `git fetch failed (${oneLine(fetched.stderr, 200)})`;
  const co = git(['checkout', '-q', '--detach', r.head]);
  if (co.status !== 0)
    return `git checkout ${r.head.slice(0, 7)} failed (${oneLine(co.stderr, 200)})`;
  const at = git(['rev-parse', 'HEAD']);
  if (at.stdout.trim() !== r.head) return `HEAD is ${at.stdout.trim()}, not ${r.head}`;
  const lock = path.join(checkout, 'package-lock.json');
  const hash = createHash('sha256').update(fs.readFileSync(lock)).digest('hex');
  const stamp = path.join(checkout, LOCK_STAMP);
  const had = fs.existsSync(stamp) ? fs.readFileSync(stamp, 'utf8').trim() : '';
  if (had !== hash) {
    const npm =
      process.platform === 'win32'
        ? run('cmd.exe', ['/d', '/s', '/c', 'npm ci'], {
            cwd: checkout,
            timeout: NPM_CI_TIMEOUT_MS,
          })
        : run('npm', ['ci'], { cwd: checkout, timeout: NPM_CI_TIMEOUT_MS });
    if (npm.status !== 0) return `npm ci failed (${oneLine(npm.stderr || npm.stdout, 200)})`;
    fs.writeFileSync(stamp, `${hash}\n`);
  }
  return null;
}

/**
 * Write main's copy of a repo file to a temp folder (the PR's own copy never runs). Null when main
 * has none.
 * @param {string} checkout @param {string} rel `/` separated
 * @returns {{ file: string, cleanup: () => void } | null}
 */
export function mainCopy(checkout, rel) {
  const r = sh('git', ['show', `${MAIN}:${rel}`], { cwd: checkout });
  if (r.status !== 0 || !r.stdout) return null;
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'merge-runner-'));
  const file = path.join(dir, path.basename(rel));
  fs.writeFileSync(file, r.stdout);
  return { file, cleanup: () => fs.rmSync(dir, { recursive: true, force: true }) };
}

/** The gate's argv after the script path. @param {number} pr @param {string} vault */
export const gateArgs = (pr, vault) => [String(pr), ...GATE_FLAGS, '--vault', vault];

/**
 * Take the runner lock: `wx` create with our pid. A lock whose pid is gone is taken over.
 * @param {string} file @param {number} [pid]
 * @returns {{ ok: true, release: () => void } | { ok: false, holder: number }}
 */
export function takeRunnerLock(file, pid = process.pid) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  for (let i = 0; i < 2; i++) {
    try {
      fs.writeFileSync(file, `${pid}\n`, { flag: 'wx' });
      return {
        ok: true,
        release: () => {
          try {
            if (fs.readFileSync(file, 'utf8').trim() === String(pid)) fs.unlinkSync(file);
          } catch {
            // already gone
          }
        },
      };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
      const holder = Number(fs.readFileSync(file, 'utf8').trim());
      if (Number.isInteger(holder) && holder > 0 && holder !== pid && pidAlive(holder)) {
        return { ok: false, holder };
      }
      fs.rmSync(file, { force: true });
    }
  }
  return { ok: false, holder: 0 };
}

/**
 * @param {string[]} argv
 * @returns {{ once: boolean, interval: number, vault: string, checkout: string }}
 */
export function parseArgs(argv) {
  const repo = path.resolve(here, '..').replace(/[\\/]\.claude[\\/]worktrees[\\/].*$/, '');
  const o = {
    once: false,
    interval: DEFAULT_INTERVAL,
    vault:
      process.env.FOUNDRY_AI_OBSIDIAN_DIR ||
      path.join(os.homedir(), 'Documents', 'Obsidian', 'vault'),
    checkout: `${repo}-gate`,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[++i];
      if (!v) throw new Error(`${a} needs a value`);
      return v;
    };
    if (a === '--once') o.once = true;
    else if (a === '--interval') {
      o.interval = Number(value());
      if (!Number.isFinite(o.interval) || o.interval < 10)
        throw new Error('--interval is at least 10 seconds');
    } else if (a === '--vault') o.vault = value();
    else if (a === '--checkout') o.checkout = path.resolve(value());
    else throw new Error(`unknown argument ${a}`);
  }
  return o;
}

/** @param {string} line */
const stamp = line => console.log(`merge-runner: ${new Date().toISOString()} ${line}`);

/** @param {ReturnType<typeof parseArgs>} o @returns {Deps} */
function realDeps(o) {
  const vaultGit = (/** @type {string[]} */ args) =>
    sh('git', ['-C', o.vault, ...args], { timeout: 60_000 });
  return {
    readBacklog: () => readUpstreamBacklog(vaultGit, m => stamp(`WARNING: ${m}`)),
    gh: args => sh('gh', args),
    prepare: r => {
      try {
        return prepareCheckout(o.checkout, r);
      } catch (e) {
        return e instanceof Error ? e.message : String(e);
      }
    },
    gate: pr => {
      const copy = mainCopy(o.checkout, 'scripts/lane-merge.mjs');
      if (!copy) return { status: 1, stdout: '', stderr: 'no scripts/lane-merge.mjs on main' };
      try {
        const r = sh(process.execPath, [copy.file, ...gateArgs(pr, o.vault)], {
          cwd: o.checkout,
          timeout: GATE_TIMEOUT_MS,
        });
        for (const line of `${r.stdout}`.split(/\r?\n/).filter(Boolean)) stamp(`  ${line}`);
        return r;
      } finally {
        copy.cleanup();
      }
    },
    backlog: args =>
      sh(process.execPath, [path.join(here, 'backlog.mjs'), ...args, '--vault', o.vault]),
    post: text => {
      const copy = mainCopy(o.checkout, 'packages/discord-bot/announce/announce.mjs');
      if (!copy) return stamp('WARNING: no announce sender on main; nothing posted');
      try {
        const r = sh(process.execPath, [copy.file, 'pr-note', text], { timeout: 15_000 });
        if (r.status !== 0)
          stamp(`WARNING: Discord line not posted (${oneLine(r.stdout || r.stderr, 200)})`);
      } finally {
        copy.cleanup();
      }
    },
    log: stamp,
  };
}

/**
 * @param {string[]} argv
 * @param {{ deps?: Deps, lockFile?: string, sleep?: (ms: number) => Promise<void> }} [inject]
 * @returns {Promise<number>} the exit code
 */
export async function main(argv, inject = {}) {
  let o;
  try {
    o = parseArgs(argv);
  } catch (e) {
    console.error(`merge-runner: ${e instanceof Error ? e.message : e}`);
    return 2;
  }
  const d = inject.deps ?? realDeps(o);
  const lockFile =
    inject.lockFile ?? path.join(os.homedir(), '.foundry-ai-tool', 'merge-runner.lock');
  const lock = takeRunnerLock(lockFile);
  if (!lock.ok) {
    d.log(`another merge runner runs (pid ${lock.holder || 'unknown'}, ${lockFile}); exiting`);
    return 1;
  }
  const sleep = inject.sleep ?? (ms => new Promise(res => setTimeout(res, ms)));
  try {
    d.log(`started (pid ${process.pid}, vault ${o.vault}, gate checkout ${o.checkout})`);
    /** @type {Set<string>} */
    const tried = new Set();
    for (;;) {
      const r = round(d, tried);
      if (r.stop) {
        d.log(`exiting: ${r.stop}`);
        return EXIT_STOPPED;
      }
      if (o.once) return 0;
      await sleep(o.interval * 1000);
    }
  } finally {
    lock.release();
  }
}

if (process.argv[1] && fileURLToPath(import.meta.url) === path.resolve(process.argv[1])) {
  process.exitCode = await main(process.argv.slice(2));
}
