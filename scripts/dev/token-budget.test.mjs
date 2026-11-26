// node --test scripts/dev/token-budget.test.mjs
import assert from 'node:assert/strict';
import { test } from 'node:test';
import { group, noteText } from './token-budget.mjs';

const states = [
  { sessionId: 'a', branch: 'claude/x', tokens: 1000, updated: '2026-11-26T10:00:00.000Z' },
  { sessionId: 'b', branch: 'claude/x', tokens: 500, updated: '2026-11-26T12:00:00.000Z' },
  { sessionId: 'c', branch: 'claude/y', tokens: 70, updated: '2026-11-26T11:00:00.000Z' },
];

test('sessions on one branch add up and map to the newest PR', () => {
  const g = group(states, [
    { number: 9, headRefName: 'claude/x' },
    { number: 4, headRefName: 'claude/x' },
  ]);
  assert.deepEqual(
    g.map(x => [x.branch, x.pr, x.tokens, x.sessions]),
    [
      ['claude/x', 9, 1500, 2],
      ['claude/y', null, 70, 1],
    ]
  );
});

test('the note has one parseable line per branch', () => {
  const text = noteText(group(states, [{ number: 9, headRefName: 'claude/x' }]), 18_000_000);
  assert.match(
    text,
    /^- branch: claude\/x \| pr: 9 \| tokens: 1500 \| limit: 18000000 \| sessions: 2 \|/m
  );
  assert.match(text, /pr: none \| tokens: 70/);
});

test('a session that changed branch is split between the branches', () => {
  const g = group(
    [
      {
        sessionId: 'd',
        branch: 'claude/y',
        tokens: 150,
        branchTokens: { 'claude/x': 100, 'claude/y': 50 },
        updated: '2026-11-26T13:00:00.000Z',
      },
    ],
    []
  );
  assert.deepEqual(g.map(x => [x.branch, x.tokens, x.sessions]).sort(), [
    ['claude/x', 100, 1],
    ['claude/y', 50, 1],
  ]);
});
