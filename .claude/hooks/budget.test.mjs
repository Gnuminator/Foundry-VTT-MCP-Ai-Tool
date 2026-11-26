// node --test .claude/hooks/budget.test.mjs
import assert from 'node:assert/strict';
import { appendFileSync, mkdirSync, mkdtempSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { test } from 'node:test';
import { advance, lineFor, readState, run, update } from './budget.mjs';

const root = mkdtempSync(path.join(os.tmpdir(), 'budget-test-'));
const env = { TOKEN_BUDGET_STATE_DIR: path.join(root, 'state'), TOKEN_BUDGET_LIMIT: '10000000' };

const resp = (id, input, extra = {}) =>
  JSON.stringify({
    type: 'assistant',
    gitBranch: 'claude/x',
    isSidechain: false,
    message: {
      id,
      model: 'claude-sonnet-5-5',
      usage: { input_tokens: input, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
    ...extra,
  }) + '\n';

test('counts every response once, incrementally, and records branch and last context', () => {
  const t = path.join(root, 's1.jsonl');
  writeFileSync(t, resp('a', 100) + resp('b', 200));
  let s = update('s1', t, env);
  assert.equal(s.tokens, 300);
  assert.equal(s.lastContext, 200);
  assert.equal(s.branch, 'claude/x');
  appendFileSync(t, resp('c', 50));
  s = update('s1', t, { ...env });
  assert.equal(s.tokens, 350, 'update alone writes no state, so it counts from the start');
});

test('run persists state and a re-run only adds the new bytes', () => {
  const t = path.join(root, 's2.jsonl');
  writeFileSync(t, resp('a', 100));
  run({ session_id: 's2', transcript_path: t }, env);
  appendFileSync(t, resp('b', 100));
  run({ session_id: 's2', transcript_path: t }, env);
  assert.equal(readState('s2', env).tokens, 200);
  run({ session_id: 's2', transcript_path: t }, env);
  assert.equal(readState('s2', env).tokens, 200, 'nothing new, nothing added');
});

test('a response split over several lines counts once', () => {
  const t = path.join(root, 's3.jsonl');
  writeFileSync(t, resp('a', 100) + resp('a', 100) + resp('b', 40));
  assert.equal(update('s3', t, env).tokens, 140);
});

test('an advisor call counts its last pass, not the doubled top level', () => {
  const t = path.join(root, 's4.jsonl');
  const line =
    JSON.stringify({
      type: 'assistant',
      message: {
        id: 'a',
        usage: {
          input_tokens: 400,
          iterations: [
            { type: 'message', input_tokens: 190 },
            { type: 'advisor_message', input_tokens: 99 },
            { type: 'message', input_tokens: 210 },
          ],
        },
      },
    }) + '\n';
  writeFileSync(t, line);
  assert.equal(update('s4', t, env).tokens, 210);
});

test('a partial last line waits for its newline', () => {
  const t = path.join(root, 's5.jsonl');
  writeFileSync(t, resp('a', 100) + resp('b', 100).trimEnd());
  run({ session_id: 's5', transcript_path: t }, env);
  assert.equal(readState('s5', env).tokens, 100);
  appendFileSync(t, '\n');
  run({ session_id: 's5', transcript_path: t }, env);
  assert.equal(readState('s5', env).tokens, 200);
});

test('subagent transcripts add to the session total', () => {
  const t = path.join(root, 's6.jsonl');
  writeFileSync(t, resp('a', 100));
  mkdirSync(path.join(root, 's6', 'subagents'), { recursive: true });
  writeFileSync(
    path.join(root, 's6', 'subagents', 'agent-1.jsonl'),
    resp('z', 70, { isSidechain: true })
  );
  const s = update('s6', t, env);
  assert.equal(s.tokens, 170);
  assert.equal(s.lastContext, 100);
});

test('one line at 70% and one at 100%, then quiet', () => {
  const t = path.join(root, 's7.jsonl');
  writeFileSync(t, resp('a', 7_500_000));
  const first = JSON.parse(run({ session_id: 's7', transcript_path: t }, env));
  assert.match(first.systemMessage, /lane at 7\.5 M of 10\.0 M \(75%\)/);
  assert.equal(run({ session_id: 's7', transcript_path: t }, env), '');
  appendFileSync(t, resp('b', 3_000_000));
  const second = JSON.parse(run({ session_id: 's7', transcript_path: t }, env));
  assert.match(second.systemMessage, /\(105%\)/);
  assert.equal(run({ session_id: 's7', transcript_path: t }, env), '');
});

test('lineFor stays quiet under 70% and a subagent call prints nothing', () => {
  assert.equal(lineFor({ tokens: 600, level: 0 }, 1000).line, '');
  assert.equal(run({ session_id: 's8', transcript_path: 'x', agent_id: 'a' }, env), '');
  assert.equal(run(null, env), '');
});

test('the same id in a subagent file and the main file counts once', () => {
  const t = path.join(root, 's9.jsonl');
  writeFileSync(t, resp('a', 100) + resp('x', 5) + resp('a', 100));
  mkdirSync(path.join(root, 's9', 'subagents'), { recursive: true });
  writeFileSync(path.join(root, 's9', 'subagents', 'agent-1.jsonl'), resp('a', 100));
  assert.equal(update('s9', t, env).tokens, 105);
});

test('a line longer than the chunk is still read', () => {
  const t = path.join(root, 's10.jsonl');
  const big = JSON.stringify({ type: 'user', pad: 'x'.repeat(9 * 1024 * 1024) }) + '\n';
  writeFileSync(t, resp('a', 100) + big + resp('b', 50));
  assert.equal(update('s10', t, env).tokens, 150);
});

test('multi-byte text does not skew the offset', () => {
  const t = path.join(root, 's11.jsonl');
  writeFileSync(
    t,
    JSON.stringify({ type: 'user', text: 'æøå€😀'.repeat(50) }) + '\n' + resp('a', 100)
  );
  run({ session_id: 's11', transcript_path: t }, env);
  appendFileSync(t, resp('b', 100));
  run({ session_id: 's11', transcript_path: t }, env);
  assert.equal(readState('s11', env).tokens, 200);
});

test('a session that changes branch is split between the branches', () => {
  const t = path.join(root, 's12.jsonl');
  writeFileSync(
    t,
    resp('a', 100) +
      resp('b', 40, { gitBranch: 'claude/y' }) +
      resp('c', 10, { gitBranch: 'claude/y' })
  );
  const s = update('s12', t, env);
  assert.deepEqual(s.branchTokens, { 'claude/x': 100, 'claude/y': 50 });
});

test('a passed deadline leaves the offset where it was', () => {
  const t = path.join(root, 's13.jsonl');
  writeFileSync(t, resp('a', 100));
  const state = { files: {}, seen: {}, branchTokens: {} };
  const entry = { offset: 0 };
  advance(t, entry, state, { main: true }, Date.now() - 1);
  assert.equal(entry.offset, 0);
  advance(t, entry, state, { main: true });
  assert.ok(entry.offset > 0);
});
