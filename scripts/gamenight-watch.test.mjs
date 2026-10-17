/** scripts/gamenight-watch.mjs: the alert state machine, the probe and the message text. No network. */
import { test } from 'node:test';
import assert from 'node:assert/strict';
import {
  DEFAULTS,
  initialState,
  step,
  formatAlert,
  probeFoundry,
  parseEnv,
  postToChannel,
  flushPending,
  parseArgs,
  safeUrl,
} from './gamenight-watch.mjs';

const GOOD = { ok: true, ms: 100 };
const SLOW = { ok: true, ms: 5000 };
const FAIL = { ok: false, ms: 10000, error: 'timed out' };

/** Feed probes, return the alerts in order. */
function run(probes, cfg = DEFAULTS) {
  let state = initialState();
  const alerts = [];
  for (const p of probes) {
    const r = step(state, p, cfg);
    state = r.state;
    if (r.alert) alerts.push(r.alert);
  }
  return { state, alerts };
}

test('healthy answers never alert', () => {
  assert.deepEqual(run([GOOD, GOOD, GOOD, GOOD]).alerts, []);
});

test('one miss is not enough, two in a row post "down" once', () => {
  assert.deepEqual(run([FAIL, GOOD, FAIL, GOOD]).alerts, []);
  const { alerts, state } = run([FAIL, FAIL, FAIL, FAIL, FAIL]);
  assert.deepEqual(alerts, ['down']);
  assert.equal(state.mode, 'down');
});

test('back up posts "recovered" once, after two good answers', () => {
  assert.deepEqual(run([FAIL, FAIL, GOOD]).alerts, ['down']);
  assert.deepEqual(run([FAIL, FAIL, GOOD, GOOD, GOOD]).alerts, ['down', 'recovered']);
  // a miss in between resets the recovery count
  assert.deepEqual(run([FAIL, FAIL, GOOD, FAIL, GOOD, GOOD]).alerts, ['down', 'recovered']);
});

test('three slow answers in a row post "slow" once; one or two do not', () => {
  assert.deepEqual(run([SLOW, SLOW, GOOD, SLOW, SLOW]).alerts, []);
  const { alerts, state } = run([SLOW, SLOW, SLOW, SLOW, SLOW]);
  assert.deepEqual(alerts, ['slow']);
  assert.equal(state.mode, 'slow');
});

test('slow then fast again posts "recovered"', () => {
  assert.deepEqual(run([SLOW, SLOW, SLOW, GOOD, GOOD]).alerts, ['slow', 'recovered']);
});

test('slow turning into down posts "down" and still recovers', () => {
  assert.deepEqual(run([SLOW, SLOW, SLOW, FAIL, FAIL, GOOD, GOOD]).alerts, [
    'slow',
    'down',
    'recovered',
  ]);
});

test('slow answers while down do not post "slow" or recover', () => {
  assert.deepEqual(run([FAIL, FAIL, SLOW, SLOW, SLOW, SLOW]).alerts, ['down']);
});

test('thresholds come from the config', () => {
  const cfg = { ...DEFAULTS, failCount: 1, slowMs: 50, slowCount: 1, recoverCount: 1 };
  assert.deepEqual(
    run(
      [
        { ok: true, ms: 60 },
        { ok: true, ms: 10 },
      ],
      cfg
    ).alerts,
    ['slow', 'recovered']
  );
  assert.deepEqual(run([FAIL, { ok: true, ms: 10 }], cfg).alerts, ['down', 'recovered']);
});

test('formatAlert names the address and pings the given users', () => {
  assert.match(
    formatAlert('down', 'http://pi:30000', FAIL),
    /does not answer at http:\/\/pi:30000 \(timed out\)/
  );
  assert.match(formatAlert('slow', 'u', SLOW), /5000 ms, the limit is 3000 ms/);
  assert.match(formatAlert('recovered', 'u', GOOD), /answers again/);
  assert.ok(formatAlert('down', 'u', FAIL, DEFAULTS, ['1', '2']).startsWith('<@1> <@2> '));
});

test('probeFoundry: ok, HTTP error, refused, timeout', async () => {
  const ok = await probeFoundry('http://x:1', 1000, async url => {
    assert.equal(String(url), 'http://x:1/api/status');
    return { ok: true, status: 200 };
  });
  assert.equal(ok.ok, true);
  const bad = await probeFoundry('http://x:1', 1000, async () => ({ ok: false, status: 502 }));
  assert.deepEqual([bad.ok, bad.error], [false, 'HTTP 502']);
  const refused = await probeFoundry('http://x:1', 1000, async () => {
    throw new TypeError('fetch failed');
  });
  assert.deepEqual([refused.ok, refused.error], [false, 'connection failed']);
  const timeout = await probeFoundry('http://x:1', 1000, async () => {
    throw Object.assign(new Error('t'), { name: 'TimeoutError' });
  });
  assert.equal(timeout.error, 'timed out');
});

test('flushPending keeps unsent alerts in order and retries them', async () => {
  const sent = [];
  let fail = true;
  const post = async t => {
    if (fail) throw new Error('Discord answered HTTP 500');
    sent.push(t);
  };
  const logs = [];
  let pending = await flushPending(['down'], post, m => logs.push(m));
  assert.deepEqual(pending, ['down']);
  assert.match(logs[0], /will retry/);
  fail = false;
  pending = await flushPending([...pending, 'recovered'], post);
  assert.deepEqual(pending, []);
  assert.deepEqual(sent, ['down', 'recovered']);
});

test('parseArgs: switches take no value, other flags need one', () => {
  assert.deepEqual(parseArgs(['--post', '--interval', '5', '--once']), {
    post: true,
    interval: '5',
    once: true,
  });
  assert.throws(() => parseArgs(['--interval']), /needs a value/);
  assert.throws(() => parseArgs(['--url', '--post']), /needs a value/);
});

test('safeUrl drops credentials and refuses other schemes', () => {
  assert.equal(safeUrl('http://u:p@pi:30000/'), 'http://pi:30000');
  assert.throws(() => safeUrl('ftp://pi'), /http/);
});

test('parseEnv reads KEY=value, strips quotes and skips comments', () => {
  assert.deepEqual(parseEnv('# c\nA=1\nB="two"\n\nC = x y\n'), { A: '1', B: 'two', C: 'x y' });
});

test('postToChannel sends the bot header and fails on a bad status without leaking the token', async () => {
  let seen;
  await postToChannel({ token: 'SECRET', channelId: '42' }, 'hi', async (url, init) => {
    seen = { url, init };
    return { ok: true };
  });
  assert.equal(seen.url, 'https://discord.com/api/v10/channels/42/messages');
  assert.equal(seen.init.headers.Authorization, 'Bot SECRET');
  await assert.rejects(
    postToChannel({ token: 'SECRET', channelId: '42' }, 'hi', async () => ({
      ok: false,
      status: 403,
    })),
    err => /HTTP 403/.test(err.message) && !err.message.includes('SECRET')
  );
});
