// The guard between a tools-only scenario and the Pi's dashboard (lib/pi-guard.mjs), with a stand-in
// dashboard that records every request it gets.
import { test } from 'node:test';
import assert from 'node:assert/strict';
import { createPiGuard } from '../lib/pi-guard.mjs';
import { EnvError } from '../lib/errors.mjs';
import { isToolsOnlyTool } from '../lib/dashboard.mjs';
import { validateScenario } from '../lib/contract.mjs';

/** A dashboard that records calls; `state.world` is what get-world-info answers. */
function stubDashboard(state = { world: 'strahd-kit' }) {
  /** @type {Array<[string, ...unknown[]]>} */
  const calls = [];
  return {
    state,
    calls,
    base: 'http://pi:3000',
    health: async () => ({ ok: true }),
    tools: async () => ({ tools: [] }),
    getGmActions: async () => false,
    setGmActions: async v => calls.push(['setGmActions', v]),
    planApply: async () => calls.push(['planApply']),
    undo: async () => calls.push(['undo']),
    http: async (path, opts) => {
      calls.push(['http', path, opts]);
      return { status: 200, data: {} };
    },
    tool: async (name, args, flags) => {
      calls.push(['tool', name, args, flags]);
      if (name === 'get-world-info') return { id: state.world };
      return { ok: name };
    },
  };
}

const requests = d => d.calls.map(c => c.slice(0, 2).join(' '));

test('which tools a tools-only scenario may use: reads and plans, not the play-log mark', () => {
  const allowed = [
    'get-world-info',
    'list-scenes',
    'measure-distance',
    'plan-scene-change',
    'search-compendium',
    'suggest-balanced-encounter',
    'open-in-foundry',
    'check-secret-terms',
  ];
  const refused = [
    'apply-planned-change',
    'undo-change',
    'clear-module-errors',
    'switch-scene',
    'send-chat-message',
    'use-item',
    'create-quest-journal',
    'mark-play-session',
  ];
  for (const name of allowed) assert.equal(isToolsOnlyTool(name), true, name);
  for (const name of refused) assert.equal(isToolsOnlyTool(name), false, name);
});

test('validateScenario: a tools-only scenario may list only read or plan tools', () => {
  const base = {
    id: 'demo-one',
    title: 'Demo',
    sizes: ['smoke'],
    tags: ['bridge', 'tools-only'],
    needs: [],
    tools: ['get-world-info', 'plan-party-change'],
    run: async () => {},
  };
  assert.deepEqual(validateScenario(base), []);
  const bad = validateScenario({
    ...base,
    tools: ['get-world-info', 'apply-planned-change', 'undo-change'],
  });
  assert.deepEqual(bad, [
    'a tools-only scenario may list only read or plan tools, not "apply-planned-change"',
    'a tools-only scenario may list only read or plan tools, not "undo-change"',
  ]);
  // a scenario without the tag is not held to it
  assert.deepEqual(
    validateScenario({ ...base, tags: ['bridge'], tools: ['apply-planned-change'] }),
    []
  );
});

test('a tool the scenario did not declare is refused before any request', async () => {
  const d = stubDashboard();
  const t = createPiGuard(d, { world: 'strahd-kit' }).forScenario({
    id: 's1',
    tools: ['get-targets'],
  });
  await assert.rejects(
    t.tool('apply-planned-change', { planId: 'p' }),
    e =>
      e instanceof EnvError &&
      /^REFUSED: pi run, scenario "s1": tool "apply-planned-change" is not in the scenario's declared tools/.test(
        e.message
      )
  );
  await assert.rejects(t.tool('get-world-info', {}), EnvError);
  assert.deepEqual(d.calls, [], 'the dashboard got no request at all');
});

test('a declared tool that is not a read or plan tool is refused before any request', async () => {
  const d = stubDashboard();
  const names = ['apply-planned-change', 'undo-change', 'mark-play-session', 'clear-module-errors'];
  const t = createPiGuard(d, { world: 'strahd-kit' }).forScenario({ id: 's2', tools: names });
  for (const name of names) {
    await assert.rejects(
      t.tool(name, {}),
      e => e instanceof EnvError && /is not a read or plan tool/.test(e.message),
      name
    );
  }
  assert.deepEqual(d.calls, []);
});

test('a confirmation is never sent: refused when asked for, and not added to a read call', async () => {
  const d = stubDashboard();
  const t = createPiGuard(d, { world: 'strahd-kit' }).forScenario({
    id: 's3',
    tools: ['plan-scene-change'],
  });
  await assert.rejects(
    t.tool('plan-scene-change', {}, { confirm: true }),
    e => e instanceof EnvError && /confirmation/.test(e.message)
  );
  await assert.rejects(t.tool('plan-scene-change', {}, { confirmDestructive: true }), EnvError);
  assert.deepEqual(d.calls, []);
  await t.tool('plan-scene-change', { action: 'template' });
  const call = d.calls.find(c => c[1] === 'plan-scene-change');
  assert.deepEqual(call, ['tool', 'plan-scene-change', { action: 'template' }, {}]);
});

test('raw http is GET only, and plan/apply, undo and the GM Actions switch are closed', async () => {
  const d = stubDashboard();
  const t = createPiGuard(d, { world: 'strahd-kit' }).forScenario({ id: 's4', tools: [] });
  assert.equal((await t.http('/api/health')).status, 200);
  assert.equal((await t.http('/player', { text: true })).status, 200);
  await assert.rejects(
    t.http('/api/tool', { method: 'POST', body: { name: 'undo-change' } }),
    EnvError
  );
  await assert.rejects(t.http('/api/control', { method: 'post', body: {} }), EnvError);
  assert.throws(() => t.planApply('plan-actor-change', {}), EnvError);
  assert.throws(() => t.undo('c1'), EnvError);
  assert.throws(() => t.setGmActions(true), EnvError);
  assert.deepEqual(requests(d), ['http /api/health', 'http /player']);
  assert.equal(await t.getGmActions(), false);
  assert.equal(t.base, 'http://pi:3000');
});

test('the world is checked before every call except get-world-info, and a change stops the run', async () => {
  const d = stubDashboard();
  const t = createPiGuard(d, { world: 'strahd-kit', ttlMs: 0 }).forScenario({
    id: 's5',
    tools: ['get-world-info', 'get-targets', 'list-scenes'],
  });
  await t.tool('get-targets', {});
  assert.deepEqual(requests(d), ['tool get-world-info', 'tool get-targets']);
  await t.tool('get-world-info', {}); // no check of its own
  assert.deepEqual(requests(d).slice(2), ['tool get-world-info']);
  d.state.world = 'curse-of-strahd';
  d.calls.length = 0;
  await assert.rejects(
    t.tool('list-scenes', {}),
    e =>
      e instanceof EnvError &&
      /^REFUSED: the Pi's bridge now reports the world "curse-of-strahd", not strahd-kit/.test(
        e.message
      )
  );
  assert.deepEqual(requests(d), ['tool get-world-info'], 'list-scenes was not sent');
  // an answer with no world is just as bad
  d.state.world = '';
  await assert.rejects(t.tool('get-targets', {}), /"\(none\)"/);
});

test('the world check is cached for the ttl and shared by the scenarios of a run', async () => {
  const d = stubDashboard();
  let clock = 1000;
  const guard = createPiGuard(d, { world: 'strahd-kit', ttlMs: 2000, now: () => clock });
  const a = guard.forScenario({ id: 'a', tools: ['get-targets'] });
  const b = guard.forScenario({ id: 'b', tools: ['get-targets'] });
  const checks = () => d.calls.filter(c => c[1] === 'get-world-info').length;
  await a.tool('get-targets', {});
  await b.tool('get-targets', {});
  clock += 1999;
  await a.tool('get-targets', {});
  assert.equal(checks(), 1, 'one check inside the ttl');
  clock += 2;
  await b.tool('get-targets', {});
  assert.equal(checks(), 2, 'checked again after the ttl');
});
