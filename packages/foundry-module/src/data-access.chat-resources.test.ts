/**
 * Characterization tests for the chat, resource-tracking, and condition-clearing
 * surface of `FoundryDataAccess`:
 *   - sendChatMessage  (§3B)
 *   - updateCharacterResource  (§3C write)
 *   - clearStaleConditions  (§3D write)
 *
 * These pin the *current* (upstream-derived) behavior so the from-scratch
 * reimplementation planned for Phase 9 can be verified to parity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES } from './constants.js';
import {
  createTestWorld,
  makeEffect,
  makeItem,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// =============================================================================
// sendChatMessage
// =============================================================================

describe('FoundryDataAccess — sendChatMessage', () => {
  it('posts an IC message and returns success with messageId and speaker alias', async () => {
    const actor = world.addActor({ id: 'a1', name: 'Silvera', type: 'character' });
    world.actors.add(actor);

    const result = await da.sendChatMessage({
      message: 'Hello world',
      speakerActorId: 'a1',
      messageType: 'ic',
    });

    expect(result.success).toBe(true);
    expect(result.messageId).toBeTruthy();
    expect(result.speaker).toBe('Silvera');
    expect(result.messageType).toBe('ic');
    expect(result.whisperedTo).toEqual([]);
  });

  it('defaults to IC style when messageType is omitted', async () => {
    const result = await da.sendChatMessage({ message: 'Narration' });

    expect(result.success).toBe(true);
    expect(result.messageType).toBe('ic');
  });

  it('uses current user name as speaker alias when no actor is supplied', async () => {
    const result = await da.sendChatMessage({ message: 'GM speaks' });

    // game.user.name is 'Gamemaster' from createTestWorld
    expect(result.speaker).toBe('Gamemaster');
  });

  it('resolves speaker by actor name when speakerActorName is given', async () => {
    world.addActor({ id: 'a2', name: 'Thorin', type: 'character' });

    const result = await da.sendChatMessage({
      message: 'I am Thorin',
      speakerActorName: 'Thorin',
    });

    expect(result.speaker).toBe('Thorin');
  });

  it('wraps emote content in <em> tags and sets messageType to emote', async () => {
    const result = await da.sendChatMessage({
      message: 'laughs heartily',
      messageType: 'emote',
    });

    expect(result.messageType).toBe('emote');
    // Verify the message stored in game.messages has the wrapped content
    const msgs = Array.from(world.messages.contents);
    const stored = msgs[msgs.length - 1] as any;
    expect(stored.content).toBe('<em>laughs heartily</em>');
  });

  it('whispers to a named user and returns whisperedTo with the original target names', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });

    const result = await da.sendChatMessage({
      message: 'secret message',
      messageType: 'whisper',
      whisperTargets: ['Alice'],
    });

    expect(result.messageType).toBe('whisper');
    expect(result.whisperedTo).toEqual(['Alice']);
    expect(result.warning).toBeUndefined();
  });

  it('falls back to GM when whisper targets do not resolve and attaches a warning', async () => {
    // Add a GM user to game.users so the fallback path finds one
    world.addUser({ id: 'gm2', name: 'Gamemaster', active: true, isGM: true });

    const result = await da.sendChatMessage({
      message: 'secret',
      messageType: 'whisper',
      whisperTargets: ['Ghost'],
    });

    expect(result.success).toBe(true);
    expect(result.warning).toMatch(/No whisper targets resolved/);
    // whisper array was populated with the GM id, so whisperedTo = data.whisperTargets
    expect(result.whisperedTo).toEqual(['Ghost']);
  });

  it('returns empty whisperedTo when no targets resolve and no GM users are registered', async () => {
    // game.users is empty (world.users has no docs); whisper stays empty
    const result = await da.sendChatMessage({
      message: 'secret',
      messageType: 'whisper',
      whisperTargets: ['Ghost'],
    });

    // whisper.length === 0 → whisperedTo is []
    expect(result.whisperedTo).toEqual([]);
    // warning is still set because we entered the fallback branch
    expect(result.warning).toMatch(/No whisper targets resolved/);
  });

  it('throws when message is an empty string', async () => {
    await expect(da.sendChatMessage({ message: '' })).rejects.toThrow('message is required');
  });

  it('is case-insensitive for messageType (OOC vs ooc)', async () => {
    const result = await da.sendChatMessage({ message: 'Out of character', messageType: 'OOC' });
    expect(result.messageType).toBe('ooc');
    const msgs = Array.from(world.messages.contents);
    const stored = msgs[msgs.length - 1] as any;
    // style for OOC = 1
    expect(stored.style).toBe(1);
  });
});

// =============================================================================
// updateCharacterResource
// =============================================================================

describe('FoundryDataAccess — updateCharacterResource', () => {
  it('updates a spell slot value by level keyword and returns the new value', async () => {
    world.addActor({
      id: 'b1',
      name: 'Mira',
      type: 'character',
      system: { spells: { spell3: { value: 3, max: 3 } } },
    });

    const result = await da.updateCharacterResource({
      identifier: 'Mira',
      resourceName: 'spell3',
      newValue: 1,
    });

    expect(result.success).toBe(true);
    expect(result.actorName).toBe('Mira');
    expect(result.resourceName).toBe('spell3');
    expect(result.newValue).toBe(1);
    expect(result.max).toBe(3);

    // Verify the actor's system was actually mutated
    const actor = world.actors.find((a: any) => a.id === 'b1') as any;
    expect(actor.system.spells.spell3.value).toBe(1);
  });

  it('resolves "level 3" as an alias for spell3', async () => {
    world.addActor({
      id: 'b2',
      name: 'Elara',
      type: 'character',
      system: { spells: { spell3: { value: 2, max: 4 } } },
    });

    const result = await da.updateCharacterResource({
      identifier: 'Elara',
      resourceName: 'level 3',
      newValue: 0,
    });

    expect(result.success).toBe(true);
    expect(result.newValue).toBe(0);
  });

  it('updates a class resource by label (case-insensitive match)', async () => {
    world.addActor({
      id: 'b3',
      name: 'Paldin',
      type: 'character',
      system: {
        resources: {
          primary: { label: 'Channel Divinity', value: 2, max: 3 },
        },
      },
    });

    const result = await da.updateCharacterResource({
      identifier: 'Paldin',
      resourceName: 'channel divinity',
      newValue: 1,
    });

    expect(result.success).toBe(true);
    expect(result.newValue).toBe(1);
    expect(result.max).toBe(3);

    const actor = world.actors.find((a: any) => a.id === 'b3') as any;
    expect(actor.system.resources.primary.value).toBe(1);
  });

  it('updates item charges via system.uses.value when uses.spent is absent', async () => {
    const torch = makeItem({
      id: 'item1',
      name: 'Healing Potion',
      type: 'consumable',
      system: { uses: { value: 3, max: 3 } },
    });
    world.addActor({
      id: 'b4',
      name: 'Bront',
      type: 'character',
      items: [torch],
    });

    const result = await da.updateCharacterResource({
      identifier: 'Bront',
      resourceName: 'healing potion',
      newValue: 1,
    });

    expect(result.success).toBe(true);
    expect(result.type).toBe('item');
    expect(result.newValue).toBe(1);
    expect(result.max).toBe(3);
    expect(result.resourceName).toBe('Healing Potion');
  });

  it('updates item charges via system.uses.spent when uses.spent is present (dnd5e v3+)', async () => {
    const wand = makeItem({
      id: 'item2',
      name: 'Wand of Magic',
      type: 'equipment',
      system: { uses: { spent: 0, max: 7 } },
    });
    world.addActor({
      id: 'b5',
      name: 'Zana',
      type: 'character',
      items: [wand],
    });

    const result = await da.updateCharacterResource({
      identifier: 'Zana',
      resourceName: 'Wand of Magic',
      newValue: 5,
    });

    expect(result.success).toBe(true);
    expect(result.newValue).toBe(5);
    // spent = max - newValue = 7 - 5 = 2
    const actor = world.actors.find((a: any) => a.id === 'b5') as any;
    const wandDoc = actor.items.find((i: any) => i.id === 'item2');
    expect(wandDoc.system.uses.spent).toBe(2);
  });

  it('throws CHARACTER_NOT_FOUND for an unknown identifier', async () => {
    await expect(
      da.updateCharacterResource({ identifier: 'Nobody', resourceName: 'spell1', newValue: 0 })
    ).rejects.toThrow(ERROR_MESSAGES.CHARACTER_NOT_FOUND);
  });

  it('throws when newValue exceeds the spell slot max', async () => {
    world.addActor({
      id: 'b6',
      name: 'Ovra',
      type: 'character',
      system: { spells: { spell1: { value: 2, max: 2 } } },
    });

    await expect(
      da.updateCharacterResource({ identifier: 'Ovra', resourceName: 'spell1', newValue: 5 })
    ).rejects.toThrow(/exceeds max/);
  });

  it('throws when resourceName is not found on the actor', async () => {
    world.addActor({ id: 'b7', name: 'Nork', type: 'character', system: {} });

    await expect(
      da.updateCharacterResource({
        identifier: 'Nork',
        resourceName: 'Channel Divinity',
        newValue: 1,
      })
    ).rejects.toThrow(/Resource not found/);
  });

  it('throws when newValue is negative', async () => {
    world.addActor({
      id: 'b8',
      name: 'Reg',
      type: 'character',
      system: { spells: { spell2: { value: 2, max: 2 } } },
    });

    await expect(
      da.updateCharacterResource({ identifier: 'Reg', resourceName: 'spell2', newValue: -1 })
    ).rejects.toThrow(/non-negative/);
  });
});

// =============================================================================
// clearStaleConditions
// =============================================================================

describe('FoundryDataAccess — clearStaleConditions', () => {
  it('removes effects by name when conditionNames is supplied', async () => {
    const poisoned = makeEffect({ id: 'e1', name: 'Poisoned', disabled: false });
    const blessed = makeEffect({ id: 'e2', name: 'Blessed', disabled: false });
    world.addActor({ id: 'c1', name: 'Vera', type: 'character', effects: [poisoned, blessed] });

    const result = await da.clearStaleConditions({
      identifier: 'Vera',
      conditionNames: ['poisoned'],
    });

    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(1);
    expect(result.removed).toEqual(['Poisoned']);

    const actor = world.actors.find((a: any) => a.id === 'c1') as any;
    expect(actor.effects.size).toBe(1);
    expect(actor.effects.find((e: any) => e.id === 'e2')).toBeTruthy();
  });

  it('matches effects by status id when conditionNames is supplied', async () => {
    const eff = makeEffect({
      id: 'e3',
      name: 'Prone',
      statuses: new Set(['prone']),
    });
    world.addActor({ id: 'c2', name: 'Gara', type: 'character', effects: [eff] });

    const result = await da.clearStaleConditions({
      identifier: 'Gara',
      conditionNames: ['prone'],
    });

    expect(result.removedCount).toBe(1);
    expect(result.removed).toEqual(['Prone']);
  });

  it('removes only expired effects (remaining <= 0) when conditionNames is omitted', async () => {
    const expired = makeEffect({ id: 'e4', name: 'Slowed', duration: { remaining: 0 } });
    const active = makeEffect({ id: 'e5', name: 'Haste', duration: { remaining: 3 } });
    const noTimer = makeEffect({ id: 'e6', name: 'Blessed', duration: {} });
    world.addActor({
      id: 'c3',
      name: 'Dorn',
      type: 'character',
      effects: [expired, active, noTimer],
    });

    const result = await da.clearStaleConditions({ identifier: 'Dorn' });

    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(1);
    expect(result.removed).toEqual(['Slowed']);
  });

  it('returns removedCount 0 and empty removed when nothing matches', async () => {
    const eff = makeEffect({ id: 'e7', name: 'Stunned', disabled: false });
    world.addActor({ id: 'c4', name: 'Fenn', type: 'character', effects: [eff] });

    const result = await da.clearStaleConditions({
      identifier: 'Fenn',
      conditionNames: ['paralyzed'],
    });

    expect(result.success).toBe(true);
    expect(result.removedCount).toBe(0);
    expect(result.removed).toEqual([]);
  });

  it('throws CHARACTER_NOT_FOUND for an unknown actor', async () => {
    await expect(da.clearStaleConditions({ identifier: 'NoSuchActor' })).rejects.toThrow(
      ERROR_MESSAGES.CHARACTER_NOT_FOUND
    );
  });

  it('returns actorId and actorName in the result', async () => {
    world.addActor({ id: 'c5', name: 'Kira', type: 'character', effects: [] });

    const result = await da.clearStaleConditions({ identifier: 'Kira' });

    expect(result.actorId).toBe('c5');
    expect(result.actorName).toBe('Kira');
  });
});
