// Tests for scripts/merge-runner/unready.mjs and its two users: the runner's round() and
// `status --planner`. Real review-note parsing (the gate's), fake gh and fake runner dependencies.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  backlogIds,
  findUnready,
  readyCommand,
  unreadyKey,
  unreadyLine,
  unreadySection,
} from './unready.mjs';
import { parseReviewNote } from '../lane-merge/reviews.mjs';
import { plannerSections } from '../planner-state.mjs';
import { round } from '../merge-runner.mjs';

const H1 = 'a'.repeat(40);
const H2 = 'b'.repeat(40);
const GREEN = [{ conclusion: 'SUCCESS', status: 'COMPLETED' }];
const noteText = (head, verdict = 'Merge.') =>
  `# PR #7 review\n\nHead reviewed: ${head}\n\n## Verdict\n\n**${verdict}**\n`;
const notes = (head, verdict) => [parseReviewNote('7-review.md', noteText(head, verdict), 7)];
const pr = (o = {}) => ({
  number: 7,
  title: 'Skip line notice for the runner',
  headRefOid: H1,
  isDraft: false,
  body: 'Backlog: skip-item\n',
  statusCheckRollup: GREEN,
  ...o,
});
const backlog = progress =>
  `# Backlog\n\n## S Skip item\n\n- id: skip-item\n${progress ? `- progress: ${progress}\n` : ''}\n`;

test('an open green PR with a Merge note for its head and no ready line is found', () => {
  const [u] = findUnready([pr()], backlog(''), () => notes(H1));
  assert.equal(u.pr, 7);
  assert.deepEqual(u.ids, ['skip-item']);
  const line = unreadyLine(u);
  assert.match(line, /#7 .*item skip-item/);
  assert.equal(
    readyCommand(u),
    `node scripts/backlog.mjs progress skip-item --ready 7 --head ${H1} --review "7-review.md"`
  );
});

test('a PR that has a ready line, or is enqueued, gets no notice', () => {
  const ready = backlog(`PR #7 ready, head ${H1}`);
  assert.deepEqual(
    findUnready([pr()], ready, () => notes(H1)),
    []
  );
  const queued = backlog(`PR #7 enqueued in the merge queue, head ${H1}`);
  assert.deepEqual(
    findUnready([pr()], queued, () => notes(H1)),
    []
  );
});

test('draft, red or pending CI, no note, a note for another head or a non-Merge verdict: no notice', () => {
  const none = (p, n) => findUnready([p], backlog(''), () => n);
  assert.deepEqual(none(pr({ isDraft: true }), notes(H1)), []);
  assert.deepEqual(none(pr({ statusCheckRollup: [{ conclusion: 'FAILURE' }] }), notes(H1)), []);
  assert.deepEqual(none(pr({ statusCheckRollup: [{ status: 'IN_PROGRESS' }] }), notes(H1)), []);
  assert.deepEqual(none(pr(), []), []);
  assert.deepEqual(none(pr(), null), []);
  assert.deepEqual(none(pr(), notes(H2)), []);
  assert.deepEqual(none(pr(), notes(H1, 'Merge after fixes')), []);
});

test('a PR with no Backlog line in its body still shows, without an item', () => {
  const [u] = findUnready([pr({ body: 'no link' })], backlog(''), () => notes(H1));
  assert.deepEqual(u.ids, []);
  assert.match(unreadyLine(u), /no Backlog: line in the PR body/);
  assert.deepEqual(backlogIds('Backlog-part: x\nBacklog: a, `b`'), ['a', 'b']);
});

/** A vault with one review note, for the planner section. */
function vaultWith(head) {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'unready-'));
  const dir = path.join(vault, 'Dev', 'Foundry AI Tool', 'Handoff', 'Reviews 2026-11-15');
  fs.mkdirSync(dir, { recursive: true });
  fs.writeFileSync(path.join(dir, '7-review.md'), noteText(head));
  return vault;
}

test('status --planner lists the PR in its own section, and says none otherwise', () => {
  const vault = vaultWith(H1);
  const dev = path.join(vault, 'Dev', 'Foundry AI Tool');
  const gh = a => (a[0] === 'pr' ? [pr()] : []);
  const s = plannerSections({ devDir: dev, backlog: backlog(''), today: '2026-11-15', gh });
  assert.match(s.join('\n'), /Ready but no ready line \(1\):\n- #7 .*skip-item/);
  const withLine = plannerSections({
    devDir: dev,
    backlog: backlog(`PR #7 ready, head ${H1}`),
    today: '2026-11-15',
    gh,
  });
  assert.match(withLine.join('\n'), /Ready but no ready line: none/);
  assert.match(unreadySection(null, '', vault), /gh not available/);
  fs.rmSync(vault, { recursive: true, force: true });
});

/** Minimal runner dependencies for round(): nothing is ready, so only the notice path runs. */
function deps(unready, extra = {}) {
  const posts = [];
  const d = {
    readBacklog: () => backlog(''),
    gh: () => ({ status: 1, stdout: '', stderr: '' }),
    prepare: () => null,
    gate: () => assert.fail('the gate must not run'),
    backlog: () => assert.fail('the runner must not write the Backlog'),
    post: t => posts.push(t),
    log: () => {},
    unready: () => unready,
    ...extra,
  };
  return { d, posts };
}

test('the runner posts the notice once per head, not every round, and writes nothing', () => {
  const [u] = findUnready([pr()], backlog(''), () => notes(H1));
  const { d, posts } = deps([u]);
  const tried = new Set();
  round(d, tried, new Map());
  round(d, tried, new Map());
  round(d, tried, new Map());
  assert.equal(posts.length, 1);
  assert.match(posts[0], /#7 .*skip-item.*backlog\.mjs progress skip-item --ready 7 --head a{40}/);
  // a new head is a new notice
  const [u2] = findUnready([pr({ headRefOid: H2 })], backlog(''), () => notes(H2));
  const next = deps([u2]);
  round(next.d, tried, new Map());
  assert.equal(next.posts.length, 1);
  assert.notEqual(unreadyKey(u), unreadyKey(u2));
});

test('a notice remembered across restarts is not posted again', () => {
  const [u] = findUnready([pr()], backlog(''), () => notes(H1));
  const seen = new Set([unreadyKey(u)]);
  const { d, posts } = deps([u], { noticeSeen: k => seen.has(k), noticeMark: k => seen.add(k) });
  round(d, new Set(), new Map());
  assert.equal(posts.length, 0);
  const fresh = deps([u], { noticeSeen: () => false, noticeMark: k => seen.add(k) });
  round(fresh.d, new Set(), new Map());
  assert.equal(fresh.posts.length, 1);
});
