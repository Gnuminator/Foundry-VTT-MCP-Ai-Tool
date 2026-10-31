import { describe, it, expect, vi } from 'vitest';
import { RepeatGuard, isRepeatGuarded, stableStringify } from './repeat-guard.js';

function guardWithClock() {
  let t = 1_000;
  const guard = new RepeatGuard(3000, () => t);
  return { guard, advance: (ms: number) => (t += ms) };
}

describe('isRepeatGuarded', () => {
  it('guards apply, undo and the session marker only', () => {
    for (const t of ['apply-planned-change', 'undo-change', 'mark-play-session']) {
      expect(isRepeatGuarded(t)).toBe(true);
    }
    for (const t of [
      'get-party',
      'plan-actor-change',
      'roll-npc-check',
      'use-npc-activity',
      'advance-combat-turn',
      'use-item',
      'not-a-tool',
      'toString',
    ]) {
      expect(isRepeatGuarded(t)).toBe(false);
    }
  });
});

describe('stableStringify', () => {
  it('ignores key order, also nested', () => {
    expect(stableStringify({ a: 1, b: { c: 2, d: [1, { y: 1, x: 2 }] } })).toBe(
      stableStringify({ b: { d: [1, { x: 2, y: 1 }], c: 2 }, a: 1 })
    );
  });
  it('keeps array order and tells different values apart', () => {
    expect(stableStringify([1, 2])).not.toBe(stableStringify([2, 1]));
    expect(stableStringify(undefined)).toBe('null');
  });
});

describe('RepeatGuard', () => {
  it('replays the first answer for the same apply within the window', async () => {
    const { guard, advance } = guardWithClock();
    const run = vi.fn().mockResolvedValue('applied');
    expect(await guard.run('apply-planned-change', { planId: 'p1' }, '', run)).toBe('applied');
    advance(1500);
    expect(await guard.run('apply-planned-change', { planId: 'p1' }, '', run)).toBe('applied');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('shares a call that is still running (a true double click)', async () => {
    const { guard } = guardWithClock();
    let release!: (v: string) => void;
    const run = vi.fn(() => new Promise<string>(r => (release = r)));
    const a = guard.run('apply-planned-change', { planId: 'p1' }, 'gm', run);
    const b = guard.run('apply-planned-change', { planId: 'p1' }, 'gm', run);
    release('done');
    expect(await Promise.all([a, b])).toEqual(['done', 'done']);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('runs again after the window', async () => {
    const { guard, advance } = guardWithClock();
    const run = vi.fn().mockResolvedValue('x');
    await guard.run('undo-change', { changeId: 'c1' }, '', run);
    advance(3001);
    await guard.run('undo-change', { changeId: 'c1' }, '', run);
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('treats other plan ids, other changes and other requesters as different calls', async () => {
    const { guard } = guardWithClock();
    const run = vi.fn().mockResolvedValue('x');
    await guard.run('apply-planned-change', { planId: 'p1' }, '', run);
    await guard.run('apply-planned-change', { planId: 'p2' }, '', run);
    await guard.run('apply-planned-change', { planId: 'p1' }, 'Danni', run);
    await guard.run('undo-change', { changeId: 'p1' }, '', run);
    expect(run).toHaveBeenCalledTimes(4);
  });

  it('treats the same args in another key order as the same call', async () => {
    const { guard } = guardWithClock();
    const run = vi.fn().mockResolvedValue('x');
    await guard.run('apply-planned-change', { planId: 'p', confirm: true }, '', run);
    await guard.run('apply-planned-change', { confirm: true, planId: 'p' }, '', run);
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('does not remember a failure: the retry runs', async () => {
    const { guard } = guardWithClock();
    const run = vi.fn().mockRejectedValueOnce(new Error('boom')).mockResolvedValue('ok');
    await expect(guard.run('apply-planned-change', { planId: 'p1' }, '', run)).rejects.toThrow(
      'boom'
    );
    expect(await guard.run('apply-planned-change', { planId: 'p1' }, '', run)).toBe('ok');
    expect(run).toHaveBeenCalledTimes(2);
  });

  it('never blocks reads, plans, direct writes or dice rolls (a Multiattack is two identical calls)', async () => {
    const { guard } = guardWithClock();
    const run = vi.fn().mockResolvedValue('x');
    const calls = ['get-party', 'plan-actor-change', 'roll-npc-check', 'use-npc-activity'];
    await Promise.all(
      calls.flatMap(tool => [
        guard.run(tool, { a: 1 }, '', run),
        guard.run(tool, { a: 1 }, '', run),
      ])
    );
    expect(run).toHaveBeenCalledTimes(8);
  });

  it('gives a joined caller the same rejection', async () => {
    const { guard } = guardWithClock();
    let fail!: (e: Error) => void;
    const run = vi.fn(() => new Promise<string>((_r, rej) => (fail = rej)));
    const a = guard.run('undo-change', { changeId: 'c1' }, '', run);
    const b = guard.run('undo-change', { changeId: 'c1' }, '', run);
    fail(new Error('boom'));
    await expect(a).rejects.toThrow('boom');
    await expect(b).rejects.toThrow('boom');
    expect(run).toHaveBeenCalledTimes(1);
  });

  it('undo X, undo U (redo), undo X inside the window runs the third one', async () => {
    const { guard } = guardWithClock();
    const run = vi.fn().mockResolvedValue('x');
    await guard.run('undo-change', { changeId: 'X' }, '', run);
    await guard.run('undo-change', { changeId: 'U' }, '', run);
    await guard.run('undo-change', { changeId: 'X' }, '', run);
    expect(run).toHaveBeenCalledTimes(3);
  });
});
