/**
 * scripts/lane-merge.mjs: the merge gate. gh, git and npm are faked through the injectable `run`;
 * the vault and the merge train state are temp directories.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  RISKY_CATEGORIES,
  TRAIN_PATTERNS,
  TRAIN_SIZE,
  globToRegExp,
  hasChangelogFragment,
  isTrainRelevant,
  judgeReviews,
  findReviewNotes,
  main,
  parseArgs,
  parseReviewNote,
  riskyHits,
  rollupProblems,
  shaMatches,
  readTrain,
} from './lane-merge.mjs';

const HEAD = '3d24f70a1b2c3d4e5f60718293a4b5c6d7e8f901';
const OTHER = 'ffffffff00000000000000000000000000000000';

/** A review note in the vault format. */
function note({
  head = '3d24f70a',
  verdict = '**Merge.** All fine.',
  title = 'PR #310 review',
} = {}) {
  return `---\ntype: review\n---\n\n# ${title}\n\nHead reviewed: \`${head}\` (CI green).\n\n## Verdict\n\n${verdict}\n\n## What I checked\n\n- **Bold later**\n`;
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

/**
 * A gate run against fakes. Returns the output lines, the exit code, the calls and the state file.
 * @param {{ vault?: string, files?: string[], rollup?: any[], pr?: object, localHead?: string,
 *   dirty?: boolean, drift?: number, argv?: string[], train?: object, merge?: number }} o
 */
function gate(o = {}) {
  const vault = o.vault ?? vaultWith([{ name: '312-review.md', text: note() }]);
  const home = tmpDir();
  const state = path.join(home, 'merge-train.json');
  if (o.train) fs.writeFileSync(state, JSON.stringify(o.train));
  const files = (o.files ?? ['docs/guide.md', 'changelog.d/thing.md']).map(p => ({ path: p }));
  const pr = {
    number: 312,
    state: 'OPEN',
    isDraft: false,
    baseRefName: 'main',
    headRefName: 'claude/thing',
    headRefOid: HEAD,
    mergeable: 'MERGEABLE',
    title: 'A thing',
    files,
    statusCheckRollup: o.rollup ?? [
      { __typename: 'CheckRun', name: 'build-test', status: 'COMPLETED', conclusion: 'SUCCESS' },
      { __typename: 'CheckRun', name: 'codeql', status: 'COMPLETED', conclusion: 'SKIPPED' },
    ],
    ...o.pr,
  };
  /** @type {string[][]} */
  const calls = [];
  const run = (cmd, args) => {
    calls.push([cmd, ...args]);
    const key = `${cmd} ${args.slice(0, 2).join(' ')}`;
    if (key === 'gh pr view') return { status: 0, stdout: JSON.stringify(pr), stderr: '' };
    if (key === 'git rev-parse HEAD')
      return { status: 0, stdout: `${o.localHead ?? HEAD}\n`, stderr: '' };
    if (key === 'git status --porcelain') {
      return { status: 0, stdout: o.dirty ? ' M a.txt\n?? b.txt\n' : '', stderr: '' };
    }
    if (key === 'npm run drift:check') {
      return {
        status: o.drift ?? 0,
        stdout: 'drift output\n',
        stderr: o.drift ? 'guard failed\n' : '',
      };
    }
    if (key === 'gh pr merge')
      return { status: o.merge ?? 0, stdout: '', stderr: o.merge ? 'not allowed' : '' };
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
  });
  return { code, lines, calls, state, merged: calls.some(c => c[0] === 'gh' && c[2] === 'merge') };
}

test('shaMatches: either side may be the prefix, at least 7 characters', () => {
  assert.ok(shaMatches('3d24f70a', HEAD));
  assert.ok(shaMatches(HEAD, '3d24f70'));
  assert.ok(!shaMatches('3d24f7', HEAD));
  assert.ok(!shaMatches('3d24f71', HEAD));
});

test('parseReviewNote: head sha forms, verdict forms, opus', () => {
  const backtick = parseReviewNote('310-opus-review.md', note());
  assert.equal(backtick.head, '3d24f70a');
  assert.ok(backtick.merge && backtick.opus);
  const bare = parseReviewNote(
    '1-review.md',
    'Head reviewed: 95adeaaf. CI: 8/8.\n\n## Verdict\n\n**Merge.**\n'
  );
  assert.equal(bare.head, '95adeaaf');
  assert.ok(bare.merge && !bare.opus);
  const full = parseReviewNote(
    '1-review.md',
    `Head reviewed: \`${HEAD}\`\n\n## Verdict\n\n**Merge**, nothing else.\n`
  );
  assert.equal(full.head, HEAD);
  assert.ok(full.merge);
  const fixes = parseReviewNote(
    '1-review.md',
    note({ verdict: '**Merge after fixes.** One medium.' })
  );
  assert.equal(fixes.verdict, 'Merge after fixes.');
  assert.ok(!fixes.merge);
  assert.ok(!parseReviewNote('1-review.md', note({ verdict: '**Do not merge.** Broken.' })).merge);
  assert.ok(!parseReviewNote('1-review.md', note({ verdict: 'Merge it, looks fine.' })).merge);
  assert.equal(
    parseReviewNote('1-review.md', '# x\n\nHead 410d764e. Verdict: **merge**.\n').head,
    null
  );
  assert.equal(parseReviewNote('1-review.md', note({ head: '3d24f7' })).head, null);
});

test('parseReviewNote: the first bold text under Verdict counts, not a later one', () => {
  const text = note({ verdict: 'Mostly fine, but **Merge after fixes.** Then **Merge.**' });
  assert.ok(!parseReviewNote('1-review.md', text).merge);
  assert.ok(parseReviewNote('1-x.md', note({ title: 'Opus check of PR #1' })).opus);
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

test('judgeReviews: head must match, verdict must be Merge, Opus when risky', () => {
  const ok = parseReviewNote('312-review.md', note());
  const opus = parseReviewNote('312-opus-review.md', note());
  const old = parseReviewNote('312-review-round1.md', note({ head: '1111111' }));
  const fixes = parseReviewNote('312-review-r2.md', note({ verdict: '**Merge after fixes.**' }));
  assert.ok(judgeReviews([ok], HEAD, false).ok);
  assert.ok(judgeReviews([old, ok], HEAD, false).ok);
  assert.match(judgeReviews([old], HEAD, false).detail, /no review note for head 3d24f70/);
  assert.match(judgeReviews([fixes], HEAD, false).detail, /Merge after fixes/);
  assert.match(judgeReviews([], HEAD, false).detail, /no review note/);
  const needOpus = judgeReviews([ok], HEAD, true);
  assert.ok(!needOpus.ok);
  assert.match(needOpus.detail, /needs an Opus review/);
  assert.ok(judgeReviews([ok, opus], HEAD, true).ok);
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
  assert.deepEqual(category('packages/mcp-server/src/control-target.ts'), ['the bridge link']);
  assert.deepEqual(category('packages/cogm-dashboard/src/auth.ts'), ['security']);
  assert.deepEqual(category('.claude/hooks/guard-remote-commands.mjs'), ['security']);
  assert.deepEqual(category('.github/workflows/ci.yml'), ['security']);
  assert.deepEqual(category('scripts/pi/remote/5-tool.sh'), ['Pi scripts']);
  assert.deepEqual(category('scripts/plan-b/start.ps1'), ['Pi scripts']);
  assert.deepEqual(category('deploy/Dockerfile'), ['Pi scripts']);
  assert.deepEqual(category('shared/src/protocol.ts'), ['wire contracts']);
  assert.deepEqual(category('packages/foundry-module/module.json'), ['wire contracts']);
  assert.deepEqual(category('scripts/lane-merge.mjs'), ['the merge gate']);
  for (const calm of [
    'docs/guide.md',
    'packages/cogm-dashboard/web/src/App.tsx',
    'packages/mcp-server/src/tools/dice.ts',
    'scripts/drift-check.mjs',
  ]) {
    assert.deepEqual(category(calm), [], calm);
  }
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
});

test('rollupProblems: check runs and commit statuses, failing and pending', () => {
  const ok = rollupProblems([
    { name: 'a', status: 'COMPLETED', conclusion: 'SUCCESS' },
    { name: 'b', status: 'COMPLETED', conclusion: 'SKIPPED' },
    { name: 'c', status: 'COMPLETED', conclusion: 'NEUTRAL' },
    { context: 'ci/legacy', state: 'SUCCESS' },
  ]);
  assert.deepEqual(ok, { failing: [], pending: [] });
  const bad = rollupProblems([
    { name: 'a', status: 'COMPLETED', conclusion: 'FAILURE' },
    { name: 'b', status: 'IN_PROGRESS', conclusion: '' },
    { name: 'c', status: 'QUEUED' },
    { context: 'ci/legacy', state: 'PENDING' },
    { context: 'ci/other', state: 'FAILURE' },
    { name: 'd', status: 'COMPLETED', conclusion: 'CANCELLED' },
  ]);
  assert.deepEqual(bad.failing, ['a (FAILURE)', 'ci/other (FAILURE)', 'd (CANCELLED)']);
  assert.deepEqual(bad.pending, ['b (IN_PROGRESS)', 'c (QUEUED)', 'ci/legacy (PENDING)']);
});

test('hasChangelogFragment: added or changed fragments only', () => {
  assert.ok(hasChangelogFragment([{ path: 'changelog.d/x.md' }]));
  assert.ok(!hasChangelogFragment([{ path: 'changelog.d/README.md' }]));
  assert.ok(!hasChangelogFragment([{ path: 'CHANGELOG.md' }, { path: 'docs/changelog.d/x.md' }]));
  assert.ok(!hasChangelogFragment([{ path: 'changelog.d/x.md', changeType: 'DELETED' }]));
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

test('dry run: all checks pass, prints the OK line, never calls gh pr merge or writes the train', () => {
  const r = gate({
    argv: ['--dry-run'],
    files: ['packages/foundry-module/src/main.ts', 'changelog.d/thing.md'],
  });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(
    r.lines.at(-1),
    'lane:merge: OK #312 at 3d24f70 (dry run, nothing merged); merge train 0/4'
  );
  assert.ok(!r.merged);
  assert.ok(!fs.existsSync(r.state));
  assert.ok(r.calls.some(c => c.join(' ') === 'npm run drift:check'));
});

test('merge: calls gh pr merge with the head commit and prints the merged line', () => {
  const r = gate({});
  assert.equal(r.code, 0, r.lines.join('\n'));
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
  const text = r.lines.join('\n');
  assert.match(text, /pr: #312 is a draft/);
  assert.match(text, /pr: base is dev, not main/);
  assert.match(text, /pr: mergeable is CONFLICTING/);
  assert.match(text, /ci: failing: build-test \(FAILURE\); pending: python-tests \(IN_PROGRESS\)/);
  assert.match(text, /review: no review note for head 3d24f70/);
  assert.match(text, /changelog: no added or changed/);
  assert.match(
    text,
    /local: this checkout is at fffffff, the PR head is 3d24f70; check out claude\/thing/
  );
  assert.match(text, /local: the working tree is not clean \(2 changes\)/);
  assert.ok(!r.calls.some(c => c[0] === 'npm'), 'drift:check waits for the cheap checks');
});

test('no checks reported at all fails the CI check', () => {
  const r = gate({ rollup: [] });
  assert.match(r.lines.join('\n'), /ci: no checks reported/);
});

test('review: Merge after fixes, a stale head and the wrong PR number do not count', () => {
  const stale = vaultWith([
    { name: '312-review.md', text: note({ head: '1111111aaaa' }) },
    { name: '3120-review.md', text: note() },
  ]);
  assert.match(gate({ vault: stale }).lines.join('\n'), /review: no review note for head 3d24f70/);
  const fixes = vaultWith([
    { name: '312-review.md', text: note({ verdict: '**Merge after fixes.**' }) },
  ]);
  assert.match(
    gate({ vault: fixes }).lines.join('\n'),
    /review: no review says Merge for head 3d24f70 \(312-review.md: Merge after fixes/
  );
  assert.match(
    gate({ vault: path.join(os.tmpdir(), 'no-such-vault-xyz') }).lines.join('\n'),
    /review: vault not found/
  );
});

test('risky files need an Opus review, and the category is printed', () => {
  const files = ['packages/foundry-module/src/write-gate.ts', 'changelog.d/thing.md'];
  const sonnet = gate({ files });
  assert.equal(sonnet.code, 1);
  assert.match(
    sonnet.lines.join('\n'),
    /risky \(the write gate\): packages\/foundry-module\/src\/write-gate.ts/
  );
  assert.match(sonnet.lines.join('\n'), /needs an Opus review/);
  const opusVault = vaultWith([{ name: '312-opus-review.md', text: note() }]);
  const opus = gate({ files, vault: opusVault, argv: ['--dry-run'] });
  assert.equal(opus.code, 0, opus.lines.join('\n'));
  assert.ok(opus.lines.some(l => l.includes('risky (the write gate)')));
  const headingVault = vaultWith([
    { name: '312-review.md', text: note({ title: 'Opus review of 312' }) },
  ]);
  assert.equal(gate({ files, vault: headingVault, argv: ['--dry-run'] }).code, 0);
});

test('changelog: required unless --no-changelog gives a reason, which is printed', () => {
  const files = ['docs/guide.md'];
  const without = gate({ files });
  assert.equal(without.code, 1);
  assert.match(without.lines.join('\n'), /changelog:/);
  const waived = gate({ files, argv: ['--no-changelog', 'docs typo only'] });
  assert.equal(waived.code, 0, waived.lines.join('\n'));
  assert.match(
    waived.lines.at(-1),
    /merged #312 at 3d24f70; merge train 0\/4; no changelog: docs typo only/
  );
});

test('drift:check failing is reported with the last 30 lines of its output', () => {
  const r = gate({ drift: 1 });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(r.lines.join('\n'), /drift: npm run drift:check failed \(log /);
  assert.ok(r.lines.includes('guard failed'));
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

test('merge train full: a train-relevant PR is refused with the planner instruction, nothing merged', () => {
  const r = gate({ files: MODULE_FILES, train: trainOf(TRAIN_SIZE) });
  assert.equal(r.code, 1);
  assert.ok(!r.merged);
  assert.match(
    r.lines.join('\n'),
    /train: merge train full \(4\/4\): the planner runs npm run live:roundtrip on main, then npm run lane:merge -- --train-reset <sha>/
  );
  const calm = gate({ train: trainOf(TRAIN_SIZE) });
  assert.equal(calm.code, 0, 'a PR outside the module is not held by a full train');
  assert.match(calm.lines.at(-1), /merge train 4\/4$/);
});

test('merge train: a merged module PR is appended, and the third one asks for a roundtrip', () => {
  const first = gate({ files: MODULE_FILES, train: trainOf(1) });
  assert.equal(first.code, 0, first.lines.join('\n'));
  assert.equal(first.lines.at(-1), 'lane:merge: merged #312 at 3d24f70; merge train 2/4');
  const saved = readTrain(first.state);
  assert.deepEqual(saved.since.at(-1), { pr: 312, sha: HEAD, at: '2026-10-10T12:00:00.000Z' });
  assert.equal(saved.lastRoundtrip.sha, 'abc1234');
  const third = gate({ files: MODULE_FILES, train: trainOf(2) });
  assert.equal(
    third.lines.at(-1),
    'lane:merge: merged #312 at 3d24f70; merge train 3/4; run live:roundtrip before the next module merge'
  );
});

test('merge train: --train-reset records the roundtrip and empties the train, --train prints it', () => {
  const home = tmpDir();
  const state = path.join(home, 'merge-train.json');
  fs.writeFileSync(state, JSON.stringify(trainOf(4)));
  const lines = [];
  const opts = { home, log: l => lines.push(l), now: () => new Date('2026-10-10T13:00:00Z') };
  assert.equal(main({ ...opts, argv: ['--train', '--state', state] }), 0);
  assert.match(lines[0], /merge train 4\/4; last live:roundtrip at abc1234.*#300@sha0aaa/);
  assert.equal(main({ ...opts, argv: ['--train-reset', '9f8e7d6c5b', '--state', state] }), 0);
  assert.equal(lines[1], 'lane:merge: merge train reset at 9f8e7d6; merge train 0/4');
  assert.deepEqual(readTrain(state), {
    lastRoundtrip: { sha: '9f8e7d6c5b', at: '2026-10-10T13:00:00.000Z' },
    since: [],
  });
  assert.equal(main({ ...opts, argv: ['--train-reset', 'nothex', '--state', state] }), 2);
  const fresh = path.join(home, 'sub', 'train.json');
  assert.equal(main({ ...opts, argv: ['--train', '--state', fresh] }), 0);
  assert.match(lines.at(-1), /merge train 0\/4; no live:roundtrip recorded; merged since: none/);
});

test('a dry run does not touch the train even for a module PR', () => {
  const r = gate({ files: MODULE_FILES, train: trainOf(1), argv: ['--dry-run'] });
  assert.equal(r.code, 0, r.lines.join('\n'));
  assert.equal(readTrain(r.state).since.length, 1);
  assert.ok(!r.merged);
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
