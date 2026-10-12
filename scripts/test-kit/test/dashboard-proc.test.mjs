/**
 * The pure parts of the dashboard restart (slice 4, the login split pass): the child environment with
 * and without tokens, the port refusal, the script arguments, and the order of the restart with the
 * process runner and the health probe stubbed. No real process is started.
 */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import path from 'node:path';
import {
  DASHBOARD_SERVER,
  SPLIT_ENV_KEYS,
  assertTestDashboardPort,
  dashboardEnv,
  portOfUrl,
  restartDashboard,
  scriptArgs,
} from '../lib/dashboard-proc.mjs';
import { EnvError } from '../lib/errors.mjs';

const TOKENS = { gmToken: 'gm-test-token', playerToken: 'player-test-token' };

test('dashboardEnv sets both tokens and keeps the rest of the environment', () => {
  const env = dashboardEnv({ PATH: 'x', FOO: 'bar' }, TOKENS);
  assert.equal(env.GM_DASHBOARD_TOKEN, 'gm-test-token');
  assert.equal(env.PLAYER_DASHBOARD_TOKEN, 'player-test-token');
  assert.equal(env.PATH, 'x');
  assert.equal(env.FOO, 'bar');
});

test('dashboardEnv with null removes tokens the caller already had, and never changes the input', () => {
  const base = { GM_DASHBOARD_TOKEN: 'old', PLAYER_DASHBOARD_TOKEN: 'old2', KEEP: '1' };
  const env = dashboardEnv(base, null);
  for (const key of SPLIT_ENV_KEYS) assert.equal(key in env, false, `${key} is removed`);
  assert.equal(env.KEEP, '1');
  assert.equal(base.GM_DASHBOARD_TOKEN, 'old', 'the input object is untouched');
  assert.deepEqual(dashboardEnv({}, undefined), {});
});

test('dashboardEnv refuses a half split and equal tokens', () => {
  assert.throws(() => dashboardEnv({}, { gmToken: 'a', playerToken: '' }), EnvError);
  assert.throws(() => dashboardEnv({}, { gmToken: '', playerToken: 'b' }), EnvError);
  assert.throws(() => dashboardEnv({}, { gmToken: 'same', playerToken: 'same' }), /differ/);
});

test('only the test dashboard port is allowed; the live bridge ports are refused', () => {
  assertTestDashboardPort(3100);
  for (const port of [31414, 31415, 31416]) {
    assert.throws(
      () => assertTestDashboardPort(port),
      e => e instanceof EnvError && /live bridge/.test(e.message)
    );
  }
  // server B: its own dashboard port only
  assertTestDashboardPort(3101, { FOUNDRY_TEST_SERVER: 'B' });
  assert.throws(
    () => assertTestDashboardPort(3100, { FOUNDRY_TEST_SERVER: 'B' }),
    e => e instanceof EnvError && /Only port 3101 \(server B\)/.test(e.message)
  );
  for (const port of [3000, 30001, 31514, 80]) {
    assert.throws(
      () => assertTestDashboardPort(port),
      e => e instanceof EnvError && /not the test dashboard/.test(e.message)
    );
  }
});

test('portOfUrl reads the port, with the scheme defaults', () => {
  assert.equal(portOfUrl('http://127.0.0.1:3100'), 3100);
  assert.equal(portOfUrl('http://localhost:31414/'), 31414);
  assert.equal(portOfUrl('http://example.test'), 80);
  assert.equal(portOfUrl('https://example.test'), 443);
  assert.throws(() => portOfUrl('not a url'), EnvError);
});

test('scriptArgs runs the test-env script for the dashboard only, with no token in it', () => {
  const root = path.join('C:', 'repo');
  for (const which of /** @type {const} */ (['stop', 'start'])) {
    const args = scriptArgs(root, which);
    assert.equal(args.at(-2), '-Only');
    assert.equal(args.at(-1), 'dashboard');
    assert.equal(args[args.indexOf('-Server') + 1], 'A');
    assert.equal(scriptArgs(root, which, 'B')[args.indexOf('-Server') + 1], 'B');
    assert.ok(args.includes(path.join(root, 'scripts', 'test-env', `${which}.ps1`)));
    assert.ok(args.includes('-File'));
  }
});

/** A runner and probe that record what they were asked, with a dashboard that is up until stopped. */
function stubs({ stopCode = 0, startCode = 0, stopsAnswering = true, comesUp = true } = {}) {
  const calls = [];
  let answering = true;
  return {
    calls,
    run: async (args, env, cwd) => {
      const which = args.find(a => /(stop|start)\.ps1$/.test(a)).match(/(stop|start)\.ps1$/)[1];
      calls.push({ which, env, cwd, args });
      if (which === 'stop') {
        if (stopsAnswering) answering = false;
        return { code: stopCode, stdout: '', stderr: stopCode ? 'boom' : '' };
      }
      if (comesUp) answering = true;
      return { code: startCode, stdout: '', stderr: startCode ? 'no start' : '' };
    },
    probe: async () => answering,
    exists: () => true,
  };
}

test('restartDashboard stops, then starts; the split tokens go to start.ps1 only, never to stop.ps1', async () => {
  const s = stubs();
  await restartDashboard(TOKENS, {
    repoRoot: 'C:\\repo',
    env: { PATH: 'p' },
    run: s.run,
    probe: s.probe,
    exists: s.exists,
    timeoutMs: 200,
    pollMs: 5,
  });
  assert.deepEqual(
    s.calls.map(c => c.which),
    ['stop', 'start']
  );
  assert.equal('GM_DASHBOARD_TOKEN' in s.calls[0].env, false, 'stop.ps1 gets no GM token');
  assert.equal('PLAYER_DASHBOARD_TOKEN' in s.calls[0].env, false, 'stop.ps1 gets no player token');
  assert.equal(s.calls[0].env.PATH, 'p');
  assert.equal(s.calls[1].env.GM_DASHBOARD_TOKEN, 'gm-test-token');
  assert.equal(s.calls[1].env.PLAYER_DASHBOARD_TOKEN, 'player-test-token');
  assert.equal(s.calls[1].cwd, 'C:\\repo');
  for (const call of s.calls) {
    assert.ok(!call.args.some(a => a.includes('test-token')), 'no token is ever an argument');
  }
});

test('restartDashboard in the normal mode takes the tokens out of the environment', async () => {
  const s = stubs();
  await restartDashboard(null, {
    repoRoot: 'C:\\repo',
    env: { GM_DASHBOARD_TOKEN: 'left-over', PLAYER_DASHBOARD_TOKEN: 'left-over-2', PATH: 'p' },
    run: s.run,
    probe: s.probe,
    exists: s.exists,
    timeoutMs: 200,
    pollMs: 5,
  });
  for (const call of s.calls) {
    assert.equal('GM_DASHBOARD_TOKEN' in call.env, false);
    assert.equal('PLAYER_DASHBOARD_TOKEN' in call.env, false);
    assert.equal(call.env.PATH, 'p');
  }
});

test('restartDashboard refuses another port before it runs anything', async () => {
  const s = stubs();
  await assert.rejects(
    restartDashboard(TOKENS, { repoRoot: 'C:\\repo', port: 31414, run: s.run, probe: s.probe }),
    /live bridge/
  );
  await assert.rejects(
    restartDashboard(null, { repoRoot: 'C:\\repo', port: 3000, run: s.run, probe: s.probe }),
    /not the test dashboard/
  );
  assert.equal(s.calls.length, 0);
});

test('restartDashboard refuses a checkout without a built dashboard before it stops anything', async () => {
  const s = stubs();
  const asked = [];
  await assert.rejects(
    restartDashboard(TOKENS, {
      repoRoot: 'C:\\repo',
      run: s.run,
      probe: s.probe,
      exists: file => {
        asked.push(file);
        return false;
      },
    }),
    e =>
      e instanceof EnvError &&
      /not built in C:\\repo/.test(e.message) &&
      /left alone/.test(e.message)
  );
  assert.equal(s.calls.length, 0, 'stop.ps1 never ran');
  assert.deepEqual(asked, [path.join('C:\\repo', ...DASHBOARD_SERVER)]);
});

test('a refusal from stop.ps1 (another process owns the port or the pid) reaches the error message', async () => {
  const s = stubs();
  const run = async (args, env, cwd) => {
    const r = await s.run(args, env, cwd);
    return s.calls.at(-1).which === 'stop'
      ? {
          code: 1,
          stdout: '',
          stderr:
            'REFUSED: dashboard : the recorded pid 4242 (node) does not own port 3100 (pid 777 does); nothing stopped.',
        }
      : r;
  };
  await assert.rejects(
    restartDashboard(TOKENS, {
      repoRoot: 'C:\\repo',
      run,
      probe: s.probe,
      exists: s.exists,
      pollMs: 5,
    }),
    e =>
      e instanceof EnvError &&
      /could not stop/.test(e.message) &&
      /REFUSED: dashboard/.test(e.message)
  );
  assert.equal(s.calls.length, 1, 'start.ps1 never ran after the refusal');
});

test('restartDashboard fails with an EnvError that says what went wrong', async () => {
  const opts = { repoRoot: 'C:\\repo', timeoutMs: 60, downTimeoutMs: 60, pollMs: 5 };
  await assert.rejects(
    restartDashboard(TOKENS, { ...opts, ...stubs({ stopCode: 1 }) }),
    e => e instanceof EnvError && /could not stop/.test(e.message) && /boom/.test(e.message)
  );
  // A dashboard that keeps answering was not started by start.ps1 (its pid is unknown).
  const stuck = stubs({ stopsAnswering: false });
  await assert.rejects(
    restartDashboard(TOKENS, { ...opts, run: stuck.run, probe: stuck.probe, exists: stuck.exists }),
    e => e instanceof EnvError && /not started by scripts\/test-env\/start\.ps1/.test(e.message)
  );
  assert.equal(stuck.calls.length, 1, 'start is never run when the stop did not take');
  await assert.rejects(
    restartDashboard(TOKENS, { ...opts, ...stubs({ startCode: 2 }) }),
    e => e instanceof EnvError && /could not start/.test(e.message)
  );
  await assert.rejects(
    restartDashboard(null, { ...opts, ...stubs({ comesUp: false }) }),
    e => e instanceof EnvError && /did not answer on port 3100/.test(e.message)
  );
});

test('restartDashboard error messages never contain a token', async () => {
  const s = stubs({ startCode: 3 });
  try {
    await restartDashboard(TOKENS, {
      repoRoot: 'C:\\repo',
      run: s.run,
      probe: s.probe,
      exists: s.exists,
      timeoutMs: 60,
      pollMs: 5,
    });
    assert.fail('should have thrown');
  } catch (e) {
    assert.ok(e instanceof EnvError);
    assert.ok(!e.message.includes('test-token'));
  }
});
