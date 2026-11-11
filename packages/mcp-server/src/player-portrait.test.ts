import { describe, expect, it, vi } from 'vitest';

import { handlePlayerPortrait, PortraitError } from './player-portrait.js';

const USER = 'user000000000001';
const ACTOR = 'actor00000000001';
const PNG = Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 1, 2, 3]);

function setup(options: { features?: unknown; upload?: unknown } = {}): {
  foundry: { query: ReturnType<typeof vi.fn> };
  writes: { createPlan: ReturnType<typeof vi.fn>; applyPlan: ReturnType<typeof vi.fn> };
} {
  const foundry = {
    query: vi.fn((method: string) => {
      if (method === 'foundry-mcp-bridge.listGuardedFeatures') {
        return Promise.resolve(
          options.features ?? [
            { id: 'player-portrait', name: 'x', enabled: true, writesAllowed: true },
          ]
        );
      }
      return Promise.resolve(
        options.upload ?? {
          success: true,
          path: 'assets/players/p/portrait-1.png',
          actorName: 'Brenna',
          userName: 'Player',
        }
      );
    }),
  };
  const writes = {
    createPlan: vi.fn(() => Promise.resolve({ planId: 'plan1' })),
    applyPlan: vi.fn(() => Promise.resolve({ changeId: 'chg1' })),
  };
  return { foundry, writes };
}

const run = (s: ReturnType<typeof setup>, params: object): Promise<unknown> =>
  handlePlayerPortrait(s.foundry, s.writes, params);

describe('handlePlayerPortrait', () => {
  it('uploads, then records the portrait change as a guarded write with the old path undoable', async () => {
    const s = setup();
    const r = await run(s, {
      userId: USER,
      actorId: ACTOR,
      target: 'portrait',
      data: PNG.toString('base64'),
    });
    expect(r).toEqual({
      ok: true,
      path: 'assets/players/p/portrait-1.png',
      actorName: 'Brenna',
      changeId: 'chg1',
    });
    const plan = s.writes.createPlan.mock.calls[0][0] as {
      feature: string;
      ops: Array<{ kind: string; uuid: string; changes: Record<string, unknown> }>;
    };
    expect(plan.feature).toBe('player-portrait');
    expect(plan.ops).toEqual([
      {
        kind: 'update',
        uuid: `Actor.${ACTOR}`,
        changes: { img: 'assets/players/p/portrait-1.png' },
      },
    ]);
    expect(s.writes.applyPlan).toHaveBeenCalledWith(
      'plan1',
      { confirm: true },
      'Player (player page)'
    );
  });

  it('sets the prototype token picture too when the player picked it', async () => {
    const s = setup();
    await run(s, { userId: USER, actorId: ACTOR, target: 'both', data: PNG.toString('base64') });
    const plan = s.writes.createPlan.mock.calls[0][0] as { ops: Array<{ changes: object }> };
    expect(plan.ops[0].changes).toEqual({
      img: 'assets/players/p/portrait-1.png',
      'prototypeToken.texture.src': 'assets/players/p/portrait-1.png',
    });
  });

  it('also updates the tokens already placed, in the same plan, when the token picture is chosen', async () => {
    const tok = 'Scene.scene00000000001.Token.tok0000000001';
    const s = setup({
      upload: {
        success: true,
        path: 'assets/players/p/portrait-1.png',
        actorName: 'Brenna',
        userName: 'Player',
        placedTokens: [tok, 'Scene.bad/../x', 42],
      },
    });
    await run(s, { userId: USER, actorId: ACTOR, target: 'both', data: PNG.toString('base64') });
    const plan = s.writes.createPlan.mock.calls[0][0] as {
      summary: string;
      ops: Array<{ uuid: string; changes: object }>;
    };
    expect(plan.ops).toHaveLength(2);
    expect(plan.ops[1]).toEqual({
      kind: 'update',
      uuid: tok,
      changes: { 'texture.src': 'assets/players/p/portrait-1.png' },
    });
    expect(plan.summary).toContain('also on 1 placed token');
  });

  it('leaves placed tokens alone when only the portrait is chosen', async () => {
    const s = setup({
      upload: {
        success: true,
        path: 'assets/players/p/portrait-1.png',
        placedTokens: ['Scene.scene00000000001.Token.tok0000000001'],
      },
    });
    await run(s, {
      userId: USER,
      actorId: ACTOR,
      target: 'portrait',
      data: PNG.toString('base64'),
    });
    const plan = s.writes.createPlan.mock.calls[0][0] as { ops: unknown[] };
    expect(plan.ops).toHaveLength(1);
  });

  it('refuses bytes that are not a picture before anything reaches Foundry', async () => {
    const s = setup();
    await expect(
      run(s, { userId: USER, actorId: ACTOR, data: Buffer.from('<html>').toString('base64') })
    ).rejects.toThrow(PortraitError);
    expect(s.foundry.query).not.toHaveBeenCalled();
  });

  it('refuses when the feature or the write switch is off, without uploading', async () => {
    for (const features of [
      [{ id: 'player-portrait', enabled: false, writesAllowed: true }],
      [{ id: 'player-portrait', enabled: true, writesAllowed: false }],
      [],
    ]) {
      const s = setup({ features });
      await expect(
        run(s, { userId: USER, actorId: ACTOR, data: PNG.toString('base64') })
      ).rejects.toThrow(PortraitError);
      expect(s.foundry.query).toHaveBeenCalledTimes(1);
      expect(s.writes.createPlan).not.toHaveBeenCalled();
    }
  });

  it("passes on the module's refusal (not your character) and records no change", async () => {
    const s = setup({ upload: { success: false, error: 'That is not your character.' } });
    await expect(
      run(s, { userId: USER, actorId: ACTOR, data: PNG.toString('base64') })
    ).rejects.toThrow('That is not your character.');
    expect(s.writes.createPlan).not.toHaveBeenCalled();
  });
});
