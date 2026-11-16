import assert from 'node:assert/strict';
import test from 'node:test';
import { openStep } from './open-steps.mjs';

test('openStep: the release-v0-29-2 and github-merge-queue shapes keep the item open', () => {
  assert.equal(
    openStep('v0.29.2 tagged and published; the release notes and installer are on GitHub'),
    'tag'
  );
  assert.equal(openStep('the installer is published on GitHub'), 'publish');
  assert.equal(openStep('the user says go, then tag and publish the release'), 'tag');
  assert.equal(
    openStep('the main ruleset has a merge_queue rule and the gate enqueues; CI green'),
    'ruleset change'
  );
  assert.equal(openStep('done once the user OK arrives'), "the user's OK");
});

test('openStep: ordinary done-when text closes on the merge', () => {
  assert.equal(
    openStep('markDone keeps the item open; a test covers it; Sonnet review plus CI'),
    ''
  );
  assert.equal(openStep('the tag filter in the dashboard shows whole numbers'), '');
  assert.equal(openStep(undefined), '');
});
