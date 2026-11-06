/**
 * scripts/docs-quest-check.mjs against throwaway trees.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { check, sections, words } from './docs-quest-check.mjs';

const QUESTS = { 'q.md': 'list.md' };

const LIST = [
  '---',
  'title: List',
  '---',
  '# List',
  '',
  '## Start here',
  '',
  'Open the box and take out the one small red lantern that sits on top.',
  '',
  '## Wrap up',
  '',
  'Close the box.',
  '',
].join('\n');

function tree(quest, list = LIST) {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'docs-quest-'));
  fs.writeFileSync(path.join(root, 'list.md'), list);
  fs.writeFileSync(path.join(root, 'q.md'), quest);
  return root;
}

const run = quest => check(tree(quest), QUESTS);

test('words drops links, comments and marks', () => {
  assert.deepEqual(words('A [Link here](x.md#y) and `code` <!-- skip --> **Bold**'), [
    'a',
    'link',
    'here',
    'and',
    'code',
    'bold',
  ]);
});

test('sections lists ## headings with slugs', () => {
  assert.deepEqual(
    sections(LIST).map(s => s.slug),
    ['start-here', 'wrap-up']
  );
});

test('a quest that links every section passes', () => {
  assert.deepEqual(run('# Q\n\n[a](list.md#start-here) [b](list.md#wrap-up)\n'), []);
});

test('a copied run of words is reported', () => {
  const problems = run(
    '# Q\n\n[a](list.md#start-here) [b](list.md#wrap-up)\n\n- [ ] Open the box and take out the one small red lantern.\n'
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /copies list\.md/);
});

test('a section that is neither linked nor skipped is reported', () => {
  const problems = run('# Q\n\n[a](list.md#start-here)\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no link to "Wrap up"/);
});

test('quest-skips covers a section', () => {
  assert.deepEqual(run('# Q\n\n[a](list.md#start-here)\n\n<!-- quest-skips: wrap-up -->\n'), []);
});

test('an unknown or doubled skip fails', () => {
  const unknown = run('# Q\n\n[a](list.md#start-here)\n<!-- quest-skips: wrap-up, nope -->\n');
  assert.equal(unknown.length, 1);
  assert.match(unknown[0], /"nope", which is no section/);
  const doubled = run(
    '# Q\n\n[a](list.md#start-here) [b](list.md#wrap-up)\n<!-- quest-skips: wrap-up -->\n'
  );
  assert.equal(doubled.length, 1);
  assert.match(doubled[0], /both linked and in quest-skips/);
});

test('a copy wrapped over two lines is still reported', () => {
  const problems = run(
    '# Q\n\n[a](list.md#start-here) [b](list.md#wrap-up)\n\n- [ ] Open the box and take out\n      the one small red lantern.\n'
  );
  assert.equal(problems.length, 1);
  assert.match(problems[0], /:5: copies/);
});

test('a link to another page of the same name does not count', () => {
  const problems = run('# Q\n\n[a](../x/list.md#start-here) [b](list.md#wrap-up)\n');
  assert.equal(problems.length, 1);
  assert.match(problems[0], /no link to "Start here"/);
});

test('a link inside a code span or a comment does not count', () => {
  const problems = run('# Q\n\n`[a](list.md#start-here)` <!-- [b](list.md#wrap-up) -->\n');
  assert.equal(problems.length, 2);
});

test('repeated headings get numbered anchors and code fences are skipped', () => {
  const list = '# L\n\n## Same\n\n```\n## Not a section\n```\n\n## Same\n';
  assert.deepEqual(
    sections(list).map(s => s.slug),
    ['same', 'same-1']
  );
});

test('a missing page is reported', () => {
  const root = tree('# Q\n');
  fs.rmSync(path.join(root, 'list.md'));
  assert.match(check(root, QUESTS)[0], /is missing/);
});
