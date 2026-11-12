import assert from 'node:assert/strict';
import test from 'node:test';
import { judgeReviews, parseReviewNote, reviewNoteCommand } from './lane-merge.mjs';
import { buildNote, finishNote, latestRound, modelRefusal, noteName, parseArgs } from './review-note.mjs';

const SHA = 'a'.repeat(40);
const SHA2 = 'b'.repeat(40);
const BODY = '# PR #9 review: x\n\nScope.\n\n## Findings\n\nNone.\n';

test('noteName and latestRound follow the gate naming', () => {
  assert.equal(noteName(5, 'sonnet', 1), '5-review.md');
  assert.equal(noteName(5, 'opus', 1), '5-opus-review.md');
  assert.equal(noteName(5, 'opus', 2), '5-opus-review-round2.md');
  assert.equal(latestRound(['5-review.md', '5-opus-review-round3.md', '6-review-round9.md', 'x.md'], 5), 3);
  assert.equal(latestRound([], 5), 0);
});

test('parseArgs reads the flags and refuses bad input', () => {
  const o = parseArgs(['9', '--verdict', 'merge', '--model', 'opus', '--body', 'b.md', '--round', '2'], {});
  assert.equal(o.pr, 9);
  assert.equal(o.round, 2);
  assert.throws(() => parseArgs(['9', '--verdict', 'ok', '--model', 'opus', '--body', 'b'], {}), /--verdict/);
  assert.throws(() => parseArgs(['9', '--verdict', 'merge', '--model', 'gpt', '--body', 'b'], {}), /--model/);
  assert.throws(() => parseArgs(['--verdict', 'merge', '--model', 'opus', '--body', 'b'], {}), /PR number/);
  assert.throws(() => parseArgs(['9', '--model', 'opus', '--body', 'b'], {}), /--verdict/);
  assert.throws(() => parseArgs(['9', '--verdict', 'merge', '--model', 'opus', '--body', 'b', '--head', 'abc'], {}), /40/);
});

test('buildNote: round 1 passes the gate parser and the judge', () => {
  const n = buildNote({ pr: 9, model: 'sonnet', round: 1, sha: SHA, verdict: 'merge', body: BODY });
  assert.deepEqual(n.problems, []);
  assert.equal(n.name, '9-review.md');
  const parsed = parseReviewNote(n.name, n.text, 9);
  assert.deepEqual(parsed.malformed, []);
  assert.equal(parsed.entries[0].head, SHA);
  assert.equal(parsed.entries[0].merge, true);
  assert.equal(judgeReviews([parsed], SHA, false).ok, true);
});

test('buildNote: a heading is added, an own verdict section must match --verdict', () => {
  const noHeading = buildNote({ pr: 9, model: 'opus', round: 1, sha: SHA, verdict: 'fixes', body: 'Scope.\n\n## Findings\n\nM1 x.' });
  assert.deepEqual(noHeading.problems, []);
  assert.match(noHeading.text, /^# PR #9 Opus review/);
  assert.match(noHeading.text, /Head reviewed: a{40}\n\n## Verdict\n\n\*\*Merge after fixes\.\*\*/);
  const own = `${BODY}\n## Verdict\n\n**Merge.** fine.\n`;
  assert.deepEqual(buildNote({ pr: 9, model: 'sonnet', round: 1, sha: SHA, verdict: 'merge', body: own }).problems, []);
  assert.ok(buildNote({ pr: 9, model: 'sonnet', round: 1, sha: SHA, verdict: 'no', body: own }).problems.some(p => /does not match/.test(p)));
});

test('buildNote: a later round is its own file and the judge needs every note to say Merge', () => {
  const r1 = buildNote({ pr: 9, model: 'opus', round: 1, sha: SHA, verdict: 'fixes', body: BODY });
  const r2 = buildNote({ pr: 9, model: 'opus', round: 2, sha: SHA2, verdict: 'merge', body: BODY });
  assert.equal(r2.name, '9-opus-review-round2.md');
  const notes = [r1, r2].map(n => parseReviewNote(n.name, n.text, 9));
  assert.equal(judgeReviews(notes, SHA2, true).ok, true);
  assert.equal(judgeReviews(notes, SHA, true).ok, false);
});

test('buildNote: a verdict for an earlier head carries when the gate says the patch is the same', () => {
  const n = buildNote({ pr: 9, model: 'sonnet', round: 1, sha: SHA, verdict: 'merge', body: BODY });
  const parsed = parseReviewNote(n.name, n.text, 9);
  const carried = judgeReviews([parsed], SHA2, false, { carried: [SHA] });
  assert.equal(carried.ok, true);
  assert.deepEqual(carried.carriedFrom, [SHA]);
});

test('finishNote drops a typed Head reviewed line, fixes em dashes and rejects a missing verdict', () => {
  const dash = String.fromCharCode(0x2014);
  const typed = `# PR #9 review: x\n\nHead reviewed: ${SHA2}\nA ${dash} B\n\n## Verdict\n\n**Merge.**\n`;
  const { text, problems } = finishNote(typed, 9, 'sonnet', SHA, '9-review.md');
  assert.deepEqual(problems, []);
  assert.ok(!text.includes(SHA2) && !text.includes(dash));
  assert.match(finishNote('# PR #9 review: x\n\nnothing', 9, 'sonnet', SHA, '9-review.md').problems[0], /Verdict/);
  assert.ok(finishNote(typed, 9, 'opus', SHA, '9-review.md').problems.some(p => /Opus review/.test(p)));
});

test('a Sonnet stamp on a risky PR is refused, Opus is not', () => {
  const risky = ['packages/foundry-module/src/write-gate.ts'];
  assert.match(modelRefusal('sonnet', risky) ?? '', /--model opus/);
  assert.equal(modelRefusal('opus', risky), null);
  assert.equal(modelRefusal('sonnet', ['docs/x.md']), null);
});

test('the gate refusal helper command names the PR and the model', () => {
  assert.match(reviewNoteCommand(12, true), /node scripts\/review-note\.mjs 12 .*--model opus/);
  assert.match(reviewNoteCommand(12, false), /--model sonnet/);
});
