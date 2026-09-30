import { describe, expect, it } from 'vitest';

import {
  USAGE_LIMITS,
  canonicalUsageName,
  isUsageName,
  sanitizeUsageBatch,
  sanitizeUsageEvent,
  usageLogFileName,
  USAGE_LOG_FILE_RE,
} from './usage.js';

const NOW = 1_790_000_000_000;

function raw(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    v: 1,
    t: NOW - 1000,
    seq: 3,
    clientId: 'c1',
    surface: 'dashboard',
    kind: 'action',
    name: 'dash.tarokka.draw',
    who: { role: 'gm', userId: null, name: null },
    ...extra,
  };
}

describe('usage names', () => {
  it('accepts dotted lowercase names of 2 to 5 segments', () => {
    expect(isUsageName('dash.tarokka.draw')).toBe(true);
    expect(isUsageName('tool.get-world-info')).toBe(true);
    expect(isUsageName('dash')).toBe(false);
    expect(isUsageName('Dash.tarokka')).toBe(false);
    expect(isUsageName('a.b.c.d.e.f')).toBe(false);
    expect(isUsageName(`dash.${'x'.repeat(80)}`)).toBe(false);
    expect(isUsageName('dash.hello world')).toBe(false);
  });

  it('builds and matches the daily file name', () => {
    expect(usageLogFileName('2026-09-30')).toBe('2026-09-30.usage.jsonl');
    expect(USAGE_LOG_FILE_RE.exec('2026-09-30.usage.jsonl')?.[1]).toBe('2026-09-30');
    expect(USAGE_LOG_FILE_RE.test('2026-09-30.play.jsonl')).toBe(false);
  });

  it('resolves unknown names to themselves', () => {
    expect(canonicalUsageName('dash.x.y')).toBe('dash.x.y');
  });
});

describe('sanitizeUsageEvent', () => {
  it('keeps a valid event and derives the key', () => {
    const e = sanitizeUsageEvent(raw(), { now: NOW });
    expect(e).toMatchObject({ key: 'c1:3', name: 'dash.tarokka.draw', surface: 'dashboard' });
  });

  it('drops unknown fields, so no free text survives', () => {
    const e = sanitizeUsageEvent(raw({ text: 'secret whisper', args: { a: 1 } }), { now: NOW });
    expect(e).not.toHaveProperty('text');
    expect(e).not.toHaveProperty('args');
  });

  it('enforces the surface prefix and the tool rules', () => {
    expect(sanitizeUsageEvent(raw({ name: 'player.x.y' }), { now: NOW })).toBeNull();
    expect(
      sanitizeUsageEvent(raw({ kind: 'tool', name: 'tool.get-world-info' }), { now: NOW })
    ).not.toBeNull();
    expect(
      sanitizeUsageEvent(raw({ kind: 'action', name: 'tool.get-world-info' }), { now: NOW })
    ).toBeNull();
    expect(
      sanitizeUsageEvent(raw({ surface: 'player', kind: 'tool', name: 'tool.x' }), { now: NOW })
    ).toBeNull();
  });

  it('lets the server force the surface and who', () => {
    const e = sanitizeUsageEvent(raw({ name: 'player.handouts.open' }), {
      now: NOW,
      surface: 'player',
      who: { role: 'player', userId: 'u1', name: 'Player' },
    });
    expect(e?.surface).toBe('player');
    expect(e?.who).toEqual({ role: 'player', userId: 'u1', name: 'Player' });
    expect(
      sanitizeUsageEvent(raw({ name: 'dash.tarokka.draw' }), { now: NOW, surface: 'player' })
    ).toBeNull();
  });

  it('clamps future timestamps and bounds numbers', () => {
    const e = sanitizeUsageEvent(
      raw({
        t: NOW + 60 * 60 * 1000,
        kind: 'view',
        name: 'dash.view.main',
        durationMs: 1e12,
        count: 5,
      }),
      { now: NOW }
    );
    expect(e?.t).toBe(NOW);
    expect(e?.durationMs).toBe(USAGE_LIMITS.maxDurationMs);
    expect(e?.count).toBe(5);
  });

  it('accepts only short codes on errors and tools', () => {
    expect(
      sanitizeUsageEvent(raw({ kind: 'error', name: 'dash.error.tool', code: 'timeout' }), {
        now: NOW,
      })?.code
    ).toBe('timeout');
    expect(
      sanitizeUsageEvent(raw({ kind: 'error', name: 'dash.error.tool', code: 'Tool failed: x' }), {
        now: NOW,
      })?.code
    ).toBeUndefined();
  });

  it('rejects bad client ids and sequence numbers', () => {
    expect(sanitizeUsageEvent(raw({ clientId: 'a b' }), { now: NOW })).toBeNull();
    expect(sanitizeUsageEvent(raw({ seq: -1 }), { now: NOW })).toBeNull();
    expect(sanitizeUsageEvent(null)).toBeNull();
  });
});

describe('sanitizeUsageBatch', () => {
  it('counts invalid and over-limit events as dropped', () => {
    const batch = [
      raw(),
      raw({ name: 'nope' }),
      ...Array.from({ length: USAGE_LIMITS.maxBatch }, (_, i) => raw({ seq: i + 10 })),
    ];
    const { events, dropped } = sanitizeUsageBatch(batch, { now: NOW });
    expect(events.length).toBe(USAGE_LIMITS.maxBatch - 1);
    expect(dropped).toBe(batch.length - events.length);
    expect(sanitizeUsageBatch('x')).toEqual({ events: [], dropped: 0 });
  });
});
