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
import { fileURLToPath } from 'node:url';
import {
  RISKY_CATEGORIES,
  TRAIN_PATTERNS,
  TRAIN_SIZE,
  acquireLock,
  entryDecision,
  findReviewNotes,
  globToRegExp,
  hasChangelogFragment,
  hasRelativeImports,
  isEntryModule,
  isTrainRelevant,
  judgeReviews,
  main,
  matchesAny,
  parseArgs,
  parseNameStatus,
  parseReviewNote,
  readTrain,
  relaunchFromMain,
  requiredContexts,
  riskyHits,
  rollupProblems,
} from './lane-merge.mjs';

const HEAD = '3d24f70a1b2c3d4e5f60718293a4b5c6d7e8f901';
const OTHER = 'ffffffff00000000000000000000000000000000';
const SELF = fileURLToPath(new URL('./lane-merge.mjs', import.meta.url));
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

/**
 * A gate run against fakes. Returns the output lines, the exit code, the calls and the state file.
 * @param {{ vault?: string, files?: string[], ghFiles?: string[], rollup?: any[], pr?: object,
 *   localHead?: string, dirty?: boolean, drift?: number, argv?: string[], train?: object,
 *   merge?: number, rules?: any, rulesFail?: boolean, fetchFail?: boolean, driftSource?: string | null,
 *   lockTimeoutMs?: number, onDrift?: (stateFile: string) => void }} o
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
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.slice(0, 2).join(' ')}`;
    if (key === 'gh pr view') return ok(JSON.stringify(pr));
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
      const entry = p => `${p.startsWith('changelog.d/') ? 'A' : 'M'}${nul}${p}${nul}`;
      return ok(localPaths.map(entry).join(''));
    }
    if (key === 'git rev-parse HEAD') return ok(`${o.localHead ?? HEAD}\n`);
    if (key === 'git status --porcelain') return ok(o.dirty ? ' M a.txt\n?? b.txt\n' : '');
    if (key === 'git show aitool/main:scripts/drift-check.mjs') {
      return o.driftSource === null
        ? { status: 128, stdout: '', stderr: 'fatal: path not in aitool/main' }
        : ok(o.driftSource ?? FAKE_DRIFT_SOURCE);
    }
    if (cmd === 'node' && args[0] === '--input-type=module') {
      o.onDrift?.(state);
      return {
        status: o.drift ?? 0,
        stdout: 'drift output\n',
        stderr: o.drift ? 'guard failed\n' : '',
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
  const code = main({
    argv: ['312', '--vault', vault, '--state', state, ...(o.argv ?? [])],
    run,
    log: l => lines.push(l),
    home,
    tmpdir: home,
    now: () => new Date('2026-10-10T12:00:00Z'),
    lockTimeoutMs: o.lockTimeoutMs ?? 300,
  });
  return {
    code,
    lines,
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
  assert.deepEqual(category('.claude/hooks/guard-remote-commands.mjs'), [
    'security',
    'the merge gate',
  ]);
  assert.deepEqual(category('scripts/pi/remote/5-tool.sh'), ['Pi scripts']);
  assert.deepEqual(category('scripts/plan-b/start.ps1'), ['Pi scripts']);
  assert.deepEqual(category('deploy/Dockerfile'), ['Pi scripts']);
  assert.deepEqual(category('shared/src/protocol.ts'), ['wire contracts']);
  assert.deepEqual(category('packages/foundry-module/module.json'), ['wire contracts']);
  for (const gateInput of [
    'scripts/lane-merge.mjs',
    'scripts/green.mjs',
    'scripts/drift-check.mjs',
    '.github/workflows/ci.yml',
    '.claude/hooks/context-alert.mjs',
    '.claude/settings.json',
  ]) {
    assert.ok(category(gateInput).includes('the merge gate'), gateInput);
  }
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
  assert.ok(r.calls.some(c => c[0] === 'node' && c[1] === '--input-type=module'));
  assert.ok(
    !r.calls.some(c => c.join(' ') === 'npm run drift:check'),
    'main copy, not the local script'
  );
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

test('H1: edits to the gate or what it executes need an Opus review', () => {
  for (const file of [
    'scripts/lane-merge.mjs',
    'scripts/drift-check.mjs',
    '.claude/hooks/context-alert.mjs',
    '.claude/settings.json',
    '.github/workflows/ci.yml',
  ]) {
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
  assert.match(r.text, /drift: drift-check failed \(log /);
  assert.ok(r.lines.includes('guard failed'));
});

test("H1: drift-check runs from a temp copy of main's script, not the branch's npm script", () => {
  const r = gate({});
  const node = r.calls.find(c => c[0] === 'node');
  assert.deepEqual(node.slice(1, 3), ['--input-type=module', '-e']);
  assert.match(node[3], /runDriftCheck/);
  assert.match(node[4], /^file:\/\/\/.*lane-merge-drift-.*drift-check\.mjs$/);
  const copy = fs.readFileSync(fileURLToPath(node[4]), 'utf8');
  assert.equal(copy, FAKE_DRIFT_SOURCE);
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
  });
  assert.equal(code, 1);
  assert.deepEqual(lines, [
    'lane:merge: NOT merged #312',
    'pr: gh pr view 312 failed: could not resolve to a PullRequest',
  ]);
});

/** relaunchFromMain with fakes: a "self" file with `selfText`, main's copy `mainText` (or null). */
function relaunch({
  selfText = 'gate A\n',
  mainText = 'gate A\n',
  fetchFail = false,
  env = {},
  argv = ['312'],
} = {}) {
  const dir = tmpDir();
  const selfPath = path.join(dir, 'lane-merge.mjs');
  fs.writeFileSync(selfPath, selfText);
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
      return mainText === null
        ? { status: 128, stdout: '', stderr: 'fatal' }
        : { status: 0, stdout: mainText, stderr: '' };
    },
    spawn: (cmd, args, opts) => {
      spawned.push({ cmd, args, opts });
      return { status: 7 };
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
  ]);
  assert.equal(relaunch({ mainText: 'gate A\r\n' }).out.relaunched, false);
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
