import { describe, expect, it, vi } from 'vitest';

import { combatIdsFor, readFoundryTargets, targetValues, targetsNote } from './foundryTargets';

// The pure helpers under test never call the API; the real module reads `location` on import.
vi.mock('./api', () => ({ callTool: vi.fn() }));

const tok = (n: number): { tokenId: string; name: string; actorId: string } => ({
  tokenId: `t${n}`,
  name: `Bandit ${n}`,
  actorId: `a${n}`,
});

describe('readFoundryTargets', () => {
  it('prefers targets over the selection', () => {
    const r = readFoundryTargets({ targets: [tok(1)], selected: [tok(2), tok(3)] });
    expect(r.source).toBe('targeted');
    expect(r.tokens).toHaveLength(1);
  });

  it('falls back to the selection, then to nothing', () => {
    expect(readFoundryTargets({ targets: [], selected: [tok(2)] }).source).toBe('selected');
    expect(readFoundryTargets({ targets: [], selected: [] }).source).toBe('none');
    expect(readFoundryTargets(null).source).toBe('none');
    expect(readFoundryTargets({ targets: [{ name: 'no id' }] }).source).toBe('none');
  });
});

describe('targetValues', () => {
  const tokens = [tok(1), { tokenId: 't2', name: 'Bandit 2', actorId: null }];
  it('gives names for a name field', () => {
    expect(targetValues(tokens, 'name', ['token'])).toEqual(['Bandit 1', 'Bandit 2']);
  });
  it('gives token ids when tokens are offered, actor ids for an actor-only field', () => {
    expect(targetValues(tokens, 'id', ['token', 'actor'])).toEqual(['t1', 't2']);
    expect(targetValues(tokens, 'id', ['actor'])).toEqual(['a1']);
  });
});

describe('combatIdsFor', () => {
  it("picks the fireball's combatants and leaves the rest (Danni's case)", () => {
    const combatants = Array.from({ length: 7 }, (_, i) => ({
      id: `c${i + 1}`,
      tokenId: `t${i + 1}`,
    }));
    const inside = [1, 2, 3].map(tok);
    expect(combatIdsFor(combatants, inside)).toEqual(['c1', 'c2', 'c3']);
    expect(combatIdsFor([{ id: 'x', tokenId: null }], inside)).toEqual([]);
  });
});

describe('targetsNote', () => {
  it('names the source and the tokens', () => {
    expect(targetsNote({ tokens: [tok(1)], source: 'targeted' })).toBe(
      '1 targeted in Foundry: Bandit 1'
    );
    expect(targetsNote({ tokens: [], source: 'none' })).toMatch(/Nothing/);
  });
});
