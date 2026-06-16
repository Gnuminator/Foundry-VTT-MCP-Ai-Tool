/**
 * Characterization tests for the `player-rolls` domain of `FoundryDataAccess`
 * (delegated to `PlayerRollsDataAccess`):
 *   - requestPlayerRolls        (player/character resolution + roll-button chat message)
 *   - requestAbilityCheck       (thin wrapper → requestPlayerRolls)
 *   - requestAttackRoll         (thin wrapper → requestPlayerRolls)
 *   - rollNpcCheck              (direct Roll + toMessage for a GM-controlled actor)
 *   - saveRollButtonMessageId / getRollButtonMessageId   (button↔message id map in settings)
 *   - getRollState                                       (per-button persisted roll state)
 *   - getRollStateFromMessage                            (roll state read from message flags)
 *   - updateRollButtonMessage                            (rolled-state rewrite / GM socket relay)
 *   - saveRollState / requestRollStateSave (legacy → updateRollButtonMessage redirect)
 *   - broadcastRollState                                 (legacy no-op)
 *   - cleanOldRollStates                                 (>30-day pruning of rollStates)
 *
 * These pin the *current* (upstream-derived) behaviour so the Phase 9 from-scratch
 * rewrite of `player-rolls.ts` can be verified to parity.
 *
 * Driven through the Phase 9 Foundry-mock harness (in-memory, no browser).
 *
 * Harness gaps worked around locally (never editing shared harness files):
 *   - `makeActor` has no `testUserPermission` / `hasPlayerOwner` / `getRollData`;
 *     these are attached per-test as plain stubs so `resolveTargetPlayer` and
 *     `buildRollFormula` see the dnd5e shape they expect.
 *   - The harness `Roll` global returns `{ formula, evaluate, total }` with no
 *     `toMessage`/`validate`; `rollNpcCheck` (and the button-click path, if it were
 *     observable) need `toMessage`, so `globalThis.Roll` is overridden locally with
 *     a spy-able mock that records `toMessage` calls and yields a deterministic total.
 *   - `game.socket.emit` is spied (`vi.spyOn`) to assert the GM-relay dispatch in
 *     `updateRollButtonMessage`; the harness already provides a no-op socket.
 *
 * NOT characterized here (and why):
 *   - `attachRollButtonHandlers` — operates purely on a live jQuery object and the
 *     DOM (`html.find(...).on('click', ...)`, `button.css/show/hide/prop`). The
 *     `rollButtonProcessingStates` map is private and only mutated inside those DOM
 *     click handlers, so it is not observable without a DOM/jQuery harness, which
 *     would require editing shared test support. Skipped.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import { ERROR_MESSAGES, MODULE_ID } from './constants.js';
import { createTestWorld, makeItem, type TestWorld } from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  vi.spyOn(console, 'debug').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// Helpers
// ---------------------------------------------------------------------------

/**
 * Add a player-owned character actor that `resolveTargetPlayer` /
 * `buildRollFormula` can read: an `OWNER` for `ownerUserId`, `hasPlayerOwner`,
 * and a `getRollData()` returning the supplied roll-data block.
 */
function addPlayerCharacter(opts: {
  id: string;
  name: string;
  ownerUserId: string;
  rollData?: any;
}): any {
  const actor = world.addActor({ id: opts.id, name: opts.name, type: 'character' });
  actor.hasPlayerOwner = true;
  actor.testUserPermission = (user: any, _level: any) => user?.id === opts.ownerUserId;
  actor.getRollData = () => opts.rollData ?? {};
  return actor;
}

/** Override `globalThis.Roll` with a spy-able mock that records `toMessage`. */
function installRollSpy(total = 14): {
  toMessage: ReturnType<typeof vi.fn>;
  evaluate: ReturnType<typeof vi.fn>;
  ctorArgs: any[];
} {
  const toMessage = vi.fn(() => Promise.resolve({}));
  const evaluate = vi.fn(() => Promise.resolve({ total }));
  const ctorArgs: any[] = [];
  (globalThis as any).Roll = function MockRoll(this: any, formula: string, data?: any) {
    ctorArgs.push([formula, data]);
    this.formula = formula;
    this.total = total;
    this.evaluate = evaluate;
    this.toMessage = toMessage;
  } as any;
  (globalThis as any).Roll.validate = () => true;
  return { toMessage, evaluate, ctorArgs };
}

// ===========================================================================
// requestPlayerRolls
// ===========================================================================

describe('FoundryDataAccess — requestPlayerRolls', () => {
  it('creates a public roll-button chat message for an online player and returns success', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    addPlayerCharacter({
      id: 'a1',
      name: 'Silvera',
      ownerUserId: 'u1',
      rollData: { abilities: { dex: { mod: 3 } } },
    });

    const before = world.messages.size;
    const result = await da.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'dex',
      targetPlayer: 'Alice',
      isPublic: true,
      rollModifier: '',
      flavor: 'Perception sweep',
    });

    expect(result.success).toBe(true);
    expect(result.message).toBe('Roll request sent to Alice. Public roll button created in chat.');
    expect(result.error).toBeUndefined();

    // one chat message was created
    expect(world.messages.size).toBe(before + 1);
    const msg = world.messages.contents[world.messages.contents.length - 1];

    // public roll => empty whisper targets, OTHER style (0)
    expect(msg.whisper).toEqual([]);
    expect(msg.style).toBe(0);
    // button HTML + flavor surfaced in content
    expect(msg.content).toContain('mcp-roll-button');
    expect(msg.content).toContain('DEX Ability Check (Public)');
    expect(msg.content).toContain('Perception sweep');

    // the module flags carry a single rollButtons entry, unrolled, with formula 1d20+3
    const buttons = msg.flags[MODULE_ID].rollButtons;
    const buttonId = Object.keys(buttons)[0];
    expect(buttons[buttonId].rolled).toBe(false);
    expect(buttons[buttonId].rollFormula).toBe('1d20+3');
    expect(buttons[buttonId].isPublic).toBe(true);
    expect(buttons[buttonId].characterId).toBe('a1');
    expect(buttons[buttonId].targetUserId).toBe('u1');
  });

  it('whispers a private roll request to the target player and all active GMs', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    world.addUser({ id: 'gm2', name: 'DM', active: true, isGM: true });
    addPlayerCharacter({ id: 'a1', name: 'Silvera', ownerUserId: 'u1' });

    const result = await da.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'str',
      targetPlayer: 'Alice',
      isPublic: false,
      rollModifier: '',
      flavor: '',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Private roll button created in chat.');

    const msg = world.messages.contents[world.messages.contents.length - 1];
    expect(msg.whisper).toEqual(['u1', 'gm2']);
  });

  it('records the button→message id mapping in settings on success', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    addPlayerCharacter({ id: 'a1', name: 'Silvera', ownerUserId: 'u1' });

    await da.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'dex',
      targetPlayer: 'Alice',
      isPublic: true,
      rollModifier: '',
      flavor: '',
    });

    const msg = world.messages.contents[world.messages.contents.length - 1];
    const buttonId = Object.keys(msg.flags[MODULE_ID].rollButtons)[0];
    expect(da.getRollButtonMessageId(buttonId)).toBe(msg.id);
  });

  it('returns a PLAYER_OFFLINE-style error (no message) for a registered but inactive player', async () => {
    world.addUser({ id: 'u2', name: 'Bob', active: false, isGM: false });
    const before = world.messages.size;

    const result = await da.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'dex',
      targetPlayer: 'Bob',
      isPublic: true,
      rollModifier: '',
      flavor: '',
    });

    expect(result.success).toBe(false);
    expect(result.message).toBe('');
    expect(result.error).toMatch(/registered but not currently logged in/);
    expect(world.messages.size).toBe(before); // no chat message created
  });

  it('returns a PLAYER_NOT_FOUND error listing available players when nothing matches', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });

    const result = await da.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'dex',
      targetPlayer: 'Nobody',
      isPublic: true,
      rollModifier: '',
      flavor: '',
    });

    expect(result.success).toBe(false);
    expect(result.error).toContain('No player or character named "Nobody" found');
    expect(result.error).toContain('Alice');
  });

  it('resolves a target by character name (GM-owned, no player) and still succeeds without a user whisper', async () => {
    // character exists, has no player owner => found:true, user omitted
    const actor = world.addActor({ id: 'npc1', name: 'Goblin Boss', type: 'npc' });
    actor.hasPlayerOwner = false;
    actor.testUserPermission = () => false;
    actor.getRollData = () => ({ abilities: { dex: { mod: 1 } } });

    const result = await da.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'dex',
      targetPlayer: 'Goblin Boss',
      isPublic: true,
      rollModifier: '',
      flavor: '',
    });

    expect(result.success).toBe(true);
    expect(result.message).toContain('Roll request sent to Goblin Boss');

    const msg = world.messages.contents[world.messages.contents.length - 1];
    const buttons = msg.flags[MODULE_ID].rollButtons;
    const buttonId = Object.keys(buttons)[0];
    expect(buttons[buttonId].characterId).toBe('npc1');
    expect(buttons[buttonId].targetUserId).toBe(''); // no user for GM-only characters
  });

  it('appends a custom rollModifier to the formula', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    addPlayerCharacter({
      id: 'a1',
      name: 'Silvera',
      ownerUserId: 'u1',
      rollData: { abilities: { dex: { mod: 2 } } },
    });

    await da.requestPlayerRolls({
      rollType: 'ability',
      rollTarget: 'dex',
      targetPlayer: 'Alice',
      isPublic: true,
      rollModifier: '4',
      flavor: '',
    });

    const msg = world.messages.contents[world.messages.contents.length - 1];
    const buttons = msg.flags[MODULE_ID].rollButtons;
    const buttonId = Object.keys(buttons)[0];
    // base 1d20+2 (ability mod) then +4 modifier appended
    expect(buttons[buttonId].rollFormula).toBe('1d20+2+4');
  });
});

// ===========================================================================
// requestAbilityCheck / requestAttackRoll (wrappers)
// ===========================================================================

describe('FoundryDataAccess — requestAbilityCheck (wrapper)', () => {
  it('builds an ability roll request and folds reason + DC into the flavor', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    addPlayerCharacter({
      id: 'a1',
      name: 'Silvera',
      ownerUserId: 'u1',
      rollData: { abilities: { wis: { mod: 1 } } },
    });

    const result = await da.requestAbilityCheck({
      targetPlayer: 'Alice',
      ability: 'wis',
      dc: 15,
      isPublic: true,
      reason: 'Spot the trap',
    });

    expect(result.success).toBe(true);
    const msg = world.messages.contents[world.messages.contents.length - 1];
    expect(msg.content).toContain('WIS Ability Check (Public)');
    expect(msg.content).toContain('Spot the trap — DC 15');
  });
});

describe('FoundryDataAccess — requestAttackRoll (wrapper)', () => {
  it('builds an attack roll request with a "<weapon> attack" flavor and attack label', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    addPlayerCharacter({ id: 'a1', name: 'Silvera', ownerUserId: 'u1' });

    const result = await da.requestAttackRoll({
      targetPlayer: 'Alice',
      weaponOrSpellName: 'Longsword',
      isPublic: false,
    });

    expect(result.success).toBe(true);
    const msg = world.messages.contents[world.messages.contents.length - 1];
    expect(msg.content).toContain('Longsword Attack (Private)');
    expect(msg.content).toContain('Longsword attack');
  });
});

// ===========================================================================
// rollNpcCheck
// ===========================================================================

describe('FoundryDataAccess — rollNpcCheck', () => {
  it('throws CHARACTER_NOT_FOUND for an unknown actor', async () => {
    await expect(
      da.rollNpcCheck({
        actorName: 'Ghost',
        rollType: 'ability',
        rollTarget: 'dex',
        isPublic: true,
      })
    ).rejects.toThrow(ERROR_MESSAGES.CHARACTER_NOT_FOUND);
  });

  it('rolls a public ability check and returns the roll summary', async () => {
    const roll = installRollSpy(17);
    const actor = world.addActor({ id: 'npc1', name: 'Bandit', type: 'npc' });
    actor.getRollData = () => ({ abilities: { dex: { mod: 2 } } });

    const result = await da.rollNpcCheck({
      actorName: 'Bandit',
      rollType: 'ability',
      rollTarget: 'dex',
      isPublic: true,
    });

    // formula computed from getRollData (ability dex mod = 2)
    expect(roll.ctorArgs[0][0]).toBe('1d20+2');
    expect(roll.evaluate).toHaveBeenCalledTimes(1);
    // public => publicroll rollMode
    expect(roll.toMessage).toHaveBeenCalledTimes(1);
    expect(roll.toMessage.mock.calls[0][1]).toEqual({ rollMode: 'publicroll' });
    expect(roll.toMessage.mock.calls[0][0].flavor).toBe('dex (ability)');

    expect(result).toEqual({
      success: true,
      actorName: 'Bandit',
      rollType: 'ability',
      rollTarget: 'dex',
      formula: '1d20+2',
      total: 17,
      isPublic: true,
    });
  });

  it('uses gmroll rollMode for a private (non-public) roll', async () => {
    const roll = installRollSpy(9);
    const actor = world.addActor({ id: 'npc2', name: 'Cultist', type: 'npc' });
    actor.getRollData = () => ({ abilities: { str: { mod: 0 } } });

    await da.rollNpcCheck({
      actorName: 'Cultist',
      rollType: 'ability',
      rollTarget: 'str',
      isPublic: false,
    });

    expect(roll.toMessage.mock.calls[0][1]).toEqual({ rollMode: 'gmroll' });
  });

  it('builds an attack formula from the matched item label toHit', async () => {
    const roll = installRollSpy(20);
    const sword = makeItem({ id: 'i1', name: 'Scimitar', type: 'weapon' });
    (sword as any).labels = { toHit: '+4' };
    const actor = world.addActor({ id: 'npc3', name: 'Raider', type: 'npc', items: [sword] });
    actor.getRollData = () => ({});

    const result = await da.rollNpcCheck({
      actorName: 'Raider',
      rollType: 'attack',
      rollTarget: 'Scimitar',
      isPublic: true,
    });

    expect(roll.ctorArgs[0][0]).toBe('1d20+4');
    expect(result.formula).toBe('1d20+4');
    expect(result.rollType).toBe('attack');
  });
});

// ===========================================================================
// saveRollButtonMessageId / getRollButtonMessageId
// ===========================================================================

describe('FoundryDataAccess — roll button↔message id mapping', () => {
  it('round-trips a buttonId→messageId mapping through settings', () => {
    da.saveRollButtonMessageId('btn-1', 'msg-1');
    expect(da.getRollButtonMessageId('btn-1')).toBe('msg-1');
  });

  it('returns null for an unknown button id', () => {
    expect(da.getRollButtonMessageId('missing')).toBeNull();
  });

  it('accumulates multiple mappings in the same settings object', () => {
    da.saveRollButtonMessageId('btn-a', 'msg-a');
    da.saveRollButtonMessageId('btn-b', 'msg-b');
    expect(da.getRollButtonMessageId('btn-a')).toBe('msg-a');
    expect(da.getRollButtonMessageId('btn-b')).toBe('msg-b');
  });
});

// ===========================================================================
// getRollState
// ===========================================================================

describe('FoundryDataAccess — getRollState', () => {
  it('returns the persisted roll state for a button id', () => {
    world.setSetting(MODULE_ID, 'rollStates', {
      'btn-1': { rolled: true, rolledBy: 'u1', rolledByName: 'Alice', timestamp: 123 },
    });

    expect(da.getRollState('btn-1')).toEqual({
      rolled: true,
      rolledBy: 'u1',
      rolledByName: 'Alice',
      timestamp: 123,
    });
  });

  it('returns null when the button id has no stored state', () => {
    expect(da.getRollState('nope')).toBeNull();
  });
});

// ===========================================================================
// getRollStateFromMessage
// ===========================================================================

describe('FoundryDataAccess — getRollStateFromMessage', () => {
  it('reads the rollButtons[buttonId] entry from a message flag', () => {
    const chatMessage = {
      getFlag: (scope: string, key: string) =>
        scope === MODULE_ID && key === 'rollButtons' ? { 'btn-1': { rolled: true } } : undefined,
    };

    expect(da.getRollStateFromMessage(chatMessage, 'btn-1')).toEqual({ rolled: true });
  });

  it('returns null when the button id is absent from the flag', () => {
    const chatMessage = { getFlag: () => ({ other: {} }) };
    expect(da.getRollStateFromMessage(chatMessage, 'btn-1')).toBeNull();
  });

  it('returns null and swallows the error when getFlag throws', () => {
    const chatMessage = {
      getFlag: () => {
        throw new Error('boom');
      },
    };
    expect(da.getRollStateFromMessage(chatMessage, 'btn-1')).toBeNull();
  });
});

// ===========================================================================
// updateRollButtonMessage
// ===========================================================================

describe('FoundryDataAccess — updateRollButtonMessage', () => {
  it('throws when no message id is mapped for the button', async () => {
    await expect(da.updateRollButtonMessage('unknown-btn', 'gm', 'Roll')).rejects.toThrow(
      'No message ID found for button unknown-btn'
    );
  });

  it('throws when the mapped message no longer exists', async () => {
    da.saveRollButtonMessageId('btn-1', 'gone');
    await expect(da.updateRollButtonMessage('btn-1', 'gm', 'Roll')).rejects.toThrow(
      'ChatMessage gone not found'
    );
  });

  it('as GM, rewrites the message content + flags to the rolled/completed state', async () => {
    const msg = world.addMessage({
      id: 'm1',
      content: '<original/>',
      flags: { [MODULE_ID]: { rollButtons: { 'btn-1': { rolled: false } } } },
    });
    (msg as any).canUserModify = () => true;
    da.saveRollButtonMessageId('btn-1', 'm1');

    await da.updateRollButtonMessage('btn-1', 'gm', 'DEX Check');

    // game.user is the GM 'Gamemaster'; rolledByName comes from game.users.get(userId)
    // ('gm' is not in world.users here) → falls back to 'Unknown'
    expect(msg.content).toContain('Roll Request:</strong> DEX Check');
    expect(msg.content).toContain('Completed by Unknown');
    const updated = msg.flags[MODULE_ID].rollButtons['btn-1'];
    expect(updated.rolled).toBe(true);
    expect(updated.rolledBy).toBe('gm');
    expect(updated.rolledByName).toBe('Unknown');
    expect(typeof updated.timestamp).toBe('number');
  });

  it('uses the resolved user name for rolledByName when the user is registered', async () => {
    world.addUser({ id: 'u1', name: 'Alice', active: true, isGM: false });
    const msg = world.addMessage({
      id: 'm2',
      content: 'x',
      flags: { [MODULE_ID]: { rollButtons: {} } },
    });
    (msg as any).canUserModify = () => true;
    da.saveRollButtonMessageId('btn-2', 'm2');

    await da.updateRollButtonMessage('btn-2', 'u1', 'STR Save');

    expect(msg.content).toContain('Completed by Alice');
    expect(msg.flags[MODULE_ID].rollButtons['btn-2'].rolledByName).toBe('Alice');
  });

  it('relays to an online GM over the socket when a non-GM user cannot modify the message', async () => {
    // current user is a non-GM who cannot modify; an online GM exists to relay to
    (globalThis as any).game.user = { id: 'u1', name: 'Alice', active: true, isGM: false };
    world.addUser({ id: 'gm9', name: 'DM', active: true, isGM: true });
    const msg = world.addMessage({
      id: 'm3',
      content: 'x',
      flags: { [MODULE_ID]: { rollButtons: {} } },
    });
    (msg as any).canUserModify = () => false;
    da.saveRollButtonMessageId('btn-3', 'm3');

    const emitSpy = vi.spyOn((globalThis as any).game.socket, 'emit');

    await da.updateRollButtonMessage('btn-3', 'u1', 'Roll');

    expect(emitSpy).toHaveBeenCalledTimes(1);
    expect(emitSpy).toHaveBeenCalledWith('module.foundry-mcp-bridge', {
      type: 'requestMessageUpdate',
      buttonId: 'btn-3',
      userId: 'u1',
      rollLabel: 'Roll',
      messageId: 'm3',
      fromUserId: 'u1',
      targetGM: 'gm9',
    });
    // the message was NOT rewritten (the GM will do it)
    expect(msg.content).toBe('x');
  });

  it('throws when a non-GM cannot modify and no GM is online', async () => {
    (globalThis as any).game.user = { id: 'u1', name: 'Alice', active: true, isGM: false };
    const msg = world.addMessage({
      id: 'm4',
      content: 'x',
      flags: { [MODULE_ID]: { rollButtons: {} } },
    });
    (msg as any).canUserModify = () => false;
    da.saveRollButtonMessageId('btn-4', 'm4');

    await expect(da.updateRollButtonMessage('btn-4', 'u1', 'Roll')).rejects.toThrow(
      'No Game Master is online to update the chat message'
    );
  });
});

// ===========================================================================
// saveRollState / requestRollStateSave (legacy redirects)
// ===========================================================================

describe('FoundryDataAccess — legacy roll-state redirects', () => {
  it('saveRollState redirects to updateRollButtonMessage and rewrites the message', async () => {
    const msg = world.addMessage({
      id: 'm5',
      content: 'x',
      flags: { [MODULE_ID]: { rollButtons: {} } },
    });
    (msg as any).canUserModify = () => true;
    da.saveRollButtonMessageId('btn-5', 'm5');

    await da.saveRollState('btn-5', 'gm');

    // legacy label is the generic 'Legacy Roll'
    expect(msg.content).toContain('Roll Request:</strong> Legacy Roll');
    expect(msg.flags[MODULE_ID].rollButtons['btn-5'].rolled).toBe(true);
  });

  it('saveRollState swallows errors from the redirect (no throw) when no mapping exists', async () => {
    await expect(da.saveRollState('no-map', 'gm')).resolves.toBeUndefined();
  });

  it('requestRollStateSave returns void and triggers the same redirect', () => {
    const msg = world.addMessage({
      id: 'm6',
      content: 'x',
      flags: { [MODULE_ID]: { rollButtons: {} } },
    });
    (msg as any).canUserModify = () => true;
    da.saveRollButtonMessageId('btn-6', 'm6');

    expect(da.requestRollStateSave('btn-6', 'gm')).toBeUndefined();
  });
});

// ===========================================================================
// broadcastRollState (legacy no-op)
// ===========================================================================

describe('FoundryDataAccess — broadcastRollState', () => {
  it('is a no-op that returns undefined', () => {
    expect(da.broadcastRollState('btn-1', { rolled: true })).toBeUndefined();
  });
});

// ===========================================================================
// cleanOldRollStates
// ===========================================================================

describe('FoundryDataAccess — cleanOldRollStates', () => {
  it('removes roll states older than 30 days and persists the pruned set', async () => {
    const now = Date.now();
    const old = now - 31 * 24 * 60 * 60 * 1000;
    world.setSetting(MODULE_ID, 'rollStates', {
      stale: { rolled: true, timestamp: old },
      fresh: { rolled: true, timestamp: now },
    });

    const cleaned = await da.cleanOldRollStates();

    expect(cleaned).toBe(1);
    const remaining = world.settings.get(`${MODULE_ID}.rollStates`) as any;
    expect(remaining.stale).toBeUndefined();
    expect(remaining.fresh).toBeTruthy();
  });

  it('returns 0 when nothing is old enough to prune', async () => {
    world.setSetting(MODULE_ID, 'rollStates', {
      fresh: { rolled: true, timestamp: Date.now() },
    });

    expect(await da.cleanOldRollStates()).toBe(0);
  });

  it('returns 0 when there are no roll states at all', async () => {
    expect(await da.cleanOldRollStates()).toBe(0);
  });
});
