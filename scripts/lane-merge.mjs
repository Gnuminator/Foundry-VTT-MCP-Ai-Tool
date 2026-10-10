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
 *
 * The checks, in order: (a) the PR is open, not a draft, based on main and mergeable; (b) every CI
 * check passed; (c) a review note for the head commit says Merge, from an Opus review when the PR
 * touches a risky area (RISKY_CATEGORIES, D-101); (d) a changelog.d fragment; (e) this checkout is
 * the PR head, clean, and `npm run drift:check` passes; (f) the merge train (D-121) has room.
 * The merge is `gh pr merge --merge --match-head-commit <head>`. All gh, git and npm calls go
 * through one injectable `run(cmd, args)`.
 */
import { spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';

/** Merges allowed on the module, the bridge link or guarded writes between two live round trips. */
export const TRAIN_SIZE = 4;

/** Lines of a failed log that are printed. */
const TAIL_LINES = 30;

/**
 * Areas where a Sonnet review is not enough (D-101): the counting review note must be an Opus
 * review. Patterns are repo-relative, `/` separated: `**` crosses folders, `*` does not.
 * @type {{ name: string, patterns: string[] }[]}
 */
export const RISKY_CATEGORIES = [
  {
    // Guarded writes: plan, apply and undo, in the module, the server and the shared contract.
    name: 'guarded writes',
    patterns: [
      'packages/foundry-module/src/data-access/guarded-write*',
      'packages/foundry-module/src/live-plan*',
      'packages/foundry-module/src/transaction-manager*',
      'packages/foundry-module/src/guarded-features*',
      'packages/foundry-module/src/change-journal*',
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
    // Security: dashboard auth and redaction, secret terms, the player vault writer, guard hooks, CI.
    name: 'security',
    patterns: [
      'packages/cogm-dashboard/src/auth*',
      'packages/cogm-dashboard/src/redact*',
      'packages/cogm-dashboard/src/player-vault/writer*',
      'packages/mcp-server/src/secret-terms*',
      '.claude/hooks/guard-*',
      '.github/workflows/**',
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
    // The merge gate and the keep-green script themselves.
    name: 'the merge gate',
    patterns: ['scripts/lane-merge.mjs', 'scripts/green.mjs'],
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

/** Is one hex sha a prefix of the other (both at least 7 characters)? @param {string} a @param {string} b */
export function shaMatches(a, b) {
  const x = a.toLowerCase();
  const y = b.toLowerCase();
  return x.length >= 7 && y.length >= 7 && (x.startsWith(y) || y.startsWith(x));
}

/**
 * What a review note says.
 * `head`: the sha after `Head reviewed:` (backticked or bare, 7 to 40 hex characters, prose may
 * follow). `verdict`: the first bold text under `## Verdict`. `opus`: the file name or the first
 * `# ` heading contains "opus".
 * @param {string} name @param {string} text
 * @returns {{ name: string, head: string | null, verdict: string | null, merge: boolean, opus: boolean }}
 */
export function parseReviewNote(name, text) {
  const lines = text.split(/\r?\n/);
  let head = null;
  for (const line of lines) {
    const m = /Head reviewed:\s*`?([0-9a-f]{7,40})(?![0-9a-z])/i.exec(line);
    if (m) {
      head = m[1];
      break;
    }
  }
  let verdict = null;
  const at = lines.findIndex(l => /^##\s+Verdict\b/i.test(l));
  if (at >= 0) {
    const section = [];
    for (const l of lines.slice(at + 1)) {
      if (/^#{1,2}\s/.test(l)) break;
      section.push(l);
    }
    const bold = /\*\*(.+?)\*\*/.exec(section.join('\n'));
    verdict = bold ? bold[1].trim() : null;
  }
  const heading = lines.find(l => /^#\s+/.test(l)) ?? '';
  return {
    name,
    head,
    verdict,
    merge: verdict !== null && verdict.replace(/[.\s]+$/, '').toLowerCase() === 'merge',
    opus: /opus/i.test(name) || /opus/i.test(heading),
  };
}

/** Review notes of one PR: the "Reviews ..." folders under Handoff, files named <N>-*review*.md. @param {string} vault @param {number} prNumber */
export function findReviewNotes(vault, prNumber) {
  const handoff = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff');
  if (!fs.existsSync(vault)) return null;
  if (!fs.existsSync(handoff)) return [];
  const prefix = `${prNumber}-`;
  /** @type {ReturnType<typeof parseReviewNote>[]} */
  const notes = [];
  for (const dir of fs.readdirSync(handoff, { withFileTypes: true })) {
    if (!dir.isDirectory() || !dir.name.startsWith('Reviews ')) continue;
    const folder = path.join(handoff, dir.name);
    for (const file of fs.readdirSync(folder)) {
      if (!file.endsWith('.md') || !file.startsWith(prefix) || !/review/i.test(file)) continue;
      notes.push(parseReviewNote(file, fs.readFileSync(path.join(folder, file), 'utf8')));
    }
  }
  return notes;
}

/**
 * Does a review note for this head commit say Merge (from an Opus review when `needOpus`)?
 * @param {ReturnType<typeof parseReviewNote>[]} notes @param {string} headSha @param {boolean} needOpus
 * @returns {{ ok: boolean, note?: ReturnType<typeof parseReviewNote>, detail: string }}
 */
export function judgeReviews(notes, headSha, needOpus) {
  const forHead = notes.filter(n => n.head && shaMatches(n.head, headSha));
  const merging = forHead.filter(n => n.merge);
  const counting = needOpus ? merging.filter(n => n.opus) : merging;
  if (counting.length > 0) return { ok: true, note: counting[0], detail: counting[0].name };
  const short = headSha.slice(0, 7);
  if (merging.length > 0) {
    return {
      ok: false,
      detail: `only a Sonnet review (${merging.map(n => n.name).join(', ')}) says Merge for ${short}, and this PR needs an Opus review`,
    };
  }
  if (forHead.length > 0) {
    const said = forHead.map(n => `${n.name}: ${n.verdict ?? 'no verdict'}`).join('; ');
    return { ok: false, detail: `no review says Merge for head ${short} (${said})` };
  }
  const seen = notes.map(n => `${n.name} reviewed ${n.head ? n.head.slice(0, 7) : 'no head'}`);
  return {
    ok: false,
    detail: `no review note for head ${short}${seen.length ? ` (found ${seen.join(', ')})` : ''}`,
  };
}

/**
 * What is wrong with the CI checks of a PR. Handles both shapes of `statusCheckRollup`: a check run
 * `{ name, status, conclusion }` and a commit status `{ context, state }`.
 * @param {any[]} rollup
 * @returns {{ failing: string[], pending: string[] }}
 */
export function rollupProblems(rollup) {
  const failing = [];
  const pending = [];
  for (const c of rollup) {
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
  return { failing, pending };
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

/** @typedef {{ lastRoundtrip: { sha: string, at: string } | null, since: { pr: number, sha: string, at: string }[] }} TrainState */

/** The merge train state; an empty train when the file does not exist yet. @param {string} file @returns {TrainState} */
export function readTrain(file) {
  if (!fs.existsSync(file)) return { lastRoundtrip: null, since: [] };
  const data = JSON.parse(fs.readFileSync(file, 'utf8'));
  return {
    lastRoundtrip: data.lastRoundtrip ?? null,
    since: Array.isArray(data.since) ? data.since : [],
  };
}

/** @param {string} file @param {TrainState} state */
export function writeTrain(file, state) {
  fs.mkdirSync(path.dirname(file), { recursive: true });
  fs.writeFileSync(file, `${JSON.stringify(state, null, 2)}\n`);
}

/**
 * The real `run`: gh, git and npm. `npm` is a .cmd file on Windows, so it goes through the shell.
 * @param {string} cmd @param {string[]} args
 * @returns {{ status: number, stdout: string, stderr: string }}
 */
export function defaultRun(cmd, args) {
  const r = spawnSync(cmd, args, {
    encoding: 'utf8',
    shell: cmd === 'npm' && process.platform === 'win32',
    maxBuffer: 256 * 1024 * 1024,
  });
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

/**
 * Runs the gate.
 * @param {{
 *   argv?: string[], run?: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string },
 *   log?: (line: string) => void, env?: Record<string, string | undefined>, home?: string,
 *   tmpdir?: string, now?: () => Date,
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
  } = options;
  const args = parseArgs(argv);
  if (args.error) {
    log(`lane:merge: ${args.error}`);
    return 2;
  }
  const statePath = args.state ?? path.join(home, '.foundry-ai-tool', 'merge-train.json');
  const short = (/** @type {string} */ sha) => sha.slice(0, 7);

  if (args.train || args.trainReset !== null) {
    let state;
    try {
      state = readTrain(statePath);
      if (args.trainReset !== null) {
        if (!/^[0-9a-f]{7,40}$/i.test(args.trainReset)) {
          log(`lane:merge: --train-reset needs a commit sha (7 to 40 hex characters)`);
          return 2;
        }
        state = { lastRoundtrip: { sha: args.trainReset, at: now().toISOString() }, since: [] };
        writeTrain(statePath, state);
        log(
          `lane:merge: merge train reset at ${short(args.trainReset)}; merge train 0/${TRAIN_SIZE}`
        );
        return 0;
      }
    } catch (e) {
      log(
        `lane:merge: merge train state ${statePath} is unreadable: ${e instanceof Error ? e.message : e}`
      );
      return 1;
    }
    const last = state.lastRoundtrip
      ? `last live:roundtrip at ${short(state.lastRoundtrip.sha)} (${state.lastRoundtrip.at})`
      : 'no live:roundtrip recorded';
    const since = state.since.map(s => `#${s.pr}@${short(s.sha)}`).join(', ') || 'none';
    log(
      `lane:merge: merge train ${state.since.length}/${TRAIN_SIZE}; ${last}; merged since: ${since}`
    );
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
  const head = String(pr.headRefOid ?? '');
  if (pr.state !== 'OPEN') failures.push(`pr: #${n} is ${pr.state}, not OPEN`);
  if (pr.isDraft) failures.push(`pr: #${n} is a draft; mark it ready for review`);
  if (pr.baseRefName !== 'main') failures.push(`pr: base is ${pr.baseRefName}, not main`);
  if (pr.mergeable !== 'MERGEABLE') {
    failures.push(
      `pr: mergeable is ${pr.mergeable}; merge main into the branch and resolve conflicts`
    );
  }
  const files = (pr.files ?? []).map((/** @type {any} */ f) => ({ ...f, path: String(f.path) }));
  const paths = files.map((/** @type {{ path: string }} */ f) => f.path);

  // b. CI.
  const rollup = pr.statusCheckRollup ?? [];
  if (rollup.length === 0) failures.push('ci: no checks reported for this PR yet');
  else {
    const { failing, pending } = rollupProblems(rollup);
    if (failing.length > 0 || pending.length > 0) {
      const parts = [];
      if (failing.length > 0) parts.push(`failing: ${failing.join(', ')}`);
      if (pending.length > 0) parts.push(`pending: ${pending.join(', ')}`);
      failures.push(`ci: ${parts.join('; ')}`);
    }
  }

  // c. Review note for the head commit.
  const hits = riskyHits(paths);
  for (const h of hits) notes.push(`risky (${h.name}): ${h.file}; an Opus review is required`);
  /** @type {ReturnType<typeof parseReviewNote>[] | null} */
  let reviews = null;
  try {
    reviews = findReviewNotes(vault, n);
  } catch (e) {
    failures.push(`review: cannot read the vault ${vault}: ${e instanceof Error ? e.message : e}`);
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
  const local = run('git', ['rev-parse', 'HEAD']);
  const status = run('git', ['status', '--porcelain']);
  const localHead = local.stdout.trim();
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

  // f. Merge train.
  const trainRelevant = isTrainRelevant(paths);
  /** @type {TrainState} */
  let train = { lastRoundtrip: null, since: [] };
  try {
    train = readTrain(statePath);
  } catch (e) {
    failures.push(`train: ${statePath} is unreadable: ${e instanceof Error ? e.message : e}`);
  }
  if (trainRelevant && train.since.length >= TRAIN_SIZE) {
    failures.push(
      `train: merge train full (${train.since.length}/${TRAIN_SIZE}): the planner runs npm run live:roundtrip on main, then npm run lane:merge -- --train-reset <sha>`
    );
  }

  // e (continued). drift:check, the slow one: only when everything above passed.
  if (failures.length === 0 && localOk) {
    const drift = run('npm', ['run', 'drift:check']);
    const logFile = path.join(tmpdir, `lane-merge-${n}-drift-${now().getTime()}.log`);
    const output = `${drift.stdout}${drift.stderr}`;
    try {
      fs.writeFileSync(logFile, output);
    } catch {
      /* the tail below still shows the output */
    }
    if (drift.status !== 0) {
      failures.push(`drift: npm run drift:check failed (log ${logFile}); last lines below`);
      details.push(...output.replace(/\s+$/, '').split(/\r?\n/).slice(-TAIL_LINES));
    }
  } else if (failures.length > 0) {
    notes.push('drift:check not run: it is slow, so it runs once the other checks pass');
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
  const merge = run('gh', ['pr', 'merge', String(n), '--merge', '--match-head-commit', head]);
  if (merge.status !== 0) {
    failures.push(
      `merge: gh pr merge exited ${merge.status}: ${firstLine(merge.stderr || merge.stdout)}`
    );
    return finish();
  }
  let warning = '';
  if (trainRelevant) {
    train.since.push({ pr: n, sha: head, at: now().toISOString() });
    try {
      writeTrain(statePath, train);
    } catch (e) {
      warning = `; WARNING: merge train not recorded (${e instanceof Error ? e.message : e})`;
    }
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

if (process.argv[1] && path.resolve(process.argv[1]) === fileURLToPath(import.meta.url)) {
  process.exit(main());
}
