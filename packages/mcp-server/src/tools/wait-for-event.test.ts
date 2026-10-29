import { readFileSync, readdirSync } from 'fs';
import path from 'path';
import { fileURLToPath } from 'url';

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';

import { GameEventHub, KNOWN_EVENT_TYPES } from '../game-event-hub.js';
import { WaitForEventTools } from './wait-for-event.js';

const T0 = 1_000_000;
const logger = { debug: vi.fn(), info: vi.fn(), warn: vi.fn(), error: vi.fn() } as any;
logger.child = (): unknown => logger;

let hub: GameEventHub;
let tools: WaitForEventTools;

beforeEach(() => {
  vi.useFakeTimers();
  hub = new GameEventHub(() => T0);
  hub.setSources({ sessionEvents: true, playLog: true });
  tools = new WaitForEventTools({ hub, logger });
});
afterEach(() => {
  vi.useRealTimers();
});

describe('handleWaitForGameEvent', () => {
  it('rejects a sinceTimestamp that is not a date', async () => {
    await expect(tools.handleWaitForGameEvent({ sinceTimestamp: 'yesterday' })).rejects.toThrow(
      /not an ISO timestamp/
    );
    expect(hub.waiterCount).toBe(0);
  });

  it('rejects a timeout over the maximum', async () => {
    await expect(tools.handleWaitForGameEvent({ timeoutSeconds: 600 })).rejects.toThrow();
  });

  it('answers a cancelled wait when the signal aborts (a closed control socket)', async () => {
    const abort = new AbortController();
    const pending = tools.handleWaitForGameEvent({ timeoutSeconds: 30 }, abort.signal);
    expect(hub.waiterCount).toBe(1);
    abort.abort();
    const reply = (await pending) as Record<string, unknown>;
    expect(reply).toMatchObject({ success: true, timedOut: true, cancelled: true, events: [] });
    expect(hub.waiterCount).toBe(0);
  });

  it('answers at once, cancelled, for a signal that is already aborted', async () => {
    const abort = new AbortController();
    abort.abort();
    const reply = (await tools.handleWaitForGameEvent({}, abort.signal)) as Record<string, unknown>;
    expect(reply.cancelled).toBe(true);
    expect(hub.waiterCount).toBe(0);
  });

  it('times out with a cursor the next call can pass back', async () => {
    const pending = tools.handleWaitForGameEvent({ timeoutSeconds: 1 });
    await vi.advanceTimersByTimeAsync(1000);
    const reply = (await pending) as Record<string, unknown>;
    expect(reply).toMatchObject({ timedOut: true, events: [] });
    expect(reply.cancelled).toBeUndefined();
    expect(reply.latestTimestamp).toBe(new Date(T0).toISOString());
  });

  it('returns a matching event and its cursor', async () => {
    const pending = tools.handleWaitForGameEvent({ eventTypes: ['scene-change'] });
    hub.publishSessionEvents([
      {
        id: 'a',
        timestamp: new Date(5).toISOString(),
        eventType: 'scene-change',
        description: 'Scene changed',
      },
    ]);
    const reply = (await pending) as { timedOut: boolean; events: unknown[] };
    expect(reply.timedOut).toBe(false);
    expect(reply.events).toHaveLength(1);
  });
});

describe('KNOWN_EVENT_TYPES', () => {
  /** Event types the module logs on purpose that a wait does not offer (the AI's own writes). */
  const NOT_WAITABLE = ['gm-change', 'roll-request'];

  function moduleSources(): string[] {
    const root = path.resolve(
      path.dirname(fileURLToPath(import.meta.url)),
      '../../../foundry-module/src'
    );
    const files: string[] = [];
    const walk = (dir: string): void => {
      for (const entry of readdirSync(dir, { withFileTypes: true })) {
        const full = path.join(dir, entry.name);
        if (entry.isDirectory()) walk(full);
        else if (entry.name.endsWith('.ts') && !entry.name.endsWith('.test.ts')) files.push(full);
      }
    };
    walk(root);
    return files.map(f => readFileSync(f, 'utf8'));
  }

  it('matches the types the module logs, bar combat-turn (play log) and the unwaitable ones', () => {
    const logged = new Set<string>();
    for (const source of moduleSources()) {
      for (const m of source.matchAll(/logSessionEvent\(\s*'([a-z-]+)'/g)) logged.add(m[1]);
      // Types chosen before the call: `const eventType = cond ? 'a' : 'b'` and onActiveEffect(x, 'c').
      for (const m of source.matchAll(/const eventType = ([^;\n]+)/g)) {
        for (const q of m[1].matchAll(/'([a-z-]+)'/g)) logged.add(q[1]);
      }
      for (const m of source.matchAll(/onActiveEffect\([^,)]+,\s*'([a-z-]+)'/g)) logged.add(m[1]);
    }
    for (const type of NOT_WAITABLE) expect(logged.has(type)).toBe(true);
    const waitable = [...logged].filter(t => !NOT_WAITABLE.includes(t));
    expect([...KNOWN_EVENT_TYPES].filter(t => t !== 'combat-turn').sort()).toEqual(waitable.sort());
  });
});
