import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { execFileSync } from 'node:child_process';
import { findReviewNotes, judgeReviews, parseReviewNote } from '../lane-merge.mjs';
import { plan, review } from './run.mjs';
import {
  appendLedger,
  budgetFor,
  buildPrompts,
  checkHead,
  classifyDelta,
  finishNote,
  latestRound,
  nextRound,
  noteName,
  parseArgs,
  pickModel,
  readLedger,
  scrub,
  secretHits,
  toolRefusal,
  totalUsd,
} from './lib.mjs';

const SHA = 'a'.repeat(40);

test('parseArgs reads PRs and flags and refuses bad input', () => {
  const o = parseArgs(['#12', '13', '--dry-run', '--model', 'opus', '--round', '2', '--max-turns', '9'], {});
  assert.deepEqual(o.prs, [12, 13]);
  assert.equal(o.dryRun, true);
  assert.equal(o.model, 'opus');
  assert.equal(o.round, 2);
  assert.equal(o.maxTurns, 9);
  assert.throws(() => parseArgs([], {}), /at least one PR/);
  assert.throws(() => parseArgs(['1', '--model', 'haiku'], {}), /opus or sonnet/);
  assert.throws(() => parseArgs(['1', '--bogus'], {}), /unknown argument/);
  assert.throws(() => parseArgs(['1', '--round'], {}), /needs a value/);
});

test('pickModel follows the merge gate risky list (D-101)', () => {
  assert.deepEqual(pickModel(['docs/gm/x.md']), { model: 'sonnet', categories: [] });
  const gate = pickModel(['scripts/lane-merge.mjs', 'shared/src/index.ts']);
  assert.equal(gate.model, 'opus');
  assert.ok(gate.categories.includes('the merge gate'));
  assert.ok(gate.categories.includes('wire contracts'));
});

test('round and note names', () => {
  assert.equal(nextRound([], 5), 1);
  assert.equal(nextRound(['5-review.md', '7-review.md'], 5), 2);
  assert.equal(nextRound(['5-opus-review.md', '5-opus-review-round2.md'], 5), 3);
  assert.equal(noteName(5, 'sonnet', 1), '5-review.md');
  assert.equal(noteName(5, 'opus', 1), '5-opus-review.md');
  assert.equal(noteName(5, 'opus', 2), '5-opus-review-round2.md');
});

test('the ledger totals and the $95 stop', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-ledger-'));
  const file = path.join(dir, 'sub', 'ledger.jsonl');
  assert.deepEqual(readLedger(file), []);
  appendLedger(file, { costUsd: 2.5 });
  appendLedger(file, { costUsd: 1.25 });
  assert.equal(totalUsd(readLedger(file)), 3.75);
  assert.equal(budgetFor(0, 'opus'), 6);
  assert.equal(budgetFor(0, 'sonnet'), 3);
  assert.equal(budgetFor(91, 'opus'), 4);
  assert.equal(budgetFor(94.6, 'sonnet'), null);
  assert.equal(budgetFor(95, 'sonnet'), null);
  fs.rmSync(dir, { recursive: true, force: true });
});

test('latestRound picks the highest round, not the last name', () => {
  const names = ['5-opus-review-round2.md', '5-opus-review.md', '5-handover.md'];
  assert.deepEqual(latestRound(names, 5), { round: 2, name: '5-opus-review-round2.md' });
  assert.deepEqual(latestRound([], 5), { round: 0, name: null });
});

test('a ledger line without a number counts as a full review, not as free', () => {
  assert.equal(totalUsd([{ costUsd: 1 }, { costUsd: /** @type {any} */ ('x') }]), 7);
});

test('toolRefusal keeps the reviewer inside its folders', () => {
  const wt = path.resolve('/work/wt');
  const roots = [wt, path.resolve('/work/scratch')];
  const refuse = (/** @type {string} */ t, /** @type {Record<string, unknown>} */ i) => toolRefusal(t, i, wt, roots);
  assert.equal(refuse('Read', { file_path: path.join(wt, 'a.ts') }), null);
  assert.equal(refuse('Read', { file_path: 'src/a.ts' }), null);
  assert.equal(refuse('Read', { file_path: path.resolve('/work/scratch/pr.diff') }), null);
  assert.match(refuse('Read', { file_path: path.resolve('/etc/passwd') }) ?? '', /outside/);
  assert.match(refuse('Read', { file_path: '../../secret' }) ?? '', /outside/);
  assert.match(refuse('Read', { file_path: path.resolve('/work/wt-evil/x') }) ?? '', /outside/);
  assert.equal(refuse('Grep', { pattern: '/etc/passwd', path: 'src' }), null);
  assert.match(refuse('Grep', { pattern: 'x', path: path.resolve('/') }) ?? '', /outside/);
  assert.match(refuse('Glob', { pattern: '../**' }) ?? '', /relative/);
  assert.match(refuse('Glob', { pattern: 'C:/Users/**' }) ?? '', /relative/);
  assert.equal(refuse('Glob', { pattern: 'src/**/*.ts' }), null);
  assert.match(refuse('Bash', { command: 'ls' }) ?? '', /not allowed/);
});

test('toolRefusal refuses home folders, variables and brace lists that start at a root', () => {
  const wt = path.resolve('/work/wt');
  const refuse = (/** @type {string} */ t, /** @type {Record<string, unknown>} */ i) => toolRefusal(t, i, wt, [wt]);
  assert.match(refuse('Read', { file_path: '~/.ssh/id_rsa' }) ?? '', /plain relative path/);
  assert.match(refuse('Read', { file_path: '~\\.claude\\.credentials.json' }) ?? '', /plain relative path/);
  assert.match(refuse('Read', { file_path: '$HOME/x' }) ?? '', /plain relative path/);
  assert.match(refuse('Read', { file_path: '%APPDATA%\\x' }) ?? '', /plain relative path/);
  assert.match(refuse('Glob', { pattern: '{C:/Users/chris/**,x}' }) ?? '', /plain relative path/);
  assert.match(refuse('Glob', { pattern: '{src/*,/etc/*}' }) ?? '', /plain relative path/);
  assert.equal(refuse('Glob', { pattern: 'src/**/*.{ts,tsx}' }), null);
  // An 8.3 short name inside a path is fine, and a drive letter on an absolute path is fine.
  assert.equal(refuse('Read', { file_path: path.join(wt, 'CHRIS~1', 'a.ts') }), null);
  // Windows paths compare without case.
  assert.equal(refuse('Read', { file_path: path.join(wt, 'A.ts').toUpperCase() }), null);
});

test('a reserve line plus a settle line total the real cost', () => {
  const budget = 3;
  const real = 0.38;
  assert.ok(Math.abs(totalUsd([{ costUsd: budget }, { costUsd: real - budget }]) - real) < 1e-9);
  // A run with no settle line stays at the full budget.
  assert.equal(totalUsd([{ costUsd: budget }]), budget);
});

test('secretHits finds the key and token-like strings', () => {
  assert.deepEqual(secretHits('fine', 'sk-ant-abc'), []);
  assert.deepEqual(secretHits('has KEY-123 inside', 'KEY-123'), ['the review key']);
  assert.deepEqual(secretHits(`token ghp_${'a'.repeat(30)}`, ''), ['a token-like string']);
  assert.deepEqual(secretHits('plain text', ''), []);
});

test('scrub removes the key', () => {
  assert.equal(scrub('bad sk-secret here sk-secret', 'sk-secret'), 'bad [key] here [key]');
  assert.equal(scrub('nothing', ''), 'nothing');
});

const ANSWER = [
  '# PR #9 Sonnet review: Example',
  '',
  'Scope.',
  '',
  '## Findings',
  'L1 a.ts:3 fix it \u2014 now.',
  '',
  'Head reviewed: ' + 'b'.repeat(40),
  '## Verdict',
  '',
  '**Merge.** Fine.',
].join('\n');

test('finishNote puts the real Head reviewed line above the verdict and passes the gate parser', () => {
  const { text, problems } = finishNote(ANSWER, 9, 'sonnet', SHA, '9-review.md');
  assert.deepEqual(problems, []);
  assert.ok(!text.includes('\u2014'));
  assert.ok(!text.includes('b'.repeat(40)));
  const note = parseReviewNote('9-review.md', text, 9);
  assert.deepEqual(note.malformed, []);
  assert.equal(note.entries.length, 1);
  assert.equal(note.entries[0].head, SHA);
  assert.equal(note.entries[0].merge, true);
  assert.equal(note.opus, false);
});

test('finishNote rejects a missing verdict, an unknown verdict and a wrong Opus heading', () => {
  assert.match(finishNote('# PR #9 Sonnet review: x\n\nno verdict', 9, 'sonnet', SHA, '9-review.md').problems[0], /Verdict/);
  const odd = ANSWER.replace('**Merge.**', '**Looks good.**');
  assert.ok(finishNote(odd, 9, 'sonnet', SHA, '9-review.md').problems.some(p => /unknown verdict/.test(p)));
  // An Opus note with a Sonnet heading in a file the gate does not call Opus.
  assert.ok(finishNote(ANSWER, 9, 'opus', SHA, '9-review.md').problems.some(p => /Opus review/.test(p)));
  const opus = ANSWER.replace('Sonnet review', 'Opus review');
  assert.deepEqual(finishNote(opus, 9, 'opus', SHA, '9-opus-review.md').problems, []);
  const fenced = '```markdown\n' + opus + '\n```';
  assert.deepEqual(finishNote(fenced, 9, 'opus', SHA, '9-opus-review.md').problems, []);
});

test('buildPrompts names the round, the sha and the checklists', () => {
  const base = {
    pr: 9,
    sha: SHA,
    title: 'T',
    model: /** @type {const} */ ('opus'),
    round: 1,
    categories: ['the merge gate'],
    previousNote: null,
    diffPath: 'D:/x/pr.diff',
    bodyPath: 'D:/x/body.md',
    agentChecklists: ['CHECK ONE'],
  };
  const r1 = buildPrompts(base);
  assert.match(r1.system, /round 1: a full review/);
  assert.match(r1.system, /CHECK ONE/);
  assert.match(r1.system, /# PR #9 Opus review/);
  assert.match(r1.user, new RegExp(SHA));
  const r2 = buildPrompts({ ...base, round: 2, previousNote: 'V:/9-opus-review.md' });
  assert.match(r2.system, /round 2: a delta check/);
  assert.match(r2.user, /9-opus-review\.md/);
  const d = buildPrompts({ ...base, round: 3, previousNote: 'V:/9-opus-review-round2.md', delta: { reviewed: 'b'.repeat(40) } });
  assert.match(d.system, /small-delta note/);
  assert.doesNotMatch(d.system, /round 3: a delta check/);
});

test('checkHead refuses a moved head and names both shas', () => {
  checkHead(7, SHA, SHA.toUpperCase(), 'x');
  assert.throws(() => checkHead(7, SHA, 'c'.repeat(40), 'while the review ran'), /PR #7 head moved while the review ran.*aaaaaaaa.*cccccccc.*no note written/);
});

test('parseArgs reads --delta and wants one PR', () => {
  assert.equal(parseArgs(['5', '--delta', 'ABCDEF1'], {}).delta, 'abcdef1');
  assert.equal(parseArgs(['5'], {}).delta, null);
  assert.throws(() => parseArgs(['5', '--delta', 'xyz'], {}), /7 to 40 hex/);
  assert.throws(() => parseArgs(['5', '6', '--delta', 'abcdef1'], {}), /one PR at a time/);
});

test('classifyDelta: docs, tests, changelog and main-only files are small; own code is not', () => {
  const base = { prFilesOld: ['src/a.js', 'src/a.test.js'], prFilesNew: ['src/a.js', 'src/a.test.js', 'changelog.d/x.md'], ownLines: 10 };
  const ok = classifyDelta({ ...base, deltaFiles: ['src/a.test.js', 'changelog.d/x.md', 'docs/gm/y.md', 'other/from-main.js'] });
  assert.equal(ok.small, true);
  assert.deepEqual(ok.mainOnly, ['docs/gm/y.md', 'other/from-main.js']);
  assert.equal(classifyDelta({ ...base, deltaFiles: ['other/from-main.js'] }).small, true);
  const code = classifyDelta({ ...base, deltaFiles: ['src/a.js'] });
  assert.equal(code.small, false);
  assert.match(code.reasons[0], /own code changed: src\/a\.js/);
  assert.equal(classifyDelta({ ...base, deltaFiles: [] }).small, false);
  // docs/ and tests/ hold config and build files too; .claude markdown steers reviewers
  for (const f of ['docs/wiki/astro.config.mjs', 'docs/wiki/package.json', 'tests/package.json', '.claude/agents/review-pi-ci.md']) {
    assert.equal(classifyDelta({ ...base, prFilesNew: [...base.prFilesNew, f], deltaFiles: [f] }).small, false, f);
  }
  assert.equal(classifyDelta({ ...base, deltaFiles: ['src/a.test.js'], ownLines: 401 }).small, false);
});

/** A throwaway origin + clone with remote `aitool`, so plan() and review() run against real git. */
function makeRepo() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'rr-test-'));
  const env = { ...process.env, GIT_AUTHOR_NAME: 't', GIT_AUTHOR_EMAIL: 't@t', GIT_COMMITTER_NAME: 't', GIT_COMMITTER_EMAIL: 't@t' };
  const git = (/** @type {string} */ cwd, /** @type {string[]} */ ...a) => execFileSync('git', a, { cwd, env, encoding: 'utf8' }).trim();
  const origin = path.join(root, 'origin.git');
  git(root, 'init', '-q', '--bare', '-b', 'main', origin);
  const repo = path.join(root, 'repo');
  git(root, 'init', '-q', '-b', 'main', repo);
  git(repo, 'remote', 'add', 'aitool', origin);
  const write = (/** @type {string} */ f, /** @type {string} */ t) => {
    fs.mkdirSync(path.dirname(path.join(repo, f)), { recursive: true });
    fs.writeFileSync(path.join(repo, f), t);
  };
  const commit = (/** @type {string} */ msg) => {
    git(repo, 'add', '-A');
    git(repo, 'commit', '-q', '-m', msg);
    return git(repo, 'rev-parse', 'HEAD');
  };
  write('base.txt', 'base\n');
  const m0 = commit('m0');
  git(repo, 'push', '-q', 'aitool', 'main');
  /** Publish a sha as the PR head, like GitHub's refs/pull/N/head. */
  const publish = (/** @type {string} */ sha) => {
    git(repo, 'push', '-q', '-f', 'aitool', `${sha}:refs/pull/5/head`);
  };
  return { root, repo, git, write, commit, publish, m0 };
}

const NOTE = (/** @type {string} */ head) =>
  `# PR #5 Sonnet review: t\n\nscope\n\n## Findings\n\nNone.\n\nHead reviewed: ${head}\n\n## Verdict\n\n**Merge.** ok\n`;

test('plan --delta: small commits after a Merge skip the round 3 flag, code does not', () => {
  const t = makeRepo();
  try {
    t.git(t.repo, 'checkout', '-q', '-b', 'pr');
    t.write('src/a.js', 'a\n');
    const p1 = t.commit('p1');
    const vault = path.join(t.root, 'vault');
    const dir = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff', 'Reviews 2026-10-30');
    fs.mkdirSync(dir, { recursive: true });
    fs.writeFileSync(path.join(dir, '5-review.md'), NOTE('b'.repeat(40)));
    fs.writeFileSync(path.join(dir, '5-review-round2.md'), NOTE(p1));
    const o = parseArgs(['5', '--delta', p1.slice(0, 10), '--vault', vault, '--ledger', path.join(t.root, 'l.jsonl')], {});
    const info = (/** @type {string} */ sha, /** @type {string[]} */ files) => ({ prInfo: () => ({ title: 'T', body: '', state: 'OPEN', sha, files }) });
    // docs + test commit, then a merge of main that touches only a file the PR does not own
    t.write('docs/x.md', 'x\n');
    t.write('src/a.test.js', 't\n');
    t.commit('docs and test');
    t.git(t.repo, 'checkout', '-q', 'main');
    t.write('other.txt', 'from main\n');
    t.commit('main moves');
    t.git(t.repo, 'push', '-q', 'aitool', 'main');
    t.git(t.repo, 'checkout', '-q', 'pr');
    t.git(t.repo, 'merge', '-q', '--no-edit', 'main');
    const head = t.git(t.repo, 'rev-parse', 'HEAD');
    t.publish(head);
    const p = plan(5, o, 0, t.repo, info(head, ['src/a.js', 'docs/x.md', 'src/a.test.js']));
    assert.equal(p.round, 3);
    assert.equal(p.name, '5-review-round3.md');
    assert.equal(p.budget, 0.75);
    assert.deepEqual(p.delta?.mainOnly, ['other.txt']);
    assert.deepEqual(p.delta?.ownFiles.sort(), ['docs/x.md', 'src/a.test.js']);
    // without --delta the same round 3 needs the planner's flag
    assert.throws(() => plan(5, { ...o, delta: null }, 0, t.repo, info(head, [])), /third round needs the planner/);
    // code after the Merge is a normal round: refused as a delta
    t.write('src/a.js', 'changed\n');
    const head2 = t.commit('code');
    t.publish(head2);
    assert.throws(() => plan(5, o, 0, t.repo, info(head2, [])), /not a small delta.*own code changed: src\/a\.js/);
    // a sha no note called Merge is refused
    const o2 = { ...o, delta: head.slice(0, 10) };
    assert.throws(() => plan(5, o2, 0, t.repo, info(head2, [])), /does not say Merge/);
    // a rename of code into a test file is still a code change
    t.git(t.repo, 'reset', '-q', '--hard', head);
    t.git(t.repo, 'mv', 'src/a.js', 'src/b.test.js');
    const head3 = t.commit('rename');
    t.publish(head3);
    const o3 = { ...o, delta: head };
    fs.writeFileSync(path.join(dir, '5-review-round3.md'), NOTE(head));
    assert.throws(() => plan(5, o3, 0, t.repo, info(head3, [])), /own code changed: src\/a\.js/);
    // a delta note cannot seed another delta
    fs.writeFileSync(path.join(dir, '5-review-round4.md'), NOTE(head).replace('Head reviewed:', `Small delta from ${p1}\n\nHead reviewed:`));
    assert.throws(() => plan(5, { ...o3, round: 5 }, 0, t.repo, info(head3, [])), /itself a small-delta note/);
    // a risky PR whose Merge came from a Sonnet note is not cleared by an Opus delta
    fs.rmSync(path.join(dir, '5-review-round4.md'));
    fs.rmSync(path.join(dir, '5-review-round3.md'));
    fs.writeFileSync(path.join(dir, '5-review-round3.md'), NOTE(head));
    t.write('docs/more.md', 'm\n');
    const head4 = t.commit('docs again');
    t.publish(head4);
    assert.throws(() => plan(5, { ...o3, round: 4 }, 0, t.repo, info(head4, ['scripts/lane-merge.mjs'])), /not an Opus review/);
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});

/** A fake SDK query: init with the review key source, then a result with a valid note. */
const fakeQuery = (/** @type {{ n: number }} */ calls, /** @type {'Sonnet' | 'Opus'} */ kind = 'Sonnet') => {
  const f = async function* () {
    calls.n++;
    yield { type: 'system', subtype: 'init', apiKeySource: 'ANTHROPIC_API_KEY' };
    yield {
      type: 'result',
      subtype: 'success',
      total_cost_usd: 0.4,
      num_turns: 2,
      result: `# PR #5 ${kind} review: t\n\nscope\n\n## Findings\n\nNone.\n\n## Verdict\n\n**Merge.** fine\n`,
      modelUsage: { [`claude-${kind.toLowerCase()}-5-5`]: {} },
      usage: {},
    };
  };
  return f;
};

test('a delta note from review() is accepted by the merge gate, Opus for a risky PR', async () => {
  for (const kind of /** @type {const} */ (['Sonnet', 'Opus'])) {
    const t = makeRepo();
    try {
      t.git(t.repo, 'checkout', '-q', '-b', 'pr');
      t.write('src/a.js', 'a\n');
      const p1 = t.commit('p1');
      const vault = path.join(t.root, 'vault');
      const dir = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff', 'Reviews 2026-10-30');
      fs.mkdirSync(dir, { recursive: true });
      const prior = kind === 'Opus' ? '5-opus-review.md' : '5-review.md';
      fs.writeFileSync(path.join(dir, prior), NOTE(p1).replace('Sonnet', kind));
      t.write('docs/x.md', 'x\n');
      const head = t.commit('docs');
      t.publish(head);
      const calls = { n: 0 };
      const o = parseArgs(['5', '--delta', p1, '--model', kind.toLowerCase(), '--vault', vault, '--ledger', path.join(t.root, 'l.jsonl'), '--no-commit'], {});
      const info = { prInfo: () => ({ title: 'T', body: '', state: 'OPEN', sha: head, files: ['src/a.js', 'docs/x.md'] }) };
      const p = plan(5, o, 0, t.repo, info);
      assert.equal(p.round, 2);
      await review(p, o, 'k', t.repo, { headOf: () => head, query: fakeQuery(calls, kind) });
      const notes = findReviewNotes(vault, 5) ?? [];
      assert.equal(notes.length, 2);
      assert.deepEqual(judgeReviews(notes, head, kind === 'Opus'), { ok: true, detail: notes.find(n => n.entries.some(e => e.head === head))?.name });
    } finally {
      fs.rmSync(t.root, { recursive: true, force: true });
    }
  }
});

test('review refuses a head that moved: before the spend books nothing, after it writes no note', async () => {
  const t = makeRepo();
  try {
    t.git(t.repo, 'checkout', '-q', '-b', 'pr');
    t.write('src/a.js', 'a\n');
    const head = t.commit('p1');
    t.publish(head);
    const vault = path.join(t.root, 'vault');
    const ledger = path.join(t.root, 'l.jsonl');
    const o = parseArgs(['5', '--vault', vault, '--ledger', ledger, '--no-commit'], {});
    const info = { prInfo: () => ({ title: 'T', body: '', state: 'OPEN', sha: head, files: ['src/a.js'] }) };
    const noteDir = () => path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff');
    const newHead = 'd'.repeat(40);

    // moved before the SDK starts: nothing is booked, the SDK is never called
    const calls = { n: 0 };
    let p = plan(5, o, 0, t.repo, info);
    await assert.rejects(review(p, o, 'k', t.repo, { headOf: () => newHead, query: fakeQuery(calls) }), /head moved before the review started, nothing spent/);
    assert.equal(calls.n, 0);
    assert.equal(readLedger(ledger).length, 0);
    assert.equal(fs.existsSync(noteDir()), false);

    // moved while the review ran: the cost is booked honestly, no note is written
    const seen = [head, newHead];
    p = plan(5, o, 0, t.repo, info);
    await assert.rejects(review(p, o, 'k', t.repo, { headOf: () => seen.shift() ?? newHead, query: fakeQuery(calls) }), /head moved while the review ran/);
    assert.ok(totalUsd(readLedger(ledger)) > 0 && totalUsd(readLedger(ledger)) < 1);
    assert.equal(fs.existsSync(noteDir()), false);

    // a stable head writes the sha-bound note
    p = plan(5, o, 0, t.repo, info);
    const r = await review(p, o, 'k', t.repo, { headOf: () => head, query: fakeQuery(calls) });
    assert.match(fs.readFileSync(r.file, 'utf8'), new RegExp(`Head reviewed: ${head}`));
  } finally {
    fs.rmSync(t.root, { recursive: true, force: true });
  }
});
