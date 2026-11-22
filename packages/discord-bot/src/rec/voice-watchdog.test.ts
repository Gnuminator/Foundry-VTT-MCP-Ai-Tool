import { EventEmitter } from 'node:events';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

type Status = 'signalling' | 'connecting' | 'ready' | 'disconnected' | 'destroyed';

class FakeConnection extends EventEmitter {
  state: { status: Status } = { status: 'signalling' };
  receiver = {
    ssrcMap: new EventEmitter(),
    speaking: new EventEmitter(),
    subscribe: (): EventEmitter => new EventEmitter(),
  };
  destroyed = 0;
  set(to: Status): void {
    const from = this.state;
    this.state = { status: to };
    this.emit('stateChange', from, this.state);
  }
  destroy(): void {
    this.destroyed++;
    this.set('destroyed');
  }
}

const made: FakeConnection[] = [];

vi.mock('@discordjs/voice', () => ({
  EndBehaviorType: { Manual: 0 },
  VoiceConnectionStatus: {
    Signalling: 'signalling',
    Connecting: 'connecting',
    Ready: 'ready',
    Disconnected: 'disconnected',
    Destroyed: 'destroyed',
  },
  joinVoiceChannel: (): FakeConnection => {
    const c = new FakeConnection();
    made.push(c);
    return c;
  },
  // Resolves when the connection is (or becomes) in `status`, rejects after `ms`.
  entersState: (c: FakeConnection, status: Status, ms: number): Promise<FakeConnection> =>
    new Promise((resolve, reject) => {
      if (c.state.status === status) return resolve(c);
      const on = (_f: unknown, to: { status: Status }): void => {
        if (to.status !== status) return;
        clearTimeout(t);
        c.off('stateChange', on);
        resolve(c);
      };
      const t = setTimeout(() => {
        c.off('stateChange', on);
        reject(new Error('timeout'));
      }, ms);
      c.on('stateChange', on);
    }),
}));
vi.mock('./rtp-tap.js', () => ({
  installRtpTap: (): { active: boolean; current: () => undefined } => ({
    active: false,
    current: (): undefined => undefined,
  }),
}));

import { READY_WATCHDOG_MS, VoiceRecorder } from './voice.js';

function make(): { rec: VoiceRecorder; alerts: string[]; events: string[] } {
  const alerts: string[] = [];
  const events: string[] = [];
  const rec = new VoiceRecorder({
    target: { guildId: 'g', channelId: 'c', adapterCreator: (() => ({})) as never },
    session: {
      log: (e: { type: string }) => events.push(e.type),
      debug: (): undefined => undefined,
      packet: (): undefined => undefined,
    } as never,
    resolveSpeaker: (): never => ({ username: 'u', displayName: 'U' }) as never,
    alert: (m): void => {
      alerts.push(m);
    },
  });
  return { rec, alerts, events };
}

describe('connection watchdog', () => {
  beforeEach(() => {
    vi.useFakeTimers();
    made.length = 0;
  });
  afterEach(() => vi.useRealTimers());

  async function started(): Promise<ReturnType<typeof make>> {
    const h = make();
    const p = h.rec.start();
    made[0].set('ready');
    await p;
    return h;
  }

  it('leaves a connection alone that heals itself within the window', async () => {
    const h = await started();
    const c = made[0];
    c.set('disconnected');
    c.set('connecting');
    await vi.advanceTimersByTimeAsync(10_000);
    c.set('ready');
    await vi.advanceTimersByTimeAsync(READY_WATCHDOG_MS + 5_000);
    expect(c.destroyed).toBe(0);
    expect(h.alerts).toHaveLength(0);
  });

  it('destroys a connection stuck connecting 30 s after the disconnect and rejoins', async () => {
    const h = await started();
    const c = made[0];
    c.set('disconnected');
    c.set('signalling'); // the library began to reconnect and hung
    await vi.advanceTimersByTimeAsync(READY_WATCHDOG_MS + 1);
    expect(c.destroyed).toBe(1);
    expect(h.alerts[0]).toContain('lost the voice connection');
    // the Destroyed handler schedules the rejoin (first backoff 1 s)
    await vi.advanceTimersByTimeAsync(1_000);
    expect(made).toHaveLength(2);
    made[1].set('ready');
    await vi.advanceTimersByTimeAsync(0);
    expect(h.events).toContain('rejoined');
    expect(h.alerts.some(a => a.includes('back in the voice channel'))).toBe(true);
  });

  it('keeps retrying with alerts when the rejoin itself fails', async () => {
    const h = await started();
    const c = made[0];
    c.set('disconnected'); // never enters signalling: destroyed after 5 s
    await vi.advanceTimersByTimeAsync(5_001);
    expect(c.destroyed).toBe(1);
    await vi.advanceTimersByTimeAsync(1_000); // rejoin 1 starts, never ready
    expect(made).toHaveLength(2);
    await vi.advanceTimersByTimeAsync(20_001); // start() times out
    expect(h.events).toContain('rejoin_failed');
    expect(made[1].destroyed).toBe(1);
    await vi.advanceTimersByTimeAsync(2_000); // next attempt after the 2 s backoff
    expect(made).toHaveLength(3);
  });
});
