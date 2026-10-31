// Tests for the context alert hook (context-alert.mjs): tail parsing, thresholds and low mode,
// once per threshold, and silence on every failure.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { spawnSync } from 'node:child_process';
import { mkdtempSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  confirmedContextIn,
  contextFromTranscript,
  contextOf,
  lastContextIn,
  messageFor,
  run,
  thresholdsFor,
} from './context-alert.mjs';

const HOOK = path.join(path.dirname(fileURLToPath(import.meta.url)), 'context-alert.mjs');

function fixture() {
  const root = mkdtempSync(path.join(os.tmpdir(), 'context-alert-test-'));
  const env = {
    CONTEXT_ALERT_STATE_DIR: path.join(root, 'state'),
    CONTEXT_ALERT_THRESHOLDS_FILE: path.join(root, 'none.json'),
  };
  return { root, env, cleanup: () => rmSync(root, { recursive: true, force: true }) };
}

function turn(ctx, extra = {}) {
  // Split the context over the three counted fields; output tokens must not count.
  const cacheRead = Math.floor(ctx * 0.9);
  const cacheCreate = Math.floor(ctx * 0.09);
  return JSON.stringify({
    type: 'assistant',
    message: {
      id: `msg-${ctx}`,
      usage: {
        input_tokens: ctx - cacheRead - cacheCreate,
        cache_read_input_tokens: cacheRead,
        cache_creation_input_tokens: cacheCreate,
        output_tokens: 5000,
      },
    },
    ...extra,
  });
}

function transcript(root, lines, name = 't.jsonl') {
  const file = path.join(root, name);
  writeFileSync(file, `${lines.join('\n')}\n`);
  return file;
}

const input = (file, extra = {}) => ({
  session_id: 'sess-1',
  transcript_path: file,
  hook_event_name: 'PostToolUse',
  ...extra,
});

test('lastContextIn: the last main-thread usage wins, sidechain and non-assistant lines are ignored', () => {
  const lines = [
    turn(100_000),
    turn(120_000),
    JSON.stringify({ type: 'user', message: { content: 'hi' } }),
    turn(900_000, { isSidechain: true }),
    '{"type":"assistant","message":{"usage":',
    'not json at all "usage"',
  ];
  assert.equal(lastContextIn(lines), 120_000);
  assert.equal(lastContextIn(['{}', '']), null);
});

test('contextFromTranscript: a partial first line of the tail is skipped', () => {
  const { root, cleanup } = fixture();
  try {
    // The old big turn is cut in half by a tiny tail; only whole lines after it may count.
    const file = transcript(root, [turn(300_000), turn(150_000)]);
    const lastLine = turn(150_000).length + 1;
    assert.equal(contextFromTranscript(file, lastLine + 10), 150_000);
    // A tail that starts inside the only usable line yields nothing rather than a half line.
    assert.equal(contextFromTranscript(file, lastLine - 20), null);
    assert.equal(contextFromTranscript(file), 150_000);
  } finally {
    cleanup();
  }
});

test('contextFromTranscript: only the tail is read from a large file', () => {
  const { root, cleanup } = fixture();
  try {
    const filler = JSON.stringify({ type: 'user', message: { content: 'x'.repeat(2000) } });
    const lines = [turn(390_000)];
    for (let i = 0; i < 600; i++) lines.push(filler); // about 1.2 MB after the first turn
    lines.push(turn(210_000));
    const file = transcript(root, lines);
    assert.equal(contextFromTranscript(file), 210_000);
    // The 390k turn is outside the last 512 KB: with no other turn in the tail there is no answer.
    const only = transcript(root, [turn(390_000), ...lines.slice(1, 601)], 'only.jsonl');
    assert.equal(contextFromTranscript(only), null);
  } finally {
    cleanup();
  }
});

test('thresholds: defaults, low mode by env, the file wins over the env, bad files fall back', () => {
  const { root, env, cleanup } = fixture();
  try {
    assert.deepEqual(thresholdsFor(env), { plan: 350_000, out: 400_000 });
    assert.deepEqual(thresholdsFor({ ...env, CONTEXT_ALERT_LOW: '1' }), {
      plan: 200_000,
      out: 250_000,
    });
    const file = path.join(root, 'thresholds.json');
    writeFileSync(file, JSON.stringify({ plan: 150_000, out: 180_000 }));
    const withFile = { ...env, CONTEXT_ALERT_THRESHOLDS_FILE: file };
    assert.deepEqual(thresholdsFor(withFile), { plan: 150_000, out: 180_000 });
    assert.deepEqual(thresholdsFor({ ...withFile, CONTEXT_ALERT_LOW: '1' }), {
      plan: 150_000,
      out: 180_000,
    });
    writeFileSync(file, '{"plan": 300000, "out": 100000}');
    assert.deepEqual(thresholdsFor({ ...withFile, CONTEXT_ALERT_LOW: '1' }), {
      plan: 200_000,
      out: 250_000,
    });
    writeFileSync(file, 'garbage');
    assert.deepEqual(thresholdsFor(withFile), { plan: 350_000, out: 400_000 });
  } finally {
    cleanup();
  }
});

test('run: silent under the plan line, plan line at 350k, out line at 400k', () => {
  const { root, env, cleanup } = fixture();
  try {
    const below = transcript(root, [turn(349_000)]);
    assert.equal(run(input(below), env), '');
    const plan = transcript(root, [turn(352_000)], 'plan.jsonl');
    const out = JSON.parse(run(input(plan), env));
    assert.equal(out.systemMessage, 'Context 352k: plan the handover (lane skill).');
    assert.equal(out.hookSpecificOutput.hookEventName, 'PostToolUse');
    assert.match(out.hookSpecificOutput.additionalContext, /352k tokens .*350k.*Out by 400k/);
    assert.match(out.hookSpecificOutput.additionalContext, /write the handover prompt and stop/);
  } finally {
    cleanup();
  }
});

test('run: a subagent event (agent_id) prints nothing and leaves the state for the main thread', () => {
  const { root, env, cleanup } = fixture();
  try {
    const file = transcript(root, [turn(352_000)]);
    assert.equal(run(input(file, { agent_id: 'agent-1', agent_type: 'general-purpose' }), env), '');
    assert.equal(run(input(file, { agent_type: 'Explore' }), env), '');
    // The main thread still gets its line afterwards.
    const out = JSON.parse(run(input(file), env));
    assert.equal(out.systemMessage, 'Context 352k: plan the handover (lane skill).');
  } finally {
    cleanup();
  }
});

test('run: each line prints once per session (350 then 360 once, then 400 prints the out line)', () => {
  const { root, env, cleanup } = fixture();
  try {
    const at = (ctx, name) => transcript(root, [turn(ctx)], name);
    assert.ok(run(input(at(350_000, 'a.jsonl')), env));
    assert.equal(run(input(at(360_000, 'b.jsonl')), env), '');
    const out = JSON.parse(
      run(input(at(401_000, 'c.jsonl'), { hook_event_name: 'UserPromptSubmit' }), env)
    );
    assert.equal(out.systemMessage, 'Context 401k: hand over now.');
    assert.equal(out.hookSpecificOutput.hookEventName, 'UserPromptSubmit');
    assert.match(out.hookSpecificOutput.additionalContext, /stop taking new work/);
    assert.match(out.hookSpecificOutput.additionalContext, /write the handover prompt now/);
    assert.equal(run(input(at(420_000, 'd.jsonl')), env), '');
    // Another session has its own state.
    assert.ok(run(input(at(360_000, 'e.jsonl'), { session_id: 'sess-2' }), env));
    // After a compact the context falls under the plan line and the lines can fire again.
    assert.equal(run(input(at(80_000, 'f.jsonl')), env), '');
    assert.ok(run(input(at(355_000, 'g.jsonl')), env));
  } finally {
    cleanup();
  }
});

test('run: a first reading above the out line prints only the out line', () => {
  const { root, env, cleanup } = fixture();
  try {
    const file = transcript(root, [turn(450_000)]);
    const out = JSON.parse(run(input(file), env));
    assert.match(out.systemMessage, /hand over now/);
    assert.equal(run(input(file), env), '');
  } finally {
    cleanup();
  }
});

test('run: low mode lines at 200k and 250k, by env and by file', () => {
  const { root, env, cleanup } = fixture();
  try {
    const low = { ...env, CONTEXT_ALERT_LOW: '1' };
    const file = transcript(root, [turn(205_000)]);
    assert.equal(run(input(file), env), '');
    const plan = JSON.parse(run(input(file), low));
    assert.equal(plan.systemMessage, 'Context 205k: plan the handover (lane skill).');
    assert.match(plan.hookSpecificOutput.additionalContext, /Out by 250k/);
    const out = JSON.parse(run(input(transcript(root, [turn(255_000)], 'o.jsonl')), low));
    assert.match(out.systemMessage, /Context 255k: hand over now/);

    const thresholds = path.join(root, 'th.json');
    writeFileSync(thresholds, JSON.stringify({ plan: 100_000, out: 120_000 }));
    const viaFile = { ...env, CONTEXT_ALERT_THRESHOLDS_FILE: thresholds };
    const second = transcript(root, [turn(110_000)], 's.jsonl');
    assert.match(
      JSON.parse(run(input(second, { session_id: 'sess-file' }), viaFile)).systemMessage,
      /Context 110k: plan/
    );
  } finally {
    cleanup();
  }
});

test('run: a missing or empty transcript, bad input and no session id print nothing', () => {
  const { root, env, cleanup } = fixture();
  try {
    assert.equal(run(input(path.join(root, 'missing.jsonl')), env), '');
    assert.equal(run(input(transcript(root, [], 'empty.jsonl')), env), '');
    assert.equal(run(input(root), env), ''); // a directory
    assert.equal(run(null, env), '');
    assert.equal(run({}, env), '');
    assert.equal(run('text', env), '');
    // A missing session id still works (state key "unknown").
    const file = transcript(root, [turn(360_000)]);
    assert.ok(run({ transcript_path: file }, env));
  } finally {
    cleanup();
  }
});

// A real doubled reading (2026-10-28, cache read): one response, an advisor call, reported about
// twice the true context between two normal ones. 38 false handovers came from such readings.
const DOUBLED_TRIPLE = [161_654, 327_920, 164_453];

test('confirmedContextIn: a doubled reading between two normal ones never counts', () => {
  const [a, phantom, b] = DOUBLED_TRIPLE;
  assert.equal(confirmedContextIn([turn(a), turn(phantom)]), a);
  assert.equal(confirmedContextIn([turn(a), turn(phantom), turn(b)]), b);
  assert.equal(confirmedContextIn([turn(phantom), turn(b)]), b);
  // Both responses big: the smaller one is the confirmed context.
  assert.equal(confirmedContextIn([turn(260_000), turn(270_000)]), 260_000);
  assert.equal(confirmedContextIn([turn(270_000)]), 270_000);
  assert.equal(confirmedContextIn([]), null);
});

test('confirmedContextIn: lines of one response do not confirm each other, sidechains are skipped', () => {
  const phantom = turn(DOUBLED_TRIPLE[1]);
  assert.equal(confirmedContextIn([turn(DOUBLED_TRIPLE[0]), phantom, phantom]), DOUBLED_TRIPLE[0]);
  assert.equal(
    confirmedContextIn([turn(DOUBLED_TRIPLE[0]), turn(900_000, { isSidechain: true })]),
    DOUBLED_TRIPLE[0]
  );
});

test('run: the doubled triple stays silent in low mode, a real climb past the line still fires', () => {
  const { root, env, cleanup } = fixture();
  try {
    const low = { ...env, CONTEXT_ALERT_LOW: '1' }; // 200k and 250k
    const [a, phantom, b] = DOUBLED_TRIPLE;
    assert.equal(run(input(transcript(root, [turn(a), turn(phantom)], 'p1.jsonl')), low), '');
    assert.equal(run(input(transcript(root, [turn(phantom), turn(b)], 'p2.jsonl')), low), '');
    // Two real readings above the out line: the line fires on the smaller one.
    const real = transcript(root, [turn(255_000), turn(262_000)], 'real.jsonl');
    assert.match(JSON.parse(run(input(real), low)).systemMessage, /Context 255k: hand over now/);
  } finally {
    cleanup();
  }
});

// The real usage of the doubled response above (2026-10-28, an advisor call): the top level sums
// the two executor passes (163,467 + 164,453 cache read), `iterations` holds each pass.
const ADVISOR_USAGE = {
  input_tokens: 4,
  cache_creation_input_tokens: 2730,
  cache_read_input_tokens: 327_920,
  output_tokens: 454,
  iterations: [
    {
      type: 'message',
      input_tokens: 2,
      cache_read_input_tokens: 163_467,
      cache_creation_input_tokens: 986,
    },
    {
      type: 'advisor_message',
      input_tokens: 163_867,
      cache_read_input_tokens: 0,
      cache_creation_input_tokens: 0,
    },
    {
      type: 'message',
      input_tokens: 2,
      cache_read_input_tokens: 164_453,
      cache_creation_input_tokens: 1744,
    },
  ],
};
const advisorTurn = () =>
  JSON.stringify({ type: 'assistant', message: { id: 'msg-advisor', usage: ADVISOR_USAGE } });

test('contextOf: an advisor response counts its last pass, not the summed top level', () => {
  assert.equal(contextOf(ADVISOR_USAGE), 2 + 164_453 + 1744);
  assert.equal(contextOf({ ...ADVISOR_USAGE, iterations: [] }), 4 + 327_920 + 2730);
  assert.equal(contextOf({ input_tokens: 1, cache_read_input_tokens: 2, iterations: 'x' }), 3);
  // Shapes without a usable executor pass fall back to the top level, never to 0.
  const top = { input_tokens: 1, cache_read_input_tokens: 2 };
  const only = it => contextOf({ ...top, iterations: it });
  assert.equal(only([ADVISOR_USAGE.iterations[1]]), 3);
  assert.equal(only([{ input_tokens: 9 }, null]), 3);
  assert.equal(only([{ type: 'message' }]), 3);
  // The last executor pass wins, not the first one or the advisor's own read.
  assert.equal(only([...ADVISOR_USAGE.iterations, ADVISOR_USAGE.iterations[1]]), 166_199);
});

test('run: an advisor call whose last pass is past the out line still fires', () => {
  const { root, env, cleanup } = fixture();
  try {
    const low = { ...env, CONTEXT_ALERT_LOW: '1' };
    const big = JSON.stringify({
      type: 'assistant',
      message: {
        id: 'msg-advisor-big',
        usage: {
          ...ADVISOR_USAGE,
          cache_read_input_tokens: 510_000,
          iterations: [
            { type: 'message', input_tokens: 2, cache_read_input_tokens: 254_000 },
            ADVISOR_USAGE.iterations[1],
            { type: 'message', input_tokens: 2, cache_read_input_tokens: 256_000 },
          ],
        },
      },
    });
    const file = transcript(root, [turn(255_000), big]);
    // The last pass (256,002), not the summed top level and not 0.
    assert.equal(lastContextIn(readFileSync(file, 'utf8').split('\n')), 256_002);
    assert.match(JSON.parse(run(input(file), low)).systemMessage, /Context 255k: hand over now/);
  } finally {
    cleanup();
  }
});

test('run: two advisor calls in a row at 166k stay silent in low mode', () => {
  const { root, env, cleanup } = fixture();
  try {
    const low = { ...env, CONTEXT_ALERT_LOW: '1' };
    const second = advisorTurn().replace('msg-advisor', 'msg-advisor-2');
    const file = transcript(root, [turn(160_000), advisorTurn(), second]);
    assert.equal(lastContextIn(readFileSync(file, 'utf8').split('\n')), 166_199);
    assert.equal(run(input(file), low), '');
  } finally {
    cleanup();
  }
});

test('confirmedContextIn: zero-usage synthetic messages do not count as a response', () => {
  const synthetic = JSON.stringify({
    type: 'assistant',
    message: {
      id: 'syn',
      model: '<synthetic>',
      usage: { input_tokens: 0, cache_read_input_tokens: 0, cache_creation_input_tokens: 0 },
    },
  });
  assert.equal(confirmedContextIn([turn(260_000), turn(262_000), synthetic]), 260_000);
});

test('messageFor: the event name defaults to PostToolUse', () => {
  const m = messageFor(1, 352_000, { plan: 350_000, out: 400_000 });
  assert.equal(m.hookSpecificOutput.hookEventName, 'PostToolUse');
});

test('the hook process: prints the plan line as JSON, and nothing on garbage stdin or no stdin', () => {
  const { root, env, cleanup } = fixture();
  try {
    const file = transcript(root, [turn(360_000)]);
    const spawn = stdin =>
      spawnSync(process.execPath, [HOOK], {
        input: stdin,
        encoding: 'utf8',
        env: { ...process.env, ...env },
      });
    const ok = spawn(JSON.stringify(input(file)));
    assert.equal(ok.status, 0);
    assert.equal(
      JSON.parse(ok.stdout).systemMessage,
      'Context 360k: plan the handover (lane skill).'
    );
    for (const bad of ['not json', '', '[1,2', JSON.stringify({ transcript_path: 5 })]) {
      const r = spawn(bad);
      assert.equal(r.status, 0);
      assert.equal(r.stdout, '');
    }
  } finally {
    cleanup();
  }
});
