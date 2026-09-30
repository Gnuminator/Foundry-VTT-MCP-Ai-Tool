/**
 * Unit tests for the EventTracker.
 *
 * The EventTracker is the part of the chat-log / play-by-play / session-log
 * pipeline that can be tested without a live Foundry: we stub the small set of
 * Foundry globals it touches (`Hooks`, `CONST`, `game`), fire synthetic
 * `createChatMessage` / `updateActor` / combat hooks at it, and assert on the
 * buffers and the (pure) play-by-play synthesis it produces.
 */

import { beforeEach, describe, expect, it, vi } from 'vitest';

// --- Minimal Foundry global harness -----------------------------------------

type HookFn = (...args: any[]) => void;
let hooks: Record<string, HookFn[]> = {};

function fire(event: string, ...args: any[]): void {
  for (const cb of hooks[event] ?? []) cb(...args);
}

beforeEach(() => {
  hooks = {};
  (globalThis as any).Hooks = {
    on: (name: string, cb: HookFn) => {
      (hooks[name] ??= []).push(cb);
    },
    once: (_name: string, _cb: HookFn) => {
      // no-op in tests; we don't fire 'ready' so seedCaches stays inert
    },
  };
  (globalThis as any).CONST = {
    CHAT_MESSAGE_STYLES: { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 },
    DICE_ROLL_MODES: { PUBLIC: 'publicroll', PRIVATE: 'gmroll' },
  };
  (globalThis as any).game = {
    settings: { get: () => 200 },
    actors: { get: () => undefined },
    users: { get: (id: string) => ({ name: `User-${id}` }) },
  };
  // Ensure foundry.utils is absent so getProp uses its manual fallback.
  delete (globalThis as any).foundry;
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
});

// Import after the harness type is in place (module construction is side-effect free).
import { EventTracker } from './session-events.js';

// --- Synthetic message builders ---------------------------------------------

function attackMessage(over: Partial<any> = {}): any {
  return {
    id: 'atk',
    timestamp: 1000,
    speaker: { alias: 'Silvera', actor: 'actor1' },
    rolls: [
      {
        formula: '2d20kh + 5',
        total: 25,
        dice: [
          {
            faces: 20,
            number: 2,
            modifiers: ['kh'],
            results: [
              { result: 20, active: true },
              { result: 12, active: false },
            ],
          },
        ],
        terms: [],
        options: { advantageMode: 1 },
      },
    ],
    flavor: 'Longsword Attack',
    content: '<div>attack</div>',
    style: 2,
    whisper: [],
    ...over,
  };
}

function damageMessage(over: Partial<any> = {}): any {
  return {
    id: 'dmg',
    timestamp: 2000,
    speaker: { alias: 'Silvera', actor: 'actor1' },
    rolls: [
      {
        formula: '1d8 + 3',
        total: 9,
        dice: [{ faces: 8, results: [{ result: 6, active: true }] }],
        terms: [{ options: { flavor: 'slashing' } }],
        options: {},
      },
    ],
    flavor: 'Longsword Damage',
    flags: { dnd5e: { roll: { type: 'damage' } } },
    content: '',
    style: 2,
    whisper: [],
    ...over,
  };
}

/** `game.actors.get` stub for the M2 visibility-stamp roll tests: resolves `attackMessage`/`damageMessage`'s `speaker.actor` ('actor1') to a PC actor. */
function resolveSilveraActor(
  id: string
): { id: string; name: string; hasPlayerOwner: boolean } | undefined {
  return id === 'actor1' ? { id: 'actor1', name: 'Silvera', hasPlayerOwner: true } : undefined;
}

// ---------------------------------------------------------------------------

describe('EventTracker chat parsing', () => {
  it('parses an advantage crit attack roll', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', attackMessage());

    const [entry] = t.getChatLog();
    expect(entry.speakerName).toBe('Silvera');
    expect(entry.actorId).toBe('actor1');
    expect(entry.messageType).toBe('roll');
    expect(entry.isRoll).toBe(true);
    expect(entry.roll).not.toBeNull();
    expect(entry.roll!.total).toBe(25);
    expect(entry.roll!.isCritical).toBe(true);
    expect(entry.roll!.isFumble).toBe(false);
    expect(entry.roll!.advantage).toBe('advantage');
    expect(entry.roll!.dice[0]).toEqual({ faces: 20, results: [20, 12] });
  });

  it('detects a natural-1 fumble and disadvantage', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire(
      'createChatMessage',
      attackMessage({
        rolls: [
          {
            formula: '2d20kl + 5',
            total: 6,
            dice: [
              {
                faces: 20,
                number: 2,
                modifiers: ['kl'],
                results: [
                  { result: 1, active: true },
                  { result: 14, active: false },
                ],
              },
            ],
            terms: [],
            options: { advantageMode: -1 },
          },
        ],
      })
    );

    const [entry] = t.getChatLog();
    expect(entry.roll!.isFumble).toBe(true);
    expect(entry.roll!.isCritical).toBe(false);
    expect(entry.roll!.advantage).toBe('disadvantage');
  });

  it('parses a damage roll with damage type and logs a session damage event', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', damageMessage());

    const [entry] = t.getChatLog();
    expect(entry.messageType).toBe('damage');
    expect(entry.damage).not.toBeNull();
    expect(entry.damage!.total).toBe(9);
    expect(entry.damage!.types).toEqual(['slashing']);

    const events = t.getSessionLog({ eventType: 'damage-roll' });
    expect(events).toHaveLength(1);
    expect(events[0].details.total).toBe(9);
  });

  it('classifies ic / ooc / emote / whisper messages', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', {
      id: 'ic',
      timestamp: 10,
      speaker: { alias: 'Bartender' },
      rolls: [],
      content: 'Welcome!',
      style: 2,
      whisper: [],
    });
    fire('createChatMessage', {
      id: 'ooc',
      timestamp: 11,
      speaker: { alias: 'Greg' },
      rolls: [],
      content: 'brb',
      style: 1,
      whisper: [],
    });
    fire('createChatMessage', {
      id: 'em',
      timestamp: 12,
      speaker: { alias: 'Greg' },
      rolls: [],
      content: 'waves',
      style: 3,
      whisper: [],
    });
    fire('createChatMessage', {
      id: 'wh',
      timestamp: 13,
      speaker: { alias: 'GM' },
      rolls: [],
      content: 'psst',
      style: 0,
      whisper: ['u1'],
    });

    const log = t.getChatLog();
    expect(log.map(e => e.messageType)).toEqual(['ic', 'ooc', 'emote', 'whisper']);
    expect(log[3].whisperTo).toEqual(['User-u1']);
  });

  it('applies limit, speaker, type and since filters', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', attackMessage({ id: 'a', timestamp: 1000 }));
    fire('createChatMessage', damageMessage({ id: 'd', timestamp: 2000 }));
    fire('createChatMessage', {
      id: 'chat',
      timestamp: 3000,
      speaker: { alias: 'Goblin' },
      rolls: [],
      content: 'grr',
      style: 2,
      whisper: [],
    });

    expect(t.getChatLog({ messageType: 'roll' }).map(e => e.id)).toEqual(['a', 'd']);
    expect(t.getChatLog({ messageType: 'damage' }).map(e => e.id)).toEqual(['d']);
    expect(t.getChatLog({ speakerName: 'silvera' }).map(e => e.id)).toEqual(['a', 'd']);
    expect(t.getChatLog({ limit: 1 }).map(e => e.id)).toEqual(['chat']);
    expect(t.getChatLog({ sinceTimestamp: new Date(1500).toISOString() }).map(e => e.id)).toEqual([
      'd',
      'chat',
    ]);
  });

  it('trims the chat buffer to the configured size', () => {
    (globalThis as any).game.settings.get = () => 3;
    const t = new EventTracker();
    t.registerHooks();
    for (let i = 0; i < 10; i++) {
      fire('createChatMessage', {
        id: `m${i}`,
        timestamp: i,
        speaker: { alias: 'X' },
        rolls: [],
        content: '',
        style: 2,
        whisper: [],
      });
    }
    const log = t.getChatLog({ limit: 200 });
    expect(log).toHaveLength(3);
    expect(log.map(e => e.id)).toEqual(['m7', 'm8', 'm9']);
  });
});

// dnd5e 6.0-shaped roll messages (the subtype is `message.type`, the data `message.system`).
function d20Term(result: number): any {
  return { faces: 20, number: 1, results: [{ result, active: true }] };
}

function rollMessage(over: Partial<any> = {}): any {
  return {
    id: 'bite',
    timestamp: 3000,
    type: 'attack',
    speaker: { alias: 'Wolf', actor: 'wolf1' },
    system: {},
    rolls: [
      {
        formula: '1d20 + 4',
        total: 18,
        terms: [d20Term(14), { operator: '+' }, { number: 4 }],
        dice: [d20Term(14)],
        options: { target: 13 },
      },
    ],
    flavor: 'Bite - Attack Roll',
    content: '',
    whisper: [],
    blind: false,
    ...over,
  };
}

function damageRoll(total: number, type: string): any {
  return {
    formula: `1d6 + ${total - 3}`,
    total,
    terms: [
      { faces: 6, number: 1, results: [{ result: 3, active: true }] },
      { operator: '+' },
      { number: total - 3 },
    ],
    dice: [],
    options: { type },
  };
}

describe('EventTracker roll events (O3 item 6)', () => {
  it('a public roll is a `roll` event: player-safe description, full GM breakdown in details', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', rollMessage());

    const [event] = t.getSessionLog({ eventType: 'roll' });
    expect(event.actorName).toBe('Wolf');
    expect(event.description).toBe('Wolf, Attack: 1d20 (14) +4 modifier = 18');
    expect(event.details).toMatchObject({
      rollType: 'attack',
      total: 18,
      breakdown: 'Wolf, Attack: 1d20 (14) +4 modifier = 18 vs AC 13: hit',
      natural: 14,
      dc: 13,
      outcome: 'success',
      messageId: 'bite',
    });
    expect(t.getSessionLog({ eventType: 'gm-roll' })).toHaveLength(0);
  });

  it("players see the target and outcome when dnd5e's challengeVisibility is `all`", () => {
    (globalThis as any).game.settings.get = (ns: string, key: string): unknown =>
      ns === 'dnd5e' && key === 'challengeVisibility' ? 'all' : 200;
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', rollMessage());
    const [event] = t.getSessionLog({ eventType: 'roll' });
    expect(event.description).toBe('Wolf, Attack: 1d20 (14) +4 modifier = 18 vs AC 13: hit');
  });

  it('whispered, blind and self rolls are GM-only `gm-roll` events, never `roll`', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', rollMessage({ id: 'blind', whisper: ['gm'], blind: true }));
    fire('createChatMessage', rollMessage({ id: 'gmroll', whisper: ['gm'] }));
    fire('createChatMessage', rollMessage({ id: 'self', whisper: ['player1'] }));

    expect(t.getSessionLog({ eventType: 'roll' })).toHaveLength(0);
    const gm = t.getSessionLog({ eventType: 'gm-roll' });
    expect(gm.map(e => e.details.messageId)).toEqual(['blind', 'gmroll', 'self']);
    // The GM's own feed line is the full one.
    expect(gm[0].description).toBe('Wolf, Attack: 1d20 (14) +4 modifier = 18 vs AC 13: hit');
  });

  it('a whispered damage roll is a `gm-roll`, not a public `damage-roll`', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', damageMessage({ whisper: ['gm'], blind: true }));
    expect(t.getSessionLog({ eventType: 'damage-roll' })).toHaveLength(0);
    const [event] = t.getSessionLog({ eventType: 'gm-roll' });
    expect(event.details).toMatchObject({ rollType: 'damage', total: 9, types: ['slashing'] });
  });

  it('one public `damage-roll` per message, every roll listed with the sum', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire(
      'createChatMessage',
      rollMessage({
        id: 'flame',
        type: 'damage',
        speaker: { alias: 'Hero', actor: 'hero1' },
        rolls: [damageRoll(8, 'slashing'), damageRoll(5, 'fire')],
        flavor: 'Flame Tongue - Damage Roll',
      })
    );
    const events = t.getSessionLog({ eventType: 'damage-roll' });
    expect(events).toHaveLength(1);
    expect(events[0].description).toBe(
      'Hero, Damage: 1d6 (3) +5 modifier = 8 slashing; 1d6 (3) +2 modifier = 5 fire; total 13'
    );
    expect(events[0].details).toMatchObject({ rollType: 'damage', total: 13 });
  });

  it('rest and usage cards get no roll event, even when they carry rolls', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', rollMessage({ id: 'rest', type: 'rest', system: { type: 'short' } }));
    fire('createChatMessage', rollMessage({ id: 'use', type: 'usage' }));
    const rollish = ['roll', 'gm-roll', 'damage-roll'];
    expect(t.getSessionLog({}).filter(e => rollish.includes(e.eventType))).toHaveLength(0);
  });
});

describe('EventTracker session events', () => {
  it('detects damage and death from HP changes', () => {
    const t = new EventTracker();
    t.registerHooks();
    const goblin = { id: 'g1', name: 'Goblin' };
    // First sighting seeds the cache (no event).
    fire('updateActor', goblin, { system: { attributes: { hp: { value: 5 } } } });
    // Drop to 0 → damage + death.
    fire('updateActor', goblin, { system: { attributes: { hp: { value: 0 } } } });

    expect(t.getSessionLog({ eventType: 'damage' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'damage' })[0].details.amount).toBe(5);
    expect(t.getSessionLog({ eventType: 'death' })).toHaveLength(1);
  });

  it("credits damage like the play log: the card's own message exactly, else a roll that fits", () => {
    const t = new EventTracker();
    t.registerHooks();
    const wolf = { id: 'w1', uuid: 'Actor.w1', name: 'Wolf' };
    const hp = (value: number): void =>
      fire('updateActor', wolf, { system: { attributes: { hp: { value } } } });
    hp(40); // seeds the cache
    const now = Date.now();
    fire('createChatMessage', damageMessage({ id: 'sword', timestamp: now })); // 9 slashing
    fire('createChatMessage', damageMessage({ id: 'later', timestamp: now, flavor: 'Axe Damage' }));

    // Applied from the sword card: exact, although the axe roll came later.
    const card = { id: 'sword', documentName: 'ChatMessage' };
    fire('dnd5e.preApplyDamage', wolf, 9, {}, { originatingMessage: card });
    hp(31);
    fire('dnd5e.applyDamage', wolf, 9, {});
    hp(22); // 9 again, no card: the latest roll that fits (the axe)
    hp(17); // 5: fits no 9-point roll

    const details = t.getSessionLog({ eventType: 'damage' }).map(e => e.details);
    expect(details.map(d => [d.source, d.sourceMessageId, d.sourceExact])).toEqual([
      ['Longsword Damage', 'sword', true],
      ['Axe Damage', 'later', false],
      [null, undefined, undefined],
    ]);
  });

  it('detects healing and stabilization', () => {
    const t = new EventTracker();
    t.registerHooks();
    const pc = { id: 'p1', name: 'Tulkas' };
    fire('updateActor', pc, { system: { attributes: { hp: { value: 0 } } } });
    fire('updateActor', pc, { system: { attributes: { hp: { value: 8 } } } });

    expect(t.getSessionLog({ eventType: 'healing' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'stabilize' })).toHaveLength(1);
  });

  it('detects spell-slot expenditure', () => {
    const t = new EventTracker();
    t.registerHooks();
    const caster = { id: 'c1', name: 'Silvera' };
    fire('updateActor', caster, { system: { spells: { spell3: { value: 2 } } } });
    fire('updateActor', caster, { system: { spells: { spell3: { value: 1 } } } });

    const spent = t.getSessionLog({ eventType: 'resource-spent' });
    expect(spent).toHaveLength(1);
    expect(spent[0].details).toMatchObject({ resource: 'spell3', from: 2, to: 1 });
  });

  it('logs condition apply/remove and scene changes', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createActiveEffect', {
      name: 'Prone',
      parent: { id: 'g1', name: 'Goblin' },
      statuses: new Set(['prone']),
    });
    fire('deleteActiveEffect', {
      name: 'Prone',
      parent: { id: 'g1', name: 'Goblin' },
      statuses: new Set(['prone']),
    });
    fire('updateScene', { id: 's2', name: 'Throne Room' }, { active: true });

    expect(t.getSessionLog({ eventType: 'condition-applied' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'condition-removed' })).toHaveLength(1);
    expect(t.getSessionLog({ eventType: 'scene-change' })).toHaveLength(1);
  });

  it('logs a mirrored condition (two ActiveEffects per toggle) once (P-026)', () => {
    vi.useFakeTimers({ toFake: ['Date'] });
    try {
      vi.setSystemTime(1_790_000_000_000);
      const t = new EventTracker();
      t.registerHooks();
      const goblin = { id: 'g1', name: 'Goblin' };
      const prone = { name: 'Prone', parent: goblin, statuses: new Set(['prone']) };
      const mirror = { name: 'Prone', parent: goblin, statuses: new Set(['prone']) };
      fire('createActiveEffect', prone);
      fire('createActiveEffect', mirror);
      fire('deleteActiveEffect', prone);
      fire('deleteActiveEffect', mirror);
      expect(t.getSessionLog({ eventType: 'condition-applied' })).toHaveLength(1);
      expect(t.getSessionLog({ eventType: 'condition-removed' })).toHaveLength(1);

      // A new toggle after the window is logged again.
      vi.setSystemTime(1_790_000_002_000);
      fire('createActiveEffect', prone);
      expect(t.getSessionLog({ eventType: 'condition-applied' })).toHaveLength(2);
    } finally {
      vi.useRealTimers();
    }
  });

  it('detects legendary actions spent (dnd5e 6 stores `spent`, `value` is derived)', () => {
    const t = new EventTracker();
    t.registerHooks();
    const dragon = { id: 'd1', name: 'Dragon', system: { resources: { legact: { value: 3 } } } };
    // First sighting seeds the cache (no event); then one action is spent.
    fire('updateActor', dragon, { system: { resources: { legact: { spent: 0 } } } });
    dragon.system.resources.legact.value = 2;
    fire('updateActor', dragon, { system: { resources: { legact: { spent: 1 } } } });

    const spent = t.getSessionLog({ eventType: 'resource-spent' });
    expect(spent).toHaveLength(1);
    expect(spent[0].details).toMatchObject({ resource: 'legact', from: 3, to: 2 });
  });
});

describe('EventTracker session events — visibility stamp (M2)', () => {
  it('damage/death: stamps visibility from the actor (pc)', () => {
    const t = new EventTracker();
    t.registerHooks();
    const pc = { id: 'p1', name: 'Tulkas', hasPlayerOwner: true };
    fire('updateActor', pc, { system: { attributes: { hp: { value: 10 } } } });
    fire('updateActor', pc, { system: { attributes: { hp: { value: 0 } } } });

    const [damage] = t.getSessionLog({ eventType: 'damage' });
    expect(damage.visibility).toEqual({ subject: 'pc', tokenVisible: false, playerName: 'Tulkas' });
    const [death] = t.getSessionLog({ eventType: 'death' });
    expect(death.visibility).toEqual({ subject: 'pc', tokenVisible: false, playerName: 'Tulkas' });
  });

  it('damage: stamps visibility from the actor (npc, no visible token -> playerName null)', () => {
    const t = new EventTracker();
    t.registerHooks();
    const goblin = { id: 'g1', name: 'Goblin', hasPlayerOwner: false };
    fire('updateActor', goblin, { system: { attributes: { hp: { value: 5 } } } });
    fire('updateActor', goblin, { system: { attributes: { hp: { value: 2 } } } });

    const [damage] = t.getSessionLog({ eventType: 'damage' });
    expect(damage.visibility).toEqual({ subject: 'npc', tokenVisible: false, playerName: null });
  });

  it('healing/stabilize: stamps visibility from the actor', () => {
    const t = new EventTracker();
    t.registerHooks();
    const pc = { id: 'p1', name: 'Tulkas', hasPlayerOwner: true };
    fire('updateActor', pc, { system: { attributes: { hp: { value: 0 } } } });
    fire('updateActor', pc, { system: { attributes: { hp: { value: 8 } } } });

    const [healing] = t.getSessionLog({ eventType: 'healing' });
    expect(healing.visibility?.subject).toBe('pc');
    const [stabilize] = t.getSessionLog({ eventType: 'stabilize' });
    expect(stabilize.visibility?.subject).toBe('pc');
  });

  it('resource-spent: stamps visibility from the actor', () => {
    const t = new EventTracker();
    t.registerHooks();
    const caster = { id: 'c1', name: 'Silvera', hasPlayerOwner: true };
    fire('updateActor', caster, { system: { spells: { spell3: { value: 2 } } } });
    fire('updateActor', caster, { system: { spells: { spell3: { value: 1 } } } });

    const [spent] = t.getSessionLog({ eventType: 'resource-spent' });
    expect(spent.visibility).toEqual({ subject: 'pc', tokenVisible: false, playerName: 'Silvera' });
  });

  it('condition-applied/removed: stamps visibility from the effect parent, plus statuses', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createActiveEffect', {
      name: 'Prone',
      parent: { id: 'g1', name: 'Goblin', hasPlayerOwner: false },
      statuses: new Set(['prone']),
    });
    fire('deleteActiveEffect', {
      name: 'Prone',
      parent: { id: 'g1', name: 'Goblin', hasPlayerOwner: false },
      statuses: new Set(['prone']),
    });

    const [applied] = t.getSessionLog({ eventType: 'condition-applied' });
    expect(applied.visibility).toEqual({
      subject: 'npc',
      tokenVisible: false,
      playerName: null,
      statuses: ['prone'],
    });
    const [removed] = t.getSessionLog({ eventType: 'condition-removed' });
    expect(removed.visibility?.statuses).toEqual(['prone']);
  });

  it('scene-change: stamps the player-facing scene name (navName, else the generic label)', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire(
      'updateScene',
      { id: 's1', name: 'Death House Basement', navName: 'The Basement' },
      {
        active: true,
      }
    );
    fire('updateScene', { id: 's2', name: 'Death House Attic' }, { active: true });

    const [withNav, withoutNav] = t.getSessionLog({ eventType: 'scene-change' });
    expect(withNav.visibility).toEqual({
      subject: null,
      tokenVisible: false,
      playerName: null,
      sceneName: 'The Basement',
    });
    expect(withoutNav.visibility?.sceneName).toBe('Current scene');
  });

  it('combat-start/combat-end/journal events: no-subject visibility', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('combatStart', { id: 'c1', round: 1, combatants: { size: 1 } });
    fire('deleteCombat', { id: 'c1', round: 3 });
    fire('createJournalEntry', { id: 'j1', name: 'Notes' });
    fire('updateJournalEntry', { id: 'j1', name: 'Notes' });

    const noSubject = { subject: null, tokenVisible: false, playerName: null };
    expect(t.getSessionLog({ eventType: 'combat-start' })[0].visibility).toEqual(noSubject);
    expect(t.getSessionLog({ eventType: 'combat-end' })[0].visibility).toEqual(noSubject);
    expect(t.getSessionLog({ eventType: 'journal-created' })[0].visibility).toEqual(noSubject);
    expect(t.getSessionLog({ eventType: 'journal-updated' })[0].visibility).toEqual(noSubject);
  });

  it('roll: stamps visibility from the resolved speaker actor', () => {
    const t = new EventTracker();
    t.registerHooks();
    (globalThis as any).game.actors.get = resolveSilveraActor;
    fire('createChatMessage', attackMessage());

    const [roll] = t.getSessionLog({ eventType: 'roll' });
    expect(roll.visibility).toEqual({ subject: 'pc', tokenVisible: false, playerName: 'Silvera' });
  });

  it('damage-roll: stamps visibility from the resolved speaker actor', () => {
    const t = new EventTracker();
    t.registerHooks();
    (globalThis as any).game.actors.get = resolveSilveraActor;
    fire('createChatMessage', damageMessage());

    const [dmgRoll] = t.getSessionLog({ eventType: 'damage-roll' });
    expect(dmgRoll.visibility?.subject).toBe('pc');
  });

  it('gm-roll (whispered): stamps visibility from the resolved speaker actor', () => {
    const t = new EventTracker();
    t.registerHooks();
    (globalThis as any).game.actors.get = resolveSilveraActor;
    fire('createChatMessage', attackMessage({ whisper: ['gm-user'] }));

    const [gmRoll] = t.getSessionLog({ eventType: 'gm-roll' });
    expect(gmRoll.visibility).toEqual({
      subject: 'pc',
      tokenVisible: false,
      playerName: 'Silvera',
    });
  });

  it('roll: no subject when the speaker actor cannot be resolved', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', attackMessage({ speaker: { alias: 'Unknown' } }));

    const [roll] = t.getSessionLog({ eventType: 'roll' });
    expect(roll.visibility).toEqual({ subject: null, tokenVisible: false, playerName: null });
  });
});

describe('EventTracker combat play-by-play', () => {
  it('groups actions into rounds using the recorded turn timeline', () => {
    const t = new EventTracker();
    t.registerHooks();

    fire('combatStart', {
      id: 'c1',
      round: 1,
      combatants: { size: 1 },
      combatant: { name: 'Silvera', actor: { id: 'actor1' } },
    });

    // Chat after combat start (timestamps must be >= the combat-start time).
    const base = Date.now() + 100;
    fire('createChatMessage', attackMessage({ id: 'a', timestamp: base + 1 }));
    fire('createChatMessage', damageMessage({ id: 'd', timestamp: base + 2 }));

    const pbp = t.buildPlayByPlay({ round: 1, started: true });
    expect(pbp.combatActive).toBe(true);
    expect(pbp.totalRounds).toBe(1);
    expect(pbp.rounds).toHaveLength(1);
    expect(pbp.rounds[0].turns[0].combatant).toBe('Silvera');
    expect(pbp.rounds[0].turns[0].actions).toHaveLength(2);
    expect(pbp.summary.damageByActor).toEqual({ Silvera: 9 });
    expect(pbp.summary.note).toBeNull();
  });

  it('degrades gracefully to a single round when no timeline was recorded', () => {
    const t = new EventTracker();
    t.registerHooks();
    fire('createChatMessage', attackMessage({ id: 'a', timestamp: 1000 }));
    fire('createChatMessage', damageMessage({ id: 'd', timestamp: 2000 }));

    const pbp = t.buildPlayByPlay({ round: 2, started: false });
    expect(pbp.combatActive).toBe(false);
    expect(pbp.totalRounds).toBe(2);
    expect(pbp.rounds).toHaveLength(1);
    expect(pbp.rounds[0].turns[0].combatant).toBe('(unattributed)');
    expect(pbp.summary.note).toMatch(/no per-turn timeline/i);
    expect(pbp.summary.damageByActor).toEqual({ Silvera: 9 });
  });
});
