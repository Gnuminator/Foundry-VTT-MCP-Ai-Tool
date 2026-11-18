/** deploy/scheduled-tasks/game-day-brief/SKILL.md stays read-only and off the paid API (D-066). */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { readFileSync } from 'node:fs';

const file = new URL('../deploy/scheduled-tasks/game-day-brief/SKILL.md', import.meta.url);
const text = readFileSync(file, 'utf8');

test('front matter names the task', () => {
  assert.match(text, /^---\nname: game-day-brief\ndescription: .+\n---\n/);
});

test('names the two read tools and the push', () => {
  for (const t of ['get-preflight', 'get-prep-digest', 'PushNotification']) {
    assert.ok(text.includes(t), t);
  }
});

test('names no write tool', () => {
  assert.doesNotMatch(text, /`(plan-[a-z-]+|apply-planned-change|undo-change|send-chat-message)`/);
});

test('states the no-paid-API rule', () => {
  assert.match(text, /paid service/);
});

test('has no em dash', () => {
  assert.ok(!text.includes(String.fromCharCode(0x2014)));
});
