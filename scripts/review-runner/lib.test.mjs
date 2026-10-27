import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import { parseReviewNote } from '../lane-merge.mjs';
import {
  appendLedger,
  budgetFor,
  buildPrompts,
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
});
