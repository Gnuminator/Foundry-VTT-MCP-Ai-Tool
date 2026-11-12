/**
 * scripts/lane-merge.mjs: the merge gate. gh, git, node and npm are faked through the injectable
 * `run`; the vault and the merge train state are temp directories.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { execFileSync, spawnSync } from 'node:child_process';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath, pathToFileURL } from 'node:url';
import {
  RISKY_CATEGORIES,
  TRAIN_PATTERNS,
  TRAIN_NOTE_PATH,
  TRAIN_SIZE,
  acquireLock,
  announceSource,
  carriedReviews,
  defaultAnnounce,
  defaultRun,
  entryDecision,
  findReviewNotes,
  globToRegExp,
  hasChangelogFragment,
  hasRelativeImports,
  isEntryModule,
  isTrainRelevant,
  judgeReviews,
  liveCheckLine,
  liveCheckProblem,
  main,
  matchesAny,
  parseArgs,
  parseNameStatus,
  opusNotesForHead,
  parseReviewNote,
  patchIdAt,
  publishTrainNote,
  refusalBody,
  refusedBecause,
  releasePr,
  reviewNamingRule,
  unreadPrNotes,
  refusalCauses,
  readTrain,
  renderTrainNote,
  relaunchFromMain,
  runEntry,
  verdictLine,
  requiredContexts,
  riskyHits,
  rollupProblems,
  waitForCi,
} from './lane-merge.mjs';

const HEAD = '3d24f70a1b2c3d4e5f60718293a4b5c6d7e8f901';
const OTHER = 'ffffffff00000000000000000000000000000000';
const SELF = fileURLToPath(new URL('./lane-merge.mjs', import.meta.url));

/** The gate modules of this checkout, by file name. */
function ownModules() {
  const dir = path.join(path.dirname(SELF), 'lane-merge');
  return Object.fromEntries(
    fs.readdirSync(dir).map(n => [n, fs.readFileSync(path.join(dir, n), 'utf8')])
  );
}
const REPO_ROOT = path.resolve(path.dirname(SELF), '..');

/** A review note in the vault format. */
function note({
  head = HEAD,
  verdict = '**Merge.** All fine.',
  title = 'PR #312 review',
  extra = '',
} = {}) {
  return `---\ntype: review\n---\n\n# ${title}\n\nHead reviewed: \`${head}\` (CI green).\n\n## Verdict\n\n${verdict}\n\n## What I checked\n\n- **Bold later**\n${extra}`;
}

/** A vault with Reviews folders holding the given { folder, name, text } notes. */
function vaultWith(items) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-vault-'));
  for (const { folder = 'Reviews 2026-10-10', name, text } of items) {
    const dir = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff', folder);
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, name), text);
  }
  return vault;
}

const tmpDir = () => fs.mkdtempSync(path.join(os.tmpdir(), 'lane-state-'));

const RULES = [
  {
    type: 'required_status_checks',
    parameters: { required_status_checks: [{ context: 'build-test' }] },
  },
  { type: 'pull_request', parameters: {} },
];

const FAKE_DRIFT_SOURCE = `import fs from 'node:fs';\nexport function runDriftCheck() { return 0; }\n`;
const FAKE_LOCK_SOURCE = `import fs from 'node:fs';\nexport function acquire() {}\n`;

/** Is this call the drift run (wrapped in main's heavy-lock copy, or bare)? @param {string} cmd @param {string[]} args */
const isDriftCall = (cmd, args) =>
  cmd === 'node' &&
  (args[0] === '--input-type=module' ||
    (/heavy-lock\.mjs$/.test(args[0] ?? '') && args[1] === 'run'));

/**
 * A gate run against fakes. Returns the output lines, the exit code, the calls and the state file.
 * @param {{ vault?: string, files?: string[], ghFiles?: string[], rollup?: any[], pr?: object,
 *   localHead?: string, dirty?: boolean, drift?: number, argv?: string[], train?: object,
 *   merge?: number, rules?: any, rulesFail?: boolean, fetchFail?: boolean, driftSource?: string | null,
 *   lockSource?: string | null,
 *   lockTimeoutMs?: number, onDrift?: (stateFile: string) => void, fetched?: boolean,
 *   mainGate?: string | null, prFor?: (viewIndex: number) => object }} o. `mainGate` is what
 *   aitool/main holds as lane-merge.mjs (default: this very file; null: none yet). `prFor` overrides fields of the PR for each
 *   successive `gh pr view` (the first calls are --wait-ci's polls, the last one is the gate's);
 *   time is fake: the polls' sleeps advance a clock, `sleeps` lists them.
 */
function gate(o = {}) {
  const vault = o.vault ?? vaultWith([{ name: '312-review.md', text: note() }]);
  const home = tmpDir();
  const state = path.join(home, 'merge-train.json');
  if (o.train) fs.writeFileSync(state, JSON.stringify(o.train));
  const localPaths = o.files ?? ['docs/guide.md', 'changelog.d/thing.md'];
  const pr = {
    number: 312,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'claude/thing',
    headRefOid: HEAD,
    mergeable: 'MERGEABLE',
    title: 'A thing',
    body: o.body ?? 'Live check: test server A, real dnd5e data',
    files: (o.ghFiles ?? localPaths).map(p => ({ path: p })),
    statusCheckRollup: o.rollup ?? [
      { __typename: 'CheckRun', name: 'build-test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'codeql', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ],
    ...o.pr,
  };
  /** @type {string[][]} */
  const calls = [];
  const ok = (stdout = '') => ({ status: 0, stdout, stderr: '' });
  let views = 0;
  let clockMs = 0;
  /** @type {number[]} */
  const sleeps = [];
  const run = (cmd, args, input) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.slice(0, 2).join(' ')}`;
    // the review carry (carriedReviews): `patchIds` maps a commit to its patch id; a commit not in
    // it has no patch id (git patch-id fails), `missing` commits are not in the clone
    if (key === 'git rev-parse --is-shallow-repository')
      return ok(o.shallow ? 'true\n' : 'false\n');
    if (key === 'git cat-file -e') {
      const sha = args[2].replace('^{commit}', '');
      return o.missing?.includes(sha) ? { status: 1, stdout: '', stderr: 'missing' } : ok();
    }
    if (key === 'git fetch -q') return { status: 128, stdout: '', stderr: 'not our ref' };
    if (key === 'git merge-base aitool/main' && args[2] !== 'HEAD')
      return ok(`${'b'.repeat(40)}\n`);
    if (key === 'git diff --binary') return ok(`patch ${args.at(-1)}\n`);
    if (key === 'git show -s') return ok(`${o.commitTimes?.[args[3]] ?? 1000}\n`);
    if (key === 'git patch-id --verbatim') {
      const id =
        o.patchIds?.[
          String(input)
            .replace(/^patch /, '')
            .trim()
        ];
      return id ? ok(`${id} ${'0'.repeat(40)}\n`) : { status: 1, stdout: '', stderr: 'no id' };
    }
    // vault git calls (the merge train note): answered by `vaultRun`, a failure by default
    if (cmd === 'git' && args[0] === '-C') {
      return o.vaultRun?.(args.slice(2)) ?? { status: 1, stdout: '', stderr: 'no vault git' };
    }
    if (key === 'gh pr view') {
      return ok(JSON.stringify({ ...pr, ...o.prFor?.(views++) }));
    }
    if (cmd === 'gh' && args[0] === 'api') {
      return o.rulesFail
        ? { status: 1, stdout: '', stderr: 'HTTP 403' }
        : ok(JSON.stringify(o.rules ?? RULES));
    }
    if (key === 'git fetch aitool') {
      return o.fetchFail ? { status: 128, stdout: '', stderr: 'no network' } : ok();
    }
    if (key === 'git merge-base aitool/main') return ok('basesha\n');
    if (key === 'git diff -z') {
      const nul = String.fromCharCode(0);
      const entry = p =>
        `${o.changeTypes?.[p] ?? (p.startsWith('changelog.d/') ? 'A' : 'M')}${nul}${p}${nul}`;
      return ok(localPaths.map(entry).join(''));
    }
    if (key === 'git rev-parse HEAD') return ok(`${o.localHead ?? HEAD}\n`);
    if (key === 'git status --porcelain') return ok(o.dirty ? ' M a.txt\n?? b.txt\n' : '');
    if (key === 'git show aitool/main:scripts/lane-merge.mjs') {
      return o.mainGate === null
        ? { status: 128, stdout: '', stderr: 'fatal: path not in aitool/main' }
        : ok(o.mainGate ?? fs.readFileSync(SELF, 'utf8'));
    }
    // Main's gate modules: this checkout's own unless the test gives others (`mainModules`).
    if (cmd === 'git' && args[0] === 'ls-tree' && args.at(-1) === 'scripts/lane-merge/') {
      const names = Object.keys(o.mainModules ?? ownModules());
      return ok(names.map(n => `scripts/lane-merge/${n}`).join('\n'));
    }
    if (key.startsWith('git show aitool/main:scripts/lane-merge/')) {
      const name = key.slice('git show aitool/main:scripts/lane-merge/'.length);
      return ok((o.mainModules ?? ownModules())[name] ?? '');
    }
    if (key === 'git show aitool/main:scripts/drift-check.mjs') {
      return o.driftSource === null
        ? { status: 128, stdout: '', stderr: 'fatal: path not in aitool/main' }
        : ok(o.driftSource ?? FAKE_DRIFT_SOURCE);
    }
    if (key === 'git show aitool/main:scripts/heavy-lock.mjs') {
      return o.lockSource === null
        ? { status: 128, stdout: '', stderr: 'fatal: path not in aitool/main' }
        : ok(o.lockSource ?? FAKE_LOCK_SOURCE);
    }
    // a file at the merge base (basesha) or the head, for the release PR check
    if (cmd === 'git' && args[0] === 'show' && o.show && /^(basesha|[0-9a-f]{40}):/.test(args[1])) {
      const [rev, ...rest] = args[1].split(':');
      const text = o.show(rev === 'basesha' ? 'base' : 'head', rest.join(':'));
      return text === null ? { status: 128, stdout: '', stderr: 'fatal: no such path' } : ok(text);
    }
    if (isDriftCall(cmd, args)) {
      o.onDrift?.(state);
      return {
        status: o.drift ?? 0,
        stdout: 'drift output\n',
        stderr: o.drift ? '  FAIL bundle budget\nguard failed\n' : '',
      };
    }
    if (key === 'npm run drift:check') {
      return { status: o.drift ?? 0, stdout: 'local drift\n', stderr: '' };
    }
    if (key === 'gh pr merge') {
      return { status: o.merge ?? 0, stdout: '', stderr: o.merge ? 'not allowed' : '' };
    }
    return { status: 1, stdout: '', stderr: `unexpected ${key}` };
  };
  const lines = [];
  /** @type {string[]} */
  const progress = [];
  const code = main({
    argv: ['312', '--vault', vault, '--state', state, ...(o.argv ?? [])],
    run,
    log: l => lines.push(l),
    progress: l => progress.push(l),
    home,
    tmpdir: home,
    now: () => new Date('2026-10-10T12:00:00Z'),
    lockTimeoutMs: o.lockTimeoutMs ?? 300,
    selfPath: SELF,
    ...(o.announce ? { announce: o.announce } : {}),
    ...(o.fetched === undefined ? {} : { fetched: o.fetched }),
    clock: () => clockMs,
    sleep: ms => {
      sleeps.push(ms);
      clockMs += ms;
    },
  });
  return {
    code,
    sleeps,
    lines,
    progress,
    calls,
    state,
    home,
    text: lines.join('\n'),
    merged: calls.some(c => c[0] === 'gh' && c[2] === 'merge'),
  };
}

test('parseReviewNote: full sha forms, verdict forms, opus', () => {
  const backtick = parseReviewNote('312-opus-review.md', note(), 312);
  assert.deepEqual(backtick.entries, [{ head: HEAD, verdict: 'Merge.', merge: true }]);
  assert.ok(backtick.opus);
  const bare = parseReviewNote(
    '312-review.md',
    `Head reviewed: ${HEAD.toUpperCase()}. CI: 8/8.\n\n## Verdict\n\n**Merge.**\n`,
    312
  );
  assert.equal(bare.entries[0].head, HEAD);
  assert.ok(bare.entries[0].merge && !bare.opus);
  const noDot = parseReviewNote('1-review.md', note({ verdict: '**Merge**, nothing else.' }), 1);
  assert.ok(noDot.entries[0].merge);
  const fixes = parseReviewNote('1-review.md', note({ verdict: '**Merge after fixes.** One.' }), 1);
  assert.equal(fixes.entries[0].verdict, 'Merge after fixes.');
  assert.ok(!fixes.entries[0].merge);
  assert.ok(
    !parseReviewNote('1-review.md', note({ verdict: '**Do not merge.** Broken.' }), 1).entries[0]
      .merge
  );
  assert.ok(
    !parseReviewNote('1-review.md', note({ verdict: 'Merge it, looks fine.' }), 1).entries[0].merge
  );
  assert.deepEqual(
    parseReviewNote('1-review.md', '# x\n\nHead 410d764e. Verdict: **merge**.\n', 1).entries,
    []
  );
});

test('parseReviewNote: a short sha ties nothing (the full 40 characters are required)', () => {
  const p = parseReviewNote('312-review.md', note({ head: '3d24f70a' }), 312);
  assert.equal(p.entries[0].head, null);
  assert.deepEqual(p.shortHeads, ['3d24f70a']);
  const r = judgeReviews([p], HEAD, false);
  assert.ok(!r.ok);
  assert.match(r.detail, /3d24f70a \(Head reviewed needs the full 40-character sha\)/);
});

test('parseReviewNote: every Verdict section counts, tied to the Head reviewed above it', () => {
  const rounds = `# PR #312 review\n\nHead reviewed: \`${HEAD}\`\n\n## Verdict\n\n**Merge.**\n\n## Round 2\n\nHead reviewed: \`${OTHER}\`\n\n## Verdict\n\n**Do not merge.**\n`;
  const p = parseReviewNote('312-review.md', rounds, 312);
  assert.deepEqual(
    p.entries.map(e => [e.head, e.merge]),
    [
      [HEAD, true],
      [OTHER, false],
    ]
  );
  // Probe E: same sha, round 2 appended, first section says Merge.
  const same = `# t\n\nHead reviewed: ${HEAD}\n\n## Verdict\n\n**Merge.**\n\n## Round 2 verdict\n\n## Verdict\n\n**Do not merge.**\n`;
  assert.deepEqual(
    parseReviewNote('312-review.md', same, 312).entries.map(e => e.merge),
    [true, false]
  );
});

test('parseReviewNote: a Head reviewed line after the last Verdict makes the note malformed (#314 L3)', () => {
  // Round 1 is in order; round 2 puts its Do not merge above its own Head line.
  const text = `# t\n\nHead reviewed: ${OTHER}\n\n## Verdict\n\n**Merge after fixes.**\n\n## Round 2\n\n## Verdict\n\n**Do not merge.**\n\nHead reviewed: ${HEAD}\n`;
  const p = parseReviewNote('312-review.md', text, 312);
  assert.equal(p.malformed.length, 2, p.malformed.join(' | '));
  assert.match(p.malformed[0], /the ## Verdict on line 11 has no "Head reviewed:" line above it/);
  assert.match(p.malformed[1], /the "Head reviewed:" on line 15 comes after the last ## Verdict/);
  // The Do not merge ties to no sha, and a separate Merge note for the new head cannot rescue it.
  assert.equal(p.entries[1].head, null);
  const sonnet = parseReviewNote('312-sonnet-review.md', note(), 312);
  const r = judgeReviews([p, sonnet], HEAD, false);
  assert.ok(!r.ok);
  assert.match(r.detail, /312-review.md is malformed: /);
});

test('parseReviewNote: a Verdict with no Head reviewed since the previous verdict is malformed', () => {
  // Probe E shape: the second round says nothing about its sha, so it would tie to the first.
  const same = `# t\n\nHead reviewed: ${HEAD}\n\n## Verdict\n\n**Merge.**\n\n## Verdict\n\n**Do not merge.**\n`;
  const p = parseReviewNote('312-review.md', same, 312);
  assert.equal(p.malformed.length, 1);
  assert.match(p.malformed[0], /the ## Verdict on line 9 has no "Head reviewed:"/);
  // The very first verdict needs a Head line above it too.
  const first = `# t\n\n## Verdict\n\n**Merge.**\n\nHead reviewed: ${HEAD}\n`;
  assert.equal(parseReviewNote('312-review.md', first, 312).malformed.length, 2);
});

test('parseReviewNote: notes in the right order are not malformed', () => {
  assert.deepEqual(parseReviewNote('312-review.md', note(), 312).malformed, []);
  const rounds = `# t\n\nHead reviewed: ${OTHER}\n\n## Verdict\n\n**Merge after fixes.**\n\n## Round 2\n\nHead reviewed: ${HEAD}\n\n## Verdict\n\n**Merge.**\n`;
  assert.deepEqual(parseReviewNote('312-review.md', rounds, 312).malformed, []);
  // A short sha is still a Head reviewed line (it fails elsewhere, in shortHeads).
  assert.deepEqual(parseReviewNote('312-review.md', note({ head: '3d24f70a' }), 312).malformed, []);
  // Bullet and bold forms of the Head line count.
  const bullet = `# t\n\n- **Head reviewed:** \`${HEAD}\`\n\n## Verdict\n\n**Merge.**\n`;
  assert.deepEqual(
    parseReviewNote('312-review.md', bullet, 312).entries.map(e => e.head),
    [HEAD]
  );
});

test('parseReviewNote: shapes that would lose a Do not merge are malformed (review M1, L1, L2)', () => {
  const bad = text => parseReviewNote('312-review.md', text, 312);
  // M1a: the sha sits in the verdict heading itself.
  const inHeading = bad(`# t\n\n## Verdict: Do not merge (Head reviewed: ${HEAD})\n`);
  assert.ok(
    inHeading.malformed.some(m => /also carries "Head reviewed:"/.test(m)),
    inHeading.malformed.join('|')
  );
  assert.equal(inHeading.entries.length, 1, 'the verdict still counts');
  assert.ok(!inHeading.entries[0].merge);
  // M1b: a Head line and no ## Verdict (a ### heading does not count).
  const wrongLevel = bad(`# t\n\nHead reviewed: ${HEAD}\n\n### Verdict\n\n**Do not merge.**\n`);
  assert.match(wrongLevel.malformed[0], /has no ## Verdict/);
  assert.match(bad(`# t\n\nHead reviewed: ${HEAD}\n`).malformed[0], /has no ## Verdict/);
  // L1: a mention in prose does not move the tie, and two shas before one verdict are refused.
  const prose = bad(
    `# t\n\nHead reviewed: ${OTHER}\n\n## Verdict\n\n**Merge after fixes.**\n\nThe earlier Head reviewed: ${HEAD} was stale.\n\n## Verdict\n\n**Do not merge.**\n`
  );
  assert.match(prose.malformed.join('|'), /the ## Verdict on line 11 has no "Head reviewed:"/);
  assert.equal(prose.entries[1].head, null);
  const two = bad(
    `# t\n\nHead reviewed: ${OTHER}\n\nHead reviewed: ${HEAD}\n\n## Verdict\n\n**Merge.**\n`
  );
  assert.match(two.malformed.join('|'), /more than one full sha/);
  // L2: a verdict under a short sha of this head cannot be set aside by a Merge note for it.
  const shortNo = bad(
    `# t\n\nHead reviewed: ${HEAD.slice(0, 8)}\n\n## Verdict\n\n**Do not merge.**\n`
  );
  const merge = parseReviewNote('312-sonnet-review.md', note(), 312);
  const r = judgeReviews([shortNo, merge], HEAD, false);
  assert.ok(!r.ok);
  assert.match(
    r.detail,
    /312-review.md reviewed 3d24f70a \(Head reviewed needs the full 40-character sha\)/
  );
  // A short sha of another head is only an old note.
  const elsewhere = bad(`# t\n\nHead reviewed: deadbeef\n\n## Verdict\n\n**Do not merge.**\n`);
  assert.ok(judgeReviews([elsewhere, merge], HEAD, false).ok);
});

test('review: a malformed note refuses the gate and names the fix', () => {
  const text = `# t\n\n## Verdict\n\n**Merge.**\n\nHead reviewed: ${HEAD}\n`;
  const r = gate({ vault: vaultWith([{ name: '312-review.md', text }]) });
  assert.equal(r.code, 1);
  assert.match(r.text, /review: 312-review.md is malformed: the ## Verdict on line 3 has no/);
  assert.match(r.text, /put "Head reviewed:" before each "## Verdict"/);
});

test('parseReviewNote: text after Verdict on the heading line is the verdict (probe F)', () => {
  const text = `# t\n\nHead reviewed: ${HEAD}\n\n## Verdict: Do not merge\n\nSome prose quoting **Merge.** from the old round.\n`;
  const e = parseReviewNote('312-review.md', text, 312).entries[0];
  assert.equal(e.verdict, 'Do not merge');
  assert.ok(!e.merge);
  const dash = `# t\n\nHead reviewed: ${HEAD}\n\n## Verdict - **Merge.**\n`;
  assert.ok(parseReviewNote('312-review.md', dash, 312).entries[0].merge);
  const none = `# t\n\nHead reviewed: ${HEAD}\n\n## Verdict\n\nLooks fine to me.\n`;
  assert.equal(parseReviewNote('312-review.md', none, 312).entries[0].verdict, null);
});

test('parseReviewNote: Opus only by the file name or the PR heading, not any mention', () => {
  const opus = (name, title) => parseReviewNote(name, note({ title }), 314).opus;
  assert.ok(opus('314-opus-review.md', 'whatever'));
  assert.ok(opus('314-opus-review-round2.md', 'whatever'));
  assert.ok(opus('314-review-round2.md', 'PR #314 Opus review, round 2'));
  assert.ok(!opus('314-sonnet-review-before-opus.md', 'PR #314 Sonnet review'));
  assert.ok(!opus('314-review.md', 'PR #314 Sonnet review (Opus review still to come)'));
  assert.ok(!opus('314-review.md', 'PR #999 Opus review'));
  assert.ok(!opus('314-review.md', 'Opus thoughts'));
});

test('findReviewNotes: every dated folder, right PR number prefix only', () => {
  const vault = vaultWith([
    { folder: 'Reviews 2026-10-09', name: '310-review.md', text: note() },
    { folder: 'Reviews 2026-10-10', name: '310-opus-review-round2.md', text: note() },
    { folder: 'Reviews 2026-10-10', name: '3100-review.md', text: note() },
    { folder: 'Reviews 2026-10-10', name: '31-review.md', text: note() },
    { folder: 'Reviews 2026-10-10', name: '310-notes.md', text: note() },
    { folder: 'Other', name: '310-review.md', text: note() },
  ]);
  const names = findReviewNotes(vault, 310)
    .map(x => x.name)
    .sort();
  assert.deepEqual(names, ['310-opus-review-round2.md', '310-review.md']);
  assert.equal(findReviewNotes(path.join(vault, 'missing'), 310), null);
});

test('judgeReviews: head must match, every verdict must be Merge, Opus when risky', () => {
  const parse = (name, opts) => parseReviewNote(name, note(opts), 312);
  const ok = parse('312-review.md');
  const opus = parse('312-opus-review.md');
  const old = parse('312-review-round1.md', { head: OTHER });
  const fixes = parse('312-review-r2.md', { verdict: '**Merge after fixes.**' });
  const stop = parse('312-opus-review-r2.md', { verdict: '**Do not merge.**' });
  assert.ok(judgeReviews([ok], HEAD, false).ok);
  assert.ok(judgeReviews([old, ok], HEAD, false).ok);
  assert.match(judgeReviews([old], HEAD, false).detail, /no review note for head 3d24f70/);
  assert.match(judgeReviews([], HEAD, false).detail, /no review note/);
  assert.match(
    judgeReviews([fixes], HEAD, false).detail,
    /312-review-r2.md says "Merge after fixes."/
  );
  const needOpus = judgeReviews([ok], HEAD, true);
  assert.ok(!needOpus.ok);
  assert.match(needOpus.detail, /needs an Opus review/);
  assert.ok(judgeReviews([ok, opus], HEAD, true).ok);
  // H2: a blocking verdict for the same head vetoes a Merge.
  const a = judgeReviews([ok, stop], HEAD, false);
  assert.ok(!a.ok);
  assert.match(a.detail, /312-opus-review-r2.md says "Do not merge."/);
  assert.ok(!judgeReviews([opus, stop], HEAD, true).ok, 'probe B: two Opus notes, one blocks');
  assert.ok(!judgeReviews([opus, fixes], HEAD, true).ok, 'a Sonnet Merge after fixes blocks too');
  assert.ok(judgeReviews([opus, old], HEAD, true).ok, 'a note for another head is not a veto');
});

test('risky categories: every category has patterns and the real paths match', () => {
  for (const c of RISKY_CATEGORIES) assert.ok(c.patterns.length > 0, c.name);
  const category = file => riskyHits([file]).map(h => h.name);
  assert.deepEqual(category('packages/foundry-module/src/write-gate.ts'), ['the write gate']);
  assert.deepEqual(category('packages/foundry-module/src/bridge-link.ts'), ['the bridge link']);
  assert.deepEqual(category('packages/mcp-server/src/guarded-write/service.ts'), [
    'guarded writes',
  ]);
  assert.deepEqual(category('packages/foundry-module/src/data-access/guarded-write.ts'), [
    'guarded writes',
  ]);
  assert.deepEqual(category('packages/foundry-module/src/queries.ts'), ['guarded writes']);
  assert.deepEqual(category('packages/mcp-server/src/control-target.ts'), ['the bridge link']);
  assert.deepEqual(category('packages/cogm-dashboard/src/auth.ts'), ['security']);
  assert.deepEqual(category('packages/cogm-dashboard/web/src/lib/auth.ts'), ['security']);
  assert.deepEqual(category('packages/cogm-dashboard/web/src/lib/guarded.ts'), ['security']);
  assert.deepEqual(category('packages/mcp-server/src/handouts/strip-secrets.ts'), ['security']);
  assert.deepEqual(category('packages/mcp-server/src/obsidian/licensed-guard.ts'), ['security']);
  assert.deepEqual(category('.claude/hooks/guard-remote-commands.mjs'), ['security']);
  assert.deepEqual(category('scripts/pi/remote/5-tool.sh'), ['Pi scripts']);
  assert.deepEqual(category('scripts/plan-b/start.ps1'), ['Pi scripts']);
  assert.deepEqual(category('deploy/Dockerfile'), ['Pi scripts']);
  assert.deepEqual(category('shared/src/protocol.ts'), ['wire contracts']);
  assert.deepEqual(category('packages/foundry-module/module.json'), ['wire contracts']);
  for (const gateInput of [
    'scripts/lane-merge.mjs',
    'scripts/green.mjs',
    'scripts/drift-check.mjs',
    'scripts/checks.mjs',
    'scripts/ci-yaml.mjs',
    'scripts/heavy-lock.mjs',
    'scripts/pre-push.mjs',
    'scripts/lint-ratchet.mjs',
    '.github/workflows/ci.yml',
    '.claude/hooks/context-alert.mjs',
    '.claude/settings.json',
  ]) {
    // D-101 as narrowed by one-opus-pass: the gate, CI and hooks get a Sonnet review plus CI.
    assert.deepEqual(category(gateInput), [], gateInput);
  }
  assert.deepEqual(category('.claude/agents/review-pi-ci.md'), []);
  // The narrowed shared list: contract files are risky, the rest of shared/src is not.
  for (const f of [
    'protocol',
    'schemas',
    'constants',
    'bridge-queries',
    'types',
    'version',
    'ports',
  ]) {
    assert.deepEqual(category(`shared/src/${f}.ts`), ['wire contracts'], f);
  }
  assert.deepEqual(category('shared/src/party.ts'), []);
  assert.deepEqual(category('shared/src/guarded-write.ts'), ['guarded writes']);
  for (const calm of [
    'docs/guide.md',
    'packages/cogm-dashboard/web/src/App.tsx',
    'packages/mcp-server/src/tools/dice.ts',
    'scripts/changelog-fold.mjs',
  ]) {
    assert.deepEqual(category(calm), [], calm);
  }
});

test('risky categories: every pattern still matches a tracked file (a rename cannot drop out)', t => {
  let tracked;
  try {
    tracked = execFileSync('git', ['ls-files'], {
      cwd: REPO_ROOT,
      encoding: 'utf8',
      maxBuffer: 64e6,
    })
      .split(/\r?\n/)
      .filter(Boolean);
  } catch {
    t.skip('git ls-files is not available here');
    return;
  }
  // The gate's own files are untracked until the PR that adds them is committed.
  const dead = RISKY_CATEGORIES.flatMap(c => c.patterns.map(p => ({ c: c.name, p }))).filter(
    ({ p }) => !tracked.some(f => matchesAny(f, [p])) && !fs.existsSync(path.join(REPO_ROOT, p))
  );
  assert.deepEqual(dead, [], 'patterns that match no file in the repository');
});

/** shared/src files that are deliberately not wire contracts. A new file must be added here or to a risky pattern. */
const NOT_CONTRACT = [
  'actor-image',
  'character-entity',
  'character-sheet',
  'combat-change',
  'export-index',
  'foundry-setup',
  'index',
  'library-index',
  'live-play',
  'npc-turn',
  'ownership',
  'paper-sync',
  'party',
  'pc-creation',
  'play-log',
  'player-portrait',
  'player-view',
  'preflight',
  'prep-digest',
  'room-setup',
  'rules-check',
  'scene-change',
  'scene-mood',
  'scene-restore',
  'sessions-dir',
  'space-status',
  'switch-off',
  'table-viewer',
  'token-rings',
  'tool-refs',
  'usage-catalog.generated',
  'usage',
  'util/errors',
].map(n => `shared/src/${n}.ts`);

function sharedSourceFiles(dir = path.join(REPO_ROOT, 'shared', 'src')) {
  return fs.readdirSync(dir, { withFileTypes: true }).flatMap(e => {
    const full = path.join(dir, e.name);
    if (e.isDirectory()) return sharedSourceFiles(full);
    return /\.[cm]?[jt]sx?$/.test(e.name) && !/\.(test|spec)\./.test(e.name)
      ? [path.relative(REPO_ROOT, full).replace(/\\/g, '/')]
      : [];
  });
}

test('shared/src: every file is a risky contract file or named in NOT_CONTRACT (a new file forces a decision)', () => {
  const unclassified = sharedSourceFiles().filter(
    f => riskyHits([f]).length === 0 && !NOT_CONTRACT.includes(f)
  );
  assert.deepEqual(
    unclassified,
    [],
    'add each to a RISKY_CATEGORIES pattern in scripts/lane-merge.mjs or to NOT_CONTRACT in this test'
  );
  const files = sharedSourceFiles();
  const stale = NOT_CONTRACT.filter(f => !files.includes(f) || riskyHits([f]).length > 0);
  assert.deepEqual(stale, [], 'NOT_CONTRACT entries that are gone or are risky after all');
});

test('guard hooks stay registered: every .claude/hooks/guard-*.mjs is a command in settings.json (Sonnet-reviewed file, so CI pins it)', () => {
  const settings = fs.readFileSync(path.join(REPO_ROOT, '.claude', 'settings.json'), 'utf8');
  const guards = fs
    .readdirSync(path.join(REPO_ROOT, '.claude', 'hooks'))
    .filter(f => /^guard-.*\.mjs$/.test(f) && !f.endsWith('.test.mjs'));
  assert.ok(guards.length >= 4, 'guard hooks found');
  for (const g of guards) assert.ok(settings.includes(`.claude/hooks/${g}`), `${g} is registered`);
});

test('feature switch ids are pinned: they form the module setting keys, so a rename needs a migration (shared/src is Sonnet-reviewed outside the contract files)', () => {
  const found = sharedSourceFiles()
    .flatMap(f =>
      [
        ...fs
          .readFileSync(path.join(REPO_ROOT, f), 'utf8')
          .matchAll(/export const (\w+_FEATURE_ID) = '([^']+)'/g),
      ].map(m => `${m[1]}=${m[2]}`)
    )
    .sort();
  assert.deepEqual(found, [
    'ACTOR_IMAGE_FEATURE_ID=actor-image',
    'FOUNDRY_SETUP_FEATURE_ID=foundry-setup',
    'LIVE_PLAY_FEATURE_ID=live-play',
    'NPC_TURN_FEATURE_ID=npc-turn',
    'OWNERSHIP_FEATURE_ID=ownership',
    'PAPER_SYNC_FEATURE_ID=paper-sync',
    'PARTY_FEATURE_ID=party',
    'PC_CREATION_FEATURE_ID=pc-creation',
    'PLAYER_PORTRAIT_FEATURE_ID=player-portrait',
    'ROOM_SETUP_FEATURE_ID=room-setup',
    'RULES_CHECK_FEATURE_ID=rules-check',
    'SCENE_MOOD_FEATURE_ID=scene-mood',
    'SCENE_RESTORE_FEATURE_ID=scene-restore',
    'TABLE_VIEWER_FEATURE_ID=table-viewer',
    'TOKEN_RINGS_FEATURE_ID=token-rings',
    'WHO_NOTICES_FEATURE_ID=who-notices',
  ]);
});

test('--risky-list prints every category and pattern and exits 0', () => {
  const lines = [];
  const code = runEntry({
    argv: ['--risky-list'],
    relaunch: () => assert.fail('must not relaunch'),
    runMain: () => assert.fail('must not run the gate'),
    log: l => lines.push(l),
  });
  assert.equal(code, 0);
  for (const c of RISKY_CATEGORIES) {
    assert.ok(lines.includes(`${c.name}:`), c.name);
    for (const p of c.patterns) assert.ok(lines.includes(`  ${p}`), p);
  }
  assert.ok(!lines.some(l => l.includes('the merge gate:')));
  assert.equal(
    runEntry({
      argv: ['--risky-list', '5'],
      relaunch: () => assert.fail(),
      runMain: () => assert.fail(),
      log: () => {},
    }),
    2
  );
  assert.deepEqual(
    riskyHits(['packages/discord-bot/announce/announce.mjs']).map(h => h.name),
    ['Pi scripts']
  );
});

test('globToRegExp: ** crosses folders, * does not', () => {
  assert.ok(globToRegExp('scripts/pi/**').test('scripts/pi/remote/x.sh'));
  assert.ok(!globToRegExp('scripts/pi/**').test('scripts/pix/x.sh'));
  assert.ok(globToRegExp('a/*.ts').test('a/b.ts'));
  assert.ok(!globToRegExp('a/*.ts').test('a/b/c.ts'));
  assert.ok(globToRegExp('**/x.ts').test('x.ts'));
  assert.ok(globToRegExp('a.b').test('a.b') && !globToRegExp('a.b').test('axb'));
});

test('merge train relevance: module, bridge link, guarded writes; tests and docs do not count', () => {
  assert.ok(TRAIN_PATTERNS.length > 0);
  assert.ok(isTrainRelevant(['packages/foundry-module/src/main.ts']));
  assert.ok(isTrainRelevant(['packages/mcp-server/src/foundry-connector.ts']));
  assert.ok(isTrainRelevant(['packages/mcp-server/src/guarded-write/service.ts']));
  assert.ok(!isTrainRelevant(['packages/foundry-module/src/write-gate.test.ts']));
  assert.ok(!isTrainRelevant(['scripts/pi/remote/5-tool.sh', 'docs/x.md']));
  assert.ok(!isTrainRelevant(['packages/cogm-dashboard/web/src/lib/guarded.ts']));
});

test('rollupProblems: check runs and commit statuses, failing, pending and missing', () => {
  const ok = rollupProblems(
    [
      { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { name: 'b', status: 'COMPLETED', conclusion: 'SKIPPED' },
      { name: 'c', status: 'COMPLETED', conclusion: 'NEUTRAL' },
      { context: 'ci/legacy', state: 'SUCCESS' },
    ],
    ['a', 'ci/legacy']
  );
  assert.deepEqual(ok, { failing: [], pending: [], missing: [] });
  const bad = rollupProblems(
    [
      { name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'b', status: 'IN_PROGRESS', conclusion: '' },
      { name: 'c', status: 'QUEUED' },
      { context: 'ci/legacy', state: 'PENDING' },
      { context: 'ci/other', state: 'FAILURE' },
      { name: 'd', status: 'COMPLETED', conclusion: 'CANCELLED' },
    ],
    ['a', 'never-ran']
  );
  assert.deepEqual(bad.failing, ['a (FAILURE)', 'ci/other (FAILURE)', 'd (CANCELLED)']);
  assert.deepEqual(bad.pending, ['b (IN_PROGRESS)', 'c (QUEUED)', 'ci/legacy (PENDING)']);
  assert.deepEqual(bad.missing, ['never-ran']);
});

test('rollupProblems: a newer run of the same check outvotes an old failure on the same head', () => {
  const old = {
    workflowName: 'CI',
    name: 'build-test (Node 22)',
    status: 'COMPLETED',
    conclusion: 'FAILURE',
    startedAt: '2026-10-31T07:56:17Z',
  };
  const fresh = { ...old, conclusion: 'SUCCESS', startedAt: '2026-10-31T09:24:42Z' };
  assert.deepEqual(rollupProblems([old, fresh]).failing, []);
  assert.deepEqual(rollupProblems([fresh, old]).failing, []);
  // a newer run that failed still fails, and one still queued (no startedAt) is pending
  assert.deepEqual(rollupProblems([fresh, { ...old, startedAt: '2026-10-31T10:00:00Z' }]).failing, [
    'build-test (Node 22) (FAILURE)',
  ]);
  const queued = {
    workflowName: 'CI',
    name: 'build-test (Node 22)',
    status: 'QUEUED',
    conclusion: '',
  };
  assert.deepEqual(rollupProblems([old, fresh, queued]).pending, ['build-test (Node 22) (QUEUED)']);
  // the same check name in another workflow is a different check
  const other = { ...old, workflowName: 'Other' };
  assert.deepEqual(rollupProblems([fresh, other]).failing, ['build-test (Node 22) (FAILURE)']);
  // commit statuses: newest per context
  assert.deepEqual(
    rollupProblems([
      { context: 'ci/legacy', state: 'FAILURE', startedAt: '2026-10-31T07:00:00Z' },
      { context: 'ci/legacy', state: 'SUCCESS', startedAt: '2026-10-31T08:00:00Z' },
    ]).failing,
    []
  );
});

test('latestChecks: unknown start times (Go zero time) rank by status, ties keep the worse', () => {
  const base = { workflowName: 'CI', name: 'build-test (Node 22)' };
  const ZERO = '0001-01-01T00:00:00Z';
  const DAY = '2026-10-31T09:00:00Z';
  const failed = {
    ...base,
    status: 'COMPLETED',
    conclusion: 'FAILURE',
    startedAt: '2026-10-31T07:56:17Z',
  };
  const passed = { ...failed, conclusion: 'SUCCESS' };
  const queued = { ...base, status: 'QUEUED', conclusion: '', startedAt: ZERO };
  const q = ['build-test (Node 22) (QUEUED)'];
  const f = ['build-test (Node 22) (FAILURE)'];
  // queued with the zero time is the newest, whatever the array order
  assert.deepEqual(rollupProblems([failed, queued]), { failing: [], pending: q, missing: [] });
  assert.deepEqual(rollupProblems([queued, failed]).pending, q);
  assert.deepEqual(rollupProblems([passed, queued]).pending, q);
  assert.deepEqual(rollupProblems([queued, passed]).pending, q);
  // equal start times keep the worse entry, in either order
  assert.deepEqual(rollupProblems([passed, failed]).failing, f);
  assert.deepEqual(rollupProblems([failed, passed]).failing, f);
  // a COMPLETED entry with the zero time is the oldest: a dated run replaces it
  const zeroFailed = { ...failed, startedAt: ZERO };
  assert.deepEqual(rollupProblems([zeroFailed, { ...passed, startedAt: DAY }]).failing, []);
  assert.deepEqual(rollupProblems([{ ...passed, startedAt: DAY }, zeroFailed]).failing, []);
  // two finished entries, both without a time: the failure stays
  assert.deepEqual(rollupProblems([{ ...passed, startedAt: ZERO }, zeroFailed]).failing, f);
});

test('rollupProblems: a cancelled check of a superseded run does not block the newer green run', () => {
  const url = id => `https://github.com/o/r/actions/runs/${id}/job/1`;
  const check = (id, name, conclusion, extra = {}) => ({
    workflowName: 'CI',
    name,
    status: 'COMPLETED',
    conclusion,
    startedAt: '2026-11-10T10:00:00Z',
    detailsUrl: url(id),
    ...extra,
  });
  const raw =
    "dashboard-visual (screenshots)${{ github.event_name == 'workflow_dispatch' && ' [dispatch]' || '' }}";
  const older = [check(100, raw, 'CANCELLED'), check(100, 'lint', 'CANCELLED')];
  const newer = [
    check(200, 'dashboard-visual (screenshots)', 'SUCCESS'),
    check(200, 'lint', 'SUCCESS'),
  ];
  assert.deepEqual(rollupProblems([...older, ...newer]).failing, []);
  assert.deepEqual(rollupProblems([...newer, ...older]).failing, []);
  // the unexpanded name shares a key with the expanded one even when the cancelled entry is the later start
  const late = check(100, raw, 'CANCELLED', { startedAt: '2026-11-10T10:05:00Z' });
  assert.deepEqual(rollupProblems([late, check(100, 'lint', 'CANCELLED'), ...newer]).failing, []);
  // nothing newer: the cancelled check still blocks
  assert.deepEqual(rollupProblems(older).failing, [raw + ' (CANCELLED)', 'lint (CANCELLED)']);
  // a newer run that is itself cancelled does not excuse an older failure, and a newer failure still fails
  assert.deepEqual(
    rollupProblems([check(100, 'lint', 'FAILURE'), check(200, 'lint', 'CANCELLED')]).failing,
    ['lint (CANCELLED)']
  );
  assert.deepEqual(rollupProblems([...older, ...newer, check(200, 'lint', 'FAILURE')]).failing, [
    'lint (FAILURE)',
  ]);
  // a newer run that has not reported that very check yet (the screenshot summary comes after its
  // shards) does not excuse the old cancelled one: no screenshot result must never pass
  assert.deepEqual(rollupProblems([...older, check(200, 'lint', 'SUCCESS')]).failing, [
    raw + ' (CANCELLED)',
  ]);
  // the newer run's same check, still running, replaces it and is reported as pending
  assert.deepEqual(
    rollupProblems([
      ...older,
      check(200, 'dashboard-visual (screenshots)', '', { status: 'IN_PROGRESS' }),
      check(200, 'lint', 'SUCCESS'),
    ]),
    { failing: [], pending: ['dashboard-visual (screenshots) (IN_PROGRESS)'], missing: [] }
  );
  // an older cancelled dispatch check still blocks next to a newer green pull_request run
  assert.deepEqual(
    rollupProblems([
      check(100, 'python-tests [dispatch]', 'CANCELLED'),
      check(100, 'lint [dispatch]', 'SUCCESS'),
      check(200, 'python-tests', 'SUCCESS'),
      check(200, 'lint', 'SUCCESS'),
    ]).failing,
    ['python-tests [dispatch] (CANCELLED)']
  );
  // a dispatch run whose only other check is a raw name does not supersede a cancelled pull_request check
  assert.deepEqual(
    rollupProblems([
      check(200, 'python-tests', 'CANCELLED'),
      check(300, 'lint [dispatch]', 'SUCCESS'),
      check(300, raw, 'CANCELLED'),
    ]).failing,
    ['python-tests (CANCELLED)', raw + ' (CANCELLED)']
  );
  // a raw cancelled dispatch check without a start time is not hidden by the pull_request run's green check
  assert.deepEqual(
    rollupProblems([
      check(300, 'lint [dispatch]', 'SUCCESS'),
      check(300, raw, 'CANCELLED', { startedAt: '0001-01-01T00:00:00Z' }),
      check(200, 'dashboard-visual (screenshots)', 'SUCCESS'),
      check(200, 'lint', 'SUCCESS'),
    ]).failing,
    [raw + ' (CANCELLED)']
  );
  // an unclassified older run (only raw cancelled names) may be a dispatch run: it keeps blocking
  const rawBuild =
    "build-test (Node 24)${{ github.event_name == 'workflow_dispatch' && ' [dispatch]' || '' }}";
  assert.deepEqual(
    rollupProblems([
      check(100, rawBuild, 'CANCELLED'),
      check(200, 'build-test (Node 24)', 'SUCCESS'),
      check(200, 'lint', 'SUCCESS'),
    ]).failing,
    [rawBuild + ' (CANCELLED)']
  );
  // a mixed run (one expanded job with [dispatch], one without) is not purely normal: its cancelled
  // check keeps blocking next to a newer green pull_request run
  assert.deepEqual(
    rollupProblems([
      check(100, 'lint [dispatch]', 'SUCCESS'),
      check(100, 'python-tests', 'SUCCESS'),
      check(100, 'build-test', 'CANCELLED'),
      check(200, 'build-test', 'SUCCESS'),
    ]).failing,
    ['build-test (CANCELLED)']
  );
  // a raw name that starts with the expression has no text to match and keeps blocking
  assert.deepEqual(
    rollupProblems([
      check(100, '${{ x }}', 'CANCELLED'),
      check(100, 'lint', 'CANCELLED'),
      check(200, 'lint', 'SUCCESS'),
    ]).failing,
    ['${{ x }} (CANCELLED)']
  );
  // a raw matrix name is replaced by a newer run's expanded leg of the same job
  const rawShard = 'dashboard-visual shard ${{ matrix.shard }}/4${{ x }}';
  assert.deepEqual(
    rollupProblems([
      check(100, rawShard, 'CANCELLED'),
      check(100, 'lint', 'CANCELLED'),
      check(200, 'dashboard-visual shard 1/4', 'SUCCESS'),
      check(200, 'lint', 'SUCCESS'),
    ]).failing,
    []
  );
  // a matrix leg skipped by `if:` in the newer run (raw name, SKIPPED) clears the older raw shard check
  assert.deepEqual(
    rollupProblems([
      check(100, rawShard, 'CANCELLED'),
      check(100, 'lint', 'CANCELLED'),
      check(200, rawShard, 'SKIPPED'),
      check(200, 'lint', 'SUCCESS'),
    ]).failing,
    []
  );
  // only a run of the same check supersedes: a newer dispatch run leaves the cancelled pull_request check blocking
  const dispatch = check(300, 'lint [dispatch]', 'SUCCESS');
  assert.deepEqual(rollupProblems([check(100, 'lint', 'CANCELLED'), dispatch]).failing, [
    'lint (CANCELLED)',
  ]);
  // another workflow's newer run supersedes nothing here
  assert.deepEqual(
    rollupProblems([
      check(100, 'lint', 'CANCELLED'),
      check(900, 'x', 'SUCCESS', { workflowName: 'Other' }),
    ]).failing,
    ['lint (CANCELLED)']
  );
  // no run id: unchanged behaviour
  assert.deepEqual(
    rollupProblems([
      { workflowName: 'CI', name: 'a', status: 'COMPLETED', conclusion: 'CANCELLED' },
      ...newer,
    ]).failing,
    ['a (CANCELLED)']
  );
});

test('requiredContexts: reads the ruleset answer, nothing else counts', () => {
  assert.deepEqual(requiredContexts(JSON.stringify(RULES)), ['build-test']);
  assert.equal(requiredContexts('not json'), null);
  assert.equal(requiredContexts('{"message":"Not Found"}'), null);
  assert.equal(requiredContexts('[{"type":"pull_request"}]'), null);
  assert.equal(requiredContexts('[]'), null);
});

test('hasChangelogFragment: added or changed fragments only', () => {
  assert.ok(hasChangelogFragment([{ path: 'changelog.d/x.md' }]));
  assert.ok(!hasChangelogFragment([{ path: 'changelog.d/README.md' }]));
  assert.ok(!hasChangelogFragment([{ path: 'CHANGELOG.md' }, { path: 'docs/changelog.d/x.md' }]));
  assert.ok(!hasChangelogFragment([{ path: 'changelog.d/x.md', changeType: 'DELETED' }]));
});

test('liveCheckProblem: Module and Pi PRs need a Live check line in the description', () => {
  const mod = [{ path: 'packages/foundry-module/src/main.ts' }];
  const pi = [{ path: 'scripts/pi/remote/stage.sh' }];
  assert.match(liveCheckProblem(mod, 'Backlog: x') ?? '', /Module code .*test server A/);
  assert.match(liveCheckProblem(pi, '') ?? '', /Pi code .*ARM64.*deployed-state\.ps1/);
  assert.match(liveCheckProblem([...mod, ...pi], '') ?? '', /Module code .* and Pi code/);
  assert.equal(
    liveCheckProblem(mod, 'Live check: server A, real dnd5e actors, roundtrip ok'),
    null
  );
  assert.equal(liveCheckProblem(pi, 'text\r\n- **Live check:** none, comment-only change'), null);
  assert.equal(liveCheckProblem(mod, undefined), liveCheckProblem(mod, ''));
  // Empty, placeholder and mid-sentence mentions do not count.
  for (const body of [
    'Live check:',
    'Live check: <fill in>',
    'Live check: <!-- run -->',
    'Live check: <!-- unclosed\nmore -->',
    'we had no live check: here',
  ]) {
    assert.ok(liveCheckProblem(mod, body), body);
  }
  // Other paths and test files need nothing.
  assert.equal(
    liveCheckProblem([{ path: 'docs/a.md' }, { path: 'scripts/pi/local.ps1' }], ''),
    null
  );
  assert.equal(liveCheckProblem([{ path: 'packages/foundry-module/src/a.test.ts' }], ''), null);
  assert.equal(liveCheckLine('x\nLive check: ok then'), 'ok then');
});

test('parseNameStatus: NUL separated, non-ASCII paths unquoted, renames list both sides', () => {
  const nul = String.fromCharCode(0);
  const z = (...parts) => parts.join(nul) + nul;
  assert.deepEqual(
    parseNameStatus(z('A', 'a.md', 'M', 'b.ts', 'D', 'c.ts', 'R100', 'old', 'new')),
    [
      { path: 'a.md', changeType: 'ADDED' },
      { path: 'b.ts', changeType: 'MODIFIED' },
      { path: 'c.ts', changeType: 'DELETED' },
      { path: 'old', changeType: 'CHANGED' },
      { path: 'new', changeType: 'CHANGED' },
    ]
  );
  assert.deepEqual(parseNameStatus(z('M', 'docs/skål/æ.md')), [
    { path: 'docs/skål/æ.md', changeType: 'MODIFIED' },
  ]);
  assert.deepEqual(parseNameStatus(''), []);
});

test('L2: git is asked for NUL separated output, and a non-ASCII path is matched as it is', () => {
  const r = gate({
    files: ['packages/foundry-module/src/write-gate.ts', 'docs/skål.md', 'changelog.d/x.md'],
  });
  assert.match(r.text, /risky \(the write gate\)/);
  assert.ok(r.calls.some(c => c.join(' ').startsWith('git diff -z --no-color --name-status')));
});

test('L1: the local file list is used only when HEAD is the PR head', () => {
  const r = gate({
    localHead: OTHER,
    files: ['packages/foundry-module/src/write-gate.ts', 'changelog.d/x.md'],
    ghFiles: ['docs/guide.md', 'changelog.d/x.md'],
  });
  assert.equal(r.code, 1);
  assert.ok(!r.calls.some(c => c[0] === 'git' && ['diff', 'merge-base', 'fetch'].includes(c[1])));
  assert.match(r.text, /local: this checkout is at fffffff, the PR head is 3d24f70/);
  assert.doesNotMatch(
    r.text,
    /risky \(the write gate\)/,
    "the other branch's files are not judged"
  );
  assert.doesNotMatch(r.text, /files: cannot list/);
});

test('parseArgs', () => {
  const a = parseArgs(['312', '--dry-run', '--no-changelog', 'docs only', '--vault', 'V']);
  assert.deepEqual(
    [a.pr, a.dryRun, a.noChangelog, a.vault, a.error],
    [312, true, 'docs only', 'V', null]
  );
  assert.match(parseArgs([]).error, /usage/);
  assert.match(parseArgs(['312', '--no-changelog']).error, /needs a value/);
  assert.match(parseArgs(['abc']).error, /unexpected argument abc/);
  assert.equal(parseArgs(['--train']).error, null);
  assert.equal(parseArgs(['--train-reset', 'abcdef1']).trainReset, 'abcdef1');
});

const MODULE_FILES = ['packages/foundry-module/src/main.ts', 'changelog.d/thing.md'];
const trainOf = k => ({
  lastRoundtrip: { sha: 'abc1234', at: '2026-10-09T00:00:00Z' },
  since: Array.from({ length: k }, (_, i) => ({
    pr: 300 + i,
    sha: `sha${i}aaaa`,
    at: '2026-10-10T00:00:00Z',
  })),
});

test('dry run: all checks pass, prints the OK line, never calls gh pr merge or writes the train', () => {
  const r = gate({ argv: ['--dry-run'], files: MODULE_FILES });
  assert.equal(r.code, 0, r.text);
  assert.equal(
    r.lines.at(-1),
    'lane:merge: OK #312 at 3d24f70 (dry run, nothing merged); merge train 0/4'
  );
  assert.ok(!r.merged);
  assert.ok(!fs.existsSync(r.state));
  assert.ok(!fs.existsSync(`${r.state}.lock`));
  assert.ok(r.calls.some(c => isDriftCall(c[0], c.slice(1))));
  assert.ok(
    !r.calls.some(c => c.join(' ') === 'npm run drift:check'),
    'main copy, not the local script'
  );
});

test('gate: a Module PR without a Live check line is refused like a missing changelog', () => {
  const r = gate({ argv: ['--dry-run'], files: MODULE_FILES, body: 'no line here' });
  assert.equal(r.code, 1, r.text);
  assert.match(r.text, /live check: the PR touches Module code/);
  assert.ok(!r.merged);
});

test('merge: calls gh pr merge with the head commit and prints the merged line', () => {
  const r = gate({});
  assert.equal(r.code, 0, r.text);
  assert.equal(r.lines.at(-1), 'lane:merge: merged #312 at 3d24f70; merge train 0/4');
  const merge = r.calls.find(c => c[0] === 'gh' && c[2] === 'merge');
  assert.deepEqual(merge, ['gh', 'pr', 'merge', '312', '--merge', '--match-head-commit', HEAD]);
  assert.ok(!fs.existsSync(r.state), 'a PR outside the module does not join the train');
});

test('merge: gh pr merge failing is reported and exits 1', () => {
  const r = gate({ merge: 1 });
  assert.equal(r.code, 1);
  assert.equal(r.lines[0], 'lane:merge: NOT merged #312');
  assert.match(r.lines[1], /^merge: gh pr merge exited 1: not allowed/);
});

test('everything is checked before the merge: several failures, one line each, nothing merged', () => {
  const r = gate({
    vault: vaultWith([]),
    files: ['docs/guide.md'],
    rollup: [
      { name: 'build-test', status: 'COMPLETED', conclusion: 'FAILURE' },
      { name: 'python-tests', status: 'IN_PROGRESS' },
    ],
    pr: { isDraft: true, mergeable: 'CONFLICTING', baseRefName: 'dev' },
    localHead: OTHER,
    dirty: true,
  });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.equal(r.lines[0], 'lane:merge: NOT merged #312');
  assert.match(r.text, /pr: #312 is a draft/);
  assert.match(r.text, /pr: base is dev, not main/);
  assert.match(r.text, /pr: mergeable is CONFLICTING/);
  assert.match(
    r.text,
    /ci: failing: build-test \(FAILURE\); pending: python-tests \(IN_PROGRESS\)/
  );
  assert.match(r.text, /review: no review note for head 3d24f70/);
  assert.match(r.text, /changelog: no added or changed/);
  assert.match(
    r.text,
    /local: this checkout is at ffffff[f]?, the PR head is 3d24f70; check out claude\/thing/
  );
  assert.match(r.text, /local: the working tree is not clean \(2 changes\)/);
  assert.ok(
    !r.calls.some(c => c[0] === 'node' || c[0] === 'npm'),
    'drift waits for the cheap checks'
  );
});

test('no checks reported at all fails the CI check', () => {
  assert.match(gate({ rollup: [] }).text, /ci: no checks reported/);
});

test('L3: a check the ruleset requires must be in the rollup, and an unreadable ruleset refuses', () => {
  const rules = [
    {
      type: 'required_status_checks',
      parameters: {
        required_status_checks: [{ context: 'build-test' }, { context: 'python-tests' }],
      },
    },
  ];
  const missing = gate({ rules });
  assert.equal(missing.code, 1);
  assert.match(missing.text, /ci: required but not reported: python-tests/);
  assert.ok(!missing.merged);
  const failed = gate({ rulesFail: true });
  assert.equal(failed.code, 1);
  assert.match(
    failed.text,
    /ci: cannot read the required checks from the branch ruleset \(gh api failed: HTTP 403\)/
  );
  assert.match(gate({ rules: [] }).text, /ci: the branch ruleset lists no required status checks/);
  const api = failed.calls.find(c => c[0] === 'gh' && c[1] === 'api');
  assert.equal(api[2], 'repos/Gnuminator/Foundry-VTT-MCP-Ai-Tool/rules/branches/main');
});

test('review: Merge after fixes, a stale head, a short sha and the wrong PR number do not count', () => {
  const stale = vaultWith([
    { name: '312-review.md', text: note({ head: OTHER }) },
    { name: '3120-review.md', text: note() },
  ]);
  assert.match(gate({ vault: stale }).text, /review: no review note for head 3d24f70/);
  const fixes = vaultWith([
    { name: '312-review.md', text: note({ verdict: '**Merge after fixes.**' }) },
  ]);
  assert.match(gate({ vault: fixes }).text, /review: 312-review.md says "Merge after fixes."/);
  const short = vaultWith([{ name: '312-review.md', text: note({ head: HEAD.slice(0, 8) }) }]);
  assert.match(gate({ vault: short }).text, /needs the full 40-character sha/);
  assert.match(
    gate({ vault: path.join(os.tmpdir(), 'no-such-vault-xyz') }).text,
    /review: vault not found/
  );
});

test('H2: a Do not merge note vetoes a Merge note for the same head', () => {
  const vault = vaultWith([
    { name: '312-review.md', text: note() },
    { name: '312-opus-review.md', text: note({ verdict: '**Do not merge.** Broken.' }) },
  ]);
  const r = gate({ vault });
  assert.equal(r.code, 1);
  assert.match(r.text, /review: 312-opus-review.md says "Do not merge."/);
  assert.ok(!r.merged);
});

test('risky files need an Opus review, and the category is printed', () => {
  const files = ['packages/foundry-module/src/write-gate.ts', 'changelog.d/thing.md'];
  const sonnet = gate({ files });
  assert.equal(sonnet.code, 1);
  assert.match(
    sonnet.text,
    /risky \(the write gate\): packages\/foundry-module\/src\/write-gate.ts/
  );
  assert.match(sonnet.text, /needs an Opus review/);
  const opusVault = vaultWith([{ name: '312-opus-review.md', text: note() }]);
  const opus = gate({ files, vault: opusVault, argv: ['--dry-run'] });
  assert.equal(opus.code, 0, opus.text);
  assert.ok(opus.lines.some(l => l.includes('risky (the write gate)')));
  const headingVault = vaultWith([
    { name: '312-review.md', text: note({ title: 'PR #312 Opus review' }) },
  ]);
  assert.equal(gate({ files, vault: headingVault, argv: ['--dry-run'] }).code, 0);
  const mention = vaultWith([
    {
      name: '312-review.md',
      text: note({ title: 'PR #312 Sonnet review (Opus review still to come)' }),
    },
  ]);
  assert.equal(
    gate({ files, vault: mention }).code,
    1,
    'a heading that only mentions Opus is not Opus'
  );
});

test('H1: edits to the gate, CI and hooks take a Sonnet note; security hooks and contracts need Opus', () => {
  for (const file of [
    'scripts/lane-merge.mjs',
    'scripts/drift-check.mjs',
    '.claude/hooks/context-alert.mjs',
    '.claude/settings.json',
    '.github/workflows/ci.yml',
  ]) {
    const r = gate({ files: [file, 'changelog.d/x.md'] });
    assert.ok(!/needs an Opus review/.test(r.text), file);
  }
  for (const file of ['.claude/hooks/guard-shell-edits.mjs', 'shared/src/protocol.ts']) {
    const r = gate({ files: [file, 'changelog.d/x.md'] });
    assert.equal(r.code, 1, file);
    assert.match(r.text, /needs an Opus review/, file);
  }
});

test('H3: the changed files come from git, so a risky file past gh 100-file cap is seen', () => {
  const calm = Array.from(
    { length: 100 },
    (_, i) => `docs/img/shot-${String(i).padStart(3, '0')}.png`
  );
  const local = [...calm, 'packages/mcp-server/src/guarded-write/service.ts', 'changelog.d/x.md'];
  const r = gate({ files: local, ghFiles: calm });
  assert.equal(r.code, 1);
  assert.match(
    r.text,
    /risky \(guarded writes\): packages\/mcp-server\/src\/guarded-write\/service.ts/
  );
  assert.match(r.text, /needs an Opus review/);
  const diff = r.calls.find(c => c[0] === 'git' && c[1] === 'diff');
  assert.deepEqual(diff, [
    'git',
    'diff',
    '-z',
    '--no-color',
    '--name-status',
    '--no-renames',
    'basesha',
    'HEAD',
  ]);
  assert.ok(r.calls.some(c => c.join(' ') === 'git merge-base aitool/main HEAD'));
  // It counts for the merge train, too.
  const train = gate({ files: local, ghFiles: calm, train: trainOf(4) });
  assert.match(train.text, /train: merge train full \(4\/4\)/);
});

test('H3: gh files stay a cross-check (a path only gh lists is still judged)', () => {
  const r = gate({
    files: ['docs/a.md', 'changelog.d/x.md'],
    ghFiles: ['docs/a.md', 'changelog.d/x.md', 'packages/foundry-module/src/write-gate.ts'],
  });
  assert.match(r.text, /risky \(the write gate\)/);
});

test('H3: a failing git fetch or diff refuses instead of judging a partial list', () => {
  const r = gate({ fetchFail: true });
  assert.equal(r.code, 1);
  assert.match(
    r.text,
    /files: cannot list what the PR changes locally: git fetch aitool main failed: no network/
  );
  assert.ok(!r.merged);
});

test('changelog: required unless --no-changelog gives a reason, which is printed', () => {
  const files = ['docs/guide.md'];
  const without = gate({ files });
  assert.equal(without.code, 1);
  assert.match(without.text, /changelog:/);
  const waived = gate({ files, argv: ['--no-changelog', 'docs typo only'] });
  assert.equal(waived.code, 0, waived.text);
  assert.match(
    waived.lines.at(-1),
    /merged #312 at 3d24f70; merge train 0\/4; no changelog: docs typo only/
  );
});

test('drift-check failing is reported with the last 30 lines of its output', () => {
  const r = gate({ drift: 1 });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(r.text, /drift: drift-check failed \(guards: bundle budget\) \(log /);
  assert.ok(r.lines.includes('guard failed'));
});

test("H1: drift-check runs from a temp copy of main's script, not the branch's npm script, under one high-priority hold of main's lock", () => {
  const r = gate({});
  const node = r.calls.find(c => c[0] === 'node');
  assert.match(node[1], /lane-merge-drift-.*heavy-lock\.mjs$/);
  assert.equal(fs.readFileSync(node[1], 'utf8'), FAKE_LOCK_SOURCE, "main's copy of the lock");
  assert.deepEqual(node.slice(2, 9), [
    'run',
    '--label',
    'drift-check (merge gate)',
    '--priority',
    'high',
    '--',
    'node',
  ]);
  assert.equal(node.length, 10);
  const runner = node[9].replace(/^"|"$/g, '');
  assert.equal(node[9], `"${runner}"`, 'the runner path is quoted for the shell');
  assert.deepEqual(r.progress, [
    'lane:merge: drift-check runs now; it may first wait for the heavy-check lock (node scripts/heavy-lock.mjs status shows who holds it)',
  ]);
  assert.ok(!r.lines.some(l => l.includes('drift-check runs now')), 'not among the verdict lines');
  const source = fs.readFileSync(runner, 'utf8');
  assert.match(source, /runDriftCheck/);
  const url = /import\("([^"]+)"\)/.exec(source)?.[1] ?? '';
  assert.match(url, /^file:\/\/\/.*lane-merge-drift-.*drift-check\.mjs$/);
  assert.equal(fs.readFileSync(fileURLToPath(url), 'utf8'), FAKE_DRIFT_SOURCE);
});

test('H1: without a usable heavy-lock on main the drift run goes bare, with a note', () => {
  for (const lockSource of [null, `import { x } from './other.mjs';\n`]) {
    const r = gate({ lockSource });
    const node = r.calls.find(c => c[0] === 'node');
    assert.deepEqual(node.slice(1, 3), ['--input-type=module', '-e']);
    assert.match(node[3], /runDriftCheck/);
    assert.match(node[4], /^file:\/\/\/.*lane-merge-drift-.*drift-check\.mjs$/);
    assert.equal(fs.readFileSync(fileURLToPath(node[4]), 'utf8'), FAKE_DRIFT_SOURCE);
    assert.match(
      r.text,
      /no usable scripts\/heavy-lock\.mjs on aitool\/main; each heavy guard takes the lock on its own/
    );
  }
});

test('H1: without a drift-check on main, or with relative imports, the local script runs and a note says so', () => {
  const none = gate({ driftSource: null, argv: ['--dry-run'] });
  assert.equal(none.code, 0, none.text);
  assert.ok(none.calls.some(c => c.join(' ') === 'npm run drift:check'));
  assert.match(
    none.text,
    /has no scripts\/drift-check.mjs yet; using this checkout's npm run drift:check/
  );
  const rel = gate({
    driftSource: `import { x } from './other.mjs';\nexport function runDriftCheck() {}\n`,
  });
  assert.ok(rel.calls.some(c => c.join(' ') === 'npm run drift:check'));
  assert.match(rel.text, /imports other repo files/);
});

test('the real scripts/drift-check.mjs has no relative imports and still exports runDriftCheck', () => {
  const text = fs.readFileSync(path.join(REPO_ROOT, 'scripts', 'drift-check.mjs'), 'utf8');
  assert.equal(hasRelativeImports(text), false, 'the gate runs a copy of it away from the repo');
  assert.match(text, /export function runDriftCheck\b/);
});

test('hasRelativeImports', () => {
  assert.ok(hasRelativeImports(`import a from './a.mjs';`));
  assert.ok(hasRelativeImports(`export { b } from '../b.mjs';`));
  assert.ok(hasRelativeImports(`const m = await import('./c.mjs');`));
  assert.ok(!hasRelativeImports(`import fs from 'node:fs';\nimport { x } from "node:url";\n`));
});

test('merge train full: a train-relevant PR is refused with the planner instruction, nothing merged', () => {
  const r = gate({ files: MODULE_FILES, train: trainOf(TRAIN_SIZE) });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(
    r.text,
    /train: merge train full \(4\/4\): the planner runs npm run live:roundtrip on main, then npm run lane:merge -- --train-reset <sha>/
  );
  const calm = gate({ train: trainOf(TRAIN_SIZE) });
  assert.equal(calm.code, 0, 'a PR outside the module is not held by a full train');
  assert.match(calm.lines.at(-1), /merge train 4\/4$/);
});

test('merge train: a merged module PR is appended, and the third one asks for a roundtrip', () => {
  const first = gate({ files: MODULE_FILES, train: trainOf(1) });
  assert.equal(first.code, 0, first.text);
  assert.equal(first.lines.at(-1), 'lane:merge: merged #312 at 3d24f70; merge train 2/4');
  const saved = readTrain(first.state);
  assert.deepEqual(saved.since.at(-1), { pr: 312, sha: HEAD, at: '2026-10-10T12:00:00.000Z' });
  assert.equal(saved.lastRoundtrip.sha, 'abc1234');
  assert.ok(!fs.existsSync(`${first.state}.lock`), 'the lock is released');
  const third = gate({ files: MODULE_FILES, train: trainOf(2) });
  assert.equal(
    third.lines.at(-1),
    'lane:merge: merged #312 at 3d24f70; merge train 3/4; run live:roundtrip before the next module merge'
  );
});

test('a merge posts the number and title to #pr-log; a dry run and a refusal post nothing', () => {
  /** @type {Array<[number, string]>} */
  const posts = [];
  const announce = (n, title) => (posts.push([n, title]), '');
  const merged = gate({ announce });
  assert.equal(merged.code, 0, merged.text);
  assert.deepEqual(posts, [[312, 'A thing']]);
  assert.equal(gate({ announce, argv: ['--dry-run'] }).code, 0);
  assert.equal(gate({ announce, merge: 1 }).code, 1);
  assert.equal(posts.length, 1);
});

test('a failing or throwing Discord post is a warning and never changes the exit code', () => {
  const warned = gate({ announce: () => 'Discord post for #312 failed (offline)' });
  assert.equal(warned.code, 0);
  assert.ok(warned.lines.some(l => l.includes('merged #312')));
  assert.equal(warned.lines.at(-1), 'lane:merge: WARNING Discord post for #312 failed (offline)');
  const thrown = gate({
    announce: () => {
      throw new Error('boom');
    },
  });
  assert.equal(thrown.code, 0);
  assert.equal(thrown.lines.at(-1), 'lane:merge: WARNING Discord post failed (boom)');
});

test('the sender comes from main only; the checkout copy is never run (and a missing one posts nothing)', () => {
  const rel = 'packages/discord-bot/announce/announce.mjs';
  const repo = tmpDir();
  const git = (...a) => execFileSync('git', ['-C', repo, ...a], { encoding: 'utf8' });
  git('init', '-q');
  assert.equal(announceSource(repo), null, 'nothing anywhere');
  assert.equal(defaultAnnounce(1, 't', repo), '');
  fs.mkdirSync(path.join(repo, path.dirname(rel)), { recursive: true });
  fs.writeFileSync(path.join(repo, rel), '// checkout copy');
  assert.equal(announceSource(repo), null, 'the checkout copy alone is not used');
  assert.equal(defaultAnnounce(1, 't', repo), '');
  git('add', '.');
  git('-c', 'user.name=t', '-c', 'user.email=t@t', 'commit', '-qm', 'x');
  fs.writeFileSync(path.join(repo, rel), '// branch copy');
  git('update-ref', 'refs/remotes/aitool/main', 'HEAD');
  const main = announceSource(repo);
  assert.ok(main && main.file !== path.join(repo, rel), 'main wins over the branch copy');
  assert.equal(fs.readFileSync(main.file, 'utf8').trim(), '// checkout copy');
  main.cleanup();
  assert.ok(!fs.existsSync(main.file), 'the temp copy is removed');
});

test('a dry run does not touch the train even for a module PR', () => {
  const r = gate({ files: MODULE_FILES, train: trainOf(1), argv: ['--dry-run'] });
  assert.equal(r.code, 0, r.text);
  assert.equal(readTrain(r.state).since.length, 1);
  assert.ok(!r.merged);
});

test('M2: the train is read again under the lock; a lane that filled it meanwhile wins', () => {
  const r = gate({
    files: MODULE_FILES,
    train: trainOf(3),
    onDrift: state => fs.writeFileSync(state, JSON.stringify(trainOf(4))),
  });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(r.text, /train: merge train full \(4\/4\)/);
  assert.ok(!fs.existsSync(`${r.state}.lock`), 'the lock is released on a refusal too');
});

test('M2: a fresh lock held by another lane refuses, a stale one is taken over', () => {
  const state = path.join(tmpDir(), 'merge-train.json');
  fs.writeFileSync(`${state}.lock`, '{}');
  const busy = acquireLockSafely(state, { timeoutMs: 50, wait: () => {} });
  assert.match(busy, /another lane:merge holds/);
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(`${state}.lock`, old, old);
  const release = acquireLock(state, { timeoutMs: 50 });
  assert.ok(fs.existsSync(`${state}.lock`));
  release();
  assert.ok(!fs.existsSync(`${state}.lock`));
});

test('M2 (#314 L4): two runs that both saw the same stale lock do not both get in', () => {
  const dir = tmpDir();
  const state = path.join(dir, 'merge-train.json');
  const lock = `${state}.lock`;
  fs.writeFileSync(lock, '{"pid":1,"at":"killed run"}');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  let releaseA = null;
  let contentA = '';
  let fired = false;
  // Run B has seen the stale lock; before B takes it over, run A takes it over and creates its own.
  const errorB = acquireLockSafely(state, {
    timeoutMs: 50,
    wait: () => {},
    afterStaleSeen: () => {
      if (fired) return;
      fired = true;
      releaseA = acquireLock(state, { timeoutMs: 50 });
      contentA = fs.readFileSync(lock, 'utf8');
    },
  });
  assert.ok(releaseA, 'run A got the lock');
  assert.match(errorB, /another lane:merge holds/, 'run B must not also get in');
  assert.equal(fs.readFileSync(lock, 'utf8'), contentA, "run A's lock is still the one in place");
  assert.deepEqual(
    fs.readdirSync(dir).filter(n => n.includes('.stale-')),
    [],
    'no renamed stale locks are left behind'
  );
  releaseA();
  assert.ok(!fs.existsSync(lock));
});

test('M2 (#314 L4): a taken-over stale lock leaves no renamed file behind', () => {
  const dir = tmpDir();
  const state = path.join(dir, 'merge-train.json');
  fs.writeFileSync(`${state}.lock`, '{}');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(`${state}.lock`, old, old);
  const release = acquireLock(state, { timeoutMs: 50 });
  assert.deepEqual(fs.readdirSync(dir), ['merge-train.json.lock']);
  release();
  assert.deepEqual(fs.readdirSync(dir), []);
});

/** The error message of acquireLock, or '' when it got the lock. */
function acquireLockSafely(file, opts) {
  try {
    acquireLock(file, opts)();
    return '';
  } catch (e) {
    return e.message;
  }
}

test('M2: a gate run meets a busy lock after all checks and refuses without merging', () => {
  const home = tmpDir();
  const state = path.join(home, 'merge-train.json');
  fs.writeFileSync(`${state}.lock`, '{}');
  const lines = [];
  const code = main({
    argv: [
      '312',
      '--vault',
      vaultWith([{ name: '312-review.md', text: note() }]),
      '--state',
      state,
    ],
    run: gateRun(),
    log: l => lines.push(l),
    home,
    tmpdir: home,
    lockTimeoutMs: 50,
    fetched: true,
  });
  assert.equal(code, 1);
  assert.match(lines.join('\n'), /train: another lane:merge holds/);
});

/** A passing fake run for a module PR (a smaller copy of gate() for tests that call main directly). */
function gateRun() {
  const pr = {
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'claude/thing',
    headRefOid: HEAD,
    mergeable: 'MERGEABLE',
    body: 'Live check: test server A, real dnd5e data',
    files: MODULE_FILES.map(p => ({ path: p })),
    statusCheckRollup: [{ name: 'build-test', status: 'COMPLETED', conclusion: 'SUCCESS' }],
  };
  const ok = stdout => ({ status: 0, stdout, stderr: '' });
  return (cmd, args) => {
    const key = `${cmd} ${args.slice(0, 2).join(' ')}`;
    if (key === 'gh pr view') return ok(JSON.stringify(pr));
    if (cmd === 'gh' && args[0] === 'api') return ok(JSON.stringify(RULES));
    if (key === 'git merge-base aitool/main') return ok('basesha\n');
    if (key === 'git diff -z') {
      const nul = String.fromCharCode(0);
      return ok(
        `M${nul}packages/foundry-module/src/main.ts${nul}A${nul}changelog.d/thing.md${nul}`
      );
    }
    if (key === 'git rev-parse HEAD') return ok(`${HEAD}\n`);
    if (key === 'git status --porcelain') return ok('');
    if (key === 'git show aitool/main:scripts/drift-check.mjs') return ok(FAKE_DRIFT_SOURCE);
    if (cmd === 'node') return ok('');
    return { status: 1, stdout: '', stderr: `unexpected ${key}` };
  };
}

test('M2: a malformed train file refuses instead of reading as an empty train', () => {
  for (const bad of [
    '{"since": "oops"}',
    'not json',
    '[]',
    '{"since": [], "lastRoundtrip": "x"}',
  ]) {
    const home = tmpDir();
    const state = path.join(home, 'merge-train.json');
    fs.writeFileSync(state, bad);
    assert.throws(
      () => readTrain(state),
      /train file unreadable .*fix it or run npm run lane:merge -- --train-reset/
    );
    const lines = [];
    const code = main({ argv: ['--train', '--state', state], log: l => lines.push(l), home });
    assert.equal(code, 1);
    assert.match(lines[0], /train file unreadable/);
  }
  const r = gate({ train: { since: 'oops' }, argv: ['--dry-run'] });
  assert.equal(r.code, 1);
  assert.match(r.text, /train: train file unreadable/);
});

const TIP = 'ab12cd34'.repeat(5);

/** A fake run for the train commands: fetch and rev-parse aitool/main. */
function trainRun({ fetchFail = false, tip = TIP } = {}) {
  return (cmd, args) => {
    const key = `${cmd} ${args.join(' ')}`;
    if (key === 'git fetch aitool main') {
      return fetchFail
        ? { status: 1, stdout: '', stderr: 'offline' }
        : { status: 0, stdout: '', stderr: '' };
    }
    if (key === 'git rev-parse aitool/main') return { status: 0, stdout: `${tip}\n`, stderr: '' };
    return { status: 1, stdout: '', stderr: `unexpected ${key}` };
  };
}

test('merge train: --train-reset records the roundtrip and empties the train, --train prints it', () => {
  const home = tmpDir();
  const state = path.join(home, 'merge-train.json');
  fs.writeFileSync(state, JSON.stringify(trainOf(4)));
  const lines = [];
  const opts = {
    home,
    run: trainRun(),
    log: l => lines.push(l),
    now: () => new Date('2026-10-10T13:00:00Z'),
  };
  assert.equal(main({ ...opts, argv: ['--train', '--state', state] }), 0);
  assert.match(lines[0], /merge train 4\/4; last live:roundtrip at abc1234.*#300@sha0aaa/);
  assert.equal(main({ ...opts, argv: ['--train-reset', TIP.slice(0, 10), '--state', state] }), 0);
  assert.equal(lines[1], 'lane:merge: merge train reset at ab12cd3; merge train 0/4');
  assert.deepEqual(readTrain(state), {
    lastRoundtrip: { sha: TIP, at: '2026-10-10T13:00:00.000Z' },
    since: [],
  });
  assert.ok(!fs.existsSync(`${state}.lock`));
  assert.equal(main({ ...opts, argv: ['--train-reset', 'nothex', '--state', state] }), 2);
  const fresh = path.join(home, 'sub', 'train.json');
  assert.equal(main({ ...opts, argv: ['--train', '--state', fresh] }), 0);
  assert.match(lines.at(-1), /merge train 0\/4; no live:roundtrip recorded; merged since: none/);
});

test('L5: --train-reset refuses a sha that is not the tip of aitool/main, and writes nothing', () => {
  const home = tmpDir();
  const state = path.join(home, 'merge-train.json');
  fs.writeFileSync(state, JSON.stringify(trainOf(4)));
  const lines = [];
  const opts = {
    home,
    log: l => lines.push(l),
    argv: ['--train-reset', 'abcdef1234', '--state', state],
  };
  assert.equal(main({ ...opts, run: trainRun() }), 1);
  assert.match(lines[0], /train not reset: abcdef1 is not the tip of aitool\/main \(ab12cd3\)/);
  assert.equal(readTrain(state).since.length, 4);
  assert.equal(main({ ...opts, run: trainRun({ fetchFail: true }) }), 1);
  assert.match(lines[1], /train not reset: git fetch aitool main failed \(offline\)/);
  assert.equal(readTrain(state).since.length, 4);
  // A malformed file does not block the reset: that is what the reset is for.
  fs.writeFileSync(state, '{"since": "oops"}');
  assert.equal(
    main({ ...opts, argv: ['--train-reset', TIP, '--state', state], run: trainRun() }),
    0
  );
  assert.equal(readTrain(state).since.length, 0);
});

test('gh pr view failing ends the run with one line', () => {
  const lines = [];
  const code = main({
    argv: ['312'],
    run: () => ({ status: 1, stdout: '', stderr: 'could not resolve to a PullRequest\nmore' }),
    log: l => lines.push(l),
    home: tmpDir(),
  });
  assert.equal(code, 1);
  assert.deepEqual(lines, [
    'lane:merge: NOT merged #312',
    'pr: gh pr view 312 failed: could not resolve to a PullRequest',
    'lane:merge: refused because pr: gh pr view 312 failed: could not resolve to a PullRequest',
  ]);
});

test('lane-merge split: the entry file stays small and every gate module is a file of its own', () => {
  const entry = fs.readFileSync(SELF, 'utf8').replace(/\r\n/g, '\n').split('\n');
  const count = entry.length - (entry.at(-1) === '' ? 1 : 0);
  assert.ok(
    count <= 110,
    `scripts/lane-merge.mjs has ${count} lines (ceiling 110): new gate code goes into a file in scripts/lane-merge/`
  );
  const dir = path.join(path.dirname(SELF), 'lane-merge');
  for (const name of fs.readdirSync(dir)) {
    assert.match(name, /\.mjs$/, `${name} in scripts/lane-merge/ is not a module`);
    const text = fs.readFileSync(path.join(dir, name), 'utf8');
    assert.ok(text.split('\n').length <= 700, `${name} is over 700 lines: split it by gate`);
  }
});

/** relaunchFromMain with fakes: a "self" file with `selfText`, main's copy `mainText` (or null). */
function relaunch({
  selfText = 'gate A\n',
  mainText = 'gate A\n',
  selfModules = {},
  mainModules = {},
  fetchFail = false,
  env = {},
  argv = ['312'],
  spawnResult = { status: 7 },
} = {}) {
  const dir = tmpDir();
  const selfPath = path.join(dir, 'lane-merge.mjs');
  fs.writeFileSync(selfPath, selfText);
  if (Object.keys(selfModules).length) fs.mkdirSync(path.join(dir, 'lane-merge'));
  for (const [n, text] of Object.entries(selfModules)) {
    fs.writeFileSync(path.join(dir, 'lane-merge', n), text);
  }
  const calls = [];
  const lines = [];
  const spawned = [];
  const out = relaunchFromMain({
    argv,
    selfPath,
    env,
    tmpdir: dir,
    cwd: dir,
    log: l => lines.push(l),
    execPath: 'node-exe',
    run: (cmd, args) => {
      calls.push(`${cmd} ${args.join(' ')}`);
      if (args[0] === 'fetch') {
        return fetchFail
          ? { status: 1, stdout: '', stderr: 'offline' }
          : { status: 0, stdout: '', stderr: '' };
      }
      if (args[0] === 'ls-tree') {
        const names = Object.keys(mainModules).map(n => `scripts/lane-merge/${n}`);
        return { status: 0, stdout: names.join('\n'), stderr: '' };
      }
      const prefix = 'aitool/main:scripts/lane-merge/';
      if (args[1].startsWith(prefix)) {
        return { status: 0, stdout: mainModules[args[1].slice(prefix.length)], stderr: '' };
      }
      return mainText === null
        ? { status: 128, stdout: '', stderr: 'fatal' }
        : { status: 0, stdout: mainText, stderr: '' };
    },
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return spawnResult;
    },
  });
  return { out, calls, lines, spawned, dir };
}

test('H1: a gate identical to main runs in place (line endings do not matter)', () => {
  const same = relaunch();
  assert.deepEqual([same.out.relaunched, same.out.fetched, same.spawned.length], [false, true, 0]);
  assert.deepEqual(same.calls, [
    'git fetch aitool main',
    'git show aitool/main:scripts/lane-merge.mjs',
    'git ls-tree -r --name-only --full-tree aitool/main scripts/lane-merge/',
  ]);
  assert.equal(relaunch({ mainText: 'gate A\r\n' }).out.relaunched, false);
  const mods = { 'a.mjs': 'one\n', 'b.mjs': 'two\n' };
  const sameMods = relaunch({
    selfModules: mods,
    mainModules: { 'a.mjs': 'one\r\n', 'b.mjs': 'two\n' },
  });
  assert.equal(sameMods.out.relaunched, false, 'matching modules run in place');
  const changed = relaunch({
    selfModules: mods,
    mainModules: { 'a.mjs': 'one\n', 'b.mjs': 'X\n' },
  });
  assert.equal(changed.out.relaunched, true, 'a changed module is replaced by main');
  const [call] = changed.spawned;
  assert.equal(
    fs.readFileSync(path.join(path.dirname(call.args[0]), 'lane-merge', 'b.mjs'), 'utf8'),
    'X\n'
  );
  assert.equal(
    relaunch({ selfModules: mods, mainModules: { 'a.mjs': 'one\n' } }).out.relaunched,
    true,
    'a module only this checkout has differs'
  );
  assert.equal(
    relaunch({ selfModules: { 'a.mjs': 'one\n' }, mainModules: mods }).out.relaunched,
    true,
    'a module only main has differs'
  );
});

test("H1: a gate that differs from main is replaced by main's copy, same arguments and folder", () => {
  const r = relaunch({
    selfText: 'loosened gate\n',
    mainText: 'gate A\n',
    argv: ['312', '--dry-run'],
  });
  assert.equal(r.out.relaunched, true);
  assert.equal(r.out.code, 7, "the exit code of main's copy is passed on");
  const [call] = r.spawned;
  assert.equal(call.cmd, 'node-exe');
  assert.deepEqual(call.args.slice(1), ['312', '--dry-run']);
  assert.equal(fs.readFileSync(call.args[0], 'utf8'), 'gate A\n');
  assert.notEqual(path.resolve(call.args[0]), path.join(r.dir, 'lane-merge.mjs'));
  assert.equal(call.opts.cwd, r.dir);
  assert.equal(call.opts.env.LANE_MERGE_FROM_MAIN, '1');
  assert.equal(call.opts.env.LANE_MERGE_FETCHED, '1');
  assert.match(r.lines[0], /differs from aitool\/main; running main's copy/);
});

test('H1: the copy started from main does not relaunch again, and --train never does', () => {
  const inner = relaunch({
    selfText: 'x\n',
    env: { LANE_MERGE_FROM_MAIN: '1', LANE_MERGE_FETCHED: '1' },
  });
  assert.deepEqual([inner.out.relaunched, inner.out.fetched, inner.calls.length], [false, true, 0]);
  const train = relaunch({ selfText: 'x\n', argv: ['--train'] });
  assert.deepEqual([train.out.relaunched, train.calls.length], [false, 0]);
});

test('H1: main without a gate (bootstrap) says so in one line and runs this copy', () => {
  const r = relaunch({ mainText: null });
  assert.equal(r.out.relaunched, false);
  assert.equal(r.out.error, null);
  assert.deepEqual(r.lines, [
    "lane:merge: aitool/main has no merge gate yet (bootstrap); running this checkout's copy",
  ]);
});

test('H1: a failing fetch refuses (the gate cannot compare itself with main)', () => {
  const r = relaunch({ fetchFail: true, selfText: 'x\n' });
  assert.equal(r.out.relaunched, false);
  assert.match(r.out.error, /git fetch aitool main failed \(offline\)/);
  assert.equal(r.spawned.length, 0);
});

test('L6: entryDecision and isEntryModule use real paths; a same-named other file is a mismatch', () => {
  assert.equal(entryDecision(SELF, SELF), 'run');
  assert.equal(entryDecision(undefined, SELF), 'import');
  assert.equal(entryDecision(path.join(os.tmpdir(), 'something-else.mjs'), SELF), 'import');
  assert.equal(entryDecision(path.join(os.tmpdir(), 'lane-merge.mjs'), SELF), 'mismatch');
  assert.ok(!isEntryModule(undefined, SELF));
  if (process.platform === 'win32') assert.ok(isEntryModule(SELF.toUpperCase(), SELF));
});

test('L6: started through a junction the gate still runs, and a mismatch exits non-zero', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-junction-'));
  const link = path.join(dir, 'scripts-link');
  fs.symlinkSync(path.dirname(SELF), link, 'junction');
  const state = path.join(dir, 'train.json');
  const r = spawnSync(
    process.execPath,
    [path.join(link, 'lane-merge.mjs'), '--train', '--state', state],
    {
      encoding: 'utf8',
    }
  );
  assert.equal(r.status, 0, r.stderr);
  assert.match(r.stdout, /^lane:merge: merge train 0\/4; no live:roundtrip recorded/);
  // Another file with the same name, run by hand: the real script cannot be told apart, so it fails.
  const copyDir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-copy-'));
  const copy = path.join(copyDir, 'lane-merge.mjs');
  fs.copyFileSync(SELF, copy);
  fs.cpSync(path.join(path.dirname(SELF), 'lane-merge'), path.join(copyDir, 'lane-merge'), {
    recursive: true,
  });
  const fine = spawnSync(process.execPath, [copy, '--train', '--state', state], {
    encoding: 'utf8',
  });
  assert.equal(fine.status, 0, 'a copy that is itself the started file is fine');
  const imported = spawnSync(
    process.execPath,
    [
      '--input-type=module',
      '-e',
      `import(${JSON.stringify(new URL(`file://${SELF.replace(/\\/g, '/')}`).href)}).then(() => console.log('imported'))`,
    ],
    { encoding: 'utf8' }
  );
  assert.equal(imported.status, 0, imported.stderr);
  assert.equal(imported.stdout.trim(), 'imported', 'importing the module does not run it');
});

// ---- --wait-ci ----

const cr = (name, status, conclusion = null) => ({
  __typename: 'CheckRun',
  name,
  status,
  conclusion,
});
const GREEN = [cr('build-test', 'COMPLETED', 'SUCCESS'), cr('codeql', 'COMPLETED', 'SKIPPED')];
const RUNNING = [cr('build-test', 'IN_PROGRESS'), cr('codeql', 'COMPLETED', 'SKIPPED')];

/**
 * waitForCi against a faked gh: `views` are the successive `gh pr view` answers (the last repeats),
 * a string is a gh failure. Time is a fake clock that the sleeps advance.
 */
function waitRun(views, { rules = RULES, pollMs = 30_000, timeoutMs = 120_000 } = {}) {
  let i = 0;
  let clockMs = 0;
  const sleeps = [];
  const logs = [];
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    if (cmd === 'gh' && args[0] === 'api') {
      return { status: 0, stdout: JSON.stringify(rules), stderr: '' };
    }
    const v = views[Math.min(i++, views.length - 1)];
    if (typeof v === 'string') return { status: 1, stdout: '', stderr: v };
    const pr = { state: 'OPEN', headRefOid: HEAD, ...v };
    return { status: 0, stdout: JSON.stringify(pr), stderr: '' };
  };
  const result = waitForCi({
    pr: 312,
    run,
    log: l => logs.push(l),
    sleep: ms => {
      sleeps.push(ms);
      clockMs += ms;
    },
    clock: () => clockMs,
    pollMs,
    timeoutMs,
  });
  return { result, sleeps, logs, calls, polls: i };
}

test('parseArgs: --wait-ci', () => {
  assert.equal(parseArgs(['312', '--wait-ci']).waitCi, true);
  assert.equal(parseArgs(['312']).waitCi, false);
  assert.equal(parseArgs(['312', '--wait-ci', '--dry-run']).error, null);
  assert.match(parseArgs(['--wait-ci']).error, /usage/);
  assert.match(parseArgs(['--train', '--wait-ci']).error, /needs a PR number/);
});

test('waitForCi: green at once returns the head without sleeping', () => {
  const r = waitRun([{ statusCheckRollup: GREEN }]);
  assert.deepEqual(r.result, { ok: true, head: HEAD });
  assert.deepEqual(r.sleeps, []);
  assert.deepEqual(r.logs, []);
});

test('waitForCi: polls until the running check finishes, logs a change once', () => {
  const r = waitRun([
    { statusCheckRollup: RUNNING },
    { statusCheckRollup: RUNNING },
    { statusCheckRollup: GREEN },
  ]);
  assert.equal(r.result.ok, true);
  assert.deepEqual(r.sleeps, [30_000, 30_000]);
  assert.equal(r.logs.length, 1, 'the same pending set is reported once');
  assert.match(r.logs[0], /waiting for CI on #312 at 3d24f70: build-test \(IN_PROGRESS\)/);
});

test('waitForCi: a required check that is not reported yet counts as pending', () => {
  const r = waitRun([
    { statusCheckRollup: [cr('codeql', 'COMPLETED', 'SUCCESS')] },
    { statusCheckRollup: GREEN },
  ]);
  assert.equal(r.result.ok, true);
  assert.equal(r.polls, 2);
  assert.match(r.logs[0], /build-test \(not reported yet\)/);
});

test('waitForCi: no checks reported yet waits', () => {
  const r = waitRun([{ statusCheckRollup: [] }, { statusCheckRollup: GREEN }]);
  assert.equal(r.result.ok, true);
  assert.match(r.logs[0], /no checks reported yet/);
});

test('waitForCi: a failing check ends the wait at once, naming it, while others still run', () => {
  const r = waitRun([
    { statusCheckRollup: RUNNING },
    { statusCheckRollup: [cr('build-test', 'IN_PROGRESS'), cr('lint', 'COMPLETED', 'FAILURE')] },
    { statusCheckRollup: GREEN },
  ]);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.code, 3);
  assert.match(r.result.reason, /CI failed on 3d24f70: lint \(FAILURE\)/);
  assert.equal(r.polls, 2, 'no further poll after the failure');
});

test('waitForCi: an old failure with a newer queued rerun keeps waiting', () => {
  const old = { ...cr('build-test', 'COMPLETED', 'FAILURE'), startedAt: '2026-10-31T07:56:17Z' };
  const queued = { ...cr('build-test', 'QUEUED', ''), startedAt: '0001-01-01T00:00:00Z' };
  const done = { ...cr('build-test', 'COMPLETED', 'SUCCESS'), startedAt: '2026-10-31T09:24:42Z' };
  const r = waitRun([{ statusCheckRollup: [old, queued] }, { statusCheckRollup: [old, done] }]);
  assert.equal(r.result.ok, true);
  assert.equal(r.polls, 2, 'did not stop at the old failure');
});

test('waitForCi: a failing commit status is named too', () => {
  const r = waitRun([{ statusCheckRollup: [{ context: 'ci/deploy', state: 'FAILURE' }] }]);
  assert.equal(r.result.code, 3);
  assert.match(r.result.reason, /ci\/deploy \(FAILURE\)/);
});

test('waitForCi: head moved while waiting refuses with code 4', () => {
  const r = waitRun([
    { statusCheckRollup: RUNNING },
    { headRefOid: OTHER, statusCheckRollup: GREEN },
  ]);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.code, 4);
  assert.match(r.result.reason, /head moved from 3d24f70 to fffffff/);
});

test('waitForCi: a PR closed or merged while waiting ends the wait', () => {
  const r = waitRun([
    { statusCheckRollup: RUNNING },
    { state: 'MERGED', statusCheckRollup: RUNNING },
  ]);
  assert.equal(r.result.code, 1);
  assert.match(r.result.reason, /#312 is MERGED, not OPEN/);
});

test('waitForCi: times out with code 5 and names what is pending', () => {
  const r = waitRun([{ statusCheckRollup: RUNNING }], { pollMs: 30_000, timeoutMs: 120_000 });
  assert.equal(r.result.ok, false);
  assert.equal(r.result.code, 5);
  assert.match(
    r.result.reason,
    /timed out after 2 minutes; still waiting for build-test \(IN_PROGRESS\)/
  );
  assert.equal(r.sleeps.length, 4);
});

test('waitForCi: a gh blip is retried, three in a row end the wait', () => {
  const blip = waitRun(['HTTP 502', { statusCheckRollup: GREEN }]);
  assert.equal(blip.result.ok, true);
  assert.deepEqual(blip.sleeps, [30_000]);
  const down = waitRun(['HTTP 502', 'HTTP 502', 'HTTP 502', { statusCheckRollup: GREEN }]);
  assert.equal(down.result.ok, false);
  assert.equal(down.result.code, 1);
  assert.match(down.result.reason, /failed 3 times in a row: HTTP 502/);
  const reset = waitRun(
    ['x', 'x', { statusCheckRollup: RUNNING }, 'x', 'x', { statusCheckRollup: GREEN }],
    { timeoutMs: 600_000 }
  );
  assert.equal(reset.result.ok, true, 'a good answer resets the error count');
});

test('waitForCi: unreadable ruleset still waits for the checks that exist', () => {
  const r = waitRun([{ statusCheckRollup: RUNNING }, { statusCheckRollup: GREEN }], { rules: {} });
  assert.equal(r.result.ok, true);
});

test('gate --wait-ci: waits for CI, then runs the normal gate and merges', () => {
  const r = gate({
    argv: ['--wait-ci'],
    prFor: i => ({ statusCheckRollup: i < 2 ? RUNNING : GREEN }),
  });
  assert.equal(r.code, 0, r.text);
  assert.ok(r.merged);
  assert.deepEqual(r.sleeps, [30_000, 30_000]);
  assert.match(r.text, /--wait-ci: waiting up to 30 minutes for CI on #312/);
  assert.match(r.text, /lane:merge: merged #312 at 3d24f70/);
});

test('gate --wait-ci: the gate still refuses after the wait (no review note for the head)', () => {
  const r = gate({
    argv: ['--wait-ci'],
    vault: vaultWith([{ name: '312-review.md', text: note({ head: OTHER }) }]),
    prFor: i => ({ statusCheckRollup: i < 1 ? RUNNING : GREEN }),
  });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(r.text, /NOT merged #312/);
  assert.match(r.text, /review: no review note for head 3d24f70/);
});

test('gate --wait-ci: --dry-run waits too and merges nothing', () => {
  const r = gate({
    argv: ['--wait-ci', '--dry-run'],
    prFor: i => ({ statusCheckRollup: i < 1 ? RUNNING : GREEN }),
  });
  assert.equal(r.code, 0, r.text);
  assert.ok(!r.merged);
  assert.match(r.text, /OK #312 at 3d24f70 \(dry run/);
});

test('gate --wait-ci: a failing check exits 3 with the check named, and the gate does not run', () => {
  const r = gate({
    argv: ['--wait-ci'],
    prFor: () => ({ statusCheckRollup: [cr('build-test', 'COMPLETED', 'FAILURE')] }),
  });
  assert.equal(r.code, 3);
  assert.match(r.text, /NOT merged #312\nwait-ci: CI failed on 3d24f70: build-test \(FAILURE\)/);
  assert.ok(!r.calls.some(c => c[0] === 'git'), 'no git call: the gate never started');
  assert.ok(!r.merged);
});

test('gate --wait-ci: head moved during the wait exits 4', () => {
  const r = gate({
    argv: ['--wait-ci'],
    prFor: i =>
      i === 0 ? { statusCheckRollup: RUNNING } : { headRefOid: OTHER, statusCheckRollup: GREEN },
  });
  assert.equal(r.code, 4);
  assert.match(r.text, /wait-ci: head moved from 3d24f70 to fffffff/);
  assert.ok(!r.merged);
});

test('gate --wait-ci: head moved between the wait and the gate exits 4', () => {
  const r = gate({
    argv: ['--wait-ci'],
    prFor: i => (i === 0 ? { statusCheckRollup: GREEN } : { headRefOid: OTHER }),
  });
  assert.equal(r.code, 4);
  assert.match(r.text, /wait-ci: head moved from 3d24f70 to fffffff after the wait/);
  assert.ok(!r.merged);
});

test('gate --wait-ci: timeout exits 5', () => {
  const r = gate({ argv: ['--wait-ci'], prFor: () => ({ statusCheckRollup: RUNNING }) });
  assert.equal(r.code, 5);
  assert.match(r.text, /wait-ci: timed out after 30 minutes; still waiting for build-test/);
  assert.equal(r.sleeps.length, 60);
  assert.ok(!r.merged);
});

test('gate without --wait-ci: pending CI still refuses at once, no sleeping', () => {
  const r = gate({ prFor: () => ({ statusCheckRollup: RUNNING }) });
  assert.equal(r.code, 1);
  assert.deepEqual(r.sleeps, []);
  assert.match(r.text, /ci: pending: build-test/);
});

test('waitForCi: merge conflicts end the wait at once (CI will not run)', () => {
  const r = waitRun([{ mergeable: 'CONFLICTING', statusCheckRollup: [] }]);
  assert.equal(r.result.ok, false);
  assert.equal(r.result.code, 1);
  assert.match(r.result.reason, /#312 has merge conflicts/);
  assert.equal(r.polls, 1);
});

test('gate --wait-ci: fetches main again after the wait', () => {
  const r = gate({
    argv: ['--wait-ci'],
    prFor: i => ({ statusCheckRollup: i < 1 ? RUNNING : GREEN }),
  });
  assert.equal(r.code, 0, r.text);
  const fetches = r.calls.filter(c => c[0] === 'git' && c[1] === 'fetch');
  assert.equal(fetches.length, 1, 'once after the wait; the gate does not fetch a second time');
});

test('gate --wait-ci: a run that already fetched (fetched: true, as every real run) fetches once, after the wait', () => {
  const r = gate({
    argv: ['--wait-ci'],
    fetched: true,
    prFor: i => ({ statusCheckRollup: i < 2 ? RUNNING : GREEN }),
  });
  assert.equal(r.code, 0, r.text);
  const fetches = r.calls.filter(c => c[0] === 'git' && c[1] === 'fetch');
  assert.equal(fetches.length, 1, 'the re-fetch after the wait, and no other');
  const polls = r.calls.map((c, i) => (c[0] === 'gh' && c[1] === 'pr' && c[2] === 'view' ? i : -1));
  const fetchAt = r.calls.findIndex(c => c[0] === 'git' && c[1] === 'fetch');
  assert.ok(
    fetchAt > polls.filter(i => i >= 0)[2],
    'the fetch comes after the polls that waited, not before'
  );
  const isView = c => c[0] === 'gh' && c[1] === 'pr' && c[2] === 'view';
  const after = r.calls.slice(fetchAt + 1);
  assert.ok(after.some(isView), "the gate's own gh pr view comes after the fetch");
  const mergeBaseAt = r.calls.findIndex(c => c[0] === 'git' && c[1] === 'merge-base');
  assert.ok(mergeBaseAt > fetchAt, 'git merge-base comes after the fetch');
});

test('acquireLock (#378 L1): a failed link back is reported, or the lock is moved back', () => {
  const dir = tmpDir();
  const state = path.join(dir, 'merge-train.json');
  const lock = `${state}.lock`;
  fs.writeFileSync(lock, '{"pid":1,"at":"killed run"}');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  // The lock is replaced by a live one between stat and rename (A did its takeover), then a third
  // run takes the free slot before B links back: EEXIST, reported on stderr, B does not get in.
  let fired = false;
  let third = '';
  const written = [];
  const origWrite = process.stderr.write;
  process.stderr.write = chunk => (written.push(String(chunk)), true);
  let errorB;
  try {
    errorB = acquireLockSafely(state, {
      timeoutMs: 50,
      wait: () => {},
      afterStaleSeen: () => {
        if (fired) return;
        fired = true;
        // a fresh live lock replaces the stale one just before B's rename
        fs.unlinkSync(lock);
        fs.writeFileSync(lock, '{"pid":2,"token":"A"}');
      },
      afterTaken: () => {
        third = '{"pid":3,"token":"C"}';
        fs.writeFileSync(lock, third);
      },
    });
  } finally {
    process.stderr.write = origWrite;
  }
  assert.match(errorB, /another lane:merge holds/);
  assert.match(written.join(''), /lock race: a run may be in the merge train without the lock/);
  assert.equal(fs.readFileSync(lock, 'utf8'), third, "the third run's lock stays");
  assert.deepEqual(
    fs.readdirSync(dir).filter(n => n.includes('.stale-')),
    []
  );
});

/** Runs fn with fs.linkSync failing as on a file system without hard links (EPERM). */
function withoutHardLinks(fn) {
  const origLink = fs.linkSync;
  fs.linkSync = () => {
    throw Object.assign(new Error('EPERM: operation not permitted, link'), { code: 'EPERM' });
  };
  try {
    return fn();
  } finally {
    fs.linkSync = origLink;
  }
}

/** A stale lock next to a state file, plus the hook that swaps in a live one just before the rename. */
function staleLockRace(dir) {
  const state = path.join(dir, 'merge-train.json');
  const lock = `${state}.lock`;
  fs.writeFileSync(lock, '{"pid":1,"at":"killed run"}');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  let fired = false;
  const afterStaleSeen = () => {
    if (fired) return;
    fired = true;
    fs.unlinkSync(lock);
    fs.writeFileSync(lock, '{"pid":2,"token":"A"}');
  };
  return { state, lock, afterStaleSeen };
}

test('acquireLock (#385): no hard links and the slot is free: the lock is copied back', () => {
  const dir = tmpDir();
  const { state, lock, afterStaleSeen } = staleLockRace(dir);
  const written = [];
  const origWrite = process.stderr.write;
  process.stderr.write = chunk => (written.push(String(chunk)), true);
  let error;
  try {
    error = withoutHardLinks(() =>
      acquireLockSafely(state, { timeoutMs: 50, wait: () => {}, afterStaleSeen })
    );
  } finally {
    process.stderr.write = origWrite;
  }
  assert.match(error, /another lane:merge holds/);
  assert.equal(written.join(''), '', 'no race warning when nobody took the slot');
  assert.equal(fs.readFileSync(lock, 'utf8'), '{"pid":2,"token":"A"}', "A's lock is back");
  assert.deepEqual(
    fs.readdirSync(dir).filter(n => n.includes('.stale-')),
    []
  );
});

test('acquireLock (#385): no hard links and a third run took the slot: warns and keeps its lock', () => {
  const dir = tmpDir();
  const { state, lock, afterStaleSeen } = staleLockRace(dir);
  const third = '{"pid":3,"token":"C"}';
  const written = [];
  const origWrite = process.stderr.write;
  process.stderr.write = chunk => (written.push(String(chunk)), true);
  let error;
  try {
    error = withoutHardLinks(() =>
      acquireLockSafely(state, {
        timeoutMs: 50,
        wait: () => {},
        afterStaleSeen,
        afterTaken: () => fs.writeFileSync(lock, third),
      })
    );
  } finally {
    process.stderr.write = origWrite;
  }
  assert.match(error, /another lane:merge holds/);
  assert.match(written.join(''), /lock race: a run may be in the merge train without the lock/);
  assert.equal(fs.readFileSync(lock, 'utf8'), third, "the third run's lock is not overwritten");
  assert.deepEqual(
    fs.readdirSync(dir).filter(n => n.includes('.stale-')),
    []
  );
});

test('acquireLock (#385): no hard links and the moved lock vanished (copy ENOENT): retries, no crash', () => {
  const dir = tmpDir();
  const { state, lock, afterStaleSeen } = staleLockRace(dir);
  let removed = false;
  const written = [];
  const origWrite = process.stderr.write;
  process.stderr.write = chunk => (written.push(String(chunk)), true);
  let release;
  try {
    release = withoutHardLinks(() =>
      acquireLock(state, {
        timeoutMs: 500,
        wait: () => {},
        afterStaleSeen,
        afterTaken: () => {
          // the run that owns the moved lock deletes it before we can copy it back
          if (removed) return;
          removed = true;
          for (const n of fs.readdirSync(dir)) {
            if (n.includes('.stale-')) fs.unlinkSync(path.join(dir, n));
          }
        },
      })
    );
  } finally {
    process.stderr.write = origWrite;
  }
  assert.equal(written.join(''), '', 'no warning for a vanished lock');
  assert.ok(removed, 'the takeover path ran');
  assert.ok(fs.existsSync(lock), 'the retry took the free lock');
  release();
});

test('acquireLock (#378 L3): release removes only the lock this run wrote', () => {
  const dir = tmpDir();
  const state = path.join(dir, 'merge-train.json');
  const lock = `${state}.lock`;
  const release = acquireLock(state, { timeoutMs: 50 });
  fs.writeFileSync(lock, '{"pid":9,"token":"someone else"}');
  release();
  assert.ok(fs.existsSync(lock), "another run's lock is not removed");
  fs.unlinkSync(lock);
  const mine = acquireLock(state, { timeoutMs: 50 });
  mine();
  assert.ok(!fs.existsSync(lock), 'its own lock is removed');
});

test('acquireLock (#378 L2): a persistent takeover error ends at the timeout and names the code', () => {
  const dir = tmpDir();
  const state = path.join(dir, 'merge-train.json');
  const lock = `${state}.lock`;
  fs.writeFileSync(lock, '{}');
  const old = new Date(Date.now() - 11 * 60 * 1000);
  fs.utimesSync(lock, old, old);
  let waits = 0;
  let clock = Date.now();
  const err = acquireLockSafely(state, {
    timeoutMs: 1000,
    now: () => clock,
    wait: ms => {
      waits++;
      clock += ms;
    },
    afterStaleSeen: () => {
      // a takeover that keeps failing with something other than ENOENT
      throw Object.assign(new Error('busy'), { code: 'EBUSY' });
    },
  });
  assert.match(err, /another lane:merge holds .* \[last error EBUSY\]/);
  assert.ok(waits > 0, 'it waited between tries instead of spinning');
});

test('gate without --wait-ci: fetched: true means no fetch at all', () => {
  const r = gate({ fetched: true });
  assert.equal(r.code, 0, r.text);
  assert.equal(r.calls.filter(c => c[0] === 'git' && c[1] === 'fetch').length, 0);
});

test('gate --wait-ci: refuses when the gate on main changed during the wait', () => {
  const r = gate({
    argv: ['--wait-ci'],
    mainGate: '// a newer gate',
    prFor: i => ({ statusCheckRollup: i < 1 ? RUNNING : GREEN }),
  });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(r.text, /wait-ci: the gate on aitool\/main changed during the wait/);
});

test('gate --wait-ci: refuses when only a gate module on main changed during the wait', () => {
  const mods = ownModules();
  const first = Object.keys(mods)[0];
  const r = gate({
    argv: ['--wait-ci'],
    mainModules: { ...mods, [first]: `${mods[first]}// newer\n` },
  });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(r.text, /wait-ci: the gate on aitool\/main changed during the wait/);
  const extra = gate({ argv: ['--wait-ci'], mainModules: { ...mods, 'new.mjs': 'x\n' } });
  assert.equal(extra.code, 1, 'a module only main has is a change too');
});

test('gate --wait-ci: refuses when main cannot be fetched after the wait', () => {
  const r = gate({ argv: ['--wait-ci'], fetchFail: true });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(r.text, /wait-ci: git fetch aitool main failed after the wait \(no network\)/);
});

test('gate --wait-ci: main without a gate yet (bootstrap) does not block', () => {
  const r = gate({ argv: ['--wait-ci'], mainGate: null });
  assert.equal(r.code, 0, r.text);
});

// ---- the merge train note in the vault (board-merge-train, tool half) ----

const TRAIN_STATE = {
  lastRoundtrip: { sha: TIP, at: '2026-10-23T07:06:41.533Z' },
  since: [{ pr: 461, sha: HEAD, at: '2026-10-23T13:52:58.810Z' }],
};
const NOTE_NOW = '2026-10-23T14:00:00.000Z';
const SYNCED_PUSH = ['restore', 'fetch', 'merge', 'add', 'commit', 'push'];
const NOTE_FILE = (/** @type {string} */ vault) => path.join(vault, ...TRAIN_NOTE_PATH.split('/'));

/** The PM board's parser (a sibling checkout), or null where it is not there. */
async function boardParser() {
  const dir =
    process.env.PM_BOARD_DIR ??
    path.join(os.homedir(), 'Documents', 'Claude Code', 'Projects', 'foundry-ai-tool-pm-board');
  const target = path.join(dir, 'public', 'merge-train.mjs');
  return fs.existsSync(target) ? import(pathToFileURL(target).href) : null;
}

test('merge train note: the format of the board README, and nothing else', () => {
  const text = renderTrainNote(TRAIN_STATE, { kind: 'merge', pr: 461, at: NOTE_NOW }, NOTE_NOW);
  assert.equal(
    text.split('---')[1],
    [
      '',
      'type: merge-train',
      `updated: ${NOTE_NOW}`,
      'count: 1',
      'limit: 4',
      `last-roundtrip-sha: ${TIP}`,
      'last-roundtrip: 2026-10-23T07:06:41.533Z',
      'last-roundtrip-result: green',
      'last-event: merge',
      'last-event-pr: 461',
      `last-event-at: ${NOTE_NOW}`,
      '',
    ].join('\n')
  );
  const bare = renderTrainNote(
    { lastRoundtrip: null, since: [] },
    { kind: 'reset', at: NOTE_NOW },
    NOTE_NOW
  );
  assert.ok(!/last-event-pr|last-roundtrip/.test(bare));
});

test('merge train note: the board parser reads what the gate writes (round trip)', async t => {
  const board = await boardParser();
  if (!board) return t.skip('PM board checkout not found (set PM_BOARD_DIR)');
  for (const [state, event] of [
    [TRAIN_STATE, { kind: 'merge', pr: 461, at: NOTE_NOW }],
    [
      { lastRoundtrip: TRAIN_STATE.lastRoundtrip, since: [] },
      { kind: 'reset', at: NOTE_NOW },
    ],
    [
      { lastRoundtrip: null, since: TRAIN_STATE.since },
      { kind: 'refusal', pr: 7, at: NOTE_NOW },
    ],
  ]) {
    const { train, problems } = board.parseMergeTrain(renderTrainNote(state, event, NOTE_NOW));
    assert.deepEqual(problems, []);
    assert.equal(train.count, state.since.length);
    assert.equal(train.limit, TRAIN_SIZE);
    assert.equal(train.updated, NOTE_NOW);
    assert.equal(train.roundtrip?.sha ?? null, state.lastRoundtrip?.sha ?? null);
    assert.equal(train.roundtrip?.result ?? null, state.lastRoundtrip ? 'green' : null);
    assert.deepEqual(train.last, { kind: event.kind, pr: event.pr ?? null, at: NOTE_NOW });
  }
});

/** A vault clone with a bare remote, a committed file, and an unrelated dirty file. */
function realVault() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-gitvault-'));
  const g = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) =>
    execFileSync('git', a, { cwd, encoding: 'utf8', stdio: 'pipe' });
  g(root, 'init', '-q', '--bare', '-b', 'main', 'remote.git');
  g(root, 'clone', '-q', 'remote.git', 'vault');
  const vault = path.join(root, 'vault');
  g(vault, 'config', 'user.name', 'Test');
  g(vault, 'config', 'user.email', 'test@example.com');
  fs.writeFileSync(path.join(vault, 'other.md'), 'one\n');
  g(vault, 'add', 'other.md');
  g(vault, 'commit', '-q', '-m', 'init');
  g(vault, 'push', '-q', '-u', 'origin', 'HEAD:main');
  fs.writeFileSync(path.join(vault, 'other.md'), 'dirty\n'); // someone else's unsaved work
  return { root, vault, g };
}

test('merge train note: pulled first, only that file committed and pushed, other work untouched', () => {
  const { root, vault, g } = realVault();
  const warn = publishTrainNote({
    vault,
    state: TRAIN_STATE,
    event: { kind: 'merge', pr: 461, at: NOTE_NOW },
    run: defaultRun,
    now: () => new Date(NOTE_NOW),
  });
  assert.equal(warn, '');
  const shown = g(path.join(root, 'remote.git'), 'show', '--name-only', '--format=%s', 'main');
  assert.equal(shown.trim(), `Merge train: merge #461, 1/4\n\n${TRAIN_NOTE_PATH}`);
  assert.equal(fs.readFileSync(path.join(vault, 'other.md'), 'utf8'), 'dirty\n');
  assert.match(g(vault, 'status', '--porcelain'), /^ M other\.md$/m);
});

test('merge train note: a failed vault pull or push, no checkout, or a throw only warn', () => {
  const { root, vault } = realVault();
  const opts = {
    vault,
    state: TRAIN_STATE,
    event: { kind: 'reset', at: NOTE_NOW },
    run: defaultRun,
    now: () => new Date(NOTE_NOW),
  };
  fs.rmSync(path.join(root, 'remote.git'), { recursive: true, force: true });
  assert.match(publishTrainNote(opts), /vault fetch failed/);
  assert.equal(publishTrainNote({ ...opts, vault: tmpDir() }), ''); // no vault checkout: nothing to do
  const pushFails = (/** @type {string} */ _c, /** @type {string[]} */ args) =>
    args.includes('push')
      ? { status: 1, stdout: '', stderr: 'rejected' }
      : { status: 0, stdout: '', stderr: '' };
  assert.match(publishTrainNote({ ...opts, run: pushFails }), /not pushed \(rejected\)/);
  const boom = () => {
    throw new Error('spawn failed');
  };
  assert.match(publishTrainNote({ ...opts, run: boom }), /not written \(spawn failed\)/);
});

/** A vault for gate(): the review notes plus a `.git` marker, and a recording fake for vault git. */
function trainVault() {
  const vault = vaultWith([{ name: '312-review.md', text: note() }]);
  fs.mkdirSync(path.join(vault, '.git'));
  /** @type {string[][]} */
  const git = [];
  const vaultRun = (/** @type {string[]} */ a, fail = '') => {
    git.push(a);
    return a[0] === fail
      ? { status: 1, stdout: '', stderr: `${fail} refused` }
      : { status: 0, stdout: '', stderr: '' };
  };
  return { vault, git, vaultRun };
}

test('merge train note: a merge writes the new count; a vault failure never fails the merge', () => {
  const t = trainVault();
  const r = gate({ vault: t.vault, vaultRun: a => t.vaultRun(a), files: MODULE_FILES });
  assert.equal(r.code, 0, r.text);
  assert.deepEqual(
    t.git.map(a => a[0]),
    SYNCED_PUSH
  );
  assert.deepEqual(t.git[4].slice(-2), ['--', TRAIN_NOTE_PATH]);
  const text = fs.readFileSync(NOTE_FILE(t.vault), 'utf8');
  assert.match(text, /count: 1\n/);
  assert.match(text, /last-event: merge\nlast-event-pr: 312\n/);

  for (const fail of ['fetch', 'merge', 'commit', 'push']) {
    const f = trainVault();
    const bad = gate({ vault: f.vault, vaultRun: a => f.vaultRun(a, fail), files: MODULE_FILES });
    assert.equal(bad.code, 0, bad.text);
    assert.ok(bad.merged);
    // the merged line stands alone and comes first; the vault warning is a line of its own after it
    const mergedAt = bad.lines.findIndex(l => /merged #312 at /.test(l));
    assert.ok(mergedAt >= 0 && !/WARNING/.test(bad.lines[mergedAt]));
    assert.match(bad.lines[mergedAt + 1], /WARNING: merge train note/);
    assert.equal(readTrain(bad.state).since.length, 1);
  }
});

test('merge train note: a vault push that fails twice leaves the vault as it was', () => {
  const { root, vault, g } = realVault();
  const before = g(vault, 'rev-parse', 'HEAD').trim();
  const rejectPush = (/** @type {string} */ cmd, /** @type {string[]} */ args) =>
    args.includes('push') ? { status: 1, stdout: '', stderr: 'rejected' } : defaultRun(cmd, args);
  const warn = publishTrainNote({
    vault,
    state: TRAIN_STATE,
    event: { kind: 'refusal', pr: 9, at: NOTE_NOW },
    run: rejectPush,
    now: () => new Date(NOTE_NOW),
  });
  assert.match(warn, /not pushed \(rejected\)/);
  assert.equal(g(vault, 'rev-parse', 'HEAD').trim(), before); // our commit was taken back
  assert.equal(g(vault, 'diff', '--cached', '--name-only').trim(), ''); // nothing left staged
  assert.equal(fs.readFileSync(path.join(vault, 'other.md'), 'utf8'), 'dirty\n');
  assert.ok(root);
});

test('merge train note: the vault moved on (a push elsewhere) is fast-forwarded, no rebase or stash', () => {
  const { root, vault, g } = realVault();
  const other = path.join(root, 'other-clone');
  g(root, 'clone', '-q', 'remote.git', other);
  g(other, 'config', 'user.name', 'Other');
  g(other, 'config', 'user.email', 'other@example.com');
  fs.writeFileSync(path.join(other, 'later.md'), 'later\n');
  g(other, 'add', 'later.md');
  g(other, 'commit', '-q', '-m', 'later');
  g(other, 'push', '-q');
  const calls = [];
  const spy = (/** @type {string} */ cmd, /** @type {string[]} */ args) => {
    calls.push(args.slice(2).join(' '));
    return defaultRun(cmd, args);
  };
  const warn = publishTrainNote({
    vault,
    state: TRAIN_STATE,
    event: { kind: 'merge', pr: 461, at: NOTE_NOW },
    run: spy,
    now: () => new Date(NOTE_NOW),
  });
  assert.equal(warn, '');
  assert.ok(fs.existsSync(path.join(vault, 'later.md')));
  assert.ok(!calls.some(c => /rebase|stash|^pull/.test(c)), calls.join(' | '));
  assert.equal(fs.readFileSync(path.join(vault, 'other.md'), 'utf8'), 'dirty\n');
});

test('merge train note: a refusal drops the train lock before any vault git call', () => {
  const t = trainVault();
  let lockHeldAtVault = null;
  const probe = (/** @type {string[]} */ a) => {
    lockHeldAtVault ??= fs.existsSync(`${home}.lock`);
    return t.vaultRun(a);
  };
  const home = path.join(tmpDir(), 'merge-train.json');
  const r = gate({
    vault: t.vault,
    vaultRun: probe,
    files: MODULE_FILES,
    merge: 1,
    train: undefined,
    argv: ['--state', home],
  });
  assert.equal(r.code, 1);
  assert.equal(lockHeldAtVault, false);
});

test('merge train note: --dry-run writes nothing; a refusal writes a refusal event', () => {
  const dry = trainVault();
  assert.equal(
    gate({ vault: dry.vault, vaultRun: a => dry.vaultRun(a), argv: ['--dry-run'] }).code,
    0
  );
  assert.equal(dry.git.length, 0);
  assert.ok(!fs.existsSync(NOTE_FILE(dry.vault)));
  const dryRefused = trainVault();
  const refused = gate({
    vault: dryRefused.vault,
    vaultRun: a => dryRefused.vaultRun(a),
    argv: ['--dry-run'],
    dirty: true,
  });
  assert.equal(refused.code, 1);
  assert.equal(dryRefused.git.length, 0);

  const t = trainVault();
  const r = gate({ vault: t.vault, vaultRun: a => t.vaultRun(a), dirty: true, train: TRAIN_STATE });
  assert.equal(r.code, 1);
  assert.deepEqual(
    t.git.map(a => a[0]),
    SYNCED_PUSH
  );
  const text = fs.readFileSync(NOTE_FILE(t.vault), 'utf8');
  assert.match(text, /count: 1\n[\s\S]*last-event: refusal\nlast-event-pr: 312\n/);
  // the reason is in the commit (subject tag and body), never in the note the board parses
  const commit = t.git.find(a => a[0] === 'commit');
  assert.match(commit[2], /^Merge train: refusal #312, 1\/4 \[local\]$/);
  assert.equal(commit[3], '-m');
  assert.match(commit[4], /^local: the working tree is not clean/);
  assert.doesNotMatch(text, /working tree/);
});

test('refusal reasons: one cause tag per failure kind, once each, and a short body', () => {
  assert.deepEqual(
    refusalCauses(
      [
        'ci: failing: build-test (FAILURE); pending: dashboard-visual (IN_PROGRESS)',
        'ci: required but not reported: build-test (Node 22)',
        'ci: no checks reported for this PR yet',
        'ci: cannot read the required checks from the branch ruleset (gh api failed: x); refusing',
        'wait-ci: head moved from a to b',
        'wait-ci: CI failed on abc1234: build-test (FAILURE)',
        'wait-ci: timed out after 30 minutes; still waiting for x',
        'wait-ci: gh pr view 5 failed 3 times in a row',
        'review: no review note for this head',
        'train: merge train full (4/4): run live:roundtrip',
        'drift: drift-check failed (guards: mcp-server tests (tool counts, tool sets), lint ratchet) (log x.log); last lines below',
        'weird line',
      ],
      ['mcp-server tests (tool counts, tool sets)', 'lint ratchet']
    ),
    [
      'ci-failing',
      'ci-pending',
      'ci-missing',
      'ci-rules',
      'wait-ci-head-moved',
      'wait-ci-failing',
      'wait-ci-timeout',
      'wait-ci-other',
      'review',
      'train',
      'drift-mcp-server-tests-tool-counts-tool-sets',
      'drift-lint-ratchet',
      'other',
    ]
  );
  assert.deepEqual(refusalCauses(['drift: drift-check failed (log y.log); last lines below']), [
    'drift',
  ]);
  assert.deepEqual(refusalCauses([]), []);
  const long = 'ci: failing: ' + 'x'.repeat(400);
  const body = refusalBody([
    'review: a\nsecond line\u0007',
    long,
    '',
    'drift: drift-check failed (guards: x) (log C:/tmp/l.log); last lines below',
  ]).split('\n');
  assert.equal(body.length, 3);
  assert.equal(body[0], 'review: a');
  assert.ok(body[1].length <= 160 && body[1].endsWith('...'));
  assert.equal(body[2], 'drift: drift-check failed (guards: x); last lines below'); // no temp path
});

test('refusal reasons: a real vault commit carries the tags in the subject and the lines in the body', () => {
  const { root, g } = realVault();
  const vault = path.join(root, 'vault');
  const warn = publishTrainNote({
    vault,
    state: TRAIN_STATE,
    event: {
      kind: 'refusal',
      pr: 649,
      at: NOTE_NOW,
      reasons: ['ci: failing: build-test (FAILURE)', 'review: no note for this head'],
    },
    run: defaultRun,
    now: () => new Date(NOTE_NOW),
  });
  assert.equal(warn, '');
  const shown = g(path.join(root, 'remote.git'), 'log', '-1', '--format=%s%n--%n%b', 'main');
  assert.equal(
    shown.trim(),
    'Merge train: refusal #649, 1/4 [ci-failing, review]\n--\nci: failing: build-test (FAILURE)\nreview: no note for this head'
  );
});

test('merge train note: --train-reset writes a reset event, and a vault failure only warns', () => {
  const t = trainVault();
  const home = tmpDir();
  const state = path.join(home, 'merge-train.json');
  fs.writeFileSync(state, JSON.stringify(trainOf(4)));
  const lines = [];
  const fake = trainRun();
  const code = main({
    argv: ['--train-reset', TIP, '--state', state, '--vault', t.vault],
    run: (cmd, args) => (args[0] === '-C' ? t.vaultRun(args.slice(2), 'push') : fake(cmd, args)),
    log: l => lines.push(l),
    home,
    now: () => new Date(NOTE_NOW),
  });
  assert.equal(code, 0);
  const text = fs.readFileSync(NOTE_FILE(t.vault), 'utf8');
  assert.match(
    text,
    /count: 0\n[\s\S]*last-roundtrip-result: green\nlast-event: reset\nlast-event-at: /
  );
  assert.ok(!text.includes('last-event-pr'));
  assert.match(
    lines.join('\n'),
    /merge train reset at ab12cd3; merge train 0\/4\nlane:merge: WARNING: merge train note not pushed/
  );
  assert.equal(readTrain(state).since.length, 0);
});

test('wait-ci: a relaunched child killed by a signal still ends with a verdict line', () => {
  const r = relaunch({
    selfText: 'x\n',
    argv: ['312', '--wait-ci'],
    spawnResult: { status: null, signal: 'SIGTERM' },
  });
  assert.equal(r.out.code, 1);
  assert.match(r.out.killed, /killed \(SIGTERM\)/);
  const lines = [];
  const code = runEntry({
    argv: ['312', '--wait-ci'],
    relaunch: () => r.out,
    runMain: () => assert.fail('must not run in place'),
    log: l => lines.push(l),
  });
  assert.equal(code, 1);
  assert.deepEqual(lines, [
    "lane:merge: refused because main's copy of the gate was killed (SIGTERM)",
    "lane:merge: wait-ci ended: exit 1, main's copy of the gate was killed (SIGTERM)",
  ]);
  const failed = relaunch({
    selfText: 'x\n',
    spawnResult: { status: null, error: new Error('spawn EPERM') },
  });
  assert.match(failed.out.killed, /could not run \(spawn EPERM\)/);
});

test('wait-ci: every other exit of runEntry ends with one verdict line', () => {
  const entry = (argv, gate, runMain = () => 0) => {
    const lines = [];
    const code = runEntry({ argv, relaunch: gate, runMain, log: l => lines.push(l) });
    return { code, lines };
  };
  const plain = { relaunched: false, code: 0, fetched: true, error: null };
  for (const [code, reason] of [
    [0, /ok/],
    [1, /refused/],
    [3, /CI check failed/],
    [4, /head moved/],
    [5, /timed out/],
  ]) {
    const r = entry(
      ['312', '--wait-ci'],
      () => plain,
      () => code
    );
    assert.equal(r.code, code);
    assert.equal(r.lines.length, 1);
    assert.ok(r.lines[0].startsWith(`lane:merge: wait-ci ended: exit ${code}, `));
    assert.match(r.lines[0], reason);
  }
  const thrown = entry(
    ['312', '--wait-ci'],
    () => plain,
    () => {
      throw new Error('boom');
    }
  );
  assert.equal(thrown.code, 1);
  assert.equal(thrown.lines.at(-1), verdictLine(1, 'unexpected error: boom'));
  const noFetch = entry(['312', '--wait-ci'], () => ({ ...plain, error: 'git fetch failed' }));
  assert.equal(noFetch.code, 1);
  assert.match(noFetch.lines.at(-1), /wait-ci ended: exit 1, git fetch failed/);
  const child = entry(['312', '--wait-ci'], () => ({
    ...plain,
    relaunched: true,
    code: 3,
    killed: null,
  }));
  assert.deepEqual([child.code, child.lines], [3, []], 'the child printed its own verdict');
  const noWait = entry(
    ['312'],
    () => plain,
    () => 1
  );
  assert.deepEqual(noWait.lines, [], 'no --wait-ci: output unchanged');
  const noWaitThrow = entry(['312'], () => {
    throw new Error('x');
  });
  assert.deepEqual([noWaitThrow.code, noWaitThrow.lines.length], [1, 2]);
  assert.equal(noWaitThrow.lines[1], 'lane:merge: refused because unexpected error: x');
});

test('refusedBecause: one line, every reason, numbered when there are several', () => {
  assert.equal(refusedBecause(['review: no note']), 'lane:merge: refused because review: no note');
  assert.equal(
    refusedBecause(['review: no note; more', 'changelog: none', 'drift: failed\nsecond line']),
    'lane:merge: refused because (1) review: no note; more (2) changelog: none (3) drift: failed second line'
  );
  assert.match(refusedBecause([]), /^lane:merge: refused because /);
});

test('a refusal ends with one "refused because" line holding every reason, after the notices', () => {
  // The #741 shape: risky files, no review note for the head, so drift-check is not run.
  const r = gate({
    vault: vaultWith([{ name: '312-opus-review-round2.md', text: note({ head: OTHER }) }]),
    files: [
      'scripts/pi/container-test/stage26-scenarios.sh',
      '.github/workflows/ci.yml',
      'docs/a.md',
    ],
  });
  assert.equal(r.code, 1);
  assert.equal(r.lines[0], 'lane:merge: NOT merged #312');
  const last = r.lines.at(-1);
  assert.ok(
    last.startsWith('lane:merge: refused because (1) review: no review note for head 3d24f70'),
    last
  );
  assert.match(last, /\(2\) changelog: no added or changed changelog\.d/);
  assert.equal(r.lines.filter(l => l.startsWith('lane:merge: refused because')).length, 1);
  const notices = r.lines.findIndex(l => l.includes('drift-check not run'));
  assert.ok(notices > 0 && notices < r.lines.length - 1, 'the notices come before the summary');
  // A single reason is not numbered, and a --wait-ci failure gets the line too.
  const one = gate({ merge: 1 });
  assert.equal(
    one.lines.at(-1),
    'lane:merge: refused because merge: gh pr merge exited 1: not allowed'
  );
  const failed = gate({
    argv: ['--wait-ci'],
    prFor: () => ({ statusCheckRollup: [cr('build-test', 'COMPLETED', 'FAILURE')] }),
  });
  assert.equal(failed.code, 3);
  assert.equal(
    failed.lines.at(-1),
    'lane:merge: refused because wait-ci: CI failed on 3d24f70: build-test (FAILURE)'
  );
  // A merge prints no such line.
  assert.ok(!gate({}).lines.some(l => l.includes('refused because')));
});

test('risky notice: says found or missing for the head Opus note, so a merge never reads as a refusal', () => {
  const files = ['shared/src/protocol.ts', 'changelog.d/x.md'];
  const merged = gate({ files, vault: vaultWith([{ name: '312-opus-review.md', text: note() }]) });
  assert.equal(merged.code, 0, merged.text);
  assert.ok(
    merged.lines.includes(
      'lane:merge: risky (wire contracts): shared/src/protocol.ts; an Opus review is required; Opus note for head 3d24f70: found (312-opus-review.md)'
    ),
    merged.text
  );
  assert.ok(!merged.text.includes('missing'));
  const sonnet = gate({ files });
  assert.equal(sonnet.code, 1);
  assert.match(sonnet.text, /an Opus review is required; Opus note for head 3d24f70: missing/);
  // An Opus note for another head is missing for this one.
  const stale = gate({
    files,
    vault: vaultWith([{ name: '312-opus-review.md', text: note({ head: OTHER }) }]),
  });
  assert.match(stale.text, /Opus note for head 3d24f70: missing/);
  assert.deepEqual(
    opusNotesForHead(
      [
        parseReviewNote('312-opus-review.md', note(), 312),
        parseReviewNote('312-review.md', note(), 312),
        parseReviewNote('312-opus-review-2.md', note({ head: OTHER }), 312),
      ],
      HEAD.toUpperCase()
    ),
    ['312-opus-review.md']
  );
});

test('review refusal: names the naming rule, and lists notes of the PR that were not read', () => {
  const vault = vaultWith([
    { name: '312-merge-delta-3d24f70a.md', text: note() },
    { name: '313-merge-delta.md', text: note() },
    { folder: 'Reviews 2026-10-11', name: '312-review.md', text: note({ head: OTHER }) },
  ]);
  const r = gate({ vault });
  assert.equal(r.code, 1);
  const line = r.lines.find(l => l.startsWith('review: '));
  assert.ok(line.includes(reviewNamingRule(312)), line);
  assert.match(line, /312-\*review\*\.md in a "Handoff\/Reviews <date>\/" folder/);
  assert.match(line, /named 312-opus-review\.\.\. or headed "# PR #312 Opus review"/);
  assert.match(line, /full 40-character sha above "## Verdict"/);
  assert.match(
    line,
    /write it with: node scripts\/review-note\.mjs 312 --verdict <merge\|fixes\|no> --model <opus\|sonnet>/
  );
  assert.match(
    line,
    /not read \(no "review" in the name\): Reviews 2026-10-10\/312-merge-delta-3d24f70a\.md$/
  );
  assert.deepEqual(unreadPrNotes(vault, 312), ['Reviews 2026-10-10/312-merge-delta-3d24f70a.md']);
  assert.deepEqual(unreadPrNotes(path.join(os.tmpdir(), 'no-such-vault-xyz'), 312), []);
  // Only a Sonnet note for a risky PR gets the rule too; a Do not merge does not (the note was read).
  const sonnet = gate({ files: ['shared/src/protocol.ts', 'changelog.d/x.md'] });
  assert.ok(sonnet.text.includes(`this PR needs an Opus review; ${reviewNamingRule(312)}`));
  const veto = gate({
    vault: vaultWith([{ name: '312-review.md', text: note({ verdict: '**Do not merge.**' }) }]),
  });
  assert.ok(!veto.text.includes('the gate reads files named'));
});

/** A release PR as RELEASING.md steps 1 and 2 make it: the fold and sync-version's stamps. */
function releaseFixture() {
  const pkg = v => `{\n  "name": "foundry-ai-tool",\n  "version": "${v}",\n  "private": true\n}\n`;
  const lock = v =>
    JSON.stringify(
      {
        name: 'foundry-ai-tool',
        version: v,
        lockfileVersion: 3,
        packages: {
          '': { name: 'foundry-ai-tool', version: v },
          shared: { name: '@x/shared', version: v },
          'packages/foundry-module': { version: v },
          'packages/unversioned': { name: 'unversioned' },
          'node_modules/foo': { version: '1.0.0', resolved: 'https://r/foo.tgz' },
        },
      },
      null,
      2
    );
  const manifest = v =>
    `{\n  "id": "foundry-mcp-bridge",\n  "version": "${v}",\n  "compatibility": {}\n}\n`;
  const ts = v => `/** generated */\nexport const TOOL_VERSION = '${v}';\n`;
  const nsis = v =>
    `Name "x"\n  !define VERSION "v${v}"\nSection\n  WriteRegStr HKCU "Software\\Uninstall\\FoundryMCPServer" "DisplayVersion" "${v}"\nSectionEnd\n`;
  const at = v => ({
    'CHANGELOG.md': `# Changelog\n\n## Unreleased\n\n## v${v}\n`,
    'changelog.d/thing.md': v === '0.25.0' ? '### Fixes\n\n- a fix\n' : null,
    'package.json': pkg(v),
    'shared/package.json': pkg(v),
    'package-lock.json': lock(v),
    'packages/foundry-module/module.json': manifest(v),
    'packages/obsidian-plugin/manifest.json': manifest(v),
    'shared/src/version.ts': ts(v),
    'installer/nsis/foundry-mcp-server.nsi': nsis(v),
  });
  const base = at('0.25.0');
  const head = at('0.26.0');
  const files = Object.keys(base).map(p => ({
    path: p,
    changeType: head[p] === null ? 'DELETED' : 'MODIFIED',
  }));
  return { base, head, files, read: (rev, p) => (rev === 'base' ? base : head)[p] ?? null };
}

test('releasePr: the fold plus version bumps only; anything else is not a release', () => {
  const f = releaseFixture();
  assert.deepEqual(releasePr(f.files, f.read), { release: true, why: '' });
  const why = change => {
    const x = releaseFixture();
    change(x);
    const r = releasePr(x.files, x.read);
    assert.equal(r.release, false);
    return r.why;
  };
  const edit = (file, from, to) => x => {
    x.head[file] = x.head[file].replace(from, to);
  };
  assert.match(
    why(x => x.files.push({ path: 'docs/a.md', changeType: 'MODIFIED' })),
    /docs\/a\.md is not a changelog or version file/
  );
  assert.match(
    why(x => x.files.push({ path: 'shared/src/other.ts', changeType: 'MODIFIED' })),
    /shared\/src\/other\.ts is not a changelog or version file/
  );
  assert.match(
    why(x => x.files.push({ path: 'changelog.d/new.md', changeType: 'ADDED' })),
    /changelog\.d\/new\.md is not deleted/
  );
  assert.match(
    why(x => {
      x.files = x.files.filter(y => y.path !== 'CHANGELOG.md');
    }),
    /CHANGELOG\.md is not changed/
  );
  assert.match(
    why(x => {
      x.files = x.files.filter(y => y.path !== 'package.json');
    }),
    /root package\.json is not changed/
  );
  assert.match(
    why(edit('package.json', '"private": true', '"private": false')),
    /package\.json changes more than its version/
  );
  assert.match(
    why(edit('package-lock.json', '"version": "1.0.0"', '"version": "1.0.1"')),
    /package-lock\.json changes more than its version/
  );
  assert.match(
    why(edit('shared/src/version.ts', 'generated', 'edited')),
    /shared\/src\/version\.ts changes more than its version line \(line 1\)/
  );
  assert.match(
    why(x => {
      x.head['installer/nsis/foundry-mcp-server.nsi'] += 'Exec "evil"\n';
    }),
    /foundry-mcp-server\.nsi changes more than its version line/
  );
  // A path that names an Object.prototype member is not a version file.
  assert.match(
    why(x => x.files.push({ path: 'constructor', changeType: 'MODIFIED' })),
    /constructor is not a changelog or version file/
  );
  // The registry path on the DisplayVersion line may not change with the version.
  assert.match(
    why(edit('installer/nsis/foundry-mcp-server.nsi', 'Software\\Uninstall', 'Software\\Evil')),
    /foundry-mcp-server\.nsi changes more than its version line/
  );
  // A lock version that moves to another entry (same count) is not a bump: versions are keyed.
  assert.match(
    why(x => {
      x.head['package-lock.json'] = x.head['package-lock.json']
        .replace('"name": "@x/shared",\n      "version": "0.26.0"', '"name": "@x/shared"')
        .replace('"name": "unversioned"', '"name": "unversioned",\n      "version": "0.26.0"');
    }),
    /package-lock\.json drops or adds a version field/
  );
  // A dropped version field is not a bump.
  assert.match(
    why(edit('packages/foundry-module/module.json', '  "version": "0.26.0",\n', '')),
    /module\.json drops or adds a version field/
  );
  assert.match(
    why(edit('packages/foundry-module/module.json', '0.26.0', 'latest')),
    /module\.json has a version that is not x\.y\.z/
  );
  assert.match(
    why(x => {
      x.head['package.json'] = x.base['package.json'];
    }),
    /root package\.json version does not change/
  );
  assert.match(
    why(x => {
      x.base['shared/package.json'] = null;
    }),
    /shared\/package\.json is added or deleted/
  );
});

test('changelog: a release PR passes without --no-changelog; anything more is refused and says why', () => {
  const f = releaseFixture();
  const paths = f.files.map(x => x.path);
  const changeTypes = Object.fromEntries(
    f.files.map(x => [x.path, x.changeType === 'DELETED' ? 'D' : 'M'])
  );
  // module.json and shared/src are risky (wire contracts), so the release needs an Opus note.
  const vault = vaultWith([{ name: '312-opus-review.md', text: note() }]);
  const r = gate({ vault, files: paths, changeTypes, show: f.read });
  assert.equal(r.code, 0, r.text);
  assert.ok(r.merged);
  assert.ok(
    r.lines.includes(
      'lane:merge: changelog: a release PR (only the fold and version bumps), so no fragment is needed'
    ),
    r.text
  );
  const more = gate({ vault, files: [...paths, 'docs/guide.md'], changeTypes, show: f.read });
  assert.equal(more.code, 1);
  assert.match(
    more.lines.at(-1),
    /refused because changelog: no added or changed changelog\.d\/\*\.md fragment \(or pass --no-changelog "reason"\); not a release PR: docs\/guide\.md is not a changelog or version file$/
  );
  // A PR that never touches CHANGELOG.md keeps the old line, with nothing about releases.
  const plain = gate({ files: ['docs/guide.md'] });
  assert.match(
    plain.text,
    /^changelog: no added or changed changelog\.d\/\*\.md fragment \(or pass --no-changelog "reason"\)$/m
  );
  assert.ok(!plain.text.includes('release'));
  assert.ok(!plain.calls.some(c => c[0] === 'git' && c[1] === 'show' && /^basesha:/.test(c[2])));
  // Not at the head: the local check refuses, and no file contents are read for a release pass.
  const away = gate({ vault, files: paths, changeTypes, show: f.read, localHead: OTHER });
  assert.equal(away.code, 1);
  assert.ok(!away.calls.some(c => c[0] === 'git' && c[1] === 'show' && /^basesha:/.test(c[2])));
});

// --- review-carry-over: a verdict carries when the PR's own patch did not change (pick P3) ---

/**
 * A real git repo for the carry tests: `main` at M0 with a.txt (30 lines) and main.txt, a PR branch
 * `pr` with B (line 3 of a.txt changed), and `aitool/main` as a remote-tracking ref set by setMain.
 */
function carryRepo() {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'lane-carry-'));
  // A fake clock: every git call is one minute later, so commits made in order have rising
  // committer times (the carry reads them to find the newest review).
  let tick = 0;
  const env = () => {
    const at = `@${1_800_000_000 + 60 * tick++} +0000`;
    return { ...process.env, GIT_COMMITTER_DATE: at, GIT_AUTHOR_DATE: at };
  };
  const g = (/** @type {string[]} */ ...args) =>
    execFileSync('git', args, {
      cwd: dir,
      encoding: 'utf8',
      stdio: ['ignore', 'pipe', 'pipe'],
      env: env(),
    }).trim();
  const run = (
    /** @type {string} */ cmd,
    /** @type {string[]} */ args,
    /** @type {string} */ input
  ) => {
    const r = spawnSync(cmd, args, {
      cwd: dir,
      encoding: 'utf8',
      env: env(),
      ...(input === undefined ? {} : { input }),
    });
    return { status: r.status ?? 1, stdout: r.stdout ?? '', stderr: r.stderr ?? '' };
  };
  const lines = Array.from({ length: 30 }, (_, i) => `line ${i + 1}`);
  const write = (/** @type {string} */ file, /** @type {string[]} */ content) =>
    fs.writeFileSync(path.join(dir, file), `${content.join('\n')}\n`);
  const commit = (/** @type {string} */ msg) => {
    g('add', '-A');
    g('commit', '-q', '-m', msg);
    return g('rev-parse', 'HEAD');
  };
  const setMain = (/** @type {string} */ sha) => g('update-ref', 'refs/remotes/aitool/main', sha);
  g('init', '-q', '-b', 'main');
  for (const [k, v] of [
    ['core.autocrlf', 'false'],
    ['user.name', 'Lane Test'],
    ['user.email', 'lane@example.invalid'],
    ['commit.gpgsign', 'false'],
  ]) {
    g('config', k, v);
  }
  write('a.txt', lines);
  write('main.txt', ['main 1']);
  const M0 = commit('base');
  g('checkout', '-q', '-b', 'pr');
  write(
    'a.txt',
    lines.map((l, i) => (i === 2 ? 'line 3 changed by the PR' : l))
  );
  const B = commit('the PR');
  setMain(M0);
  return { dir, g, run, lines, write, commit, setMain, M0, B };
}

/** A note (Sonnet unless `opus`) for one reviewed sha, parsed as the gate reads it. */
const reviewed = (/** @type {string} */ sha, opus = false, verdict = '**Merge.** Fine.') =>
  parseReviewNote(
    opus ? '312-opus-review.md' : '312-review.md',
    note({ head: sha, verdict, title: opus ? 'PR #312 Opus review' : 'PR #312 review' }),
    312
  );

/** Move main on with a change in main.txt only (far from the PR's lines). */
function mainMovesOn(/** @type {ReturnType<typeof carryRepo>} */ r) {
  r.g('checkout', '-q', 'main');
  r.write('main.txt', ['main 1', 'main 2']);
  const M1 = r.commit('main moves on');
  r.g('checkout', '-q', 'pr');
  return M1;
}

test('carry (1): a clean merge of main into the branch carries the verdict', () => {
  const r = carryRepo();
  const M1 = mainMovesOn(r);
  r.g('merge', '-q', '--no-edit', 'main');
  const C = r.g('rev-parse', 'HEAD');
  r.setMain(M1);
  const a = patchIdAt(r.run, r.B);
  const b = patchIdAt(r.run, C);
  assert.ok('id' in a && 'id' in b && a.id === b.id, JSON.stringify({ a, b }));
  const notes = [reviewed(r.B)];
  const carry = carriedReviews(r.run, notes, C);
  assert.deepEqual(carry, { carried: [r.B], carryError: null });
  const verdict = judgeReviews(notes, C, false, carry);
  assert.equal(verdict.ok, true, verdict.detail);
  assert.deepEqual(verdict.carriedFrom, [r.B]);
});

test('carry (2): a merge with a conflict resolution does NOT carry', () => {
  const r = carryRepo();
  r.g('checkout', '-q', 'main');
  r.write(
    'a.txt',
    r.lines.map((l, i) => (i === 2 ? 'line 3 changed on main' : l))
  );
  const M1 = r.commit('main changes the same line');
  r.g('checkout', '-q', 'pr');
  const merged = r.run('git', ['merge', '-q', '--no-edit', 'main']);
  assert.notEqual(merged.status, 0, 'the merge must conflict');
  // resolved to the PR's own line: the PR's patch now replaces main's line, not the old one
  r.g('checkout', '--ours', 'a.txt');
  r.g('add', 'a.txt');
  r.g('commit', '-q', '--no-edit');
  const C = r.g('rev-parse', 'HEAD');
  r.setMain(M1);
  const notes = [reviewed(r.B)];
  const carry = carriedReviews(r.run, notes, C);
  assert.deepEqual(carry, { carried: [], carryError: null });
  const verdict = judgeReviews(notes, C, false, carry);
  assert.equal(verdict.ok, false);
  assert.match(
    verdict.detail,
    /^no review note for head .*; not carried: the patch changed since every reviewed commit/
  );
});

test('carry (3): a new commit that changes one line does not carry', () => {
  const r = carryRepo();
  r.write(
    'a.txt',
    r.lines.map((l, i) => (i === 2 ? 'line 3 changed by the PR' : i === 19 ? 'line 20 too' : l))
  );
  const B2 = r.commit('one more line');
  assert.deepEqual(carriedReviews(r.run, [reviewed(r.B)], B2), { carried: [], carryError: null });
  // whitespace counts (patch-id --verbatim): an indentation-only change does not carry either
  r.g('reset', '-q', '--hard', r.B);
  r.write(
    'a.txt',
    r.lines.map((l, i) => (i === 2 ? '  line 3 changed by the PR' : l))
  );
  const ws = r.commit('indent only');
  assert.deepEqual(carriedReviews(r.run, [reviewed(r.B)], ws), { carried: [], carryError: null });
});

test('carry (4): a rebase onto a newer main with no change carries', () => {
  const r = carryRepo();
  const M1 = mainMovesOn(r);
  r.g('checkout', '-q', '-b', 'pr-rebased', M1);
  r.g('cherry-pick', r.B);
  const B1 = r.g('rev-parse', 'HEAD');
  assert.notEqual(B1, r.B);
  r.setMain(M1);
  const notes = [reviewed(r.B)];
  const carry = carriedReviews(r.run, notes, B1);
  assert.deepEqual(carry, { carried: [r.B], carryError: null });
  assert.equal(judgeReviews(notes, B1, false, carry).ok, true);
});

test('carry (5): an Opus-required PR with a carried Sonnet note still refuses', () => {
  const r = carryRepo();
  const M1 = mainMovesOn(r);
  r.g('merge', '-q', '--no-edit', 'main');
  const C = r.g('rev-parse', 'HEAD');
  r.setMain(M1);
  const sonnet = [reviewed(r.B)];
  const verdict = judgeReviews(sonnet, C, true, carriedReviews(r.run, sonnet, C));
  assert.equal(verdict.ok, false);
  assert.equal(
    verdict.detail,
    `only a Sonnet review (312-review.md) says Merge for ${C.slice(0, 7)} (verdict carried from ${r.B}), and this PR needs an Opus review`
  );
  // a carried Opus Merge clears it; a carried Do not merge on the same patch still vetoes
  const opus = [reviewed(r.B, true)];
  assert.equal(judgeReviews(opus, C, true, carriedReviews(r.run, opus, C)).ok, true);
  const veto = [reviewed(r.B, true), reviewed(r.B, false, '**Do not merge.** Broken.')];
  const v = judgeReviews(veto, C, true, carriedReviews(r.run, veto, C));
  assert.equal(v.ok, false);
  assert.match(v.detail, /says "Do not merge\." for head .* \(verdict carried from /);
});

test('carry: any error carries nothing (unknown commit, shallow clone, old git, no main)', () => {
  const r = carryRepo();
  const M1 = mainMovesOn(r);
  r.g('merge', '-q', '--no-edit', 'main');
  const C = r.g('rev-parse', 'HEAD');
  r.setMain(M1);
  // a reviewed commit this clone does not have and cannot fetch (no aitool remote here)
  const gone = 'abcdef0123456789abcdef0123456789abcdef01';
  const lost = carriedReviews(r.run, [reviewed(r.B), reviewed(gone, true)], C);
  assert.deepEqual(lost.carried, []);
  assert.match(lost.carryError ?? '', /^commit abcdef0 is not in this clone and cannot be fetched/);
  const verdict = judgeReviews([reviewed(r.B)], C, false, lost);
  assert.equal(verdict.ok, false);
  assert.match(
    verdict.detail,
    /; not carried: commit abcdef0 .*; a review note for the head is needed$/
  );
  /** A run that answers one git subcommand itself and passes the rest to the real repo. */
  const faking =
    (/** @type {(args: string[]) => any} */ fake) =>
    (/** @type {string} */ cmd, /** @type {string[]} */ args, /** @type {string} */ input) =>
      fake(args) ?? r.run(cmd, args, input);
  const shallow = faking(a =>
    a[1] === '--is-shallow-repository' ? { status: 0, stdout: 'true\n', stderr: '' } : null
  );
  assert.match(carriedReviews(shallow, [reviewed(r.B)], C).carryError ?? '', /shallow/);
  const oldGit = faking(a =>
    a[0] === 'patch-id'
      ? { status: 129, stdout: '', stderr: "error: unknown option `verbatim'" }
      : null
  );
  assert.match(
    carriedReviews(oldGit, [reviewed(r.B)], C).carryError ?? '',
    /git patch-id for .* failed \(error: unknown option/
  );
  r.g('update-ref', '-d', 'refs/remotes/aitool/main');
  assert.match(carriedReviews(r.run, [reviewed(r.B)], C).carryError ?? '', /no merge base of /);
  // only the head reviewed: nothing to compare, no git call at all
  const none = () => {
    throw new Error('no call expected');
  };
  assert.deepEqual(carriedReviews(none, [reviewed(C)], C), { carried: [], carryError: null });
});

test('carry (review M2): a later review on another patch, then that change dropped, does not carry', () => {
  const r = carryRepo();
  // X = B was reviewed Merge; Y adds a line and gets Do not merge; the lane drops Y's change again
  r.write(
    'a.txt',
    r.lines.map((l, i) => (i === 2 ? 'line 3 changed by the PR' : i === 19 ? 'line 20 too' : l))
  );
  const Y = r.commit('a change the review vetoed');
  r.write(
    'a.txt',
    r.lines.map((l, i) => (i === 2 ? 'line 3 changed by the PR' : l))
  );
  const Z = r.commit('drop it again');
  const notes = [
    reviewed(r.B, true),
    parseReviewNote(
      '312-opus-review-round2.md',
      note({ head: Y, verdict: '**Do not merge.** Broken.', title: 'PR #312 Opus review' }),
      312
    ),
  ];
  const carry = carriedReviews(r.run, notes, Z);
  assert.deepEqual(carry.carried, []);
  assert.equal(
    carry.carryError,
    `the newest reviewed commit (${Y.slice(0, 7)}) has a different patch from the head`
  );
  assert.equal(judgeReviews(notes, Z, true, carry).ok, false);
  // the usual order (an older veto, then fixes reviewed Merge) still carries after a merge of main
  const M1 = mainMovesOn(r);
  r.g('checkout', '-q', 'pr');
  r.g('merge', '-q', '--no-edit', 'main');
  const C = r.g('rev-parse', 'HEAD');
  r.setMain(M1);
  const fixed = [
    parseReviewNote(
      '312-opus-review.md',
      note({ head: Y, verdict: '**Do not merge.** Broken.', title: 'PR #312 Opus review' }),
      312
    ),
    parseReviewNote(
      '312-opus-review-round2.md',
      note({ head: Z, title: 'PR #312 Opus review' }),
      312
    ),
  ];
  const ok = carriedReviews(r.run, fixed, C);
  assert.deepEqual(ok, { carried: [Z], carryError: null });
  assert.equal(judgeReviews(fixed, C, true, ok).ok, true);
});

test('carry (review M1): any short sha in a note turns the carry off', () => {
  const merge = reviewed(OTHER);
  const veto = parseReviewNote(
    '312-review-round2.md',
    note({ head: 'abcdef1', verdict: '**Do not merge.** Broken.' }),
    312
  );
  const verdict = judgeReviews([merge, veto], HEAD, false, { carried: [OTHER], carryError: null });
  assert.equal(verdict.ok, false);
  assert.match(
    verdict.detail,
    /^no review note for head 3d24f70 .*; not carried: 312-review-round2\.md reviewed abcdef1 by a short sha, which could hide a verdict on the same patch/
  );
  // without the short sha the same carry passes
  assert.equal(judgeReviews([merge], HEAD, false, { carried: [OTHER], carryError: null }).ok, true);
});

const PATCH_A = 'a'.repeat(40);
const PATCH_B = 'c'.repeat(40);

test('gate: a note for an earlier commit with the same patch carries; the output says so', () => {
  const vault = vaultWith([{ name: '312-review.md', text: note({ head: OTHER }) }]);
  const r = gate({ vault, argv: ['--dry-run'], patchIds: { [HEAD]: PATCH_A, [OTHER]: PATCH_A } });
  assert.equal(r.code, 0, r.text);
  assert.ok(
    r.lines.includes(
      `lane:merge: review: verdict carried from ${OTHER} (312-review.md): the PR's patch at head 3d24f70 is the same (git patch-id)`
    ),
    r.text
  );
  assert.equal(
    r.lines.at(-1),
    'lane:merge: OK #312 at 3d24f70 (dry run, nothing merged); merge train 0/4; verdict carried from fffffff'
  );
  // each merge base is taken from aitool/main and an explicit commit, never main itself or HEAD
  const bases = r.calls.filter(c => c[1] === 'merge-base').map(c => c.slice(2));
  assert.deepEqual(bases, [
    ['aitool/main', 'HEAD'],
    ['aitool/main', HEAD],
    ['aitool/main', OTHER],
  ]);
});

test('gate: a changed patch, a missing commit, a shallow clone or no fetch refuses', () => {
  const vault = vaultWith([{ name: '312-review.md', text: note({ head: OTHER }) }]);
  const same = { [HEAD]: PATCH_A, [OTHER]: PATCH_A };
  const changed = gate({ vault, patchIds: { [HEAD]: PATCH_A, [OTHER]: PATCH_B } });
  assert.equal(changed.code, 1);
  assert.match(
    changed.text,
    /^review: no review note for head 3d24f70 \(found 312-review\.md reviewed fffffff\); not carried: the patch changed since every reviewed commit; a review note for the head is needed; the gate reads files named/m
  );
  assert.ok(!changed.merged);
  const missing = gate({ vault, missing: [OTHER], patchIds: same });
  assert.equal(missing.code, 1);
  assert.match(
    missing.text,
    /not carried: commit fffffff is not in this clone and cannot be fetched \(not our ref\)/
  );
  const shallow = gate({ vault, shallow: true, patchIds: same });
  assert.equal(shallow.code, 1);
  assert.match(shallow.text, /not carried: this clone is shallow/);
  const noFetch = gate({ vault, fetchFail: true, patchIds: same });
  assert.equal(noFetch.code, 1);
  assert.match(noFetch.text, /not carried: git fetch aitool main failed: no network/);
});

test('gate: a note for the head itself computes no patch id; a malformed note never carries', () => {
  const r = gate({ argv: ['--dry-run'] });
  assert.equal(r.code, 0, r.text);
  assert.ok(!r.calls.some(c => c[1] === 'patch-id' || c[1] === 'cat-file'));
  const bad = vaultWith([
    { name: '312-review.md', text: `${note({ head: OTHER })}\nHead reviewed: ${HEAD}\n` },
  ]);
  const m = gate({ vault: bad, patchIds: { [HEAD]: PATCH_A, [OTHER]: PATCH_A } });
  assert.equal(m.code, 1);
  assert.ok(!m.calls.some(c => c[1] === 'patch-id'));
  assert.match(m.text, /is malformed/);
});

test('gate: a risky PR with a carried Opus note says found; a merge writes the carry to the train note', () => {
  const vault = vaultWith([
    { name: '312-opus-review.md', text: note({ head: OTHER, title: 'PR #312 Opus review' }) },
  ]);
  fs.mkdirSync(path.join(vault, '.git'));
  /** @type {string[][]} */
  const vaultGit = [];
  // the write gate is risky (Opus) and train-relevant (the note is written on a merge)
  const r = gate({
    vault,
    files: ['packages/foundry-module/src/write-gate.ts', 'changelog.d/thing.md'],
    patchIds: { [HEAD]: PATCH_A, [OTHER]: PATCH_A },
    vaultRun: a => {
      vaultGit.push(a);
      return { status: 0, stdout: '', stderr: '' };
    },
  });
  assert.equal(r.code, 0, r.text);
  assert.ok(r.merged);
  assert.match(r.text, /Opus note for head 3d24f70: found \(312-opus-review\.md\)/);
  assert.match(r.text, /merged #312 at 3d24f70; merge train 1\/4; verdict carried from fffffff/);
  const text = fs.readFileSync(NOTE_FILE(vault), 'utf8');
  assert.match(
    text,
    new RegExp(`last-event-pr: 312\\nlast-event-verdict-carried-from: ${OTHER}\\nlast-event-at: `)
  );
  const commit = vaultGit.find(a => a[0] === 'commit');
  assert.deepEqual(commit?.slice(1, 5), [
    '-m',
    'Merge train: merge #312, 1/4',
    '-m',
    `verdict carried from ${OTHER}`,
  ]);
});

test('merge train note: a carried verdict is one sha line, which the board parser accepts', async () => {
  const event = { kind: 'merge', pr: 461, at: NOTE_NOW, carriedFrom: [OTHER, 'not a sha'] };
  const text = renderTrainNote(TRAIN_STATE, /** @type {any} */ (event), NOTE_NOW);
  assert.match(text, new RegExp(`\\nlast-event-verdict-carried-from: ${OTHER}\\nlast-event-at: `));
  const board = await boardParser();
  if (board) assert.deepEqual(board.parseMergeTrain(text).problems, []);
});
