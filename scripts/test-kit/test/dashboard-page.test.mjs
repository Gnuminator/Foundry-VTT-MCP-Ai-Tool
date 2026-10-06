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
