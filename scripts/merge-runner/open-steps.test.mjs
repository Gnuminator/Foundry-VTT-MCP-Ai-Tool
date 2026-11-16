import assert from 'node:assert/strict';
import test from 'node:test';
import { openLeft, openStep } from './open-steps.mjs';

test('openStep: release and repo-setting shapes keep the item open', () => {
  assert.equal(
    openStep('v0.29.2 tagged and published; the release notes and installer are on GitHub'),
    'a tag'
  );
  assert.equal(openStep('tag v0.29.2 and the installer is published on GitHub'), 'a tag');
  assert.equal(openStep('the installer is published on GitHub'), 'a publish');
  assert.equal(
    openStep('the main ruleset has a merge_queue rule and the gate enqueues; CI green'),
    'a ruleset change'
  );
  assert.equal(openStep('branch protection change applied; CI green'), 'a ruleset change');
  assert.equal(openStep('the user says go, then it ships'), "the user's OK");
  assert.equal(openStep('done once the user OK arrives'), "the user's OK");
});

test('openStep: ordinary done-when text closes on the merge', () => {
  for (const t of [
    'markDone keeps the item open; a test covers it; Sonnet review plus CI',
    'the tag filter in the dashboard shows whole numbers',
    'adds a tag field to each item',
    'events are published on the bus',
    'publishes a PR comment',
    'no publish needed',
    'CI green; ruleset unchanged',
    'the merge_queue path marks done',
    'markDone keeps the item open when done-when names a tag, publish, ruleset change or the user OK',
  ]) {
    assert.equal(openStep(t), '', t);
  }
  assert.equal(openStep(undefined), '');
});

test('openLeft: a Pi run or Waiting blocker wins over a done-when step; nothing left is empty', () => {
  const pi = new Map([
    ['pi', ['yes']],
    ['done when', ['tagged and publish']],
  ]);
  assert.match(openLeft(pi, 5), /Pi run or Waiting step/);
  const wait = new Map([['blocked by', ['W12 (the user)']]]);
  assert.match(openLeft(wait, 5), /--pi-run/);
  assert.match(openLeft(new Map([['done when', ['tagged and publish']]]), 5), /names a tag/);
  assert.equal(openLeft(new Map([['done when', ['tests pass']]]), 5), '');
});
