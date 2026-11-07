import { describe, expect, it } from 'vitest';

import { REPEAT_ALERT_MS, RecorderHealth, SILENCE_MS, formatAge } from './health.js';

const T = 1_000_000;
const MIN = 60_000;

describe('RecorderHealth silence', () => {
  it('reports a member once after 5 minutes of nothing, and again only after a new packet', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', false, T);
    expect(h.silent(T + SILENCE_MS - 1)).toEqual([]);
    const first = h.silent(T + SILENCE_MS);
    expect(first).toHaveLength(1);
    expect(first[0]).toContain('Mara');
    expect(first[0]).toContain('not been recorded at all');
    expect(h.silent(T + 20 * MIN)).toEqual([]);
    h.packet('u1', 'Mara', T + 21 * MIN);
    expect(h.silent(T + 22 * MIN)).toEqual([]);
    expect(h.silent(T + 21 * MIN + SILENCE_MS)).toHaveLength(1);
  });

  it('counts from the last packet and skips muted members and leavers', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', false, T);
    h.join('u2', 'Brenna', true, T);
    h.join('u3', 'Aldric', false, T);
    h.packet('u1', 'Mara', T + 4 * MIN);
    h.leave('u3');
    expect(h.silent(T + 6 * MIN)).toEqual([]);
    const out = h.silent(T + 4 * MIN + SILENCE_MS);
    expect(out).toHaveLength(1);
    expect(out[0]).toContain('Mara');
    expect(out[0]).toContain('5 min');
  });

  it('ignores a late packet from someone who left, until they join again', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', false, T);
    h.leave('u1');
    h.packet('u1', 'Mara', T + MIN);
    expect(h.speakerLines(T + 2 * MIN)).toEqual([]);
    expect(h.silent(T + 20 * MIN)).toEqual([]);
    h.join('u1', 'Mara', false, T + 30 * MIN);
    h.packet('u1', 'Mara', T + 31 * MIN);
    expect(h.speakerLines(T + 32 * MIN)).toHaveLength(1);
  });

  it('says nothing about silence while the voice connection is down', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', false, T);
    expect(h.silent(T + 20 * MIN, false)).toEqual([]);
    // Back up: the windows start again now, so nobody is reported at once.
    expect(h.silent(T + 20 * MIN, true)).toEqual([]);
    expect(h.silent(T + 20 * MIN + SILENCE_MS - 1, true)).toEqual([]);
    expect(h.silent(T + 20 * MIN + SILENCE_MS, true)).toHaveLength(1);
  });

  it('gives a member who unmutes a fresh window', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', true, T);
    h.setMuted('u1', false, T + 30 * MIN);
    expect(h.silent(T + 31 * MIN)).toEqual([]);
    expect(h.silent(T + 30 * MIN + SILENCE_MS)).toHaveLength(1);
  });
});

describe('RecorderHealth alerts', () => {
  it('rate-limits stream errors per speaker', () => {
    const h = new RecorderHealth();
    expect(h.streamError('u1', 'Mara', 'boom', T)).toContain('Mara');
    expect(h.streamError('u1', 'Mara', 'boom', T + MIN)).toBeNull();
    expect(h.streamError('u2', 'Brenna', 'boom', T + MIN)).toContain('Brenna');
    expect(h.streamError('u1', 'Mara', 'boom', T + REPEAT_ALERT_MS)).toContain('Mara');
  });

  it('reports a rejoin from attempt 3, then every 5 minutes, and resets after a rejoin', () => {
    const h = new RecorderHealth();
    expect(h.rejoinFailed(1, T)).toBeNull();
    expect(h.rejoinFailed(2, T)).toBeNull();
    expect(h.rejoinFailed(3, T)).toContain('attempt 3');
    expect(h.rejoinFailed(4, T + 30_000)).toBeNull();
    expect(h.rejoinFailed(12, T + REPEAT_ALERT_MS)).toContain('attempt 12');
    h.rejoined();
    expect(h.rejoinFailed(3, T + REPEAT_ALERT_MS + 1000)).not.toBeNull();
  });

  it('rate-limits connection errors', () => {
    const h = new RecorderHealth();
    expect(h.connectionError('x', T)).toContain('x');
    expect(h.connectionError('x', T + 1000)).toBeNull();
  });
});

describe('status wording', () => {
  it('lists the last packet age per speaker', () => {
    const h = new RecorderHealth();
    h.join('u1', 'Mara', false, T);
    h.join('u2', 'Brenna', true, T);
    h.packet('u1', 'Mara', T + 10_000);
    expect(h.speakerLines(T + 52_000)).toEqual([
      'Brenna: nothing recorded yet (muted)',
      'Mara: last packet 42 s ago',
    ]);
  });

  it('formats ages', () => {
    expect(formatAge(42_000)).toBe('42 s');
    expect(formatAge(7 * MIN)).toBe('7 min');
    expect(formatAge(125 * MIN)).toBe('2 h 5 min');
  });
});
