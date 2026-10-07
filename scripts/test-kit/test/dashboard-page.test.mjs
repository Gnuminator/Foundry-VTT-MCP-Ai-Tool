/**
 * The pure parts of the dashboard page helpers (slice 4 write flows): what counts as a refusal that
 * skips a flow, and white space handling. The Playwright parts run only against a real browser.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { Refused, isSwitchedOff, squash } from '../lib/dashboard-page.mjs';

test('a refusal that says a feature is switched off skips the flow', () => {
  assert.equal(isSwitchedOff('✗ plan-page-reveal: The "handouts" feature is switched off.'), true);
  assert.equal(isSwitchedOff('Switch on "AI Tool: Party (writes)" in the module settings'), true);
  assert.equal(isSwitchedOff('GM Actions are off. Enable them first.'), false);
  assert.equal(isSwitchedOff('the Party feature is disabled'), true);
});

test('a switched-off refusal that names a feature the run switched on is a failure, not a skip', () => {
  const managed = ['tarokka', 'handouts', 'party', 'GM Actions'];
  assert.equal(
    isSwitchedOff(
      '✗ apply-planned-change: Error: The "tarokka" feature is switched off in the module settings',
      managed
    ),
    false
  );
  assert.equal(
    isSwitchedOff('✗ plan-page-reveal: The "handouts" feature is switched off.', managed),
    false
  );
  assert.equal(
    isSwitchedOff('Switch on "AI Tool: Party (writes)" in the module settings', managed),
    false
  );
  assert.equal(isSwitchedOff('GM Actions are switched off', managed), false);
  // A switch the run does not manage still skips.
  assert.equal(isSwitchedOff('The "npc-attitudes" feature is switched off', managed), true);
  // "party" must match the word, not a part of another one.
  assert.equal(isSwitchedOff('The "partyline" feature is switched off', ['party']), true);
});

test('any other refusal is a failure', () => {
  assert.equal(isSwitchedOff('✗ plan-actor-change: Target not found: Nobody'), false);
  assert.equal(isSwitchedOff('✗ apply-planned-change: HTTP 500'), false);
});

test('squash collapses white space and tolerates nothing', () => {
  assert.equal(squash('  a \n  b\tc '), 'a b c');
  assert.equal(squash(null), '');
  assert.equal(squash(undefined), '');
});

test('Refused is an Error with its own name', () => {
  const e = new Refused('no');
  assert.ok(e instanceof Error);
  assert.equal(e.name, 'Refused');
  assert.equal(e.message, 'no');
});
