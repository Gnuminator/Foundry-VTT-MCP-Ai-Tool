// Tests for guard-model.mjs:  node --test .claude/hooks/guard-model.test.mjs
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import path from 'node:path';
import { test } from 'node:test';
import { fileURLToPath } from 'node:url';
import { decide, run } from './guard-model.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'guard-model.mjs');
const START = 'mcp__ccd_session__start_session';

test('Agent and Task calls without a model are denied', () => {
  for (const tool of ['Agent', 'Task']) {
    assert.ok(decide(tool, { prompt: 'x' }), tool);
    assert.ok(decide(tool, { prompt: 'x', model: '' }), `${tool} empty`);
    assert.ok(decide(tool, { prompt: 'x', model: '   ' }), `${tool} blank`);
    assert.ok(decide(tool, { prompt: 'x', subagent_type: 'Explore' }), `${tool} typed agent`);
    assert.ok(decide(tool, null), `${tool} no input`);
  }
});

test('Agent and Task calls with a model pass', () => {
  for (const model of ['sonnet', 'haiku', 'opus', 'claude-sonnet-5-5']) {
    assert.equal(decide('Agent', { prompt: 'x', model }), null, model);
    assert.equal(decide('Task', { prompt: 'x', model }), null, model);
  }
});

test('a fork Agent call needs no model', () => {
  assert.equal(decide('Agent', { prompt: 'x', subagent_type: 'fork' }), null);
});

test('start_session without a model is denied (new sessions, cards and successors)', () => {
  for (const initiation of ['user_asked', 'own_initiative', 'offer']) {
    assert.ok(decide(START, { title: 't', prompt: 'do it', initiation }), initiation);
  }
  assert.ok(decide(START, { title: 't', prompt: 'do it', initiation: 'own_initiative', model: '' }));
  assert.ok(decide(START, { proposal_id: 'p1', prompt: 'new brief' }), 'proposal_id with a prompt is a new brief');
  assert.ok(decide(START, { title: 't', initiation: 'user_asked' }), 'title-only but not an offer');
});

test('start_session with a model passes', () => {
  assert.equal(decide(START, { title: 't', prompt: 'p', initiation: 'user_asked', model: 'sonnet' }), null);
  assert.equal(decide(START, { title: 't', prompt: 'p', initiation: 'own_initiative', model: 'opus' }), null);
});

test('start_session exemptions: fork, starting a proposal, the title-only offer', () => {
  assert.equal(decide(START, { title: 't', prompt: 'p', context: 'fork' }), null);
  assert.equal(decide(START, { proposal_id: 'p1' }), null);
  assert.equal(decide(START, { title: 't', initiation: 'offer' }), null);
});

test('other tools are not this hook’s business', () => {
  assert.equal(decide('Bash', { command: 'ls' }), null);
  assert.equal(decide('mcp__ccd_session__hand_off_to_session', { title: 't' }), null);
});

test('the deny reason names the CLAUDE.md Models rule and the hook', () => {
  const out = JSON.parse(run({ tool_name: 'Agent', tool_input: { prompt: 'x' } }));
  assert.equal(out.hookSpecificOutput.hookEventName, 'PreToolUse');
  assert.equal(out.hookSpecificOutput.permissionDecision, 'deny');
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /CLAUDE\.md "Models"/);
  assert.match(out.hookSpecificOutput.permissionDecisionReason, /guard-model\.mjs/);
  assert.equal(run({ tool_name: 'Agent', tool_input: { prompt: 'x', model: 'haiku' } }), '');
});

test('run never throws on a malformed payload', () => {
  for (const input of [null, undefined, {}, { tool_name: 5 }, { tool_name: 'Agent' }]) {
    assert.doesNotThrow(() => run(input));
  }
});

test('as a process: deny JSON on a blank model, nothing otherwise or on bad input', () => {
  const go = stdin => spawnSync(process.execPath, [HOOK], { input: stdin, encoding: 'utf8' });
  const deny = go(JSON.stringify({ tool_name: 'Agent', tool_input: { prompt: 'x' } }));
  assert.equal(deny.status, 0);
  assert.equal(JSON.parse(deny.stdout).hookSpecificOutput.permissionDecision, 'deny');
  const ok = go(JSON.stringify({ tool_name: START, tool_input: { title: 't', prompt: 'p', model: 'sonnet' } }));
  assert.equal(ok.status, 0);
  assert.equal(ok.stdout, '');
  assert.equal(go('not json').stdout, '');
});
