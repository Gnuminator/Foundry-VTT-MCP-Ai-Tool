import { mkdirSync, mkdtempSync, rmSync, utimesSync, writeFileSync } from 'node:fs';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import { afterEach, describe, expect, it } from 'vitest';

import { UnpulledNotifier, findUnpulled, type UnpulledSession } from './unpulled-notify.js';

const HOUR = 3_600_000;
const T0 = Date.parse('2026-11-22T12:00:00Z');

function harness(sendOk = true): {
  notifier: UnpulledNotifier;
  sent: string[];
  advance: (ms: number) => void;
  setSend: (ok: boolean) => void;
} {
  let now = T0;
  let ok = sendOk;
  const sent: string[] = [];
  const notifier = new UnpulledNotifier({
    now: (): number => now,
    send: (text): Promise<boolean> => {
      if (ok) sent.push(text);
      return Promise.resolve(ok);
    },
  });
  return {
    notifier,
    sent,
    advance: (ms): void => {
      now += ms;
    },
    setSend: (v): void => {
      ok = v;
    },
  };
}

const session = (name: string, ageH: number): UnpulledSession => ({
  name,
  convertedAtMs: T0 - ageH * HOUR,
});

describe('UnpulledNotifier', () => {
  it('says nothing before 24 hours', async () => {
    const h = harness();
    expect(await h.notifier.check([session('a', 23)])).toBeNull();
    expect(h.sent).toHaveLength(0);
  });

  it('sends one DM after 24 hours, then a reminder every 24 hours', async () => {
    const h = harness();
    expect(await h.notifier.check([session('a', 25)])).toBe('notice');
    h.advance(15 * 60_000);
    expect(await h.notifier.check([session('a', 25.25)])).toBeNull();
    h.advance(24 * HOUR);
    expect(await h.notifier.check([session('a', 49.25)])).toBe('reminder');
    expect(h.sent).toHaveLength(2);
    expect(h.sent[1]).toContain('reminder');
  });

  it('stops once the session is pulled and does not repeat for a pulled one', async () => {
    const h = harness();
    await h.notifier.check([session('a', 30)]);
    h.advance(48 * HOUR);
    expect(await h.notifier.check([])).toBeNull();
    expect(h.sent).toHaveLength(1);
  });

  it('records nothing when the DM fails, so the next check tries again', async () => {
    const h = harness(false);
    expect(await h.notifier.check([session('a', 30)])).toBeNull();
    h.setSend(true);
    expect(await h.notifier.check([session('a', 30)])).toBe('notice');
  });

  it('lists several sessions in one DM and a new one gets its own notice', async () => {
    const h = harness();
    await h.notifier.check([session('a', 30), session('b', 26)]);
    expect(h.sent[0]).toContain('- a');
    expect(h.sent[0]).toContain('- b');
    h.advance(HOUR);
    expect(await h.notifier.check([session('a', 31), session('b', 27), session('c', 24)])).toBe(
      'notice'
    );
    expect(h.sent[1]).toContain('- c');
    expect(h.sent[1]).toContain('- a');
  });

  it('keeps a long backlog under the Discord 2000 character limit', async () => {
    const h = harness();
    const many = Array.from({ length: 40 }, (_, i) =>
      session(`2026-11-0${i % 9}-session-${i}`, 30)
    );
    await h.notifier.check(many);
    expect(h.sent[0].length).toBeLessThan(2000);
    expect(h.sent[0]).toContain('and 32 more');
  });
});

describe('findUnpulled', () => {
  const dirs: string[] = [];
  afterEach(() => {
    for (const d of dirs.splice(0)) rmSync(d, { recursive: true, force: true });
  });

  it('finds converted sessions without .pulled and skips the rest', () => {
    const root = mkdtempSync(join(tmpdir(), 'unpulled-'));
    dirs.push(root);
    const make = (name: string, opts: { report?: boolean; pulled?: boolean }): void => {
      mkdirSync(join(root, name, 'raw'), { recursive: true });
      if (opts.report) writeFileSync(join(root, name, 'raw', 'convert-report.json'), '{}');
      if (opts.pulled) writeFileSync(join(root, name, '.pulled'), '');
    };
    make('open', { report: true });
    make('done', { report: true, pulled: true });
    make('raw-only', {});
    writeFileSync(join(root, 'stray.txt'), 'x');
    const when = new Date(T0 - 5 * HOUR);
    utimesSync(join(root, 'open', 'raw', 'convert-report.json'), when, when);
    const found = findUnpulled(root);
    expect(found.map(s => s.name)).toEqual(['open']);
    expect(found[0].convertedAtMs).toBeCloseTo(T0 - 5 * HOUR, -3);
    expect(findUnpulled(join(root, 'missing'))).toEqual([]);
  });
});
