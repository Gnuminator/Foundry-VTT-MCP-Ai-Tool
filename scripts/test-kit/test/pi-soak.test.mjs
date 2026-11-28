import assert from 'node:assert/strict';
import { test } from 'node:test';
import { EnvError, KitToolError } from '../lib/errors.mjs';
import { createPiSoakGuard } from '../lib/pi-soak-guard.mjs';
import {
  buildRecord,
  evaluate,
  isThrottled,
  parseExtras,
  percentile,
  remoteExtras,
} from '../lib/pi-soak-lib.mjs';
import { parseArgs, playerNames } from '../pi-soak.mjs';

/** A fake dashboard: records every call; `world` is what get-world-info answers. */
function fake({ world = 'strahd-kit', risk = 'safe', undoFails = false, applyFails = false } = {}) {
  const calls = [];
  const state = { world };
  const dashboard = {
    base: 'http://pi',
    health: async () => ({ ok: true, controlChannel: 'connected' }),
    tools: async () => ({ tools: [] }),
    getGmActions: async () => false,
    http: async () => ({ status: 200, data: {} }),
    async tool(name, args = {}, flags = {}) {
      calls.push({ name, args, flags });
      if (name === 'get-world-info') return { id: state.world };
      if (name === 'plan-actor-change') return { planId: 'p1', risk };
      if (name === 'apply-planned-change') {
        if (applyFails) throw applyFails instanceof Error ? applyFails : new Error('POST /api/tool timed out');
        return { changeId: 'c1' };
      }
      if (name === 'undo-change') {
        if (undoFails) throw new Error('undo broke');
        return { undoOf: 'c1' };
      }
      return {};
    },
  };
  return { dashboard, calls, state };
}

const names = calls => calls.map(c => c.name);

test('soak guard: writes are off unless the runner turned them on', async () => {
  const { dashboard, calls } = fake();
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit' });
  await assert.rejects(
    g.damageRoundTrip({ target: 'Goblin', action: 'damage', amount: 1 }),
    /writes are off/
  );
  await assert.rejects(g.roll({ actor: 'Goblin', ability: 'str' }), /writes are off/);
  assert.deepEqual(calls, []);
});

test('soak guard: plan, apply and undo, in that order, apply with confirm only, world checked before each', async () => {
  const { dashboard, calls } = fake();
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true });
  const r = await g.damageRoundTrip({ target: 'Goblin', action: 'damage', amount: 2 });
  assert.equal(r.changeId, 'c1');
  assert.deepEqual(names(calls), [
    'get-world-info',
    'plan-actor-change',
    'get-world-info',
    'apply-planned-change',
    'get-world-info',
    'undo-change',
  ]);
  const apply = calls.find(c => c.name === 'apply-planned-change');
  assert.deepEqual(apply.args, { planId: 'p1' });
  assert.deepEqual(apply.flags, { confirm: true });
  assert.equal(g.writes, 1);
});

test('soak guard: a destructive plan, a wrong action, amount, ability or empty target is refused before any write', async () => {
  const bad = fake({ risk: 'destructive' });
  const g = createPiSoakGuard(bad.dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(
    g.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }),
    /destructive/
  );
  assert.ok(!names(bad.calls).includes('apply-planned-change'));
  const { dashboard, calls } = fake();
  const h = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(
    h.damageRoundTrip({ target: 'G', action: 'delete', amount: 1 }),
    /not damage or healing/
  );
  await assert.rejects(
    h.damageRoundTrip({ target: 'G', action: 'damage', amount: 6 }),
    /from 1 to 5/
  );
  await assert.rejects(
    h.damageRoundTrip({ target: ' ', action: 'damage', amount: 1 }),
    /no target/
  );
  await assert.rejects(h.roll({ actor: 'G', ability: 'luck' }), /not str, dex/);
  assert.deepEqual(calls, []);
});

test('soak guard: another world stops every write, plan, apply, undo and roll alike', async () => {
  const { dashboard, calls } = fake({ world: 'curse-of-strahd' });
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(
    g.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }),
    /not strahd-kit/
  );
  await assert.rejects(g.roll({ actor: 'G', ability: 'str' }), /not strahd-kit/);
  assert.deepEqual(names(calls), ['get-world-info', 'get-world-info']);
});

test('soak guard: the world changing after the plan stops the apply', async () => {
  const f = fake();
  const orig = f.dashboard.tool;
  f.dashboard.tool = async (name, ...rest) => {
    const out = await orig(name, ...rest);
    if (name === 'plan-actor-change') f.state.world = 'curse-of-strahd';
    return out;
  };
  const g = createPiSoakGuard(f.dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(
    g.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }),
    /not strahd-kit/
  );
  assert.ok(!names(f.calls).includes('apply-planned-change'));
});

test('soak guard: an undo that fails is recorded as stranded and ends the run', async () => {
  const { dashboard } = fake({ undoFails: true });
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(
    g.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }),
    /undo failed/
  );
  assert.deepEqual(g.stranded, ['c1']);
});

test('soak guard: an apply that fails in transit is reported as possibly applied and ends the run', async () => {
  const { dashboard } = fake({ applyFails: true });
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(
    g.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }),
    /failed in transit/
  );
  assert.equal(g.stranded.length, 1);
  assert.match(g.stranded[0], /possibly applied, plan p1/);
});

test('soak guard: a 4xx refusal on apply is a refusal, not possibly applied', async () => {
  const { dashboard } = fake({
    applyFails: new KitToolError({ kind: 'bad-request', status: 400, error: 'no such plan', name: 'apply-planned-change' }),
  });
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(
    g.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }),
    /was refused .*nothing was applied/
  );
  assert.deepEqual(g.stranded, []);
  for (const err of [
    new KitToolError({ kind: 'tool', status: 422, error: 'was applied but could not be recorded', name: 'apply-planned-change' }),
    new EnvError('nothing is listening on http://pi:3000'),
  ]) {
    const f = fake({ applyFails: err });
    const gx = createPiSoakGuard(f.dashboard, { world: 'strahd-kit', allowWrites: true });
    await assert.rejects(gx.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }), /failed in transit/);
    assert.equal(gx.stranded.length, 1);
  }
  const five = fake({
    applyFails: new KitToolError({ kind: 'x', status: 502, error: 'bad gateway', name: 'apply-planned-change' }),
  });
  const g5 = createPiSoakGuard(five.dashboard, { world: 'strahd-kit', allowWrites: true });
  await assert.rejects(g5.damageRoundTrip({ target: 'G', action: 'damage', amount: 1 }), /failed in transit/);
  assert.equal(g5.stranded.length, 1);
});

test('evaluate: writes asked for but none measured fail the write bar', () => {
  const v = evaluate({
    records: [rec({})],
    linkDrops: 0,
    writeToDashboardMs: [],
    writesRequested: true,
  });
  assert.equal(v.pass, false);
});

test('soak guard: the write limit ends the writes', async () => {
  const { dashboard } = fake();
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true, maxWrites: 1 });
  await g.roll({ actor: 'G', ability: 'dex' });
  await assert.rejects(g.roll({ actor: 'G', ability: 'dex' }), /limit of 1 writes/);
});

test('soak guard: the tools-only side still refuses other tools, confirmations and the GM switch', async () => {
  const { dashboard } = fake();
  const g = createPiSoakGuard(dashboard, { world: 'strahd-kit', allowWrites: true });
  const reads = g.forSoak(['get-party', 'apply-planned-change']);
  await assert.rejects(reads.tool('list-journals', {}), /declared/);
  await assert.rejects(reads.tool('apply-planned-change', {}), /not a read or plan tool/);
  assert.throws(() => reads.planApply('plan-actor-change', {}), /not available on the Pi/);
  assert.throws(() => reads.setGmActions(true), /not available on the Pi/);
});

const SAMPLE = (cpuLine, extra = '') =>
  [
    'DT 10',
    'A',
    '1 0 0 1000 system.slice/foundry.service',
    'B',
    '1 800 0 1000 system.slice/foundry.service',
    'LOAD 1.00 1.00 1.00',
    'MEM 16000000 8000000',
    'TEMP 55000',
    'NCPU 8',
    `CPUSTAT ${cpuLine}`,
    'FREQ 1800000 1800000 | 1800000 1800000',
    'UNIT foundry.service ActiveState=active MainPID=10 NRestarts=0',
    'UNIT foundry-ai-tool-bridge.service ActiveState=active MainPID=20 NRestarts=0',
    extra,
  ].join('\n');

test('parseExtras: counters, clocks and unit states', () => {
  const x = parseExtras(SAMPLE('cpu 100 0 50 800 20 0 0 0'));
  assert.deepEqual(x.cpu.slice(0, 5), [100, 0, 50, 800, 20]);
  assert.deepEqual(x.freqCur, [1800000, 1800000]);
  assert.deepEqual(x.units['foundry.service'], { active: 'active', pid: 10, restarts: 0 });
  assert.match(remoteExtras(), /systemctl show/);
  assert.doesNotMatch(remoteExtras().replaceAll('2>/dev/null', ''), />|\btee\b|\brm\b|\bmv\b/);
});

test('buildRecord: Foundry CPU, iowait and busy percent from two samples, and a restart is an event', () => {
  const first = buildRecord(SAMPLE('cpu 100 0 50 800 20 0 0 0'), null);
  assert.equal(Math.round(first.foundryCpu), 80);
  assert.equal(first.iowaitPct, null);
  const second = buildRecord(
    SAMPLE('cpu 200 0 100 1600 80 0 0 0').replace(
      'MainPID=20 NRestarts=0',
      'MainPID=21 NRestarts=1'
    ),
    first.counters
  );
  // 1000 ticks passed, 60 of them iowait: 6 percent; idle grew by 800: 20 percent busy
  assert.equal(Math.round(second.iowaitPct * 10) / 10, 5.9);
  assert.ok(
    second.unitEvents.some(e => /bridge.*restarted/.test(e)),
    second.unitEvents.join()
  );
});

test('buildRecord: a unit that left active is an event, one that was never active is not', () => {
  const a = buildRecord(
    SAMPLE(
      'cpu 1 0 0 1 0 0 0 0',
      'UNIT foundry-ai-tool-gm-browser.service ActiveState=failed MainPID=0 NRestarts=0'
    ),
    null
  );
  const b = buildRecord(
    SAMPLE(
      'cpu 2 0 0 2 0 0 0 0',
      'UNIT foundry-ai-tool-gm-browser.service ActiveState=failed MainPID=0 NRestarts=0'
    ).replace('foundry.service ActiveState=active', 'foundry.service ActiveState=activating'),
    a.counters
  );
  assert.deepEqual(b.unitEvents, ['foundry.service left active (activating)']);
});

test('isThrottled: hot, or busy and slow; idle clocks are fine', () => {
  assert.equal(isThrottled({ tempC: 82, busyPct: 10, freqRatio: 1 }), true);
  assert.equal(isThrottled({ tempC: 50, busyPct: 90, freqRatio: 0.5 }), true);
  assert.equal(isThrottled({ tempC: 50, busyPct: 5, freqRatio: 0.3 }), false);
  assert.equal(isThrottled({ tempC: null, busyPct: null, freqRatio: null }), false);
});

test('percentile: nearest rank', () => {
  assert.equal(percentile([5, 1, 3, 2, 4], 50), 3);
  assert.equal(percentile([], 50), null);
  assert.equal(percentile([1, 2, 3, 4, 5, 6, 7, 8, 9, 10], 95), 10);
});

const rec = over => ({
  seconds: 10,
  foundryCpu: 20,
  iowaitPct: 1,
  busyPct: 20,
  freqRatio: 1,
  tempC: 55,
  unitEvents: [],
  ...over,
});

test('evaluate: all in the bar passes; each breach fails by itself', () => {
  const ok = { records: [rec({}), rec({})], linkDrops: 0, writeToDashboardMs: [300, 900] };
  assert.equal(evaluate(ok).pass, true);
  assert.equal(evaluate({ ...ok, records: [rec({ foundryCpu: 90 })] }).pass, false);
  assert.equal(evaluate({ ...ok, records: [rec({ unitEvents: ['x restarted'] })] }).pass, false);
  assert.equal(evaluate({ ...ok, linkDrops: 1 }).pass, false);
  assert.equal(
    evaluate({ ...ok, records: [rec({ iowaitPct: 9 }), rec({ iowaitPct: 9 })] }).pass,
    false
  );
  assert.equal(evaluate({ ...ok, records: [rec({ tempC: 85 })] }).pass, false);
  assert.equal(evaluate({ ...ok, writeToDashboardMs: [2500] }).pass, false);
});

test('evaluate: nothing measured is not a pass, and unmeasured writes do not fail it', () => {
  assert.equal(evaluate({ records: [], linkDrops: 0, writeToDashboardMs: [] }).pass, false);
  const v = evaluate({ records: [rec({})], linkDrops: 0, writeToDashboardMs: [] });
  assert.equal(v.pass, true);
  assert.equal(v.checks.at(-1).pass, null);
});

test('parseArgs and playerNames', () => {
  assert.throws(() => parseArgs([]), /--label is required/);
  const a = parseArgs(['--label', 'x', '--not-game-night', '--writes', '--players', '3']);
  assert.equal(a.players, 3);
  assert.equal(a.writes, true);
  assert.equal(a.durationMin, 180);
  assert.throws(() => parseArgs(['--label', 'x', '--players', '6']), /--players/);
  assert.deepEqual(playerNames(3), ['Kit Player', 'Kit Player 2', 'Kit Player 3']);
});

const ID = 'a'.repeat(64);
const CONTAINER_SAMPLE = (restarts = 0, pid = 500, cgId = ID) =>
  [
    'DT 10',
    'A',
    `1 0 0 1000 system.slice/docker-${cgId}.scope`,
    `2 0 0 1000 system.slice/docker-${cgId}.scope`,
    'B',
    `1 500 0 1000 system.slice/docker-${cgId}.scope`,
    `2 300 0 1000 system.slice/docker-${cgId}.scope`,
    'LOAD 1.00 1.00 1.00',
    'MEM 16000000 8000000',
    'TEMP 55000',
    'NCPU 8',
    'CPUSTAT cpu 100 0 50 800 20 0 0 0',
    'FREQ 1800000 | 1800000',
    'UNIT foundry.service ActiveState=inactive MainPID=0 NRestarts=0',
    `CONTAINER foundry ${ID} running ${restarts} ${pid}`,
  ].join('\n');

test('buildRecord: Foundry CPU comes from the foundry container on the compose stack', () => {
  const r = buildRecord(CONTAINER_SAMPLE(), null);
  assert.equal(Math.round(r.foundryCpu ?? -1), 80);
  assert.equal(Math.round(r.unitCpu['container:foundry']), 80);
  assert.match(remoteExtras(), /docker ps -a/);
});

test('buildRecord: a container restart is a unit event; with no container the systemd unit is the fallback', () => {
  const first = buildRecord(CONTAINER_SAMPLE(0), null);
  const second = buildRecord(CONTAINER_SAMPLE(1), first.counters);
  assert.ok(second.unitEvents.some(e => /container:foundry restarted/.test(e)));
  const systemd = buildRecord(SAMPLE('cpu 100 0 50 800 20 0 0 0'), null);
  assert.equal(Math.round(systemd.foundryCpu ?? -1), 80);
});

test('buildRecord: a container with no matching cgroup is not measured, a new pid or a vanished container is an event', () => {
  const none = buildRecord(CONTAINER_SAMPLE(0, 500, 'b'.repeat(64)), null);
  assert.equal(none.foundryCpu, null);
  const first = buildRecord(CONTAINER_SAMPLE(0, 500), null);
  const repid = buildRecord(CONTAINER_SAMPLE(0, 501), first.counters);
  assert.ok(repid.unitEvents.some(e => /container:foundry main process changed/.test(e)));
  const gone = buildRecord(SAMPLE('cpu 100 0 50 800 20 0 0 0'), first.counters);
  assert.ok(gone.unitEvents.some(e => /container:foundry is gone/.test(e)));
});
