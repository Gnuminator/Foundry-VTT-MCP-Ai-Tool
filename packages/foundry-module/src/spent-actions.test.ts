import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  spentLedger,
  spentSinceOwnTurn,
  useFromMessage,
  type SpentUse,
  type TurnMark,
} from './spent-actions.js';

describe('useFromMessage (card level)', () => {
  const card = (type: string, level?: number): unknown => ({
    id: 'm',
    type: 'usage',
    speaker: { actor: 'a1' },
    system: {
      activation: { type: 'action' },
      item: { name: 'Scroll', type, uuid: 'Actor.a1.Item.i1' },
      ...(level === undefined ? {} : { level }),
    },
  });

  it('reads the level from the card before the item lookup', () => {
    const levelOf = vi.fn(() => 9);
    expect(useFromMessage(card('spell', 3), null, 1, levelOf)?.itemLevel).toBe(3);
    expect(levelOf).not.toHaveBeenCalled();
  });

  it('sees a scroll cast (a consumable with a level) as a spell', () => {
    const u = useFromMessage(card('consumable', 0), null, 1);
    expect(u?.itemType).toBe('spell');
    expect(u?.itemLevel).toBe(0);
    expect(useFromMessage(card('consumable'), null, 1)?.itemType).toBe('consumable');
  });
});

describe('spentLedger hooks', () => {
  const handlers: Record<string, (m: unknown) => void> = {};
  const usage = {
    id: 'm1',
    type: 'usage',
    speaker: { actor: 'a1' },
    system: { activation: { type: 'bonus' }, item: { name: 'Healing Word', type: 'spell' } },
  };
  const fresh = (): typeof spentLedger =>
    new (spentLedger.constructor as new () => typeof spentLedger)();

  beforeEach(() => {
    vi.stubGlobal('Hooks', {
      on: (name: string, fn: (m: unknown) => void) => (handlers[name] = fn),
    });
    vi.stubGlobal('game', { user: { isGM: true }, combat: { id: 'c1' } });
    vi.stubGlobal('fromUuidSync', () => null);
    vi.spyOn(console, 'warn').mockImplementation(() => {});
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    vi.restoreAllMocks();
  });

  it('records a usage card on a GM client, forgets it when deleted, ignores other messages', () => {
    const ledger = fresh();
    ledger.registerHooks();
    handlers.createChatMessage({ type: 'base' });
    expect(ledger.snapshot()).toHaveLength(0);
    handlers.createChatMessage(usage);
    expect(ledger.snapshot()).toHaveLength(1);
    handlers.deleteChatMessage({ id: 'm1' });
    expect(ledger.snapshot()).toHaveLength(0);
  });

  it('records nothing on a player client and swallows a thrown error', () => {
    const ledger = fresh();
    ledger.registerHooks();
    vi.stubGlobal('game', { user: { isGM: false } });
    handlers.createChatMessage(usage);
    expect(ledger.snapshot()).toHaveLength(0);
    vi.stubGlobal('game', {
      get user(): never {
        throw new Error('boom');
      },
    });
    expect(() => handlers.createChatMessage(usage)).not.toThrow();
  });
});

describe('useFromMessage', () => {
  const usage = {
    type: 'usage',
    speaker: { actor: 'a1' },
    system: {
      activation: { type: 'action' },
      item: { name: 'Fire Bolt', type: 'spell', uuid: 'Actor.a1.Item.i1' },
    },
  };

  it('reads a usage message', () => {
    expect(useFromMessage({ ...usage, id: 'm1' }, 'c1', 5, () => 0)).toEqual({
      actorId: 'a1',
      item: 'Fire Bolt',
      itemType: 'spell',
      activation: 'action',
      itemLevel: 0,
      messageId: 'm1',
      combatId: 'c1',
      timestampMs: 5,
    });
  });

  it('falls back to the item uuid for the actor and skips other messages', () => {
    expect(useFromMessage({ ...usage, speaker: {} }, null, 1)?.actorId).toBe('a1');
    expect(useFromMessage({ ...usage, type: 'roll' }, null, 1)).toBeNull();
    expect(useFromMessage({ ...usage, system: { item: usage.system.item } }, null, 1)).toBeNull();
    expect(useFromMessage(null, null, 1)).toBeNull();
  });
});

const use = (actorId: string, t: number, activation = 'action', combatId = 'c1'): SpentUse => ({
  actorId,
  item: `${actorId}-${t}`,
  itemType: 'weapon',
  itemLevel: null,
  messageId: null,
  activation,
  combatId,
  timestampMs: t,
});
const turn = (actorId: string, t: number, combatId = 'c1'): TurnMark => ({
  actorId,
  combatId,
  timestampMs: t,
});

describe('spentSinceOwnTurn', () => {
  it('is untracked without a combat or without turns seen', () => {
    expect(spentSinceOwnTurn('a', null, [], [turn('a', 1)]).tracked).toBe(false);
    expect(spentSinceOwnTurn('a', 'c1', [], []).tracked).toBe(false);
    expect(spentSinceOwnTurn('a', 'c1', [], [turn('a', 1, 'c0')]).tracked).toBe(false);
  });

  it("counts the uses since the actor's own latest turn began", () => {
    const turns = [turn('a', 10), turn('b', 20), turn('a', 30), turn('b', 40)];
    const uses = [use('a', 12), use('a', 35, 'reaction'), use('b', 45), use('a', 5)];
    const r = spentSinceOwnTurn('a', 'c1', uses, turns);
    expect(r.tracked).toBe(true);
    expect(r.sinceOwnTurn.map(u => u.activation)).toEqual(['reaction']);
  });

  it('opens the window with the combat before the actor has had a turn', () => {
    const turns = [turn('b', 10), turn('a', 20)];
    const early = spentSinceOwnTurn('c', 'c1', [use('c', 15, 'reaction')], turns);
    expect(early.sinceOwnTurn).toHaveLength(1);
  });

  it('ignores uses from another combat', () => {
    const r = spentSinceOwnTurn('a', 'c1', [use('a', 50, 'action', 'c0')], [turn('a', 10)]);
    expect(r.sinceOwnTurn).toEqual([]);
  });
});
