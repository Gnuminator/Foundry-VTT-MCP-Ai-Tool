import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import test from 'node:test';
import {
  ciState,
  dueWaiting,
  ledgerLines,
  mainLine,
  newestNote,
  plannerSections,
  REPO,
  prTable,
  trainLine,
  unclaimedAccepted,
  verdictFor,
} from './planner-state.mjs';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const note = (head, verdict) => ({
  text: `# PR #1\n\nHead reviewed: ${head}\n\n## Verdict\n\n**${verdict}** all fine.\n`,
});

const BACKLOG = [
  '# Backlog',
  '',
  '## S Old accepted',
  '- id: old-one',
  '- source: Research; user verdict accept; the user 2026-11-03',
  '',
  '## S Young accepted',
  '- id: young-one',
  '- source: user verdict accept 2026-11-11',
  '',
  '## S Claimed accepted',
  '- id: claimed-one',
  '- source: user verdict accept 2026-10-01',
  '- claimed: lane 2026-11-10',
  '',
  '## S Blocked accepted',
  '- id: blocked-one',
  '- source: user verdict accept 2026-10-01',
  '- blocked by: item:old-one',
  '',
  '## S Not accepted',
  '- id: plain-one',
  '- source: Research 2026-10-01',
  '',
].join('\n');

test('unclaimed accepted: only old, free, unblocked, accepted items', () => {
  const out = unclaimedAccepted(BACKLOG, '2026-11-12');
  assert.deepEqual(out, ['- old-one: accepted, unclaimed for 9 days']);
});

test('unclaimed accepted: a source without a date is listed as unknown age', () => {
  const t = '## S X\n- id: x\n- source: user verdict accept\n';
  assert.match(unclaimedAccepted(t, '2026-11-12')[0], /unknown number of days/);
});

test('newestNote picks the highest round, verdictFor compares the head', () => {
  const notes = [
    { file: '5-review.md', text: 'r1' },
    { file: '5-review-round2.md', text: 'r2' },
    { file: '6-review.md', text: 'other' },
  ];
  assert.equal(newestNote(notes, 5)?.text, 'r2');
  assert.equal(newestNote(notes, 7), undefined);
  // A delta note for the head beats a higher-numbered round written for an older head.
  const withDelta = [
    { file: '8-opus-review-round2.md', text: note(H1, 'Merge.').text },
    { file: '8-opus-review-delta.md', text: note(H2, 'Merge.').text },
    { file: '8-opus-review-delta2.md', text: note(H2, 'Merge.').text },
  ];
  assert.equal(newestNote(withDelta, 8, H2)?.file, '8-opus-review-delta2.md');
  assert.equal(newestNote(withDelta, 8, H1)?.file, '8-opus-review-round2.md');
  // No note for the head: fall back to the highest round by name (shown as "old head").
  assert.equal(newestNote(withDelta, 8, 'c'.repeat(40))?.file, '8-opus-review-round2.md');
  assert.equal(verdictFor(note(H1, 'Merge.'), H1), 'Merge (head)');
  assert.match(verdictFor(note(H1, 'Merge.'), H2), /^Merge for old head aaaaaaaa/);
  assert.equal(verdictFor(undefined, H1), 'no review note');
});

test('ciState reads check runs and contexts', () => {
  assert.equal(ciState([]), 'no checks');
  assert.equal(ciState([{ conclusion: 'SUCCESS', status: 'COMPLETED' }]), 'green');
  assert.match(ciState([{ status: 'IN_PROGRESS', conclusion: '' }]), /^pending/);
  assert.match(
    ciState([{ name: 'build', conclusion: 'FAILURE', status: 'COMPLETED' }]),
    /red \(build\)/
  );
});

test('prTable, trainLine, mainLine', () => {
  const rows = prTable(
    [{ number: 5, title: 'Thing', headRefOid: H1, isDraft: true, statusCheckRollup: [] }],
    [{ file: '5-review.md', text: note(H1, 'Merge.').text }]
  );
  assert.equal(rows[1], '- #5 Thing: draft, CI no checks, review Merge (head)');
  assert.equal(prTable(null, [])[0], 'Open PRs: gh not available');
  const train = '---\ncount: 2\nlimit: 4\nlast-event: merge\nlast-event-pr: 9\n---\n';
  assert.match(trainLine(train), /^Merge train: 2 of 4, last merge PR #9/);
  assert.equal(trainLine(''), 'Merge train: not readable');
  assert.equal(
    mainLine({ status: 'completed', conclusion: 'success', headSha: H1 }),
    `Main's CI: success at aaaaaaaa`
  );
  assert.match(mainLine(null), /unknown/);
});

test('dueWaiting honours the 7-day lead and the from date', () => {
  const w = [
    '## W1 Due soon',
    '- due: 2026-11-15',
    '## W2 Far',
    '- due: 2026-12-30',
    '## W3 Held back',
    '- due: 2026-11-14',
    '- from: 2026-11-20',
    '## W4 Late',
    '- due: 2026-11-10',
  ].join('\n');
  const out = dueWaiting(w, '2026-11-12');
  assert.match(out, /Waiting due \(2\)/);
  assert.match(out, /W4 Late \(2026-11-10, overdue\)\n- W1 Due soon/);
  assert.doesNotMatch(out, /W2|W3/);
});

test('ledgerLines names ledgers over 10 lines with count and lines older than a month', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgers-'));
  const bullets = (n, date) =>
    Array.from({ length: n }, (_, i) => `- ${date} PR 1 L${i + 1}: x, y`).join('\n');
  fs.writeFileSync(
    path.join(dir, 'Big.md'),
    `# Lows: Big\n\n${bullets(7, '2026-09-01')}\n${bullets(5, '2026-11-10')}\n`
  );
  fs.writeFileSync(path.join(dir, 'Edge.md'), `# Lows: Edge\n\n${bullets(10, '2026-09-01')}\n`);
  fs.writeFileSync(path.join(dir, 'Small.md'), `# Lows: Small\n\n${bullets(3, '2026-11-10')}\n`);
  const s = ledgerLines(dir, '2026-11-13');
  assert.match(s, /over 10 lines \(1\); a sweep is a planner call/);
  assert.match(s, /- Big: 12 lines, 7 older than a month/);
  assert.doesNotMatch(s, /Edge|Small/);
  fs.rmSync(path.join(dir, 'Big.md'));
  assert.equal(ledgerLines(dir, '2026-11-13'), 'Lows ledgers over 10 lines: none');
  assert.equal(ledgerLines(path.join(dir, 'nope'), '2026-11-13'), 'Lows ledgers: not readable');
});

test('ledgerLines skips a folder named *.md and a malformed date', () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), 'ledgers-'));
  fs.mkdirSync(path.join(dir, 'Odd.md'));
  const good = Array.from({ length: 10 }, (_, i) => `- 2026-11-10 PR 1 L${i}: x, y`).join('\n');
  fs.writeFileSync(path.join(dir, 'Big.md'), `# Lows: Big\n\n${good}\n- 2026-13-45 PR 2 L1: x, y\n`);
  assert.equal(ledgerLines(dir, '2026-11-13'), 'Lows ledgers over 10 lines: none');
});

test('newestNote picks the note whose last Head reviewed line is the head', () => {
  const both = { file: '1-review.md', text: `Head reviewed: ${H1}\nHead reviewed: ${H2}\n` };
  const other = { file: '1-review-round2.md', text: `Head reviewed: ${H1}\n` };
  assert.equal(newestNote([both, other], 1, H2)?.file, both.file);
  assert.equal(newestNote([both, other], 1, H1)?.file, other.file);
});

test('plannerSections assembles every section from a vault dir and a fake gh', () => {
  const dev = fs.mkdtempSync(path.join(os.tmpdir(), 'planner-state-'));
  fs.mkdirSync(path.join(dev, 'Handoff', 'Reviews 2026-11-12'), { recursive: true });
  fs.writeFileSync(
    path.join(dev, 'Handoff', 'Reviews 2026-11-12', '5-review.md'),
    note(H1, 'Merge.').text
  );
  fs.writeFileSync(path.join(dev, 'Merge train.md'), '---\ncount: 1\nlimit: 4\n---\n');
  fs.writeFileSync(path.join(dev, 'Waiting.md'), '## W9 Do it\n- due: 2026-11-12\n');
  const seen = [];
  const gh = args => {
    seen.push(args);
    return ghAnswer(args);
  };
  const ghAnswer = args =>
    args[0] === 'pr'
      ? [
          {
            number: 5,
            title: 'Thing',
            headRefOid: H1,
            isDraft: false,
            statusCheckRollup: [{ conclusion: 'SUCCESS', status: 'COMPLETED' }],
          },
        ]
      : [{ status: 'completed', conclusion: 'success', headSha: H1 }];
  const s = plannerSections({ devDir: dev, backlog: BACKLOG, today: '2026-11-12', gh }).join('\n');
  assert.equal(seen.length, 2);
  for (const a of seen)
    assert.deepEqual(a.slice(a.indexOf('-R'), a.indexOf('-R') + 2), ['-R', REPO]);
  assert.match(s, /Accepted, unclaimed \(1\):/);
  assert.match(s, /#5 Thing: CI green, review Merge \(head\)/);
  assert.match(s, /Merge train: 1 of 4/);
  assert.match(s, /Main's CI: success/);
  assert.match(s, /W9 Do it/);
  const dark = plannerSections({
    devDir: dev,
    backlog: '',
    today: '2026-11-12',
    gh: () => null,
  }).join('\n');
  assert.match(dark, /gh not available/);
  fs.rmSync(path.join(dev, 'Waiting.md'));
  const gone = plannerSections({ devDir: dev, backlog: '', today: '2026-11-12', gh: () => null });
  assert.ok(gone.includes('Waiting due: not readable'));
});
