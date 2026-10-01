/**
 * Characterization tests for the chat surface of `FoundryDataAccess`:
 *   - sendChatMessage  (§3B)
 *
 * (updateCharacterResource and clearStaleConditions moved to `plan-actor-change`, F5; their
 * plans are tested in live-plan.test.ts.)
 *
 * These pin the *current* (upstream-derived) behavior so the from-scratch
 * reimplementation planned for Phase 9 can be verified to parity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
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

  it('whispers to the sending user when no targets resolve and no GM users are registered', async () => {
    // game.users is empty (world.users has no docs): an empty whisper array would be PUBLIC in
    // Foundry, so the message goes to the current user (M3: it used to be posted publicly).
    const result = await da.sendChatMessage({
      message: 'secret',
      messageType: 'whisper',
      whisperTargets: ['Ghost'],
    });

    const msgs = Array.from(world.messages.contents);
    expect((msgs[msgs.length - 1] as any).whisper).toEqual(['gm']);
    expect(result.whisperedTo).toEqual(['Ghost']);
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
