import { describe, it, expect } from 'vitest';
import {
  createLinkNotifier,
  createLinkRelayReceiver,
  parseLinkRelayState,
  LINK_BACK_TOAST,
  LINK_LOST_TOAST,
} from './link-notice.js';

function setup(opts: { gm?: boolean; enabled?: boolean } = {}): {
  n: ReturnType<typeof createLinkNotifier>;
  toasts: [string, string][];
  advance: (ms: number) => void;
} {
  let t = 0;
  const timers: { at: number; fn: () => void; id: number }[] = [];
  let nextId = 1;
  const toasts: [string, string][] = [];
  const n = createLinkNotifier({
    notify: (m, l) => toasts.push([m, l]),
    isGM: () => opts.gm ?? true,
    enabled: () => opts.enabled ?? true,
    graceMs: 10,
    throttleMs: 100,
    now: () => t,
    setTimer: (fn, ms) => {
      const id = nextId++;
      timers.push({ at: t + ms, fn, id });
      return id;
    },
    clearTimer: h => {
      const i = timers.findIndex(x => x.id === h);
      if (i >= 0) timers.splice(i, 1);
    },
  });
  const advance = (ms: number): void => {
    t += ms;
    for (const x of timers.filter(y => y.at <= t)) {
      timers.splice(timers.indexOf(x), 1);
      x.fn();
    }
  };
  return { n, toasts, advance };
}

describe('link notifier', () => {
  it('says nothing for a drop shorter than the grace period', () => {
    const s = setup();
    s.n.down();
    s.advance(5);
    s.n.up();
    s.advance(50);
    expect(s.toasts).toEqual([]);
  });

  it('toasts once when lost and once when back', () => {
    const s = setup();
    s.n.down();
    s.advance(10);
    s.n.down(); // repeated failed retries add nothing
    s.advance(10);
    expect(s.toasts).toEqual([[LINK_LOST_TOAST, 'warn']]);
    s.n.up();
    expect(s.toasts).toEqual([
      [LINK_LOST_TOAST, 'warn'],
      [LINK_BACK_TOAST, 'info'],
    ]);
  });

  it('shows no toast for a player or when messages are off', () => {
    for (const o of [{ gm: false }, { enabled: false }]) {
      const s = setup(o);
      s.n.down();
      s.advance(20);
      s.n.up();
      expect(s.toasts).toEqual([]);
    }
  });

  it('ignores the first connect', () => {
    const s = setup();
    s.n.up();
    expect(s.toasts).toEqual([]);
  });

  it('throttles a flapping link', () => {
    const s = setup();
    s.n.down();
    s.advance(10);
    s.n.up();
    s.advance(15);
    s.n.down();
    s.advance(10); // lost again 25 ms after the first: throttled, silent
    s.n.up(); // no lost toast shown, so no back toast
    expect(s.toasts.map(x => x[0])).toEqual([LINK_LOST_TOAST, LINK_BACK_TOAST]);
    s.advance(200);
    s.n.down();
    s.advance(10);
    expect(s.toasts.length).toBe(3);
  });

  it('announces a lasting outage after a flap once the throttle window passes', () => {
    const s = setup();
    s.n.down();
    s.advance(10);
    s.n.up();
    s.advance(15);
    s.n.down();
    s.advance(500); // still down: the throttled toast waits out the window, then shows
    expect(s.toasts.map(x => x[0])).toEqual([LINK_LOST_TOAST, LINK_BACK_TOAST, LINK_LOST_TOAST]);
  });

  it('re-arms in steps while the throttle window runs, then shows the lost toast', () => {
    const s = setup();
    s.n.down();
    s.advance(10); // lost at t=10
    s.n.up();
    s.advance(15);
    s.n.down(); // t=25: grace ends at 35, the throttle window at 110
    s.advance(10); // t=35: throttled, re-armed for t=110
    expect(s.toasts.map(x => x[0])).toEqual([LINK_LOST_TOAST, LINK_BACK_TOAST]);
    s.advance(70); // t=105: still waiting
    expect(s.toasts).toHaveLength(2);
    s.advance(5); // t=110: window over
    expect(s.toasts.map(x => x[0])).toEqual([LINK_LOST_TOAST, LINK_BACK_TOAST, LINK_LOST_TOAST]);
    s.n.up();
    expect(s.toasts.at(-1)).toEqual([LINK_BACK_TOAST, 'info']);
  });

  it('an up() during the re-armed wait cancels it and shows nothing', () => {
    const s = setup();
    s.n.down();
    s.advance(10);
    s.n.up();
    s.advance(15);
    s.n.down();
    s.advance(10); // re-armed for t=110
    s.n.up(); // back before the lost toast was ever shown
    s.advance(200);
    expect(s.toasts.map(x => x[0])).toEqual([LINK_LOST_TOAST, LINK_BACK_TOAST]);
  });

  it('markLost owes a back toast without a lost toast', () => {
    const s = setup();
    s.n.markLost();
    s.advance(500);
    expect(s.toasts).toEqual([]);
    s.n.down(); // retries failing add nothing
    s.advance(500);
    expect(s.toasts).toEqual([]);
    s.n.up();
    expect(s.toasts).toEqual([[LINK_BACK_TOAST, 'info']]);
  });

  it('shows the back toast after a second lost toast', () => {
    const s = setup();
    s.n.down();
    s.advance(10);
    s.n.up();
    s.advance(150);
    s.n.down();
    s.advance(10);
    s.n.up();
    expect(s.toasts.map(x => x[0])).toEqual([
      LINK_LOST_TOAST,
      LINK_BACK_TOAST,
      LINK_LOST_TOAST,
      LINK_BACK_TOAST,
    ]);
  });

  it('reset cancels a pending toast', () => {
    const s = setup();
    s.n.down();
    s.n.reset();
    s.advance(50);
    expect(s.toasts).toEqual([]);
  });
});

describe('link notifier publishing', () => {
  function withPublish(opts: { gm?: boolean; enabled?: boolean } = {}) {
    const published: string[] = [];
    let t = 0;
    const timers: { at: number; fn: () => void }[] = [];
    const n = createLinkNotifier({
      notify: () => undefined,
      isGM: () => opts.gm ?? true,
      enabled: () => opts.enabled ?? true,
      graceMs: 10,
      throttleMs: 100,
      now: () => t,
      setTimer: (fn, ms) => timers.push({ at: t + ms, fn }),
      clearTimer: () => timers.splice(0),
      publish: s => published.push(s),
    });
    const advance = (ms: number): void => {
      t += ms;
      for (const x of timers.filter(y => y.at <= t)) {
        timers.splice(timers.indexOf(x), 1);
        x.fn();
      }
    };
    return { n, published, advance };
  }

  it('publishes lost after the grace and up on the return, nothing for a short drop', () => {
    const s = withPublish();
    s.n.down();
    s.n.up();
    expect(s.published).toEqual([]);
    s.n.down();
    s.advance(10);
    s.n.up();
    expect(s.published).toEqual(['lost', 'up']);
  });

  it('publishes quiet when a lost link is stopped on purpose, and nothing otherwise', () => {
    const s = withPublish();
    s.n.reset();
    expect(s.published).toEqual([]);
    s.n.markLost();
    s.n.reset();
    expect(s.published).toEqual(['lost', 'quiet']);
  });

  it('publishes nothing when messages are off or for a non-GM', () => {
    for (const o of [{ gm: false }, { enabled: false }]) {
      const s = withPublish(o);
      s.n.down();
      s.advance(20);
      s.n.markLost();
      s.n.up();
      expect(s.published).toEqual([]);
    }
  });
});

describe('link relay receiver', () => {
  function recv(opts: { gm?: boolean; enabled?: boolean; holds?: boolean } = {}) {
    let t = 0;
    const toasts: [string, string][] = [];
    const r = createLinkRelayReceiver({
      notify: (m, l) => toasts.push([m, l]),
      isGM: () => opts.gm ?? true,
      enabled: () => opts.enabled ?? true,
      holdsLink: () => opts.holds ?? false,
      throttleMs: 100,
      now: () => t,
    });
    return { r, toasts, tick: (ms: number) => (t += ms) };
  }
  const lost = { state: 'lost', at: 1 } as const;
  const up = { state: 'up', at: 2 } as const;

  it('shows lost then back in a GM browser that does not hold the link', () => {
    const s = recv();
    s.r.apply(lost);
    s.r.apply(up);
    expect(s.toasts).toEqual([
      [LINK_LOST_TOAST, 'warn'],
      [LINK_BACK_TOAST, 'info'],
    ]);
  });

  it('shows nothing to players, with messages off, or in the browser that holds the link', () => {
    for (const o of [{ gm: false }, { enabled: false }, { holds: true }]) {
      const s = recv(o);
      s.r.apply(lost);
      s.r.apply(up);
      expect(s.toasts).toEqual([]);
    }
  });

  it('says nothing for an up it never saw lost, or after a quiet stop', () => {
    const s = recv();
    s.r.apply(up);
    s.r.apply(lost);
    s.r.apply({ state: 'quiet', at: 3 });
    s.r.apply(up);
    expect(s.toasts).toEqual([[LINK_LOST_TOAST, 'warn']]);
  });

  it('throttles a flapping link', () => {
    const s = recv();
    s.r.apply(lost);
    s.r.apply(up);
    s.tick(50);
    s.r.apply(lost);
    expect(s.toasts).toHaveLength(2);
    s.tick(100);
    s.r.apply(up);
    s.r.apply(lost);
    expect(s.toasts.filter(t => t[0] === LINK_LOST_TOAST)).toHaveLength(2);
  });

  it('parses unknown stored values as up', () => {
    expect(parseLinkRelayState(null)).toEqual({ state: 'up', at: 0 });
    expect(parseLinkRelayState({ state: 'lost', at: 5 })).toEqual({ state: 'lost', at: 5 });
    expect(parseLinkRelayState({ state: 'x', at: 5 })).toEqual({ state: 'up', at: 0 });
  });
});
