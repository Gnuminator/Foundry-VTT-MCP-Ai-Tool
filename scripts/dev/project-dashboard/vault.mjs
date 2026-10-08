#!/usr/bin/env node
// The vault pull and push wrapper (D-102 line 8, D-103 line 6). One command pulls with autostash,
// adds only the given paths, commits them and pushes (the push also carries any other local
// commits not pushed yet, as a plain `git push` would):
//
//   npm run vault:sync -- push -m "message" <path in the vault>...   [--dir <vault>]
//   npm run vault:sync -- status                                      [--dir <vault>]
//
//   pushPaths({ dir, paths, message, requireClean, write, run }) ->
//     { state: 'pushed'|'nothing'|'waiting'|'error', detail, at }
//
// The page uses requireClean: it waits (and warns) while anything outside its own files is
// changed, except Obsidian's own UI state in `.obsidian/`, or while the vault holds local commits
// not pushed yet. It never stashes (fetch, then fast-forward only), and it discards its own files
// before the pull and writes them again afterwards (`write`), so a pull never has to merge them.
import { execFile } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

const GIT_TIMEOUT_MS = 60_000;

export function vaultDirFrom(env = process.env) {
  return env.FOUNDRY_AI_OBSIDIAN_DIR || path.join(os.homedir(), 'Documents', 'Obsidian', 'vault');
}

export function defaultRun(file, args, opts = {}) {
  return new Promise(resolve => {
    execFile(
      file,
      args,
      {
        cwd: opts.cwd,
        timeout: GIT_TIMEOUT_MS,
        windowsHide: true,
        maxBuffer: 16 * 1024 * 1024,
        env: { ...process.env, GIT_TERMINAL_PROMPT: '0' },
      },
      (err, stdout, stderr) => {
        resolve({
          code: err ? (typeof err.code === 'number' ? err.code : 1) : 0,
          killed: Boolean(err?.killed),
          stdout: String(stdout ?? ''),
          stderr: String(stderr ?? ''),
        });
      }
    );
  });
}

function firstLine(text, fallback) {
  const line = String(text || '')
    .split(/\r?\n/)
    .map(l => l.trim())
    .find(Boolean);
  const t = line || fallback;
  return t.length > 150 ? `${t.slice(0, 147)}...` : t;
}

// Vault-relative paths with forward slashes; nothing absolute, nothing outside the vault.
export function normalizePaths(paths) {
  const out = [];
  for (const p of paths || []) {
    const rel = String(p).replace(/\\/g, '/').replace(/^\.\//, '');
    if (!rel || path.isAbsolute(rel) || /^[A-Za-z]:/.test(rel) || rel.split('/').includes('..'))
      throw new Error(`Not a path inside the vault: ${p}`);
    out.push(rel);
  }
  if (!out.length) throw new Error('No paths given');
  return out;
}

// Entries of `git status --porcelain=v1 -z`: [{ code, file }]. A rename has a second path.
export function parsePorcelain(text) {
  const parts = String(text || '').split('\0');
  const out = [];
  for (let i = 0; i < parts.length; i += 1) {
    const entry = parts[i];
    if (entry.length < 4) continue;
    const code = entry.slice(0, 2);
    out.push({ code, file: entry.slice(3) });
    if (code[0] === 'R' || code[0] === 'C') i += 1;
  }
  return out;
}

// Changes that block a page push: anything not in `own` and not under `.obsidian/`.
export function otherChanges(entries, own) {
  const mine = new Set(own.map(p => p.toLowerCase()));
  return entries.filter(e => {
    const f = e.file.replace(/\\/g, '/');
    return !f.startsWith('.obsidian/') && !mine.has(f.toLowerCase());
  });
}

function rebaseRunning(dir) {
  const g = path.join(dir, '.git');
  return fs.existsSync(path.join(g, 'rebase-merge')) || fs.existsSync(path.join(g, 'rebase-apply'));
}

function busyReason(dir) {
  const g = path.join(dir, '.git');
  if (fs.existsSync(path.join(g, 'index.lock'))) return 'a git command is running in the vault';
  if (rebaseRunning(dir)) return 'a rebase is in progress in the vault';
  if (fs.existsSync(path.join(g, 'MERGE_HEAD'))) return 'a merge is in progress in the vault';
  return null;
}

async function stashTop(git) {
  const r = await git(['rev-parse', '-q', '--verify', 'refs/stash']);
  return r.code === 0 ? r.stdout.trim() : null;
}

// The plain form's pull. It aborts only a rebase it started itself that stopped on a conflict: a
// rebase another session had running (or started meanwhile) is left alone, and so are an
// index.lock and a merge. An autostash that could not be put back is reported, never left silent.
async function pullRebase(git, dir) {
  const rebaseBefore = rebaseRunning(dir);
  const stashBefore = await stashTop(git);
  const pull = await git(['pull', '--rebase', '--autostash', '--quiet']);
  if (pull.code !== 0) {
    const conflict = /could not apply|CONFLICT/.test(`${pull.stdout}\n${pull.stderr}`);
    if (!rebaseBefore && rebaseRunning(dir) && conflict) await git(['rebase', '--abort']);
    return firstLine(pull.stderr, 'git pull failed');
  }
  const stashAfter = await stashTop(git);
  if (stashAfter && stashAfter !== stashBefore)
    return `the other local edits did not apply again after the pull; they are in git stash ${stashAfter.slice(0, 10)}`;
  return null;
}

// The strict form never stashes: fetch, then fast-forward only. git refuses, and changes
// nothing, when an incoming change touches a file edited here; a vault holding commits nobody
// pushed yet waits, so the page never pushes another session's commits.
async function syncClean(git) {
  const fetch = await git(['fetch', '--quiet']);
  if (fetch.code !== 0)
    return {
      state: 'error',
      detail: `fetch failed: ${firstLine(fetch.stderr, 'git fetch failed')}`,
    };
  const ahead = await git(['rev-list', '--count', '@{u}..HEAD']);
  if (ahead.code !== 0)
    return { state: 'error', detail: firstLine(ahead.stderr, 'no upstream branch in the vault') };
  const n = Number(ahead.stdout.trim());
  if (n > 0)
    return {
      state: 'waiting',
      detail: `the vault has ${n} local commit${n === 1 ? '' : 's'} not pushed yet`,
    };
  const ff = await git(['merge', '--ff-only', '--quiet', '@{u}']);
  if (ff.code !== 0)
    return {
      state: 'waiting',
      detail: `the pull waits: ${firstLine(ff.stderr, 'git merge failed')}`,
    };
  return null;
}

// Our own files are written again after the pull, so drop any leftover edits of them.
async function discardOwn(git, dir, own) {
  for (const p of own) {
    const tracked = await git(['ls-files', '--error-unmatch', '--', p]);
    if (tracked.code === 0) await git(['checkout', 'HEAD', '--', p]);
    else fs.rmSync(path.join(dir, p), { force: true });
  }
}

export async function pushPaths({
  dir = vaultDirFrom(),
  paths,
  message,
  requireClean = false,
  write = null,
  run = defaultRun,
  now = () => new Date(),
} = {}) {
  const at = () => now().toISOString();
  const result = (state, detail) => ({ state, detail, at: at() });
  let own;
  try {
    own = normalizePaths(paths);
  } catch (err) {
    return result('error', err.message);
  }
  if (!message || typeof message !== 'string') return result('error', 'No commit message');
  if (!fs.existsSync(path.join(dir, '.git'))) return result('error', `No git repository at ${dir}`);
  const git = args => run('git', args, { cwd: dir });

  const busy = busyReason(dir);
  if (busy) return result('waiting', busy);

  if (requireClean) {
    const st = await git(['status', '--porcelain=v1', '-z', '--untracked-files=all']);
    if (st.code !== 0) return result('error', firstLine(st.stderr, 'git status failed'));
    const others = otherChanges(parsePorcelain(st.stdout), own);
    if (others.length)
      return result(
        'waiting',
        `the vault has ${others.length} other uncommitted change${others.length === 1 ? '' : 's'}`
      );
    await discardOwn(git, dir, own);
    const sync = await syncClean(git);
    if (sync) return result(sync.state, sync.detail);
  } else {
    const failed = await pullRebase(git, dir);
    if (failed) return result('error', `pull failed: ${failed}`);
  }

  // Write, add and commit only our files: null once committed, else the result to return.
  const commitOwn = async () => {
    if (write) {
      try {
        await write(dir);
      } catch (err) {
        return result('error', `writing the files failed: ${firstLine(err?.message, 'error')}`);
      }
    }
    const add = await git(['add', '--', ...own]);
    if (add.code !== 0) return result('error', firstLine(add.stderr, 'git add failed'));
    const diff = await git(['diff', '--cached', '--quiet', '--', ...own]);
    if (diff.code === 0) return result('nothing', 'no changes to push');
    const commit = await git(['commit', '--quiet', '-m', message, '--only', '--', ...own]);
    if (commit.code !== 0) return result('error', firstLine(commit.stderr, 'git commit failed'));
    return null;
  };
  const pushed = () => result('pushed', `pushed ${own.length} file${own.length === 1 ? '' : 's'}`);

  const stopped = await commitOwn();
  if (stopped) return stopped;
  if ((await git(['push', '--quiet'])).code === 0) return pushed();

  // Someone pushed in between: try once more on top of their commit.
  if (requireClean) {
    // Take our commit back, drop our files, fast-forward and write them again: the page's own
    // notes are rebuilt, never merged.
    await undoOwnCommit(git, message, own);
    await discardOwn(git, dir, own);
    const sync = await syncClean(git);
    if (sync) return result(sync.state, `push rejected, then ${sync.detail}`);
    const again = await commitOwn();
    if (again) return again;
  } else {
    const failed = await pullRebase(git, dir);
    if (failed) {
      await undoOwnCommit(git, message, own);
      return result('error', `push rejected and the rebase failed: ${failed}`);
    }
  }
  const push = await git(['push', '--quiet']);
  if (push.code === 0) return pushed();
  await undoOwnCommit(git, message, own);
  return result('error', `push failed: ${firstLine(push.stderr, 'git push failed')}`);
}

// Take back our unpushed commit (only when HEAD is it), keeping the files as local edits.
async function undoOwnCommit(git, message, own) {
  const head = await git(['log', '-1', '--format=%s']);
  const ahead = await git(['rev-list', '--count', '@{u}..HEAD']);
  if (head.code !== 0 || head.stdout.trim() !== message.split('\n')[0]) return;
  if (ahead.code !== 0 || Number(ahead.stdout.trim()) < 1) return;
  await git(['reset', '--soft', 'HEAD~1']);
  await git(['restore', '--staged', '--', ...own]);
}

async function cli(argv) {
  const args = [...argv];
  const take = name => {
    const i = args.indexOf(name);
    if (i === -1) return null;
    const v = args[i + 1];
    args.splice(i, 2);
    return v ?? '';
  };
  const dir = take('--dir') || vaultDirFrom();
  const message = take('-m') ?? take('--message');
  const cmd = args.shift();
  if (cmd === 'status') {
    const st = await defaultRun('git', ['status', '--short', '--branch'], { cwd: dir });
    process.stdout.write(st.stdout || st.stderr);
    const busy = busyReason(dir);
    if (busy) console.log(`busy: ${busy}`);
    return st.code;
  }
  if (cmd !== 'push') {
    console.error('Usage: vault.mjs push -m "message" <path>... [--dir <vault>] | status');
    return 2;
  }
  const r = await pushPaths({ dir, paths: args, message: message || '' });
  console.log(`${r.state}: ${r.detail}`);
  return r.state === 'pushed' || r.state === 'nothing' ? 0 : r.state === 'waiting' ? 75 : 1;
}

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  cli(process.argv.slice(2)).then(code => process.exit(code));
}
