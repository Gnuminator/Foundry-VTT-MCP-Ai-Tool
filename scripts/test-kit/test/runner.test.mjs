import { test } from 'node:test';
import assert from 'node:assert/strict';
import { runScenarios, runScenariosDetailed } from '../lib/runner.mjs';
import { EnvError } from '../lib/errors.mjs';

function scenario(over = {}) {
  return {
    id: 'demo',
    title: 'Demo',
    sizes: ['smoke'],
    tags: ['bridge'],
    needs: [],
    tools: [],
    run: async () => {},
    ...over,
  };
}

function stubDashboard(over = {}) {
  return {
    tool: async (name, args, flags) => ({ name, args, flags }),
    planApply: async () => ({ planId: 'p', changeId: 'c', plan: {} }),
    undo: async () => ({ mode: 'undo' }),
    http: async path => ({ status: 200, data: path === '/player' ? '<p>x</p>' : { path } }),
    ...over,
  };
}

async function run1(sc, opts = {}) {
  const lines = [];
  const [r] = await runScenarios([{ scenario: sc, file: 'demo.scenario.mjs' }], {
    dashboard: stubDashboard(),
    manifest: { world: 'w' },
    log: l => lines.push(l),
    ...opts,
  });
  return { r, lines };
}

test('passing steps are recorded and printed', async () => {
  const { r, lines } = await run1(
    scenario({
      async run(t) {
        const v = await t.step('first', async () => 41 + 1);
        t.check(v === 42, 'v is 42');
        await t.step('second', async () => 'a detail');
        t.log('hello');
        t.attach('data', { a: 1 });
        t.equal({ a: [1, 2] }, { a: [1, 2] }, 'deep');
      },
    })
  );
  assert.equal(r.status, 'pass');
  assert.deepEqual(
    r.steps.map(s => [s.label, s.status]),
    [
      ['first', 'pass'],
      ['second', 'pass'],
    ]
  );
  assert.equal(r.steps[1].detail, 'a detail');
  assert.deepEqual(r.logs, ['hello']);
  assert.deepEqual(r.attachments, [{ name: 'data', data: { a: 1 } }]);
  assert.equal(r.id, 'demo');
  assert.equal(r.file, 'demo.scenario.mjs');
  assert.ok(lines.some(l => l.startsWith('PASS [01] demo: first')));
});

test('a failing step stops the scenario', async () => {
  let reached = false;
  const { r, lines } = await run1(
    scenario({
      async run(t) {
        await t.step('bad', async () => {
          t.equal(1, 2, 'numbers differ');
        });
        reached = true;
      },
    })
  );
  assert.equal(r.status, 'fail');
  assert.equal(reached, false);
  assert.equal(r.steps.length, 1);
  assert.equal(r.steps[0].status, 'fail');
  assert.match(r.steps[0].error.message, /numbers differ/);
  assert.deepEqual(r.steps[0].error.reply, { actual: 1, expected: 2 });
  assert.ok(lines.some(l => l.startsWith('FAIL [01] demo: bad')));
});

test('continueOnFail keeps going and the scenario still fails', async () => {
  const { r } = await run1(
    scenario({
      async run(t) {
        const v = await t.step(
          'soft',
          async () => {
            throw new Error('soft fail');
          },
          { continueOnFail: true }
        );
        assert.equal(v, undefined);
        await t.step('after', async () => 'ok');
      },
    })
  );
  assert.equal(r.status, 'fail');
  assert.deepEqual(
    r.steps.map(s => s.status),
    ['fail', 'pass']
  );
});

test('skip ends the scenario as skipped', async () => {
  const { r, lines } = await run1(
    scenario({
      async run(t) {
        await t.step('needs thing', async () => t.skip('no thing here'));
        throw new Error('not reached');
      },
    })
  );
  assert.equal(r.status, 'skip');
  assert.equal(r.steps[0].status, 'skip');
  assert.equal(r.steps[0].detail, 'no thing here');
  assert.ok(lines.some(l => l.startsWith('SKIP')));
});

test('skip outside a step is a skipped scenario too', async () => {
  const { r } = await run1(
    scenario({
      async run(t) {
        t.skip('later');
      },
    })
  );
  assert.equal(r.status, 'skip');
  assert.equal(r.steps.length, 1);
});

test('a throw outside a step is status error', async () => {
  const { r } = await run1(
    scenario({
      async run() {
        throw new Error('kaboom');
      },
    })
  );
  assert.equal(r.status, 'error');
  assert.match(r.steps.at(-1).error.message, /kaboom/);
});

test('timeout makes the scenario an error and late steps are dropped', async () => {
  let cleaned = false;
  const { r } = await run1(
    scenario({
      timeoutMs: 50,
      async run(t) {
        t.cleanup(async () => {
          cleaned = true;
        });
        await t.step('slow', () => new Promise(res => setTimeout(res, 300)));
      },
    })
  );
  assert.equal(r.status, 'error');
  assert.ok(r.steps.some(s => s.error && /timed out/.test(s.error.message)));
  assert.ok(!r.steps.some(s => s.label === 'slow'));
  assert.equal(cleaned, true);
  await new Promise(res => setTimeout(res, 400));
  assert.ok(!r.steps.some(s => s.label === 'slow'));
});

test('cleanups run last in first out, also after a failure; a failing cleanup adds a failed step', async () => {
  const order = [];
  const { r } = await run1(
    scenario({
      async run(t) {
        t.cleanup(async () => {
          order.push('first registered');
        });
        t.cleanup(async () => {
          throw new Error('cleanup broke');
        });
        t.cleanup(async () => {
          order.push('last registered');
        });
        await t.step('boom', async () => {
          throw new Error('x');
        });
      },
    })
  );
  assert.deepEqual(order, ['last registered', 'first registered']);
  assert.equal(r.status, 'fail');
  const c = r.steps.find(s => s.label.startsWith('cleanup: cleanup broke'));
  assert.ok(c && c.status === 'fail');
});

test('gm actions must be declared and need a session', async () => {
  const calls = [];
  const gm = {
    call: async (action, args) => {
      calls.push([action, args]);
      return action === 'consoleErrors' ? { errors: [] } : { ok: true };
    },
  };
  const { r } = await run1(
    scenario({
      gmActions: ['readActor'],
      async run(t) {
        await t.step('declared', async () => t.gm('readActor', { actorId: 'a' }));
        await t.step('undeclared', async () => t.gm('wipeKit'));
      },
    }),
    { gm }
  );
  assert.deepEqual(
    r.steps.map(s => s.status),
    ['pass', 'fail']
  );
  assert.match(r.steps[1].error.message, /did not declare gm action "wipeKit"/);
  assert.deepEqual(calls[0], ['readActor', { actorId: 'a' }]);
  assert.equal(calls.filter(c => c[0] === 'wipeKit').length, 0);

  const noGm = await run1(
    scenario({
      gmActions: ['readActor'],
      async run(t) {
        await t.step('x', async () => t.gm('readActor'));
      },
    })
  );
  assert.match(noGm.r.steps[0].error.message, /no GM session/);
});

test('module console errors fail the scenario; other errors are only collected', async () => {
  const gm = {
    call: async (action, args) => {
      assert.equal(action, 'consoleErrors');
      assert.equal(typeof args.since, 'number');
      return {
        errors: [
          { at: 't1', message: 'foundry-mcp-bridge | query failed', source: 'module' },
          { at: 't2', message: 'texture missing', source: 'core' },
        ],
      };
    },
  };
  const { results, consoleErrors } = await runScenariosDetailed(
    [{ scenario: scenario(), file: 'f' }],
    { dashboard: stubDashboard(), gm, manifest: null }
  );
  const r = results[0];
  assert.equal(r.status, 'fail');
  const s = r.steps.at(-1);
  assert.equal(s.label, 'module console errors');
  assert.match(s.error.message, /query failed/);
  assert.equal(s.error.reply.length, 1);
  assert.equal(consoleErrors.length, 2);

  const clean = await runScenarios([{ scenario: scenario(), file: 'f' }], {
    dashboard: stubDashboard(),
    gm: {
      call: async () => ({ errors: [{ at: 't', message: 'texture missing', source: 'core' }] }),
    },
    manifest: null,
  });
  assert.equal(clean[0].status, 'pass');
});

test('tool, guarded, player, http and kit reach the right places', async () => {
  const seen = [];
  const dashboard = stubDashboard({
    tool: async (n, a, f) => {
      seen.push(['tool', n, a, f]);
      return 'r';
    },
    planApply: async (p, a) => {
      seen.push(['planApply', p, a]);
      return { planId: 'p', changeId: 'c', plan: {} };
    },
    undo: async id => {
      seen.push(['undo', id]);
      return {};
    },
  });
  const { r } = await run1(
    scenario({
      async run(t) {
        await t.step('all', async () => {
          assert.equal(await t.tool('get-world-info', { a: 1 }, { confirm: true }), 'r');
          const g = await t.guarded.planApply('plan-x', { y: 2 });
          await t.guarded.undo(g.changeId);
          assert.deepEqual(await t.player.state(), { path: '/api/player/state' });
          assert.equal(await t.player.html(), '<p>x</p>');
          assert.equal((await t.http('/z')).status, 200);
          assert.equal(t.kit.world, 'w');
          assert.equal(t.fake, false);
        });
      },
    }),
    { dashboard }
  );
  assert.equal(r.status, 'pass', JSON.stringify(r.steps));
  assert.deepEqual(seen[0], ['tool', 'get-world-info', { a: 1 }, { confirm: true }]);
  assert.deepEqual(seen[1], ['planApply', 'plan-x', { y: 2 }]);
  assert.deepEqual(seen[2], ['undo', 'c']);
});

test('an EnvError inside a step ends the run and carries the results so far', async () => {
  const list = [
    { scenario: scenario({ id: 'one-ok' }), file: 'a' },
    {
      scenario: scenario({
        id: 'two-env',
        async run(t) {
          await t.step('dies', async () => {
            throw new EnvError('nothing is listening');
          });
        },
      }),
      file: 'b',
    },
    { scenario: scenario({ id: 'three-never' }), file: 'c' },
  ];
  await assert.rejects(runScenarios(list, { dashboard: stubDashboard(), manifest: null }), e => {
    assert.ok(e instanceof EnvError);
    assert.deepEqual(
      e.partialResults.map(r => r.id),
      ['one-ok', 'two-env']
    );
    return true;
  });
});
