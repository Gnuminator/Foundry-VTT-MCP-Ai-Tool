import { describe, expect, it, vi } from 'vitest';
import type { PlayerHandout } from '@gnuminator/shared';

import { runLocalPlayerTool, type LocalPlayerToolDeps } from './player-local-tools.js';

const h = (title: string, revealedAt: string | null, players?: string[]): PlayerHandout => ({
  id: title,
  title,
  html: `<p>Text of ${title}</p>`,
  revealedAt,
  ...(players ? { players } : {}),
});

function deps(over: Partial<LocalPlayerToolDeps> = {}): LocalPlayerToolDeps {
  return {
    handoutsFor: () => [],
    handoutsReady: () => true,
    worldId: () => 'w1',
    characterSheet: () => Promise.resolve({ userId: 'u1', sheets: [{ id: 'a1', name: 'Ebbe' }] }),
    playStats: () => Promise.resolve({}),
    ...over,
  };
}

const body = (r: unknown): Record<string, unknown> =>
  JSON.parse((r as { content: Array<{ text: string }> }).content[0].text);

describe('get-my-handouts', () => {
  const list = [
    h('Letter from Ireena', '2026-11-01T10:00:00Z'),
    h('Recap: session 1', '2026-11-03T10:00:00Z'),
    h('Quest: the old road', '2026-11-02T10:00:00Z'),
    h('Only for u2', '2026-11-04T10:00:00Z', ['u2']),
  ];

  it("lists newest first, labels the kind and never returns another player's handout", async () => {
    const out = body(
      await runLocalPlayerTool(deps({ handoutsFor: () => list }), 'get-my-handouts', {}, 'u1')
    );
    const titles = (out.handouts as Array<{ title: string }>).map(x => x.title);
    expect(titles).toEqual(['Recap: session 1', 'Quest: the old road', 'Letter from Ireena']);
    expect((out.handouts as Array<{ kind: string }>).map(x => x.kind)).toEqual([
      'recap',
      'quest',
      'handout',
    ]);
    expect(JSON.stringify(out)).not.toContain('Only for u2');
    expect((out.handouts as Array<{ text: string }>)[0].text).toContain('Text of Recap');
  });

  it('filters by kind and limit', async () => {
    const out = body(
      await runLocalPlayerTool(
        deps({ handoutsFor: () => list }),
        'get-my-handouts',
        { kind: 'recap', limit: 1 },
        'u1'
      )
    );
    expect((out.handouts as unknown[]).length).toBe(1);
  });

  it('says so when nothing is revealed, and refuses a bad argument', async () => {
    expect(body(await runLocalPlayerTool(deps(), 'get-my-handouts', {}, 'u1')).note).toBe(
      'Nothing revealed to you yet.'
    );
    const bad = (await runLocalPlayerTool(deps(), 'get-my-handouts', { kind: 'gm' }, 'u1')) as {
      isError?: boolean;
    };
    expect(bad.isError).toBe(true);
  });

  it('waits for the first handout read', async () => {
    const r = (await runLocalPlayerTool(
      deps({ handoutsReady: () => false }),
      'get-my-handouts',
      {},
      'u1'
    )) as {
      isError?: boolean;
    };
    expect(r.isError).toBe(true);
  });
});

describe('get-my-play-stats', () => {
  const raw = {
    worldId: 'w1',
    campaign: {
      sessions: 3,
      playMinutes: 120,
      combats: 2,
      rounds: 9,
      pcDowns: 1,
      npcKills: 4,
      spellsCast: 5,
    },
    pcs: [
      {
        uuid: 'Actor.a1',
        damageTaken: 12,
        publicRolls: 3,
        rolls: 50,
        damageDealt: 999,
        sessions: [],
      },
      { uuid: 'Actor.other', damageTaken: 77 },
    ],
  };

  it("returns only the player's own characters and no blind or NPC numbers", async () => {
    const out = body(
      await runLocalPlayerTool(
        deps({ playStats: () => Promise.resolve(raw) }),
        'get-my-play-stats',
        {},
        'u1'
      )
    );
    const pcs = out.pcs as Array<Record<string, unknown>>;
    expect(pcs.map(p => p.name)).toEqual(['Ebbe']);
    expect(pcs[0].damageTaken).toBe(12);
    expect(pcs[0].rolls).toBe(3);
    const text = JSON.stringify(out);
    expect(text).not.toContain('999');
    expect(text).not.toContain('77');
  });

  it('refuses a sheet answer for another user', async () => {
    const r = (await runLocalPlayerTool(
      deps({
        characterSheet: () => Promise.resolve({ userId: 'u2', sheets: [] }),
        playStats: () => Promise.resolve(raw),
      }),
      'get-my-play-stats',
      {},
      'u1'
    )) as { isError?: boolean };
    expect(r.isError).toBe(true);
  });

  it('turns a failing bridge into a friendly error, never a throw', async () => {
    const fail = vi.fn(() => Promise.reject(new Error('boom secret detail')));
    const r = (await runLocalPlayerTool(
      deps({ playStats: fail }),
      'get-my-play-stats',
      {},
      'u1'
    )) as {
      isError?: boolean;
      content: Array<{ text: string }>;
    };
    expect(r.isError).toBe(true);
    expect(r.content[0].text).not.toContain('boom');
  });
});
