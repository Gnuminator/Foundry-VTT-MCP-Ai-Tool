import { describe, it, expect, vi } from 'vitest';
import { RepeatGuard, isRepeatGuarded, stableStringify } from './repeat-guard.js';
import { TOOL_HINTS } from './tool-hints.js';

function guardWithClock() {
  let t = 1_000;
  const guard = new RepeatGuard(3000, () => t);
  return { guard, advance: (ms: number) => (t += ms) };
}

describe('isRepeatGuarded', () => {
  it('guards writes and destructive tools, not reads, plans or dice rolls', () => {
    expect(isRepeatGuarded('apply-planned-change')).toBe(true);
    expect(isRepeatGuarded('undo-change')).toBe(true);
    expect(isRepeatGuarded('send-chat-message')).toBe(true);
    expect(isRepeatGuarded('get-party')).toBe(false);
    expect(isRepeatGuarded('plan-actor-change')).toBe(false);
    expect(isRepeatGuarded('roll-npc-check')).toBe(false);
    expect(isRepeatGuarded('not-a-tool')).toBe(false);
    expect(isRepeatGuarded('toString')).toBe(false);
  });

  it('every tool that is not read-only is guarded except the named dice rolls', () => {
    const open = Object.keys(TOOL_HINTS).filter(
      n => TOOL_HINTS[n]?.kind !== 'read' && !isRepeatGuarded(n)
    );
    expect(open.sort()).toEqual([
      'roll-initiative-for-npcs',
      'roll-npc-check',
      'roll-saving-throws',
    ]);
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
    await guard.run('send-chat-message', { message: 'hi', speaker: 'GM' }, '', run);
    await guard.run('send-chat-message', { speaker: 'GM', message: 'hi' }, '', run);
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

  it('never blocks read-only tools or dice rolls', async () => {
    const { guard } = guardWithClock();
    const run = vi.fn().mockResolvedValue('x');
    for (const tool of ['get-party', 'plan-actor-change', 'roll-npc-check']) {
      await guard.run(tool, { a: 1 }, '', run);
      await guard.run(tool, { a: 1 }, '', run);
    }
    expect(run).toHaveBeenCalledTimes(6);
  });
});
