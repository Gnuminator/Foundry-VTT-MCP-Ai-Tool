/**
 * Unit tests for UsageRecorder (I-084): the module's usage log. Uses the
 * Foundry-mock harness for `game`, `Hooks` and `foundry.utils`; the socket is a
 * spy so the batching and the receiving side can be checked without Foundry.
 */
import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import {
  USAGE_BUFFER_MAX,
  USAGE_FLUSH_INTERVAL_MS,
  USAGE_SOCKET_CHANNEL,
  UsageRecorder,
  trackUsage,
  usageRecorder,
} from './usage-recorder.js';
import { QueryHandlers } from './queries.js';
import { bridgeHandlers } from './bridge-handlers.js';
import { MODULE_ID } from './constants.js';

let world: TestWorld;
let restore: () => void;
let emit: ReturnType<typeof vi.fn>;

function setup(currentUser: { isGM?: boolean; id?: string; name?: string } = { isGM: true }): void {
  world = createTestWorld({ currentUser });
  restore = world.install();
  emit = vi.fn();
  (globalThis as any).game.socket = { emit, on: vi.fn() };
}

function setBridgeUser(id: string): void {
  world.settings.set(`${MODULE_ID}.bridgeUserId`, id);
}

/** A list of `module.test.nN` names so neighbouring events never merge. */
function names(count: number): string[] {
  return Array.from({ length: count }, (_, i) => `module.test.n${i}`);
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  vi.useRealTimers();
  restore();
});

describe('recording on the bridge-holding GM client', () => {
  it('flushes own events into the buffer with who from game.user, seq from 1', () => {
    const rec = new UsageRecorder();
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.trackUsage('error', 'module.error.roll-button', { code: 'roll-failed' });
    expect(rec.getUsageRecords({}).records.length).toBe(2); // the query flushes the holder's outbox

    const res = rec.getUsageRecords({});
    expect(res.success).toBe(true);
    expect(res.records.map(r => [r.seq, r.name, r.kind, r.surface])).toEqual([
      [1, 'module.chat.roll-button', 'action', 'module'],
      [2, 'module.error.roll-button', 'error', 'module'],
    ]);
    expect(res.records[0].who).toEqual({ role: 'gm', userId: 'gm', name: 'Gamemaster' });
    expect(res.records[0].key).toBe(`${res.clientId}:1`);
    expect(res.records[1].code).toBe('roll-failed');
    expect(res.oldestSeq).toBe(1);
    expect(res.latestSeq).toBe(2);
    expect(emit).not.toHaveBeenCalled(); // only GM, no peer: nothing goes over the socket
  });

  it('answers a cursor: only events above sinceSeq, and the limit', () => {
    const rec = new UsageRecorder();
    for (const name of names(5)) rec.trackUsage('action', name);
    rec.flush();
    expect(rec.getUsageRecords({ sinceSeq: 3 }).records.map(r => r.seq)).toEqual([4, 5]);
    expect(rec.getUsageRecords({ sinceSeq: 0, limit: 2 }).records.map(r => r.seq)).toEqual([1, 2]);
    expect(rec.getUsageRecords({ sinceSeq: 5 }).records).toEqual([]);
    expect(rec.getUsageRecords({ sinceSeq: 'x' }).records).toHaveLength(5);
    expect(rec.getUsageRecords(undefined).latestSeq).toBe(5);
  });

  it('keeps a 2,000-event ring buffer and moves oldestSeq', () => {
    const rec = new UsageRecorder();
    for (const name of names(USAGE_BUFFER_MAX + 5)) rec.trackUsage('action', name);
    rec.flush();
    const res = rec.getUsageRecords({ limit: 5000 });
    expect(res.records).toHaveLength(USAGE_BUFFER_MAX);
    expect(res.oldestSeq).toBe(6);
    expect(res.latestSeq).toBe(USAGE_BUFFER_MAX + 5);
    expect(res.records[0].name).toBe('module.test.n5');
  });

  it('has a random clientId per recorder', () => {
    const a = new UsageRecorder().getUsageRecords({}).clientId;
    const b = new UsageRecorder().getUsageRecords({}).clientId;
    expect(a).toBeTruthy();
    expect(a).not.toBe(b);
  });
});

describe('merging identical neighbours', () => {
  it('merges consecutive identical events into count, not across a different event', () => {
    const rec = new UsageRecorder();
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.trackUsage('action', 'module.tarokka.offer-confirm');
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.flush();
    expect(rec.getUsageRecords({}).records.map(r => [r.name, r.count, r.seq])).toEqual([
      ['module.chat.roll-button', 3, 1],
      ['module.tarokka.offer-confirm', undefined, 2],
      ['module.chat.roll-button', undefined, 3],
    ]);
  });

  it('does not merge errors with different codes, or views', () => {
    const rec = new UsageRecorder();
    rec.trackUsage('error', 'module.error.campaign-status', { code: 'save-failed' });
    rec.trackUsage('error', 'module.error.campaign-status', { code: 'update-failed' });
    rec.trackUsage('view', 'module.settings.enhanced-index-open');
    rec.trackUsage('view', 'module.settings.enhanced-index-open');
    rec.flush();
    expect(rec.getUsageRecords({}).records).toHaveLength(4);
  });
});

describe('what is accepted', () => {
  it('drops names outside module.*, the tool kind, bad names and bad codes', () => {
    const rec = new UsageRecorder();
    rec.trackUsage('action', 'dash.tarokka.draw');
    rec.trackUsage('action', 'player.x.y');
    rec.trackUsage('tool', 'tool.get-world-info');
    rec.trackUsage('action', 'module.Has Space');
    rec.trackUsage('action', 'module');
    rec.trackUsage('action', `module.${'a'.repeat(90)}`);
    rec.trackUsage('bogus' as any, 'module.x.y');
    rec.trackUsage('error', 'module.error.x', { code: 'A long message with spaces!' });
    rec.flush();
    const records = rec.getUsageRecords({}).records;
    expect(records).toHaveLength(1);
    expect(records[0].name).toBe('module.error.x');
    expect(records[0].code).toBeUndefined();
  });

  it('never throws, also without game.user', () => {
    const rec = new UsageRecorder();
    (globalThis as any).game.user = undefined;
    expect(() => rec.trackUsage('action', 'module.x.y')).not.toThrow();
    expect(() => rec.flush()).not.toThrow();
  });

  it('the singleton helper records on usageRecorder', () => {
    trackUsage('action', 'module.helper.check');
    usageRecorder.flush();
    expect(usageRecorder.getUsageRecords({}).records.map(r => r.name)).toContain(
      'module.helper.check'
    );
  });
});

describe('players and non-bridge GMs send over the socket', () => {
  it('a player batches every 10 s, in chunks, without who', () => {
    restore();
    setup({ isGM: false, id: 'p1', name: 'Pia' });
    world.addUser({ id: 'gm', name: 'Gamemaster', isGM: true, active: true });
    vi.useFakeTimers({ toFake: ['setInterval', 'clearInterval', 'Date'] });
    const rec = new UsageRecorder();
    rec.start();
    rec.start(); // second call does not add a second timer
    for (const name of names(120)) rec.trackUsage('action', name);
    rec.trackUsage('error', 'module.error.roll-button', { code: 'roll-failed' });
    expect(emit).not.toHaveBeenCalled();

    vi.advanceTimersByTime(USAGE_FLUSH_INTERVAL_MS);

    expect(emit).toHaveBeenCalledTimes(3); // 121 events in chunks of 50
    const first = emit.mock.calls[0];
    expect(first[0]).toBe(USAGE_SOCKET_CHANNEL);
    expect(first[1].type).toBe('usageEvents');
    expect(first[1].userId).toBe('p1');
    expect(first[1].events).toHaveLength(50);
    expect(first[1].events[0]).toEqual({
      clientId: expect.any(String),
      seq: 1,
      t: expect.any(Number),
      kind: 'action',
      name: 'module.test.n0',
    });
    const last = emit.mock.calls[2][1].events;
    expect(last).toHaveLength(21);
    expect(last[20]).toMatchObject({ kind: 'error', code: 'roll-failed' });
    expect(JSON.stringify(emit.mock.calls)).not.toContain('Pia');

    vi.advanceTimersByTime(USAGE_FLUSH_INTERVAL_MS);
    expect(emit).toHaveBeenCalledTimes(3); // nothing new, nothing sent
    rec.stop();
  });

  it('a player keeps events while no GM is online and sends them later', () => {
    restore();
    setup({ isGM: false, id: 'p1', name: 'Pia' });
    const rec = new UsageRecorder();
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.flush();
    expect(emit).not.toHaveBeenCalled();

    world.addUser({ id: 'gm', name: 'Gamemaster', isGM: true, active: true });
    rec.flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1].events).toHaveLength(1);
  });

  it('a player never keeps a buffer and does not answer a socket message', () => {
    restore();
    setup({ isGM: false, id: 'p1', name: 'Pia' });
    world.addUser({ id: 'p2', name: 'Pax', isGM: false, active: true });
    const rec = new UsageRecorder();
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.flush();
    const accepted = rec.receive({
      type: 'usageEvents',
      userId: 'p2',
      events: [{ clientId: 'c2', seq: 1, kind: 'action', name: 'module.x.y' }],
    });
    expect(accepted).toBe(0);
    expect(rec.getUsageRecords({}).records).toEqual([]);
  });

  it('a GM who is not the bridge user sends over the socket and keeps nothing', () => {
    world.addUser({ id: 'gm2', name: 'Second GM', isGM: true, active: true });
    setBridgeUser('gm2');
    const rec = new UsageRecorder();
    expect(rec.isBufferHolder()).toBe(false);
    rec.trackUsage('action', 'module.tarokka.offer-confirm');
    rec.flush();
    expect(emit).toHaveBeenCalledTimes(1);
    expect(emit.mock.calls[0][1].userId).toBe('gm');
    expect(rec.getUsageRecords({}).records).toEqual([]);
    expect(
      rec.receive({
        userId: 'gm2',
        events: [{ clientId: 'c', seq: 1, kind: 'action', name: 'module.x.y' }],
      })
    ).toBe(0);
  });

  it('the bridge-user GM also emits while "Any GM" is chosen and a second GM is online', () => {
    world.addUser({ id: 'gm2', name: 'Second GM', isGM: true, active: true });
    const rec = new UsageRecorder();
    rec.trackUsage('action', 'module.chat.roll-button');
    rec.flush();
    expect(rec.getUsageRecords({}).records).toHaveLength(1);
    expect(emit).toHaveBeenCalledTimes(1);

    // With a named bridge user (this GM) no peer holds a buffer: no emit.
    emit.mockClear();
    setBridgeUser('gm');
    rec.trackUsage('action', 'module.tarokka.offer-decline');
    rec.flush();
    expect(emit).not.toHaveBeenCalled();
  });
});

describe('the GM branch (receive)', () => {
  beforeEach(() => {
    world.addUser({ id: 'p1', name: 'Pia', isGM: false, active: true });
    world.addUser({ id: 'gm2', name: 'Second GM', isGM: true, active: true });
  });

  const event = (seq: number, extra: Record<string, unknown> = {}): Record<string, unknown> => ({
    clientId: 'pc1',
    seq,
    t: Date.now(),
    kind: 'action',
    name: 'module.chat.roll-button',
    ...extra,
  });

  it('sanitizes, forces surface module and sets who from game.users', () => {
    const rec = new UsageRecorder();
    const accepted = rec.receive(
      {
        type: 'usageEvents',
        userId: 'p1',
        events: [
          event(1, { who: { role: 'gm', userId: 'gm', name: 'Faked' }, surface: 'dashboard' }),
          event(2, { name: 'dash.tarokka.draw' }),
          event(3, { kind: 'tool', name: 'tool.get-world-info' }),
          event(4, { text: 'typed text', code: 'x', kind: 'error', name: 'module.error.a' }),
          'junk',
        ],
      },
      'p1'
    );
    expect(accepted).toBe(2);
    const records = rec.getUsageRecords({}).records;
    expect(records.map(r => r.key)).toEqual(['pc1:1', 'pc1:4']);
    for (const r of records) {
      expect(r.surface).toBe('module');
      expect(r.who).toEqual({ role: 'player', userId: 'p1', name: 'Pia' });
    }
    expect(JSON.stringify(records)).not.toContain('typed text');
    expect(records[1].code).toBe('x');
  });

  it('marks a GM sender as gm', () => {
    const rec = new UsageRecorder();
    rec.receive({ userId: 'gm2', events: [event(1)] }, 'gm2');
    expect(rec.getUsageRecords({}).records[0].who).toEqual({
      role: 'gm',
      userId: 'gm2',
      name: 'Second GM',
    });
  });

  it('trusts the socket sender over the payload userId, and falls back to the payload', () => {
    const rec = new UsageRecorder();
    rec.receive({ userId: 'gm2', events: [event(1)] }, 'p1');
    rec.receive({ userId: 'p1', events: [event(2)] });
    const who = rec.getUsageRecords({}).records.map(r => r.who.userId);
    expect(who).toEqual(['p1', 'p1']);
  });

  it('ignores an unknown sender, this user, and a malformed payload', () => {
    const rec = new UsageRecorder();
    expect(rec.receive({ userId: 'ghost', events: [event(1)] }, 'ghost')).toBe(0);
    expect(rec.receive({ userId: 'gm', events: [event(1)] }, 'gm')).toBe(0);
    expect(rec.receive(null)).toBe(0);
    expect(rec.receive({ events: [event(1)] })).toBe(0);
    expect(rec.receive({ userId: 'p1', events: 'nope' }, 'p1')).toBe(0);
    expect(rec.getUsageRecords({}).records).toEqual([]);
  });

  it('drops a duplicate key (a batch forwarded twice)', () => {
    const rec = new UsageRecorder();
    rec.receive({ userId: 'p1', events: [event(1), event(2)] }, 'p1');
    rec.receive({ userId: 'p1', events: [event(2), event(3)] }, 'p1');
    const res = rec.getUsageRecords({});
    expect(res.records.map(r => r.key)).toEqual(['pc1:1', 'pc1:2', 'pc1:3']);
    expect(res.latestSeq).toBe(3);
  });

  it('interleaves own events and received events with one cursor', () => {
    const rec = new UsageRecorder();
    rec.receive({ userId: 'p1', events: [event(7)] }, 'p1');
    rec.trackUsage('action', 'module.tarokka.offer-confirm');
    const res = rec.getUsageRecords({});
    expect(res.records.map(r => r.who.userId)).toEqual(['p1', 'gm']);
    expect(rec.getUsageRecords({ sinceSeq: res.latestSeq }).records).toEqual([]);
  });
});

describe('query getUsageRecords', () => {
  it('is registered and returns the response shape for a GM', async () => {
    const qh = new QueryHandlers();
    qh.registerHandlers();
    usageRecorder.trackUsage('action', 'module.query.check');
    const res: any = await bridgeHandlers.get(`${MODULE_ID}.getUsageRecords`)!({ sinceSeq: 0 });
    expect(res).toMatchObject({ success: true, clientId: expect.any(String) });
    expect(res.records.some((r: any) => r.name === 'module.query.check')).toBe(true);
    expect(res.latestSeq).toBeGreaterThan(0);
    qh.unregisterHandlers();
  });

  it('is GM-gated: a player gets Access denied and no records', async () => {
    restore();
    setup({ isGM: false, id: 'p1', name: 'Pia' });
    const qh = new QueryHandlers();
    qh.registerHandlers();
    const res: any = await bridgeHandlers.get(`${MODULE_ID}.getUsageRecords`)!({});
    expect(res).toEqual({ error: 'Access denied', success: false });
    qh.unregisterHandlers();
  });
});

describe('settings saved (module.settings.save)', () => {
  it('counts one save per closed settings window, for this user and module settings only', async () => {
    const { registerSettingsUsageHooks } = await import('./settings.js');
    registerSettingsUsageHooks();
    const saves = (): number => {
      usageRecorder.flush();
      return usageRecorder
        .getUsageRecords({})
        .records.filter(r => r.name === 'module.settings.save')
        .reduce((sum, r) => sum + (r.count ?? 1), 0);
    };
    const before = saves();

    // Closing without a change, or after another user's change, counts nothing.
    Hooks.callAll('closeSettingsConfig', {});
    Hooks.callAll('updateSetting', { key: `${MODULE_ID}.enabled` }, {}, {}, 'someone-else');
    Hooks.callAll('closeSettingsConfig', {});
    // The module's own bookkeeping and other modules' settings are not a save.
    Hooks.callAll('updateSetting', { key: `${MODULE_ID}.rollStates` }, {}, {}, 'gm');
    Hooks.callAll('updateSetting', { key: 'other-module.enabled' }, {}, {}, 'gm');
    Hooks.callAll('closeSettingsConfig', {});
    expect(saves()).toBe(before);

    // Two changes by this user, then one close: one event, and never the key or value.
    Hooks.callAll('updateSetting', { key: `${MODULE_ID}.enabled`, value: true }, {}, {}, 'gm');
    Hooks.callAll('updateSetting', { key: `${MODULE_ID}.serverHost` }, {}, {}, 'gm');
    Hooks.callAll('closeSettingsConfig', {});
    Hooks.callAll('closeSettingsConfig', {});
    expect(saves()).toBe(before + 1);
    expect(JSON.stringify(usageRecorder.getUsageRecords({}).records)).not.toContain('serverHost');
  });
});
