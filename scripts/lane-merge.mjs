#!/usr/bin/env node
/**
 * Merge gate (D-122): a lane merges its own pull request through this script. Every check runs
 * before anything is changed; each failure is one line. The end is either
 *
 *   lane:merge: merged #312 at 1a2b3c4; merge train 2/4
 *   lane:merge: NOT merged #312        (then one line per failed check, exit 1)
 *
 *   npm run lane:merge -- <PR>                         check, then merge
 *   npm run lane:merge -- <PR> --dry-run               all checks, no merge, no train write
 *   npm run lane:merge -- <PR> --no-changelog "reason" no changelog.d fragment on purpose
 *   npm run lane:merge -- --vault DIR                  Obsidian vault (default: env
 *                                                      FOUNDRY_AI_OBSIDIAN_DIR, else ~/Documents/Obsidian/vault)
 *   npm run lane:merge -- --train                      print the merge train
 *   npm run lane:merge -- --train-reset <sha>          a green live:roundtrip ran on main at <sha>
 *                                                      (must be the tip of aitool/main)
 *
 * The checks, in order: (a) the PR is open, not a draft, based on main and mergeable; (b) every CI
 * check passed, including each check the branch ruleset requires (read from the GitHub API);
 * (c) every review note for the head commit says Merge (full 40-character sha), and one of them is
 * an Opus review when the PR touches a risky area (RISKY_CATEGORIES, D-101); (d) a changelog.d
 * fragment; (e) this checkout is the PR head, clean, and drift-check passes; (f) the merge train
 * (D-121) has room. The merge is `gh pr merge --merge --match-head-commit <head>`.
 *
 * The gate does not trust the branch it judges: when this file differs from aitool/main's copy, the
 * script runs main's copy instead (a temp file, same arguments), and drift-check runs from main's
 * copy too. The changed files come from `git diff` against the merge base, not from gh (which stops
 * at 100 files). All gh, git, node and npm calls go through one injectable `run(cmd, args)`.
 *
 * The merge train is per PC: its state file lives in ~/.foundry-ai-tool, so lanes on another PC
 * count their own merges. A lock file next to it serialises the read-check-merge-write.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';

/** Merges allowed on the module, the bridge link or guarded writes between two live round trips. */
export const TRAIN_SIZE = 4;

/** The remote and branch the gate trusts. */
const REMOTE = 'aitool';
const MAIN = `${REMOTE}/main`;
/** Where the branch ruleset lives. */
export const REPO = 'Gnuminator/Foundry-VTT-MCP-Ai-Tool';

/** Lines of a failed log that are printed. */
const TAIL_LINES = 30;

/** The relaunched copy (from main) must not relaunch again; it also knows main was just fetched. */
const ENV_FROM_MAIN = 'LANE_MERGE_FROM_MAIN';
const ENV_FETCHED = 'LANE_MERGE_FETCHED';

/**
 * Areas where a Sonnet review is not enough (D-101): the counting review note must be an Opus
 * review. Patterns are repo-relative, `/` separated: `**` crosses folders, `*` does not. The test
 * file checks that every pattern still matches a tracked file.
 * @type {{ name: string, patterns: string[] }[]}
 */
export const RISKY_CATEGORIES = [
  {
    // Guarded writes: plan, apply and undo, in the module, the server and the shared contract.
    // queries.ts holds the module handlers that call into guarded-write.
    name: 'guarded writes',
    patterns: [
      'packages/foundry-module/src/data-access/guarded-write*',
      'packages/foundry-module/src/live-plan*',
      'packages/foundry-module/src/transaction-manager*',
      'packages/foundry-module/src/guarded-features*',
      'packages/foundry-module/src/change-journal*',
      'packages/foundry-module/src/queries.ts',
      'packages/mcp-server/src/guarded-write/**',
      'packages/mcp-server/src/tools/guarded-changes*',
      'packages/mcp-server/src/change-journal-pump*',
      'shared/src/guarded-write*',
      'shared/src/change-journal*',
    ],
  },
  {
    // The bridge link: the module's socket to the server and the server's connection and control channel.
    name: 'the bridge link',
    patterns: [
      'packages/foundry-module/src/bridge-link*',
      'packages/foundry-module/src/bridge-handlers*',
      'packages/foundry-module/src/socket-bridge*',
      'packages/mcp-server/src/foundry-client*',
      'packages/mcp-server/src/foundry-connector*',
      'packages/mcp-server/src/control-*',
      'packages/mcp-server/src/session-control*',
      'packages/mcp-server/src/standalone.ts',
      'packages/cogm-dashboard/src/feed/mcp-control-client*',
    ],
  },
  {
    // The write gate: what may change the world, and who may.
    name: 'the write gate',
    patterns: [
      'packages/foundry-module/src/write-gate*',
      'packages/foundry-module/src/permissions*',
    ],
  },
  {
    // Security: dashboard auth (server and React side) and redaction, secret stripping, the
    // licensed-content guard, secret terms, the player vault writer, and the React side of guarded
    // changes (its confirm step).
    name: 'security',
    patterns: [
      'packages/cogm-dashboard/src/auth*',
      'packages/cogm-dashboard/src/redact*',
      'packages/cogm-dashboard/src/player-vault/writer*',
      'packages/cogm-dashboard/web/src/lib/auth*',
      'packages/cogm-dashboard/web/src/lib/guarded*',
      'packages/mcp-server/src/secret-terms*',
      'packages/mcp-server/src/handouts/strip-secrets*',
      'packages/mcp-server/src/obsidian/licensed-guard*',
      '.claude/hooks/guard-*',
    ],
  },
  {
    // Pi scripts: they run as root on the Pi and change the real campaign host.
    name: 'Pi scripts',
    patterns: ['scripts/pi/**', 'scripts/plan-b/**', 'deploy/**'],
  },
  {
    // Wire contracts: the shared package (protocol, schemas, constants) and the module manifest.
    name: 'wire contracts',
    patterns: ['shared/src/**', 'packages/foundry-module/module.json'],
  },
  {
    // The merge gate and everything it executes or trusts: the gate, keep-green, drift-check, CI,
    // and the hooks and settings that run in every lane.
    name: 'the merge gate',
    patterns: [
      'scripts/lane-merge.mjs',
      'scripts/green.mjs',
      'scripts/drift-check.mjs',
      '.github/workflows/**',
      '.claude/hooks/**',
      '.claude/settings.json',
    ],
  },
];

/**
 * PRs that touch these join the merge train (D-121): the Foundry module, the bridge link or guarded
 * writes. Tests do not count. A subset of RISKY_CATEGORIES plus the whole module package.
 * @type {string[]}
 */
export const TRAIN_PATTERNS = [
  'packages/foundry-module/**',
  ...RISKY_CATEGORIES.filter(
    c => c.name === 'guarded writes' || c.name === 'the bridge link'
  ).flatMap(c => c.patterns),
];

/** @param {string} file */
const isTestFile = file => /\.(test|spec)\.[cm]?[jt]sx?$|\/test-support\//.test(file);

/** A glob (`**`, `*`, `?`) as a regular expression over a whole repo-relative path. @param {string} glob */
export function globToRegExp(glob) {
  let re = '';
  for (let i = 0; i < glob.length; i++) {
    const c = glob[i];
    if (c === '*' && glob[i + 1] === '*') {
      if (glob[i + 2] === '/') {
        re += '(?:.*/)?';
        i += 2;
      } else {
        re += '.*';
        i += 1;
      }
    } else if (c === '*') re += '[^/]*';
    else if (c === '?') re += '[^/]';
    else re += c.replace(/[.+^${}()|[\]\\]/g, '\\$&');
  }
  return new RegExp(`^${re}$`);
}

/** @param {string} file @param {string[]} patterns */
export function matchesAny(file, patterns) {
  const f = file.replace(/\\/g, '/');
  return patterns.some(p => globToRegExp(p).test(f));
}

/**
 * The risky categories a set of changed files falls in, each with its first file.
 * @param {string[]} files
 * @returns {{ name: string, file: string }[]}
 */
export function riskyHits(files) {
  /** @type {{ name: string, file: string }[]} */
  const hits = [];
  for (const cat of RISKY_CATEGORIES) {
    const file = files.find(f => matchesAny(f, cat.patterns));
    if (file) hits.push({ name: cat.name, file });
  }
  return hits;
}

/** @param {string[]} files */
export function isTrainRelevant(files) {
  return files.some(f => !isTestFile(f) && matchesAny(f, TRAIN_PATTERNS));
}

/**
 * @typedef {{ head: string | null, verdict: string | null, merge: boolean }} VerdictEntry
 * @typedef {{ name: string, entries: VerdictEntry[], shortHeads: string[], opus: boolean }} ReviewNote
 */

/** The verdict text, without bold markers, a trailing full stop or case. @param {string} text */
const verdictKey = text =>
  text
    .replace(/\*\*/g, '')
    .replace(/[.\s]+$/, '')
    .trim()
    .toLowerCase();

/**
 * What a review note says. A note can hold several rounds: every `## Verdict` section is one entry,
 * tied to the last `Head reviewed:` line above it. `Head reviewed:` must carry the full 40-character
 * sha (backticked or bare, prose may follow); a shorter sha is listed in `shortHeads` and ties
 * nothing. The verdict is the text after `Verdict` on the heading line (`## Verdict: Do not merge`),
 * else the first bold text of the section. `opus` is true only for a file named
 * `<N>-opus-review...` or a first `# ` heading that starts `PR #<N> Opus review`.
 * @param {string} name @param {string} text @param {number} prNumber
 * @returns {ReviewNote}
 */
export function parseReviewNote(name, text, prNumber) {
  const lines = text.split(/\r?\n/);
  /** @type {string | null} */
  let head = null;
  /** @type {VerdictEntry[]} */
  const entries = [];
  /** @type {string[]} */
  const shortHeads = [];
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const h = /Head reviewed:\s*`?([0-9a-f]+)(?![0-9a-z])/i.exec(line);
    if (h) {
      if (h[1].length === 40) head = h[1].toLowerCase();
      else {
        head = null;
        shortHeads.push(h[1].toLowerCase());
      }
      continue;
    }
    const v = /^##\s+Verdict\b(.*)$/i.exec(line);
    if (!v) continue;
    let verdict = v[1].replace(/^[\s:\-\u2013]+/, '').trim() || null;
    if (verdict === null) {
      const section = [];
      for (const l of lines.slice(i + 1)) {
        if (/^#{1,2}\s/.test(l)) break;
        section.push(l);
      }
      const bold = /\*\*(.+?)\*\*/.exec(section.join('\n'));
      verdict = bold ? bold[1].trim() : null;
    }
    entries.push({ head, verdict, merge: verdict !== null && verdictKey(verdict) === 'merge' });
  }
  const heading = lines.find(l => /^#\s+/.test(l)) ?? '';
  return {
    name,
    entries,
    shortHeads,
    opus:
      new RegExp(`^${prNumber}-opus-review`, 'i').test(name) ||
      new RegExp(`^#\\s+PR\\s+#${prNumber}\\s+Opus review`, 'i').test(heading),
  };
}

/**
 * Review notes of one PR: the "Reviews ..." folders under Handoff, files named <N>-*review*.md.
 * Null when the vault folder does not exist.
 * @param {string} vault @param {number} prNumber
 * @returns {ReviewNote[] | null}
 */
export function findReviewNotes(vault, prNumber) {
  const handoff = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff');
  if (!fs.existsSync(vault)) return null;
  if (!fs.existsSync(handoff)) return [];
  const prefix = `${prNumber}-`;
  /** @type {ReviewNote[]} */
  const notes = [];
  for (const dir of fs.readdirSync(handoff, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('Reviews ')) continue;
    const folder = path.join(handoff, dir.name);
    for (const file of fs.readdirSync(folder)) {
      if (!file.endsWith('.md') || !file.startsWith(prefix) || !/review/i.test(file)) continue;
      notes.push(parseReviewNote(file, fs.readFileSync(path.join(folder, file), 'utf8'), prNumber));
    }
  }
  return notes;
}

/**
 * Do the review notes clear this head commit? Every verdict any note gives for the head must be
 * Merge (a Merge after fixes or Do not merge in any note refuses), at least one must be a Merge,
 * and when the PR is risky at least one Merge must come from an Opus review.
 * @param {ReviewNote[]} notes @param {string} headSha @param {boolean} needOpus
 * @returns {{ ok: boolean, detail: string }}
 */
export function judgeReviews(notes, headSha, needOpus) {
  const head = headSha.toLowerCase();
  const short = head.slice(0, 7);
  const forHead = notes.flatMap(note =>
    note.entries.filter(e => e.head === head).map(entry => ({ note, entry }))
  );
  if (forHead.length === 0) {
    const seen = notes.map(n => {
      const heads = [...new Set(n.entries.map(e => e.head).filter(Boolean))].map(h =>
        h.slice(0, 7)
      );
      const tooShort = n.shortHeads.map(
        h => `${h} (Head reviewed needs the full 40-character sha)`
      );
      return `${n.name} reviewed ${[...heads, ...tooShort].join(', ') || 'no head'}`;
    });
    return {
      ok: false,
      detail: `no review note for head ${short}${seen.length ? ` (found ${seen.join('; ')})` : ''}`,
    };
  }
  const blocking = forHead.filter(x => !x.entry.merge);
  if (blocking.length > 0) {
    const said = blocking.map(x => `${x.note.name} says "${x.entry.verdict ?? 'no verdict'}"`);
    return {
      ok: false,
      detail: `${said.join('; ')} for head ${short}; every review must say Merge`,
    };
  }
  if (needOpus && !forHead.some(x => x.note.opus)) {
    const names = [...new Set(forHead.map(x => x.note.name))].join(', ');
    return {
      ok: false,
      detail: `only a Sonnet review (${names}) says Merge for ${short}, and this PR needs an Opus review`,
    };
  }
  return { ok: true, detail: forHead.map(x => x.note.name).join(', ') };
}

/**
 * The status check names the branch ruleset requires, from `gh api .../rules/branches/main`.
 * Null when the answer is not a list of rules or lists no required status checks at all.
 * @param {string} json
 * @returns {string[] | null}
 */
export function requiredContexts(json) {
  let rules;
  try {
    rules = JSON.parse(json);
  } catch {
    return null;
  }
  if (!Array.isArray(rules)) return null;
  const contexts = rules
    .filter(r => r && r.type === 'required_status_checks')
    .flatMap(r => r.parameters?.required_status_checks ?? [])
    .map(c => c?.context)
    .filter(c => typeof c === 'string' && c !== '');
  return contexts.length > 0 ? [...new Set(contexts)] : null;
}

/**
 * What is wrong with the CI checks of a PR. Handles both shapes of `statusCheckRollup`: a check run
 * `{ name, status, conclusion }` and a commit status `{ context, state }`. `required` are names that
 * must be in the rollup.
 * @param {any[]} rollup @param {string[]} [required]
 * @returns {{ failing: string[], pending: string[], missing: string[] }}
 */
export function rollupProblems(rollup, required = []) {
  const failing = [];
  const pending = [];
  const names = new Set();
  for (const c of rollup) {
    names.add(c.name ?? c.context);
    if (c.state !== undefined && c.status === undefined) {
      const name = c.context ?? c.name ?? 'status';
      const state = String(c.state).toUpperCase();
      if (state === 'SUCCESS') continue;
      if (state === 'PENDING' || state === 'EXPECTED') pending.push(`${name} (${state})`);
      else failing.push(`${name} (${state})`);
      continue;
    }
    const name = c.name ?? c.context ?? 'check';
    const status = String(c.status ?? '').toUpperCase();
    const conclusion = String(c.conclusion ?? '').toUpperCase();
    if (status !== 'COMPLETED') pending.push(`${name} (${status || 'unknown'})`);
    else if (!['SUCCESS', 'SKIPPED', 'NEUTRAL'].includes(conclusion)) {
      failing.push(`${name} (${conclusion || 'no conclusion'})`);
    }
  }
  return { failing, pending, missing: required.filter(r => !names.has(r)) };
}

/** Does the PR add or change a `changelog.d/*.md` fragment (not the README)? @param {{ path: string, changeType?: string }[]} files */
export function hasChangelogFragment(files) {
  return files.some(
    f =>
      /^changelog\.d\/[^/]+\.md$/.test(f.path.replace(/\\/g, '/')) &&
      !/(^|\/)README\.md$/i.test(f.path) &&
      String(f.changeType ?? '').toUpperCase() !== 'DELETED'
  );
}

/**
 * Parses `git diff -z --name-status --no-renames` output: NUL-separated status and path pairs, so a
 * path with non-ASCII characters comes through as it is, not quoted. A rename or copy entry (should
 * --no-renames ever be dropped) carries two paths and yields both.
 * @param {string} text
 * @returns {{ path: string, changeType: string }[]}
 */
export function parseNameStatus(text) {
  /** @type {{ path: string, changeType: string }[]} */
  const files = [];
  const tokens = text.split(String.fromCharCode(0));
  for (let i = 0; i + 1 < tokens.length; ) {
    const status = tokens[i].trim();
    if (!/^[A-Z][0-9]*$/.test(status)) {
      i += 1;
      continue;
    }
    const changeType = { A: 'ADDED', M: 'MODIFIED', D: 'DELETED' }[status[0]] ?? 'CHANGED';
    const count = status[0] === 'R' || status[0] === 'C' ? 2 : 1;
    for (const p of tokens.slice(i + 1, i + 1 + count)) if (p) files.push({ path: p, changeType });
    i += 1 + count;
  }
  return files;
}

/** @typedef {{ lastRoundtrip: { sha: string, at: string } | null, since: { pr: number, sha: string, at: string }[] }} TrainState */

const TRAIN_FIX = 'fix it or run npm run lane:merge -- --train-reset <sha>';

/**
 * The merge train state; an empty train when the file does not exist yet. A file that is not JSON,
 * not an object, or whose `since` is not a list is refused (it is not read as an empty train).
 * @param {string} file @returns {TrainState}
 */
export function readTrain(file) {
  if (!fs.existsSync(file)) return { lastRoundtrip: null, since: [] };
  let data;
  try {
    data = JSON.parse(fs.readFileSync(file, 'utf8'));
  } catch (e) {
    throw new Error(`train file unreadable (${file}): ${TRAIN_FIX}`, { cause: e });
  }
  const last = data?.lastRoundtrip;
  const lastOk = last === null || last === undefined || (typeof last === 'object' && last.sha);
  if (!data || typeof data !== 'object' || !Array.isArray(data.since) || !lastOk) {
    throw new Error(`train file unreadable (${file}): ${TRAIN_FIX}`);
  }
  return { lastRoundtrip: last ?? null, since: data.since };
}

/** @param {string} file @param {TrainState} state */
export function writeTrain(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/** Wait without spinning. @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * An exclusive lock next to the train file (`<file>.lock`, created with `wx`). A lock older than
 * `staleMs` (default 10 minutes) belongs to a killed run and is taken over. Waits up to `timeoutMs`.
 * @param {string} file
 * @param {{ staleMs?: number, timeoutMs?: number, now?: () => number, wait?: (ms: number) => void }} [opts]
 * @returns {() => void} release
 */
export function acquireLock(file, opts = {}) {
  const { staleMs = 10 * 60 * 1000, timeoutMs = 20_000, now = Date.now, wait = sleep } = opts;
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const started = now();
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      fs.writeSync(fd, JSON.stringify({ pid: process.pid, at: new Date(now()).toISOString() }));
      fs.closeSync(fd);
      return () => {
        try {
          fs.unlinkSync(lock);
        } catch {
          /* already gone */
        }
      };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
    try {
      if (now() - fs.statSync(lock).mtimeMs > staleMs) {
        fs.unlinkSync(lock);
        continue;
      }
    } catch {
      continue; // the holder released it between our two calls: try again
    }
    if (now() - started >= timeoutMs) {
      throw new Error(`another lane:merge holds ${lock} (delete it if no merge is running)`);
    }
    wait(200);
  }
}

/**
 * The real `run`: gh, git, node and npm. `npm` is a .cmd file on Windows, so it goes through the
 * shell as one command string (an args array under a shell is deprecated, DEP0190).
 * @param {string} cmd @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function defaultRun(cmd, args) {
  const r =
    cmd === 'npm' && process.platform === 'win32'
      ? spawnSync(['npm', ...args].join(' '), {
          encoding: 'utf8',
          shell: true,
          maxBuffer: 256 * 1024 * 1024,
        })
      : spawnSync(cmd, args, { encoding: 'utf8', maxBuffer: 256 * 1024 * 1024 });
  return {
    status: r.status ?? 1,
    stdout: r.stdout ?? '',
    stderr: r.stderr ?? r.error?.message ?? '',
  };
}

/**
 * @param {string[]} argv
 * @returns {{ pr: number | null, dryRun: boolean, noChangelog: string | null, vault: string | null,
 *   trainReset: string | null, train: boolean, state: string | null, error: string | null }}
 */
export function parseArgs(argv) {
  const out = {
    pr: null,
    dryRun: false,
    noChangelog: null,
    vault: null,
    trainReset: null,
    train: false,
    state: null,
    error: null,
  };
  for (let i = 0; i < argv.length; i++) {
    const a = argv[i];
    const value = () => {
      const v = argv[i + 1];
      if (v === undefined || v === '' || v.startsWith('--')) return null;
      i++;
      return v;
    };
    if (a === '--dry-run') out.dryRun = true;
    else if (a === '--train') out.train = true;
    else if (
      a === '--no-changelog' ||
      a === '--vault' ||
      a === '--train-reset' ||
      a === '--state'
    ) {
      const v = value();
      if (v === null) {
        out.error = `${a} needs a value`;
        return out;
      }
      if (a === '--no-changelog') out.noChangelog = v;
      else if (a === '--vault') out.vault = v;
      else if (a === '--state') out.state = v;
      else out.trainReset = v;
    } else if (/^\d+$/.test(a) && out.pr === null) out.pr = Number(a);
    else {
      out.error = `unexpected argument ${a}`;
      return out;
    }
  }
  if (!out.error && out.pr === null && !out.train && out.trainReset === null) {
    out.error =
      'usage: npm run lane:merge -- <PR> [--dry-run] [--no-changelog "reason"] [--vault DIR]';
  }
  return out;
}

const PR_FIELDS =
  'number,state,isDraft,baseRefName,headRefName,headRefOid,mergeable,files,statusCheckRollup,title';

/** @param {string} text */
const firstLine = text => text.trim().split(/\r?\n/)[0] ?? '';

/** The shell-free runner type of `run`. @typedef {(cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }} Run */

/** Line endings must not make two copies of a file differ. @param {string} text */
const lf = text => text.replace(/\r\n/g, '\n');

/**
 * The gate judges a branch, so the branch must not judge itself: when this file differs from
 * aitool/main's copy, run main's copy (from a temp file, same arguments and folder) and return its
 * exit code. Main without a gate (bootstrap) runs this copy, with one line saying so. Skipped for the
 * copy that was itself started from main, and for `--train` (read only).
 * @param {{ argv: string[], run: Run, selfPath: string, env: Record<string, string | undefined>,
 *   tmpdir: string, cwd?: string, log: (line: string) => void,
 *   spawn?: typeof spawnSync, execPath?: string }} o
 * @returns {{ relaunched: boolean, code: number, fetched: boolean, error: string | null }}
 */
export function relaunchFromMain(o) {
  const {
    argv,
    run,
    selfPath,
    env,
    tmpdir,
    log,
    spawn = spawnSync,
    execPath = process.execPath,
  } = o;
  const same = { relaunched: false, code: 0, fetched: env[ENV_FETCHED] === '1', error: null };
  if (env[ENV_FROM_MAIN] === '1' || argv.includes('--train')) return same;
  const fetch = run('git', ['fetch', REMOTE, 'main']);
  if (fetch.status !== 0) {
    return {
      ...same,
      error: `git fetch ${REMOTE} main failed (${firstLine(fetch.stderr || fetch.stdout)}); the gate cannot compare itself with main`,
    };
  }
  const show = run('git', ['show', `${MAIN}:scripts/lane-merge.mjs`]);
  if (show.status !== 0) {
    log(`lane:merge: ${MAIN} has no merge gate yet (bootstrap); running this checkout's copy`);
    return { ...same, fetched: true };
  }
  if (lf(show.stdout) === lf(fs.readFileSync(selfPath, 'utf8'))) return { ...same, fetched: true };
  const dir = fs.mkdtempSync(path.join(tmpdir, 'lane-merge-main-'));
  const file = path.join(dir, 'lane-merge.mjs');
  fs.writeFileSync(file, show.stdout);
  log(`lane:merge: this checkout's gate differs from ${MAIN}; running main's copy`);
  const r = spawn(execPath, [file, ...argv], {
    cwd: o.cwd ?? process.cwd(),
    stdio: 'inherit',
    env: { ...env, [ENV_FROM_MAIN]: '1', [ENV_FETCHED]: '1' },
  });
  return { relaunched: true, code: r.status ?? 1, fetched: true, error: null };
}

/** Run by `node -e`: import main's drift-check copy and run it in the current folder. */
const DRIFT_RUNNER =
  'import(process.argv[1]).then(m => process.exit(m.runDriftCheck({ cwd: process.cwd() })), e => { console.error(String(e)); process.exit(1); });';

/** Does a module import another file of the repo (relative specifier)? @param {string} text */
export function hasRelativeImports(text) {
  return (
    /(?:^|\n)\s*(?:import|export)\b[^;]*?\bfrom\s+['"]\.{1,2}\//.test(text) ||
    /\bimport\s*\(\s*['"]\.{1,2}\//.test(text) ||
    /(?:^|\n)\s*import\s+['"]\.{1,2}\//.test(text)
  );
}

/**
 * drift-check from main's copy (a temp file), not the branch's own `npm run drift:check`: the branch
 * could have edited either. Falls back to the local script, with a note, when main's copy has no
 * `runDriftCheck` export or imports other repo files.
 * @param {Run} run @param {string} tmpdir @param {string[]} notes
 */
function runDrift(run, tmpdir, notes) {
  const show = run('git', ['show', `${MAIN}:scripts/drift-check.mjs`]);
  if (show.status !== 0) {
    notes.push(
      `drift-check: ${MAIN} has no scripts/drift-check.mjs yet; using this checkout's npm run drift:check`
    );
    return run('npm', ['run', 'drift:check']);
  }
  if (hasRelativeImports(show.stdout) || !/export function runDriftCheck\b/.test(show.stdout)) {
    notes.push(
      `drift-check: main's copy imports other repo files or lacks runDriftCheck; using this checkout's npm run drift:check`
    );
    return run('npm', ['run', 'drift:check']);
  }
  const dir = fs.mkdtempSync(path.join(tmpdir, 'lane-merge-drift-'));
  const file = path.join(dir, 'drift-check.mjs');
  fs.writeFileSync(file, show.stdout);
  return run('node', ['--input-type=module', '-e', DRIFT_RUNNER, pathToFileURL(file).href]);
}

/**
 * Is this module the script node was started with? Real paths on both sides, so a junction or a
 * drive-letter case cannot turn into a silent exit 0.
 * @param {string | undefined} argv1 @param {string} self
 */
export function isEntryModule(argv1, self) {
  if (!argv1) return false;
  const norm = (/** @type {string} */ p) => {
    let r;
    try {
      r = fs.realpathSync(p);
    } catch {
      r = path.resolve(p);
    }
    return process.platform === 'win32' ? r.toLowerCase() : r;
  };
  return norm(argv1) === norm(self);
}

/**
 * 'run' when started directly, 'import' when another module loaded it, 'mismatch' when the started
 * file has this file's name but is not this file (the process must then fail, not exit 0 silently).
 * @param {string | undefined} argv1 @param {string} self
 */
export function entryDecision(argv1, self) {
  if (isEntryModule(argv1, self)) return 'run';
  if (argv1 && path.basename(argv1).toLowerCase() === path.basename(self).toLowerCase()) {
    return 'mismatch';
  }
  return 'import';
}

/**
 * Runs the gate.
 * @param {{
 *   argv?: string[], run?: Run, log?: (line: string) => void, env?: Record<string, string | undefined>,
 *   home?: string, tmpdir?: string, now?: () => Date, fetched?: boolean, lockTimeoutMs?: number,
 * }} [options]
 * @returns {number} the process exit code
 */
export function main(options = {}) {
  const {
    argv = process.argv.slice(2),
    run = defaultRun,
    log = console.log,
    env = process.env,
    home = os.homedir(),
    tmpdir = os.tmpdir(),
    now = () => new Date(),
    fetched = env[ENV_FETCHED] === '1',
    lockTimeoutMs = 20_000,
  } = options;
  const args = parseArgs(argv);
  if (args.error) {
    log(`lane:merge: ${args.error}`);
    return 2;
  }
  const statePath = args.state ?? path.join(home, '.foundry-ai-tool', 'merge-train.json');
  const short = (/** @type {string} */ sha) => sha.slice(0, 7);
  /** git fetch aitool main, once per run. @returns {string | null} an error, or null */
  const fetchMain = () => {
    if (fetched) return null;
    const f = run('git', ['fetch', REMOTE, 'main']);
    return f.status === 0 ? null : firstLine(f.stderr || f.stdout) || 'failed';
  };
  const message = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));

  if (args.train) {
    try {
      const state = readTrain(statePath);
      const last = state.lastRoundtrip
        ? `last live:roundtrip at ${short(state.lastRoundtrip.sha)} (${state.lastRoundtrip.at})`
        : 'no live:roundtrip recorded';
      const since = state.since.map(s => `#${s.pr}@${short(s.sha)}`).join(', ') || 'none';
      log(
        `lane:merge: merge train ${state.since.length}/${TRAIN_SIZE}; ${last}; merged since: ${since}`
      );
      return 0;
    } catch (e) {
      log(`lane:merge: ${message(e)}`);
      return 1;
    }
  }
  if (args.trainReset !== null) {
    const sha = args.trainReset.toLowerCase();
    if (!/^[0-9a-f]{7,40}$/.test(sha)) {
      log('lane:merge: --train-reset needs a commit sha (7 to 40 hex characters)');
      return 2;
    }
    const fetchError = fetchMain();
    if (fetchError) {
      log(`lane:merge: train not reset: git fetch ${REMOTE} main failed (${fetchError})`);
      return 1;
    }
    const tip = run('git', ['rev-parse', MAIN]);
    const tipSha = tip.stdout.trim().toLowerCase();
    if (tip.status !== 0 || !tipSha.startsWith(sha)) {
      log(
        `lane:merge: train not reset: ${short(sha)} is not the tip of ${MAIN} (${tipSha ? short(tipSha) : 'unknown'}); run live:roundtrip on the newest main`
      );
      return 1;
    }
    let release;
    try {
      release = acquireLock(statePath, { timeoutMs: lockTimeoutMs });
      writeTrain(statePath, { lastRoundtrip: { sha: tipSha, at: now().toISOString() }, since: [] });
    } catch (e) {
      log(`lane:merge: train not reset: ${message(e)}`);
      return 1;
    } finally {
      release?.();
    }
    log(`lane:merge: merge train reset at ${short(tipSha)}; merge train 0/${TRAIN_SIZE}`);
    return 0;
  }

  const n = /** @type {number} */ (args.pr);
  const vault =
    args.vault ?? env.FOUNDRY_AI_OBSIDIAN_DIR ?? path.join(home, 'Documents', 'Obsidian', 'vault');
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const details = [];
  /** @type {string[]} */
  const notes = [];
  const finish = () => {
    log(`lane:merge: NOT merged #${n}`);
    for (const f of failures) log(f);
    for (const line of notes) log(`lane:merge: ${line}`);
    for (const d of details) log(d);
    return 1;
  };

  // a. The PR itself.
  const view = run('gh', ['pr', 'view', String(n), '--json', PR_FIELDS]);
  /** @type {any} */
  let pr = null;
  if (view.status === 0) {
    try {
      pr = JSON.parse(view.stdout);
    } catch {
      /* reported below */
    }
  }
  if (!pr) {
    failures.push(
      `pr: gh pr view ${n} failed: ${firstLine(view.stderr || view.stdout) || 'no output'}`
    );
    return finish();
  }
  const head = String(pr.headRefOid ?? '').toLowerCase();
  if (pr.state !== 'OPEN') failures.push(`pr: #${n} is ${pr.state}, not OPEN`);
  if (pr.isDraft) failures.push(`pr: #${n} is a draft; mark it ready for review`);
  if (pr.baseRefName !== 'main') failures.push(`pr: base is ${pr.baseRefName}, not main`);
  if (pr.mergeable !== 'MERGEABLE') {
    failures.push(
      `pr: mergeable is ${pr.mergeable}; merge main into the branch and resolve conflicts`
    );
  }

  // b. CI: every check green, and every check the branch ruleset requires present.
  const rules = run('gh', ['api', `repos/${REPO}/rules/branches/main`]);
  const required = rules.status === 0 ? requiredContexts(rules.stdout) : null;
  if (required === null) {
    failures.push(
      rules.status === 0
        ? 'ci: the branch ruleset lists no required status checks (or gh api answered something else); refusing'
        : `ci: cannot read the required checks from the branch ruleset (gh api failed: ${firstLine(rules.stderr || rules.stdout)}); refusing`
    );
  }
  const rollup = pr.statusCheckRollup ?? [];
  if (rollup.length === 0) failures.push('ci: no checks reported for this PR yet');
  else {
    const { failing, pending, missing } = rollupProblems(rollup, required ?? []);
    const parts = [];
    if (failing.length > 0) parts.push(`failing: ${failing.join(', ')}`);
    if (pending.length > 0) parts.push(`pending: ${pending.join(', ')}`);
    if (missing.length > 0) parts.push(`required but not reported: ${missing.join(', ')}`);
    if (parts.length > 0) failures.push(`ci: ${parts.join('; ')}`);
  }

  // The changed files come from the local checkout (gh stops at 100 files and drops renamed-from
  // paths); gh's list is a cross-check, and the union is judged.
  // Only when this checkout is the PR head: any other checkout would list another branch's files
  // (the local check below refuses it anyway), so then gh's list is all there is.
  const local = run('git', ['rev-parse', 'HEAD']);
  const localHead = local.stdout.trim().toLowerCase();
  const atHead = local.status === 0 && localHead === head;
  const fetchError = atHead ? fetchMain() : null;
  /** @type {{ path: string, changeType?: string }[]} */
  let localFiles = [];
  /** @type {string | null} */
  let filesError = fetchError ? `git fetch ${REMOTE} main failed: ${fetchError}` : null;
  if (atHead && !filesError) {
    const base = run('git', ['merge-base', MAIN, 'HEAD']);
    const diff =
      base.status === 0
        ? run('git', [
            'diff',
            '-z',
            '--no-color',
            '--name-status',
            '--no-renames',
            base.stdout.trim(),
            'HEAD',
          ])
        : base;
    if (base.status !== 0 || diff.status !== 0) {
      filesError = `git merge-base/diff against ${MAIN} failed: ${firstLine(diff.stderr || diff.stdout)}`;
    } else localFiles = parseNameStatus(diff.stdout);
  }
  const ghFiles = (pr.files ?? []).map((/** @type {any} */ f) => ({ ...f, path: String(f.path) }));
  const files = [
    ...localFiles,
    ...ghFiles.filter(
      (/** @type {{ path: string }} */ g) => !localFiles.some(l => l.path === g.path)
    ),
  ];
  const paths = files.map(f => f.path);

  // c. Review notes for the head commit.
  const hits = riskyHits(paths);
  for (const h of hits) notes.push(`risky (${h.name}): ${h.file}; an Opus review is required`);
  /** @type {ReviewNote[] | null} */
  let reviews = null;
  try {
    reviews = findReviewNotes(vault, n);
  } catch (e) {
    failures.push(`review: cannot read the vault ${vault}: ${message(e)}`);
  }
  if (reviews === null) {
    if (!failures.some(f => f.startsWith('review:'))) {
      failures.push(`review: vault not found at ${vault} (pass --vault DIR)`);
    }
  } else {
    const verdict = judgeReviews(reviews, head, hits.length > 0);
    if (!verdict.ok) failures.push(`review: ${verdict.detail}`);
  }

  // d. Changelog fragment.
  if (args.noChangelog === null && !hasChangelogFragment(files)) {
    failures.push(
      'changelog: no added or changed changelog.d/*.md fragment (or pass --no-changelog "reason")'
    );
  }

  // e. This checkout is the PR head and clean.
  const status = run('git', ['status', '--porcelain']);
  let localOk = true;
  if (local.status !== 0 || localHead !== head) {
    localOk = false;
    failures.push(
      `local: this checkout is at ${localHead ? short(localHead) : 'unknown'}, the PR head is ${short(head)}; check out ${pr.headRefName} and pull it`
    );
  }
  if (status.status !== 0 || status.stdout.trim() !== '') {
    localOk = false;
    const count = status.stdout.split(/\r?\n/).filter(Boolean).length;
    failures.push(
      `local: the working tree is not clean (${count} change${count === 1 ? '' : 's'}); commit or stash first`
    );
  }
  if (filesError) failures.push(`files: cannot list what the PR changes locally: ${filesError}`);

  // f. Merge train (read now for the early refusal; read again under the lock before the merge).
  const trainRelevant = isTrainRelevant(paths);
  /** @type {TrainState} */
  let train = { lastRoundtrip: null, since: [] };
  try {
    train = readTrain(statePath);
  } catch (e) {
    failures.push(`train: ${message(e)}`);
  }
  const trainFull = () =>
    `train: merge train full (${train.since.length}/${TRAIN_SIZE}): the planner runs npm run live:roundtrip on main, then npm run lane:merge -- --train-reset <sha>`;
  if (trainRelevant && train.since.length >= TRAIN_SIZE) failures.push(trainFull());

  // e (continued). drift-check, the slow one: only when everything above passed.
  if (failures.length === 0 && localOk) {
    const drift = runDrift(run, tmpdir, notes);
    const logFile = path.join(tmpdir, `lane-merge-${n}-drift-${now().getTime()}.log`);
    const output = `${drift.stdout}${drift.stderr}`;
    try {
      fs.writeFileSync(logFile, output);
    } catch {
      /* the tail below still shows the output */
    }
    if (drift.status !== 0) {
      failures.push(`drift: drift-check failed (log ${logFile}); last lines below`);
      details.push(...output.replace(/\s+$/, '').split(/\r?\n/).slice(-TAIL_LINES));
    }
  } else if (failures.length > 0) {
    notes.push('drift-check not run: it is slow, so it runs once the other checks pass');
  }

  if (failures.length > 0) return finish();
  for (const line of notes) log(`lane:merge: ${line}`);

  // g. Merge.
  const sha7 = short(head);
  const extras = args.noChangelog === null ? '' : `; no changelog: ${args.noChangelog}`;
  if (args.dryRun) {
    log(
      `lane:merge: OK #${n} at ${sha7} (dry run, nothing merged); merge train ${train.since.length}/${TRAIN_SIZE}${extras}`
    );
    return 0;
  }
  // A module PR takes the train lock around read, merge and write, so two lanes cannot both pass
  // at 3/4.
  /** @type {(() => void) | null} */
  let release = null;
  let warning = '';
  try {
    if (trainRelevant) {
      try {
        release = acquireLock(statePath, { timeoutMs: lockTimeoutMs });
        train = readTrain(statePath);
      } catch (e) {
        failures.push(`train: ${message(e)}`);
        return finish();
      }
      if (train.since.length >= TRAIN_SIZE) {
        failures.push(trainFull());
        return finish();
      }
    }
    const merge = run('gh', ['pr', 'merge', String(n), '--merge', '--match-head-commit', head]);
    if (merge.status !== 0) {
      failures.push(
        `merge: gh pr merge exited ${merge.status}: ${firstLine(merge.stderr || merge.stdout)}`
      );
      return finish();
    }
    if (trainRelevant) {
      train.since.push({ pr: n, sha: head, at: now().toISOString() });
      try {
        writeTrain(statePath, train);
      } catch (e) {
        warning = `; WARNING: merge train not recorded (${message(e)})`;
      }
    }
  } finally {
    release?.();
  }
  const k = train.since.length;
  const advice =
    trainRelevant && k === TRAIN_SIZE - 1
      ? '; run live:roundtrip before the next module merge'
      : '';
  log(
    `lane:merge: merged #${n} at ${sha7}; merge train ${k}/${TRAIN_SIZE}${advice}${extras}${warning}`
  );
  return 0;
}

const self = fileURLToPath(import.meta.url);
const decision = entryDecision(process.argv[1], self);
if (decision === 'run') {
  const gate = relaunchFromMain({
    argv: process.argv.slice(2),
    run: defaultRun,
    selfPath: self,
    env: process.env,
    tmpdir: os.tmpdir(),
    log: console.log,
  });
  if (gate.error) {
    console.log(`lane:merge: NOT merged: ${gate.error}`);
    process.exit(1);
  }
  process.exit(gate.relaunched ? gate.code : main({ fetched: gate.fetched }));
} else if (decision === 'mismatch') {
  console.error(
    `lane:merge: started as ${process.argv[1]} but this module is ${self}; not running`
  );
  process.exit(1);
}
