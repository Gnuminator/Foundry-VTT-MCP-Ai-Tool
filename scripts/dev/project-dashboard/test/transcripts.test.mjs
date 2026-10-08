import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { scanTranscripts } from '../transcripts.mjs';
import { assistant, userLine } from './helpers.mjs';

const SLUG = 'C--fake-repo';
const NOW = new Date('2026-10-08T12:00:00.000Z');

function setup() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-transcripts-'));
  const proj = path.join(root, 'projects', SLUG);
  fs.mkdirSync(proj, { recursive: true });
  return { root, projectsDir: path.join(root, 'projects'), proj };
}

const scan = (env, state) =>
  scanTranscripts({ projectsDir: env.projectsDir, slug: SLUG, state, now: NOW });

test('incremental append only reads the new lines', async () => {
  const env = setup();
  const file = path.join(env.proj, 'aaaa.jsonl');
  fs.writeFileSync(file, assistant('m1', '2026-10-08T10:00:00.000Z') + '\n');
  const r1 = await scan(env, null);
  assert.equal(r1.sessions.length, 1);
  assert.equal(r1.sessions[0].context, 10 + 1000 + 100);
  const offset1 = r1.state.files[file].offset;
  assert.equal(offset1, fs.statSync(file).size);

  fs.appendFileSync(file, assistant('m2', '2026-10-08T10:05:00.000Z', { cacheRead: 5000 }) + '\n');
  const r2 = await scan(env, JSON.parse(JSON.stringify(r1.state)));
  assert.equal(r2.sessions[0].context, 10 + 5000 + 100);
  assert.equal(r2.sessions[0].peak, 10 + 5000 + 100);
  assert.equal(r2.sessions[0].lastRequestTs, '2026-10-08T10:05:00.000Z');
  assert.equal(r2.messages.size, 2);
  assert.equal(r2.state.files[file].offset, fs.statSync(file).size);
});

test('an unterminated last line waits until it is complete', async () => {
  const env = setup();
  const file = path.join(env.proj, 'bbbb.jsonl');
  const first = assistant('m1', '2026-10-08T10:00:00.000Z') + '\n';
  const second = assistant('m2', '2026-10-08T10:05:00.000Z', { cacheRead: 7000 });
  fs.writeFileSync(file, first + second.slice(0, 40));
  const r1 = await scan(env, null);
  assert.equal(r1.state.files[file].offset, Buffer.byteLength(first));
  assert.equal(r1.messages.size, 1);

  fs.writeFileSync(file, first + second + '\n');
  const r2 = await scan(env, r1.state);
  assert.equal(r2.messages.size, 2);
  assert.equal(r2.sessions[0].context, 10 + 7000 + 100);
});

test('offsets count bytes, not characters', async () => {
  const env = setup();
  const file = path.join(env.proj, 'cccc.jsonl');
  const line = userLine('2026-10-08T10:00:00.000Z', 'blå bær og æøå') + '\n';
  fs.writeFileSync(file, line + assistant('m1', '2026-10-08T10:01:00.000Z') + '\n');
  const r = await scan(env, null);
  assert.equal(r.state.files[file].offset, fs.statSync(file).size);
  assert.ok(Buffer.byteLength(line) > line.length);
});

test('a file that shrinks is read again from the start', async () => {
  const env = setup();
  const file = path.join(env.proj, 'dddd.jsonl');
  fs.writeFileSync(
    file,
    assistant('m1', '2026-10-08T10:00:00.000Z', { cacheRead: 9000 }) +
      '\n' +
      assistant('m2', '2026-10-08T10:01:00.000Z', { cacheRead: 9000 }) +
      '\n'
  );
  const r1 = await scan(env, null);
  assert.equal(r1.sessions[0].peak, 9110);
  fs.writeFileSync(file, assistant('m9', '2026-10-08T11:00:00.000Z', { cacheRead: 100 }) + '\n');
  const r2 = await scan(env, r1.state);
  assert.equal(r2.sessions[0].peak, 210);
  assert.equal(r2.sessions[0].context, 210);
  assert.equal(r2.messages.size, 1);
  assert.ok(r2.messages.has('m9'));
});

test('sidechain records do not touch the context', async () => {
  const env = setup();
  const file = path.join(env.proj, 'eeee.jsonl');
  fs.writeFileSync(
    file,
    assistant('m1', '2026-10-08T10:00:00.000Z', { cacheRead: 2000 }) +
      '\n' +
      assistant('s1', '2026-10-08T10:01:00.000Z', { cacheRead: 90000 }, { isSidechain: true }) +
      '\n'
  );
  const r = await scan(env, null);
  assert.equal(r.sessions[0].context, 10 + 2000 + 100);
  assert.equal(r.sessions[0].peak, 10 + 2000 + 100);
  assert.equal(r.messages.get('s1').sub, true);
  assert.equal(r.messages.get('m1').sub, false);
});

test('subagent transcripts count as sub tokens and keep only the model', async () => {
  const env = setup();
  fs.writeFileSync(
    path.join(env.proj, 'ffff.jsonl'),
    assistant('m1', '2026-10-08T10:00:00.000Z') + '\n'
  );
  const subDir = path.join(env.proj, 'ffff', 'subagents');
  fs.mkdirSync(subDir, { recursive: true });
  fs.writeFileSync(
    path.join(subDir, 'agent-1.jsonl'),
    assistant('sub1', '2026-10-08T10:02:00.000Z', { output: 50 }) + '\n'
  );
  fs.writeFileSync(
    path.join(subDir, 'agent-1.meta.json'),
    JSON.stringify({ model: 'claude-sub-1', description: 'FAKE-SECRET-DESC' })
  );
  const r = await scan(env, null);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.messages.get('sub1').sub, true);
  assert.equal(r.sessions[0].context, 1110);
  assert.ok(!JSON.stringify(r).includes('FAKE-SECRET-DESC'));
  assert.ok(JSON.stringify(r.state).includes('claude-sub-1'));
});

test('a message id repeated across two files is counted once, keeping the largest output', async () => {
  const env = setup();
  fs.writeFileSync(
    path.join(env.proj, 'g1.jsonl'),
    assistant('dup', '2026-10-08T10:00:00.000Z', { output: 3 }) + '\n'
  );
  fs.writeFileSync(
    path.join(env.proj, 'g2.jsonl'),
    assistant('dup', '2026-10-08T10:00:00.000Z', { output: 30 }) +
      '\n' +
      assistant('dup', '2026-10-08T10:00:00.000Z', { output: 12 }) +
      '\n'
  );
  const r = await scan(env, null);
  assert.equal(r.sessions.length, 2);
  assert.equal(r.messages.size, 1);
  assert.equal(r.messages.get('dup').tokens.output, 30);
});

test('old messages are not kept and worktree folders of the slug are scanned', async () => {
  const env = setup();
  const wt = path.join(env.projectsDir, SLUG + '--claude-worktrees-x');
  const other = path.join(env.projectsDir, 'C--other-repo');
  const sibling = path.join(env.projectsDir, SLUG + '-Backup');
  fs.mkdirSync(wt, { recursive: true });
  fs.mkdirSync(other, { recursive: true });
  fs.mkdirSync(sibling, { recursive: true });
  fs.writeFileSync(
    path.join(sibling, 'b1.jsonl'),
    assistant('sib', '2026-10-08T09:00:00.000Z') + '\n'
  );
  fs.writeFileSync(
    path.join(wt, 'w1.jsonl'),
    assistant('old', '2026-09-01T10:00:00.000Z') +
      '\n' +
      assistant('new', '2026-10-08T09:00:00.000Z') +
      '\n'
  );
  fs.writeFileSync(
    path.join(other, 'o1.jsonl'),
    assistant('zzz', '2026-10-08T09:00:00.000Z') + '\n'
  );
  const r = await scan(env, null);
  assert.deepEqual([...r.messages.keys()], ['new']);
  assert.equal(r.sessions.length, 1);
  assert.equal(r.sessions[0].sessionId, 'w1');
});

test('titles come from customTitle lines, with custom-title.json as a fallback', async () => {
  const env = setup();
  fs.writeFileSync(
    path.join(env.proj, 'h1.jsonl'),
    JSON.stringify({ type: 'custom-title', customTitle: 'First', sessionId: 'h1' }) +
      '\n' +
      JSON.stringify({ type: 'custom-title', customTitle: 'Second', sessionId: 'h1' }) +
      '\n'
  );
  fs.writeFileSync(
    path.join(env.proj, 'h2.jsonl'),
    assistant('m1', '2026-10-08T10:00:00.000Z') + '\n'
  );
  fs.mkdirSync(path.join(env.proj, 'h2'));
  fs.writeFileSync(
    path.join(env.proj, 'h2', 'custom-title.json'),
    JSON.stringify({ customTitle: 'From file' })
  );
  const r = await scan(env, null);
  const byId = Object.fromEntries(r.sessions.map(s => [s.sessionId, s]));
  assert.equal(byId.h1.title, 'Second');
  assert.equal(byId.h2.title, 'From file');
});

test('lines that are not assistant records never reach the state or the result', async () => {
  const env = setup();
  const secret = 'sk-ant-FAKE-SECRET-0123456789';
  const file = path.join(env.proj, 'iiii.jsonl');
  fs.writeFileSync(
    file,
    [
      userLine('2026-10-08T10:00:00.000Z', `my key is ${secret}`),
      JSON.stringify({
        type: 'user',
        timestamp: '2026-10-08T10:01:00.000Z',
        toolUseResult: { stdout: secret },
        message: { content: [{ type: 'tool_result', content: secret }] },
      }),
      assistant('m1', '2026-10-08T10:02:00.000Z'),
      '{"type":"user","timestamp":"2026-10-08T10:03:00.000Z","note":"' + secret + '" <broken',
    ].join('\n') + '\n'
  );
  const r = await scan(env, null);
  const dump =
    JSON.stringify(r.sessions) + JSON.stringify([...r.messages]) + JSON.stringify(r.state);
  assert.ok(!dump.includes(secret));
  assert.ok(!dump.includes('FAKE-ASSISTANT-TEXT'));
  assert.equal(r.sessions[0].lastTs, '2026-10-08T10:03:00.000Z');
  assert.equal(r.sessions[0].firstTs, '2026-10-08T10:00:00.000Z');
});

test('branch and cwd come from assistant records, the latest wins, and they survive an incremental scan', async () => {
  const env = setup();
  const file = path.join(env.proj, 'eeee.jsonl');
  fs.writeFileSync(
    file,
    userLine('2026-10-08T09:59:00.000Z', 'hello') +
      '\n' +
      assistant(
        'm1',
        '2026-10-08T10:00:00.000Z',
        {},
        { gitBranch: 'claude/one', cwd: '/fake/repo/.claude/worktrees/one' }
      ) +
      '\n'
  );
  const r1 = await scan(env, null);
  assert.equal(r1.sessions[0].branch, 'claude/one');
  assert.equal(r1.sessions[0].cwd, '/fake/repo/.claude/worktrees/one');

  // A later pass that appends only user lines keeps the branch; a later assistant record replaces it.
  fs.appendFileSync(file, userLine('2026-10-08T10:01:00.000Z', 'again') + '\n');
  const r2 = await scan(env, JSON.parse(JSON.stringify(r1.state)));
  assert.equal(r2.sessions[0].branch, 'claude/one');
  fs.appendFileSync(
    file,
    assistant('m2', '2026-10-08T10:02:00.000Z', {}, { gitBranch: 'main', cwd: '/fake/repo' }) + '\n'
  );
  const r3 = await scan(env, JSON.parse(JSON.stringify(r2.state)));
  assert.equal(r3.sessions[0].branch, 'main');
  assert.equal(r3.sessions[0].cwd, '/fake/repo');
});

test('a non-assistant line counts its own (first) timestamp, not a nested one', async () => {
  const env = setup();
  // As in real transcripts: the record's timestamp, then toolUseResult with its own.
  const line = JSON.stringify({
    type: 'user',
    timestamp: '2026-10-08T11:00:00.000Z',
    toolUseResult: { timestamp: '2026-10-01T00:00:00.000Z' },
  });
  fs.writeFileSync(
    path.join(env.proj, 's1.jsonl'),
    assistant('m1', '2026-10-08T10:00:00.000Z') + '\n' + line + '\n'
  );
  const r = await scan(env, null);
  assert.equal(r.sessions[0].firstTs, '2026-10-08T10:00:00.000Z');
  assert.equal(r.sessions[0].lastTs, '2026-10-08T11:00:00.000Z');
});
