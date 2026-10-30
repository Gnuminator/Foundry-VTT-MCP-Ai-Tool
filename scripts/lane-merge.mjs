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
 *   npm run lane:merge -- <PR> --wait-ci               first wait (up to 30 minutes) until every CI check
 *                                                      on the head commit has finished, then the gate
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
 * --wait-ci (waitForCi) polls the PR in this one process, so nobody has to come back once CI is done.
 * It ends the run at once when a check fails (exit 3, the check named), when the head commit
 * changes (exit 4, "head moved"), or after WAIT_TIMEOUT_MS (exit 5). When every check has finished
 * green it runs the gate above, unchanged, which merges or refuses with the reason (exit 0 or 1).
 *
 * The merge train is per PC: its state file lives in ~/.foundry-ai-tool, so lanes on another PC
 * count their own merges. A lock file next to it serialises the read-check-merge-write.
 *
 * Every merge, --train-reset and refusal (not --dry-run) also writes the train state to the vault
 * note `Dev/Foundry AI Tool/Merge train.md` for the PM board: pull, commit only that file, push.
 * A vault problem is a WARNING line; it never fails or undoes a merge.
 */
import { spawnSync } from 'node:child_process';
import { randomBytes } from 'node:crypto';
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

/** --wait-ci: how long to wait for CI, and how often to ask GitHub. */
export const WAIT_TIMEOUT_MS = 30 * 60 * 1000;
export const WAIT_POLL_MS = 30 * 1000;
/** --wait-ci: GitHub answering with an error this many polls in a row ends the wait. */
const WAIT_MAX_ERRORS = 3;
/** A single gh call (spawnSync timeout). */
const GH_TIMEOUT_MS = 120_000;
/** One git call on the vault (pull, commit, push) for the merge train note. */
const VAULT_GIT_TIMEOUT_MS = 60_000;
/** Exit codes of the wait (the gate itself: 0 merged or OK, 1 refused, 2 usage). */
export const EXIT_CI_FAILED = 3;
export const EXIT_HEAD_MOVED = 4;
export const EXIT_WAIT_TIMEOUT = 5;

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
      // The heavy-check lock wraps green, lint-ratchet and drift-check's guards.
      'scripts/heavy-lock.mjs',
      'scripts/pre-push.mjs',
      'scripts/lint-ratchet.mjs',
      '.github/workflows/**',
      '.claude/hooks/**',
      '.claude/settings.json',
      // The review runner writes the notes the gate counts (D-127), and the agent files go into its prompt.
      'scripts/review-runner/**',
      '.claude/agents/**',
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
 * @typedef {{ name: string, entries: VerdictEntry[], shortHeads: string[], opus: boolean, malformed: string[] }} ReviewNote
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
 * The order is part of the format: each `## Verdict` needs a `Head reviewed:` line between it and the
 * previous verdict (or the top of the note), and no `Head reviewed:` line may follow the last
 * verdict. Otherwise a verdict would tie to an older round's sha, so the note is `malformed` (and
 * the entry ties to nothing). More rules: a `Head reviewed:` line counts only at the start of a
 * line (an optional bullet and bold markers allowed), never inside prose; `Head reviewed:` on
 * the `## Verdict` line itself is malformed; a section with no verdict text is an entry that is not
 * a Merge; and two distinct full shas on `Head reviewed:` lines before one verdict are malformed.
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
  /** @type {string[]} */
  const malformed = [];
  /** Line number (1-based) of the first Head reviewed line since the last verdict, else 0. */
  let headSince = 0;
  /** The full shas named since the last verdict. @type {Set<string>} */
  let headsSince = new Set();
  for (let i = 0; i < lines.length; i++) {
    const line = lines[i];
    const v = /^##\s+Verdict\b(.*)$/i.exec(line);
    // A Head reviewed line starts the line (a bullet or bold marker may come first); a mention in
    // prose does not move the tie.
    const h = /^\s*(?:[-*]\s+)?(?:\*\*)?Head reviewed:(?:\*\*)?\s*`?([0-9a-f]+)(?![0-9a-z])/i.exec(
      line
    );
    if (h && !v) {
      headSince ||= i + 1;
      if (h[1].length === 40) {
        head = h[1].toLowerCase();
        headsSince.add(head);
      } else {
        head = null;
        shortHeads.push(h[1].toLowerCase());
      }
      continue;
    }
    if (!v) continue;
    if (/Head reviewed:/i.test(line)) {
      malformed.push(
        `the ## Verdict on line ${i + 1} also carries "Head reviewed:"; put it on its own line above`
      );
    }
    if (headsSince.size > 1) {
      malformed.push(
        `more than one full sha is named by "Head reviewed:" above the ## Verdict on line ${i + 1}`
      );
    }
    headsSince = new Set();
    if (headSince === 0) {
      malformed.push(
        `the ## Verdict on line ${i + 1} has no "Head reviewed:" line above it since the previous verdict`
      );
      head = null;
    }
    headSince = 0;
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
  if (headSince > 0) {
    malformed.push(
      entries.length > 0
        ? `the "Head reviewed:" on line ${headSince} comes after the last ## Verdict`
        : `the "Head reviewed:" on line ${headSince} has no ## Verdict (a ### heading does not count)`
    );
  }
  if (headsSince.size > 1) {
    malformed.push('more than one full sha is named by "Head reviewed:" after the last verdict');
  }
  const heading = lines.find(l => /^#\s+/.test(l)) ?? '';
  return {
    name,
    entries,
    shortHeads,
    malformed,
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
  const bad = notes.filter(n => n.malformed.length > 0);
  if (bad.length > 0) {
    const said = bad.map(n => `${n.name} is malformed: ${n.malformed.join('; ')}`);
    return {
      ok: false,
      detail: `${said.join('; ')} (put "Head reviewed:" before each "## Verdict", nothing after the last)`,
    };
  }
  // A verdict under a short sha ties to nothing, so it could hide a Do not merge for this head.
  const shortHit = notes.flatMap(n =>
    n.shortHeads
      .filter(s => head.startsWith(s))
      .map(s => `${n.name} reviewed ${s} (Head reviewed needs the full 40-character sha)`)
  );
  if (shortHit.length > 0) {
    return {
      ok: false,
      detail: `${shortHit.join('; ')}; it could hide a verdict for head ${short}`,
    };
  }
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

/**
 * --wait-ci: poll the PR until every CI check on its head commit has finished, in this one process.
 * A check the branch ruleset requires that is not reported yet counts as pending (CI may not have
 * started). Ends at once on a failing check (names it), when the head commit differs from the first
 * one seen ("head moved"), when the PR is no longer open, after `timeoutMs`, or after
 * WAIT_MAX_ERRORS gh failures in a row. The gate's own CI check still runs afterwards; this only
 * waits. `log` gets one line when the set of pending checks changes.
 * @param {{ pr: number, run: Run, log: (line: string) => void, sleep: (ms: number) => void,
 *   clock: () => number, pollMs: number, timeoutMs: number }} o
 * @returns {{ ok: true, head: string } | { ok: false, code: number, reason: string }}
 */
export function waitForCi(o) {
  const { pr: n, run, log, sleep, clock, pollMs, timeoutMs } = o;
  const rules = run('gh', ['api', `repos/${REPO}/rules/branches/main`]);
  const required = (rules.status === 0 ? requiredContexts(rules.stdout) : null) ?? [];
  const started = clock();
  /** @type {string | null} */
  let firstHead = null;
  let errors = 0;
  let lastReport = '';
  let waitingFor = 'the first poll';
  /** @param {number} code @param {string} reason */
  const stop = (code, reason) => ({ ok: /** @type {const} */ (false), code, reason });
  for (;;) {
    const view = run('gh', [
      'pr',
      'view',
      String(n),
      '--json',
      'state,headRefOid,mergeable,statusCheckRollup',
    ]);
    /** @type {any} */
    let pr = null;
    if (view.status === 0) {
      try {
        pr = JSON.parse(view.stdout);
      } catch {
        /* counted as an error below */
      }
    }
    if (!pr) {
      errors += 1;
      if (errors >= WAIT_MAX_ERRORS) {
        return stop(
          1,
          `wait-ci: gh pr view ${n} failed ${errors} times in a row: ${firstLine(view.stderr || view.stdout) || 'no output'}`
        );
      }
    } else {
      errors = 0;
      const head = String(pr.headRefOid ?? '').toLowerCase();
      firstHead ??= head;
      if (head !== firstHead) {
        return stop(
          EXIT_HEAD_MOVED,
          `wait-ci: head moved from ${firstHead.slice(0, 7)} to ${head.slice(0, 7)} while waiting; the checks and the review no longer match, start again`
        );
      }
      if (pr.state !== 'OPEN') return stop(1, `wait-ci: #${n} is ${pr.state}, not OPEN`);
      if (pr.mergeable === 'CONFLICTING') {
        return stop(
          1,
          `wait-ci: #${n} has merge conflicts, so CI will not run; merge main into the branch and resolve them`
        );
      }
      const rollup = pr.statusCheckRollup ?? [];
      const { failing, pending, missing } = rollupProblems(rollup, required);
      if (failing.length > 0) {
        return stop(
          EXIT_CI_FAILED,
          `wait-ci: CI failed on ${head.slice(0, 7)}: ${failing.join(', ')}`
        );
      }
      const open = [...pending, ...missing.map(m => `${m} (not reported yet)`)];
      if (rollup.length === 0) open.push('no checks reported yet');
      if (open.length === 0) return { ok: true, head };
      waitingFor = open.join(', ');
      if (waitingFor !== lastReport) {
        lastReport = waitingFor;
        log(`lane:merge: waiting for CI on #${n} at ${head.slice(0, 7)}: ${waitingFor}`);
      }
    }
    if (clock() - started >= timeoutMs) {
      return stop(
        EXIT_WAIT_TIMEOUT,
        `wait-ci: timed out after ${Math.round(timeoutMs / 60000)} minutes; still waiting for ${waitingFor}`
      );
    }
    sleep(pollMs);
  }
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

/** Vault note the PM board reads for the merge train (board README, "Merge train.md"). */
export const TRAIN_NOTE_PATH = 'Dev/Foundry AI Tool/Merge train.md';

/** @typedef {{ kind: 'merge' | 'reset' | 'refusal', pr?: number, at: string }} TrainEvent */

/**
 * The vault note text: `key: value` lines in a frontmatter, numbers, a commit hash, a result word
 * and ISO dates only (the board never copies free text, and no secrets belong here). A reset only
 * ever follows a green live:roundtrip, so the recorded result is always green.
 * @param {TrainState} state @param {TrainEvent} event @param {string} updated
 */
export function renderTrainNote(state, event, updated) {
  const lines = ['type: merge-train', `updated: ${updated}`, `count: ${state.since.length}`];
  lines.push(`limit: ${TRAIN_SIZE}`);
  if (state.lastRoundtrip) {
    lines.push(`last-roundtrip-sha: ${state.lastRoundtrip.sha}`);
    lines.push(`last-roundtrip: ${state.lastRoundtrip.at}`);
    lines.push('last-roundtrip-result: green');
  }
  lines.push(`last-event: ${event.kind}`);
  if (event.pr !== undefined) lines.push(`last-event-pr: ${event.pr}`);
  lines.push(`last-event-at: ${event.at}`);
  return `---\n${lines.join('\n')}\n---\n\nWritten by scripts/lane-merge.mjs on every merge, --train-reset and refusal. Do not edit by hand.\n`;
}

/**
 * Write the merge train note into the vault and push it (vault rules: pull first, commit only that
 * file, push). Never throws and never undoes anything: every problem comes back as a warning text
 * (empty when all went well). A vault that is not a git checkout writes nothing.
 * @param {{ vault: string, state: TrainState, event: TrainEvent, run: (cmd: string, args: string[]) => { status: number, stdout: string, stderr: string }, now: () => Date }} o
 * @returns {string}
 */
export function publishTrainNote({ vault, state, event, run, now }) {
  const file = path.join(vault, ...TRAIN_NOTE_PATH.split('/'));
  const git = (/** @type {string[]} */ ...a) => run('git', ['-C', vault, ...a]);
  const why = (/** @type {{ stderr: string, stdout: string }} */ r) =>
    firstLine(r.stderr || r.stdout) || 'failed';
  try {
    // no vault checkout on this PC (or --vault points elsewhere): nothing to publish, not a problem
    if (!fs.existsSync(path.join(vault, '.git'))) return '';
    // Pull without touching anyone else's work: no rebase and no autostash, so nothing is ever left
    // half done in the shared vault. Fetch plus a fast-forward works with a dirty tree.
    const sync = () => {
      git('restore', '--staged', '--worktree', '--', TRAIN_NOTE_PATH); // an earlier failed try; fine to fail
      const fetched = git('fetch');
      if (fetched.status !== 0) return `vault fetch failed (${why(fetched)})`;
      const merged = git('merge', '--ff-only', '@{u}');
      return merged.status === 0 ? '' : `vault pull failed (${why(merged)})`;
    };
    const label = event.kind === 'reset' ? 'reset' : `${event.kind} #${event.pr}`;
    const subject = `Merge train: ${label}, ${state.since.length}/${TRAIN_SIZE}`;
    let pushError = '';
    for (let attempt = 0; attempt < 2; attempt++) {
      const synced = sync();
      if (synced) return `merge train note not written: ${synced}`;
      fs.mkdirSync(path.dirname(file), { recursive: true });
      fs.writeFileSync(file, renderTrainNote(state, event, now().toISOString()));
      const added = git('add', '--', TRAIN_NOTE_PATH);
      if (added.status !== 0) return `merge train note not committed (${why(added)})`;
      const committed = git('commit', '-m', subject, '--', TRAIN_NOTE_PATH);
      if (committed.status !== 0) return `merge train note not committed (${why(committed)})`;
      const pushed = git('push');
      if (pushed.status === 0) return '';
      pushError = why(pushed);
      // Take our own commit back, so the vault is left as it was and the next try starts clean.
      git('reset', '--soft', 'HEAD~1');
      git('restore', '--staged', '--', TRAIN_NOTE_PATH);
    }
    return `merge train note not pushed (${pushError})`;
  } catch (e) {
    return `merge train note not written (${e instanceof Error ? e.message : String(e)})`;
  }
}

/** Wait without spinning. @param {number} ms */
function sleep(ms) {
  Atomics.wait(new Int32Array(new SharedArrayBuffer(4)), 0, 0, ms);
}

/**
 * An exclusive lock next to the train file (`<file>.lock`, created with `wx`). A lock older than
 * `staleMs` (default 10 minutes) belongs to a killed run and is taken over by a rename to a unique
 * name (one rename wins), then `wx` again. Waits up to `timeoutMs`. `afterStaleSeen` is a test hook
 * that runs between seeing a stale lock and taking it over; `afterTaken` runs between the rename
 * and the link back. The lock file holds a random token and the release removes only a lock with
 * its own token.
 * @param {string} file
 * @param {{ staleMs?: number, timeoutMs?: number, now?: () => number, wait?: (ms: number) => void,
 *   afterStaleSeen?: () => void, afterTaken?: () => void }} [opts]
 * @returns {() => void} release
 */
export function acquireLock(file, opts = {}) {
  const { staleMs = 10 * 60 * 1000, timeoutMs = 20_000, now = Date.now, wait = sleep } = opts;
  const lock = `${file}.lock`;
  fs.mkdirSync(path.dirname(file), { recursive: true });
  const started = now();
  let lastError = '';
  for (;;) {
    try {
      const fd = fs.openSync(lock, 'wx');
      const token = randomBytes(8).toString('hex');
      fs.writeSync(
        fd,
        JSON.stringify({ pid: process.pid, token, at: new Date(now()).toISOString() })
      );
      fs.closeSync(fd);
      // Release removes only the lock this run wrote: if the lock was displaced and another run
      // holds the path now, its token differs and it stays.
      return () => {
        try {
          if (JSON.parse(fs.readFileSync(lock, 'utf8')).token === token) fs.unlinkSync(lock);
        } catch {
          /* already gone, or not ours */
        }
      };
    } catch (e) {
      if (/** @type {NodeJS.ErrnoException} */ (e).code !== 'EEXIST') throw e;
    }
    try {
      if (now() - fs.statSync(lock).mtimeMs > staleMs) {
        opts.afterStaleSeen?.();
        // Take over by renaming the stale lock to a name only this run uses: of several runs that
        // saw the same stale lock, one rename wins and the others get ENOENT and retry. (A plain
        // unlink let the second run delete the first run's fresh lock, and both went in.)
        const taken = `${lock}.stale-${process.pid}-${randomBytes(4).toString('hex')}`;
        fs.renameSync(lock, taken);
        if (now() - fs.statSync(taken).mtimeMs > staleMs) {
          fs.unlinkSync(taken);
          continue;
        }
        // The lock was replaced by a live one between our stat and rename: we moved someone's fresh
        // lock. Put it back (link fails if another run already took the free slot) and wait.
        opts.afterTaken?.();
        const raceWarning = () =>
          process.stderr.write(
            'lane:merge: lock race: a run may be in the merge train without the lock; check merge-train.json\n'
          );
        try {
          fs.linkSync(taken, lock);
        } catch (e) {
          if (/** @type {NodeJS.ErrnoException} */ (e).code === 'EEXIST') {
            // Another run took the free slot: both it and the run whose lock we moved may be in.
            raceWarning();
          } else {
            // No hard links here (FAT32, some network shares): copy the lock back with an exclusive
            // create (a rename would silently overwrite a third run's lock). EEXIST means a third
            // run took the free slot: warn like above. A vanished source is ENOENT: retry.
            try {
              fs.copyFileSync(taken, lock, fs.constants.COPYFILE_EXCL);
            } catch (e2) {
              if (/** @type {NodeJS.ErrnoException} */ (e2).code !== 'EEXIST') throw e2;
              raceWarning();
            }
          }
        }
        fs.unlinkSync(taken);
      }
    } catch (e) {
      // The holder released it between our two calls: try again. Any other error is kept for the
      // timeout message and waits like a busy lock, so it can never spin at full speed.
      if (/** @type {NodeJS.ErrnoException} */ (e).code === 'ENOENT') continue;
      lastError = /** @type {NodeJS.ErrnoException} */ (e).code ?? 'error';
    }
    if (now() - started >= timeoutMs) {
      throw new Error(
        `another lane:merge holds ${lock} (delete it if no merge is running)${lastError ? ` [last error ${lastError}]` : ''}`
      );
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
      : spawnSync(cmd, args, {
          encoding: 'utf8',
          maxBuffer: 256 * 1024 * 1024,
          // one hung gh call must not hang a background --wait-ci forever
          ...(cmd === 'gh' ? { timeout: GH_TIMEOUT_MS } : {}),
          // the vault's git (the merge train note) must neither hang nor ask for a login
          ...(cmd === 'git' && args[0] === '-C'
            ? { timeout: VAULT_GIT_TIMEOUT_MS, env: { ...process.env, GIT_TERMINAL_PROMPT: '0' } }
            : {}),
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
 *   trainReset: string | null, train: boolean, state: string | null, waitCi: boolean,
 *   error: string | null }}
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
    waitCi: false,
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
    else if (a === '--wait-ci') out.waitCi = true;
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
      'usage: npm run lane:merge -- <PR> [--dry-run] [--wait-ci] [--no-changelog "reason"] [--vault DIR]';
  }
  if (!out.error && out.waitCi && out.pr === null) out.error = '--wait-ci needs a PR number';
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
 * @returns {{ relaunched: boolean, code: number, fetched: boolean, error: string | null, killed?: string | null }}
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
  // A child that was killed (a signal, or a caller's timeout) has no exit status; say so.
  const killed =
    r.status == null
      ? r.error
        ? `main's copy of the gate could not run (${r.error.message})`
        : `main's copy of the gate was killed (${r.signal ?? 'no exit status'})`
      : null;
  return { relaunched: true, code: r.status ?? 1, fetched: true, error: null, killed };
}

/** What each exit code of the gate means, for the `--wait-ci` verdict line. */
const EXIT_REASONS = {
  0: 'ok (checks pass or merged)',
  1: 'refused (see the lines above)',
  2: 'usage error',
  [EXIT_CI_FAILED]: 'a CI check failed',
  [EXIT_HEAD_MOVED]: 'the PR head moved while waiting',
  [EXIT_WAIT_TIMEOUT]: 'timed out waiting for CI',
};

/**
 * The one line a `--wait-ci` run ends with, whatever happened. Read it, not the exit code of a pipe.
 * @param {number} code @param {string} [reason] overrides the reason of the code
 */
export function verdictLine(code, reason) {
  return `lane:merge: wait-ci ended: exit ${code}, ${reason ?? EXIT_REASONS[code] ?? 'unknown'}`;
}

/**
 * The entry point's work: relaunch from main or run this copy, and for `--wait-ci` end with exactly
 * one verdict line. The relaunched child prints its own, so the parent adds one only when the child
 * ended without a status (a signal) or this process threw.
 * @param {{ argv: string[], relaunch: () => ReturnType<typeof relaunchFromMain>,
 *   runMain: (fetched: boolean) => number, log: (line: string) => void }} o
 * @returns {number} the process exit code
 */
export function runEntry({ argv, relaunch, runMain, log }) {
  const wait = argv.includes('--wait-ci');
  try {
    const gate = relaunch();
    if (gate.error) {
      log(`lane:merge: NOT merged: ${gate.error}`);
      if (wait) log(verdictLine(1, gate.error));
      return 1;
    }
    if (gate.relaunched) {
      if (wait && gate.killed) log(verdictLine(gate.code, gate.killed));
      return gate.code;
    }
    const code = runMain(gate.fetched);
    if (wait) log(verdictLine(code));
    return code;
  } catch (e) {
    const reason = `unexpected error: ${e instanceof Error ? e.message : String(e)}`;
    if (e instanceof Error && e.stack) console.error(e.stack);
    log(`lane:merge: NOT merged: ${reason}`);
    if (wait) log(verdictLine(1, reason));
    return 1;
  }
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
  // One high-priority heavy-check hold around the whole drift run, from main's copy of the lock (as
  // for drift-check, the branch must not bring its own): the guards inside see the held marker and
  // do not queue again each, so a merge never waits behind a green once per guard.
  const lock = run('git', ['show', `${MAIN}:scripts/heavy-lock.mjs`]);
  if (lock.status !== 0 || hasRelativeImports(lock.stdout) || /"/.test(dir)) {
    notes.push(`drift-check: no usable scripts/heavy-lock.mjs on ${MAIN}; each heavy guard takes the lock on its own`);
    return run('node', ['--input-type=module', '-e', DRIFT_RUNNER, pathToFileURL(file).href]);
  }
  // The lock runs its command through the shell, so the runner is a file (no quotes in the command).
  // The lock's entry check compares file names: it must be called heavy-lock.mjs.
  const lockFile = path.join(dir, 'heavy-lock.mjs');
  const runner = path.join(dir, 'drift-run.mjs');
  fs.writeFileSync(lockFile, lock.stdout);
  fs.writeFileSync(runner, DRIFT_RUNNER.replace('process.argv[1]', JSON.stringify(pathToFileURL(file).href)));
  return run('node', [lockFile, 'run', '--label', 'drift-check (merge gate)', '--priority', 'high', '--', 'node', `"${runner}"`]);
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
 *   home?: string, tmpdir?: string, now?: () => Date, fetched?: boolean, selfPath?: string, lockTimeoutMs?: number,
 *   sleep?: (ms: number) => void, clock?: () => number, waitPollMs?: number, waitTimeoutMs?: number,
 *   progress?: (line: string) => void,
 * }} [options] `progress` gets live lines that are not part of the verdict (stderr by default).
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
    fetched: fetchedBefore = env[ENV_FETCHED] === '1',
    selfPath = self,
    lockTimeoutMs = 20_000,
    sleep: pause = sleep,
    clock = Date.now,
    waitPollMs = WAIT_POLL_MS,
    waitTimeoutMs = WAIT_TIMEOUT_MS,
    progress = line => console.error(line),
  } = options;
  const args = parseArgs(argv);
  if (args.error) {
    log(`lane:merge: ${args.error}`);
    return 2;
  }
  let fetched = fetchedBefore;
  const statePath = args.state ?? path.join(home, '.foundry-ai-tool', 'merge-train.json');
  const short = (/** @type {string} */ sha) => sha.slice(0, 7);
  /** git fetch aitool main, once per run. @returns {string | null} an error, or null */
  const fetchMain = () => {
    if (fetched) return null;
    const f = run('git', ['fetch', REMOTE, 'main']);
    return f.status === 0 ? null : firstLine(f.stderr || f.stdout) || 'failed';
  };
  const message = (/** @type {unknown} */ e) => (e instanceof Error ? e.message : String(e));
  const vault =
    args.vault ?? env.FOUNDRY_AI_OBSIDIAN_DIR ?? path.join(home, 'Documents', 'Obsidian', 'vault');
  /**
   * Write the train state to the vault note. A failure is a warning text, never a failed merge.
   * @param {TrainState} state @param {TrainEvent['kind']} kind @param {number} [pr]
   */
  const recordTrain = (state, kind, pr) => {
    const warn = publishTrainNote({
      vault,
      state,
      event: { kind, ...(pr === undefined ? {} : { pr }), at: now().toISOString() },
      run,
      now,
    });
    return warn ? `WARNING: ${warn}` : '';
  };

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
    const resetWarning = recordTrain(
      { lastRoundtrip: { sha: tipSha, at: now().toISOString() }, since: [] },
      'reset'
    );
    if (resetWarning) log(`lane:merge: ${resetWarning}`);
    return 0;
  }

  const n = /** @type {number} */ (args.pr);
  /** @type {string[]} */
  const failures = [];
  /** @type {string[]} */
  const details = [];
  /** @type {string[]} */
  const notes = [];
  // The train lock, held from before the merge until it is written. A refusal drops it before any
  // vault I/O, so a slow vault never keeps other lanes waiting.
  /** @type {(() => void) | null} */
  let release = null;
  const finish = (code = 1) => {
    release?.();
    release = null;
    log(`lane:merge: NOT merged #${n}`);
    for (const f of failures) log(f);
    for (const line of notes) log(`lane:merge: ${line}`);
    for (const d of details) log(d);
    if (!args.dryRun) {
      try {
        const warn = recordTrain(readTrain(statePath), 'refusal', n);
        if (warn) log(`lane:merge: ${warn}`);
      } catch (e) {
        log(`lane:merge: WARNING: merge train note not written (${message(e)})`);
      }
    }
    return code;
  };

  // --wait-ci: wait for every CI check on the head commit, then run the gate below unchanged.
  /** @type {string | null} */
  let waitedHead = null;
  if (args.waitCi) {
    log(
      `lane:merge: --wait-ci: waiting up to ${Math.round(waitTimeoutMs / 60000)} minutes for CI on #${n}`
    );
    const waited = waitForCi({
      pr: n,
      run,
      log,
      sleep: pause,
      clock,
      pollMs: waitPollMs,
      timeoutMs: waitTimeoutMs,
    });
    if (!waited.ok) {
      failures.push(waited.reason);
      return finish(waited.code);
    }
    waitedHead = waited.head;
    // The wait can take half an hour: main may have moved, and with it the merge base, drift-check
    // and the gate itself. Fetch again, and refuse when the gate on main is no longer this file.
    const refetch = run('git', ['fetch', REMOTE, 'main']);
    if (refetch.status !== 0) {
      failures.push(
        `wait-ci: git fetch ${REMOTE} main failed after the wait (${firstLine(refetch.stderr || refetch.stdout) || 'failed'})`
      );
      return finish();
    }
    fetched = true;
    const onMain = run('git', ['show', `${MAIN}:scripts/lane-merge.mjs`]);
    if (onMain.status === 0) {
      let mine = null;
      try {
        mine = fs.readFileSync(selfPath, 'utf8');
      } catch {
        /* refused below */
      }
      if (mine === null || lf(onMain.stdout) !== lf(mine)) {
        failures.push(
          `wait-ci: the gate on ${MAIN} changed during the wait (or this copy cannot be read); start again`
        );
        return finish();
      }
    }
  }

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
  if (waitedHead !== null && head !== waitedHead) {
    failures.push(
      `wait-ci: head moved from ${short(waitedHead)} to ${short(head)} after the wait; start again`
    );
    return finish(EXIT_HEAD_MOVED);
  }
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
    // Its output is captured, so a wait for the heavy-check lock would be silent until the end.
    progress(
      'lane:merge: drift-check runs now; it may first wait for the heavy-check lock (node scripts/heavy-lock.mjs status shows who holds it)'
    );
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
  // After the merged line, so a slow or hanging vault push never hides a merge that happened.
  const noteWarning = recordTrain(train, 'merge', n);
  if (noteWarning) log(`lane:merge: ${noteWarning}`);
  return 0;
}

const self = fileURLToPath(import.meta.url);
const decision = entryDecision(process.argv[1], self);
if (decision === 'run') {
  process.exit(
    runEntry({
      argv: process.argv.slice(2),
      relaunch: () =>
        relaunchFromMain({
          argv: process.argv.slice(2),
          run: defaultRun,
          selfPath: self,
          env: process.env,
          tmpdir: os.tmpdir(),
          log: console.log,
        }),
      runMain: fetched => main({ fetched }),
      log: console.log,
    })
  );
} else if (decision === 'mismatch') {
  console.error(
    `lane:merge: started as ${process.argv[1]} but this module is ${self}; not running`
  );
  if (process.argv.includes('--wait-ci')) {
    console.log(verdictLine(1, 'started under another name; not running'));
  }
  process.exit(1);
}
