import assert from 'node:assert/strict';
import test from 'node:test';

import { parseArgs, parseStream, planChats } from './run.mjs';

test('parseArgs reads models, samples and cases', () => {
  const o = parseArgs(['--models', 'sonnet,haiku', '--samples', '2', '--cases', '1,4', '--dry-run']);
  assert.deepEqual(o.models, ['sonnet', 'haiku']);
  assert.equal(o.samples, 2);
  assert.deepEqual(o.cases, [1, 4]);
  assert.equal(o.dryRun, true);
  assert.throws(() => parseArgs(['--nope']));
  assert.throws(() => parseArgs(['--samples', '0']));
});

test('planChats runs a chained case with the cases before it, once', () => {
  const chats = planChats([4, 2]);
  assert.equal(chats.length, 1);
  assert.deepEqual(chats[0].map(c => c.id), [2, 3, 4]);
  assert.equal(planChats().length, 20);
  assert.throws(() => planChats([99]));
});

test('parseStream collects tool calls (server prefix removed), the final text and the session', () => {
  const lines = [
    { type: 'system', subtype: 'init' },
    {
      type: 'assistant',
      message: { content: [{ type: 'tool_use', name: 'mcp__foundry__get-party', input: {} }] },
    },
    { type: 'result', result: 'All fine.', session_id: 's1', is_error: false, usage: { input_tokens: 5, output_tokens: 7 } },
  ]
    .map(e => JSON.stringify(e))
    .join('\n');
  const p = parseStream(lines + '\nnot json');
  assert.deepEqual(p.calls, [{ name: 'get-party', input: {} }]);
  assert.equal(p.text, 'All fine.');
  assert.equal(p.sessionId, 's1');
  assert.equal(p.isError, false);
});
