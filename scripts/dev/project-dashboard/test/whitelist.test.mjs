import test from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import { buildSnapshot, assertWhitelisted, writeSnapshot } from '../snapshot.mjs';
import { getPaths, slugify } from '../paths.mjs';
import { assistant, userLine } from './helpers.mjs';

const NOW = new Date('2026-10-08T12:00:00.000Z');
const SECRET = 'sk-ant-FAKE' + 'Z9'.repeat(250);
const KEY_SECRET = 'FAKE-KEY-FILE-CONTENT';

function makeEnv() {
  const root = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-whitelist-'));
  const repoRoot = path.join(root, 'repo');
  const env = {
    PROJECT_DASHBOARD_DATA: path.join(root, 'data'),
    CLAUDE_CONFIG_DIR: path.join(root, 'claude'),
    PROJECT_DASHBOARD_REPO: repoRoot,
  };
  const paths = getPaths(env);
  const proj = path.join(paths.projectsDir, paths.slug);
  fs.mkdirSync(proj, { recursive: true });
  fs.mkdirSync(paths.sessionsDir, { recursive: true });
  fs.mkdirSync(repoRoot, { recursive: true });
  return { root, paths, proj };
}

const deps = {
  isAlive: () => true,
  getPrs: async () => ({
    asOf: NOW.toISOString(),
    error: null,
    mainRuns: [],
    items: [
      {
        number: 12,
        title: 'A PR',
        state: 'OPEN',
        draft: false,
        branch: 'feature/a',
        headSha: 'abc',
        updatedAt: NOW.toISOString(),
        url: 'https://example.test/12',
        checks: { pass: 1, fail: 0, pending: 0, failing: [] },
      },
    ],
  }),
  readPlan: async () => ({ source: null, asOf: null, windows: [] }),
  readLock: async () => ({
    state: 'free',
    holder: null,
    session: null,
    since: null,
    purpose: null,
    queue: [],
  }),
};

test('paths: slug munging, worktree stripping and test root override', () => {
  assert.equal(
    slugify('C:\\Users\\chris\\Documents\\Claude Code\\Projects\\Foundry VTT AI Tool'),
    'C--Users-chris-Documents-Claude-Code-Projects-Foundry-VTT-AI-Tool'
  );
  const p = getPaths({ PROJECT_DASHBOARD_DATA: '/d', CLAUDE_CONFIG_DIR: '/c' });
  assert.equal(p.dataDir, '/d');
  assert.equal(p.sessionsDir, path.join('/c', 'sessions'));
  assert.ok(!/worktrees/.test(p.repoRoot));
});

test('a snapshot built from messy transcripts passes the whitelist and holds no prompt text', async () => {
  const { paths, proj } = makeEnv();
  const file = path.join(proj, 'sess-0001.jsonl');
  fs.writeFileSync(
    file,
    [
      JSON.stringify({
        type: 'custom-title',
        customTitle: 'Lane one',
        sessionId: 'sess-0001',
        extra: SECRET,
      }),
      userLine('2026-10-08T11:00:00.000Z', SECRET),
      assistant(
        'm1',
        '2026-10-08T11:30:00.000Z',
        {},
        { secretField: SECRET, requestId: SECRET, toolUseResult: { stdout: SECRET } }
      ),
      JSON.stringify({
        type: 'assistant',
        timestamp: '2026-10-08T11:31:00.000Z',
        cwd: paths.repoRoot,
        gitBranch: 'feature/a',
        message: {
          id: 'm2',
          model: 'claude-test-1',
          content: SECRET,
          usage: {
            input_tokens: 5,
            output_tokens: 7,
            cache_read_input_tokens: 300,
            cache_creation_input_tokens: 0,
            weird: SECRET,
          },
        },
      }),
    ].join('\n') + '\n'
  );
  fs.writeFileSync(
    path.join(paths.sessionsDir, '111.json'),
    JSON.stringify({
      pid: 111,
      sessionId: 'sess-0001',
      cwd: paths.repoRoot,
      name: 'Live name',
      status: 'busy',
      updatedAt: NOW.getTime() - 60000,
      hostSessionId: 'h1',
      startedAt: NOW.getTime() - 9999,
      secretToken: SECRET,
      peerFeatures: { a: SECRET },
    })
  );
  fs.writeFileSync(path.join(paths.sessionsDir, '111.abcdef.key'), KEY_SECRET);
  fs.writeFileSync(path.join(paths.sessionsDir, '222.json'), '{ not json');

  const snap = await buildSnapshot({ paths, now: NOW, withPrs: true, deps });
  assert.equal(assertWhitelisted(snap), true);
  const text = JSON.stringify(snap);
  assert.ok(!text.includes(SECRET));
  assert.ok(!text.includes(KEY_SECRET));
  assert.ok(text.includes('Live name'));
  assert.ok(snap.warnings.includes('sessions format changed'));
  assert.equal(snap.lanes.rows.length, 1);
  assert.equal(snap.lanes.rows[0].state, 'busy');
  assert.equal(snap.lanes.rows[0].pr, 12);
  assert.equal(snap.lanes.rows[0].context, 5 + 300);
  assert.equal(snap.usage.days.length, 7);
  const today = snap.usage.days[6];
  assert.equal(today.main.output, 5 + 7);

  const out = await writeSnapshot(paths.dataDir, snap);
  for (const f of [out, path.join(paths.dataDir, 'scan-state.json')]) {
    assert.ok(!fs.readFileSync(f, 'utf8').includes(SECRET), f);
  }

  // a second build reuses the saved scan state and gives the same lanes
  const again = await buildSnapshot({ paths, now: NOW, withPrs: false, deps });
  assert.deepEqual(
    again.lanes.rows.map(r => r.context),
    [305]
  );
  assert.deepEqual(again.prs.items, []);
});

test('assertWhitelisted rejects an unknown key and an over-long string', async () => {
  const { paths, proj } = makeEnv();
  fs.writeFileSync(path.join(proj, 's1.jsonl'), assistant('m1', '2026-10-08T11:30:00.000Z') + '\n');
  const snap = await buildSnapshot({ paths, now: NOW, deps });
  assert.equal(assertWhitelisted(snap), true);

  const extra = structuredClone(snap);
  extra.lanes.rows[0].prompt = 'hello';
  assert.throws(() => assertWhitelisted(extra), /lanes\.rows\[0\]\.prompt/);

  const topLevel = { ...structuredClone(snap), cookie: 'x' };
  assert.throws(() => assertWhitelisted(topLevel), /snapshot\.cookie/);

  const long = structuredClone(snap);
  long.lanes.rows[0].title = 'y'.repeat(201);
  assert.throws(() => assertWhitelisted(long), /over 200/);

  const both = structuredClone(snap);
  both.lanes.rows[0].extra = 1;
  both.project.root = 'z'.repeat(201);
  assert.throws(
    () => assertWhitelisted(both),
    err => /extra/.test(err.message) && /project\.root/.test(err.message)
  );

  await assert.rejects(() => writeSnapshot(paths.dataDir, extra), /whitelist/);
});
