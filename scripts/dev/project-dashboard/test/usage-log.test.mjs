import { test } from 'node:test';
import assert from 'node:assert/strict';
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';
import {
  emptyUsageState,
  updateUsageState,
  usageRows,
  usageSummary,
  usageWarning,
  renderNotes,
  mergeSection,
  weekWindow,
  syncUsageToVault,
  LOG_NOTE,
  WEEKLY_NOTE,
} from '../usage-log.mjs';

const H = 3600 * 1000;
const T0 = new Date(2026, 9, 8, 9, 0).getTime(); // local 09:00

function plan(atMs, fiveHour, weekly, resetsAt = new Date(2026, 9, 10, 7, 0).toISOString()) {
  return {
    source: 'plugin',
    asOf: new Date(atMs).toISOString(),
    windows: [
      { kind: 'five_hour', label: '5-hour', percentUsed: fiveHour, resetsAt: null },
      { kind: 'seven_day', label: 'Weekly (all models)', percentUsed: weekly, resetsAt },
    ],
  };
}

function session(id, title, firstMs, lastMs, extra = {}) {
  return {
    sessionId: id,
    title,
    firstTs: new Date(firstMs).toISOString(),
    lastTs: new Date(lastMs).toISOString(),
    firstContext: 90000,
    context: 180000,
    peak: 210000,
    ...extra,
  };
}

function lane(id, title, pid, lastMs) {
  return { sessionId: id, title, pid, lastActivity: new Date(lastMs).toISOString() };
}

const msgs = new Map([
  [
    'm1',
    {
      ts: new Date(T0 + H).toISOString(),
      tokens: { input: 1, output: 2, cacheRead: 3, cacheWrite: 4 },
      sub: false,
    },
  ],
  [
    'm2',
    {
      ts: new Date(T0 + H).toISOString(),
      tokens: { input: 10, output: 0, cacheRead: 0, cacheWrite: 0 },
      sub: true,
    },
  ],
]);

test('start row from the first request; no end while the process lives', () => {
  const st = emptyUsageState(new Date(T0), 'PC1');
  const s = session('s1', 'Lane one', T0 + 10 * 60000, T0 + 2 * H);
  updateUsageState(st, {
    sessions: [s],
    lanes: { rows: [lane('s1', 'Lane one', 123, T0 + 2 * H)] },
    plan: plan(T0 + 12 * 60000, 20, 40),
    messages: msgs,
    now: new Date(T0 + 4 * H),
  });
  const rows = usageRows(st);
  assert.equal(rows.length, 1);
  assert.equal(rows[0].event, 'start');
  assert.equal(rows[0].context, 90000);
  assert.equal(rows[0].fiveHour, 20);
  assert.equal(rows[0].weekly, 40);
});

test('provisional end when the process is gone an hour; dropped when the session comes back', () => {
  const st = emptyUsageState(new Date(T0), 'PC1');
  const base = session('s1', 'Lane one', T0 + 60000, T0 + H);
  updateUsageState(st, {
    sessions: [base],
    lanes: { rows: [] },
    plan: null,
    messages: msgs,
    now: new Date(T0 + 3 * H),
  });
  assert.deepEqual(
    usageRows(st).map(r => r.event),
    ['start', 'end (provisional)']
  );

  const back = session('s1', 'Lane one', T0 + 60000, T0 + 3.5 * H);
  updateUsageState(st, {
    sessions: [back],
    lanes: { rows: [lane('s1', 'Lane one', 9, T0 + 3.5 * H)] },
    plan: null,
    messages: msgs,
    now: new Date(T0 + 3.6 * H),
  });
  assert.deepEqual(
    usageRows(st).map(r => r.event),
    ['start']
  );
});

test('a CLOSED title gives a final end row with the peak; old sessions get no rows', () => {
  const st = emptyUsageState(new Date(T0), 'PC1');
  const closed = session('s2', 'CLOSED (handed over) Lane two', T0 + 60000, T0 + 2 * H);
  const old = session('s0', 'Yesterday', T0 - 20 * H, T0 - 19 * H);
  updateUsageState(st, {
    sessions: [closed, old],
    lanes: { rows: [lane('s2', 'CLOSED (handed over) Lane two', 5, T0 + 2 * H)] },
    plan: plan(T0 + 2 * H + 60000, 30, 45),
    messages: msgs,
    now: new Date(T0 + 2.2 * H),
  });
  const rows = usageRows(st);
  assert.deepEqual(
    rows.map(r => r.event),
    ['start', 'end']
  );
  assert.equal(rows[1].peak, 210000);
  assert.equal(rows[1].weekly, 45);
  assert.equal(rows[0].weekly, null, 'no plan reading near the start');
  assert.ok(!('s0' in st.sessions));
});

test('weekWindow follows the weekly reset and falls back to Monday', () => {
  const reset = new Date(2026, 9, 10, 7, 0).getTime();
  const w = weekWindow(T0, plan(T0, 1, 1, new Date(reset).toISOString()));
  assert.equal(w.end, reset);
  assert.equal(w.start, reset - 7 * 24 * H);
  const later = weekWindow(reset + H, plan(T0, 1, 1, new Date(reset).toISOString()));
  assert.equal(later.start, reset);
  const monday = weekWindow(T0, null);
  assert.equal(new Date(monday.start).getDay(), 1);
});

test('renderNotes keeps other PCs sections and escapes pipes in titles', () => {
  const st = emptyUsageState(new Date(T0), 'PC1');
  updateUsageState(st, {
    sessions: [session('s1', 'A | B', T0 + 60000, T0 + H)],
    lanes: { rows: [lane('s1', 'A | B', 1, T0 + H)] },
    plan: plan(T0 + H, 10, 20),
    messages: msgs,
    now: new Date(T0 + H),
  });
  const existing = mergeSection('', 'HEAD\n', 'PC2', '## PC PC2\n\nrow from pc2\n');
  const out = renderNotes(st, T0 + H, { log: existing, weekly: '' });
  assert.match(out.log, /## PC PC2\n\nrow from pc2/);
  assert.match(out.log, /## PC PC1/);
  assert.match(out.log, /A \\\| B/);
  assert.match(out.weekly, /Tokens, main thread: 0\.0M/);
  assert.match(out.weekly, /\(current\)/);
  const again = renderNotes(st, T0 + H, { log: out.log, weekly: out.weekly });
  assert.equal(again.log, out.log, 'rendering is stable');
});

test('syncUsageToVault pushes once, then waits an hour; a waiting vault retries next tick', async () => {
  const vault = fs.mkdtempSync(path.join(os.tmpdir(), 'pd-uv-'));
  fs.mkdirSync(path.join(vault, '.git'));
  const st = emptyUsageState(new Date(T0), 'PC1');
  updateUsageState(st, {
    sessions: [session('s1', 'Lane', T0 + 60000, T0 + H)],
    lanes: { rows: [lane('s1', 'Lane', 1, T0 + H)] },
    plan: null,
    messages: msgs,
    now: new Date(T0 + H),
  });
  const calls = [];
  let answer = 'waiting';
  const push = async opts => {
    calls.push(opts);
    if (answer === 'pushed') await opts.write(vault);
    return {
      state: answer,
      detail: answer === 'waiting' ? 'the vault has 1 other uncommitted change' : 'pushed 2 files',
      at: 'x',
    };
  };
  await syncUsageToVault({ state: st, vaultDir: vault, now: new Date(T0 + H), push });
  assert.equal(st.push.state, 'waiting');
  assert.match(usageWarning(usageSummary(st), T0 + H + 5 * 60000), /waiting 5 min/);
  answer = 'pushed';
  await syncUsageToVault({ state: st, vaultDir: vault, now: new Date(T0 + H + 5 * 60000), push });
  assert.equal(st.push.state, 'pushed');
  assert.deepEqual(calls[1].paths, [LOG_NOTE, WEEKLY_NOTE]);
  assert.equal(calls[1].requireClean, true);
  assert.ok(fs.readFileSync(path.join(vault, LOG_NOTE), 'utf8').includes('| Lane | start |'));

  // Unchanged rows: no push at all.
  await syncUsageToVault({ state: st, vaultDir: vault, now: new Date(T0 + 3 * H), push });
  assert.equal(calls.length, 2);
  // Changed rows within the hour: wait; after the hour: push.
  st.sessions.s1.title = 'Lane renamed';
  await syncUsageToVault({ state: st, vaultDir: vault, now: new Date(T0 + H + 20 * 60000), push });
  assert.equal(calls.length, 2);
  await syncUsageToVault({ state: st, vaultDir: vault, now: new Date(T0 + 2.2 * H), push });
  assert.equal(calls.length, 3);
});

test('no vault: push state off, nothing written', async () => {
  const st = emptyUsageState(new Date(T0), 'PC1');
  await syncUsageToVault({ state: st, vaultDir: null, now: new Date(T0) });
  assert.equal(st.push.state, 'off');
  assert.equal(usageWarning(usageSummary(st)), null);
});
