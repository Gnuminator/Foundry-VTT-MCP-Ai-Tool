/**
 * Tests for the dnd5e half of the version adapter, against dnd5e 5.3-shaped and
 * 6.0-shaped fixtures, and for rules-version (2014 vs 2024) detection/tagging.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import { createTestWorld, type TestWorld } from '../../test-support/foundry-mock/index.js';
import { isDnd5e, isDnd5eV6 } from './version.js';
import { findStatusEffect, statusEffectList } from './status-effects.js';
import { chatRollKind, isDamageRoll } from './chat-roll-kind.js';
import {
  detectRulesVersion,
  readRulesTag,
  RULES_FLAG_PATH,
  rulesTagForCreate,
  rulesTagUpdate,
  worldRulesVersion,
} from './rules-version.js';

let world: TestWorld;
let restore: () => void;
const g = globalThis as any;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});

afterEach(() => {
  restore();
});

describe('dnd5e version detection', () => {
  it('5.3: no condition ActiveEffect subtype', () => {
    g.game.system.documentTypes = { ActiveEffect: { base: {}, enchantment: {} } };
    expect(isDnd5e()).toBe(true);
    expect(isDnd5eV6()).toBe(false);
  });

  it('6.0: condition ActiveEffect subtype present', () => {
    g.game.system.documentTypes = { ActiveEffect: { base: {}, condition: {} } };
    expect(isDnd5eV6()).toBe(true);
  });

  it('not dnd5e', () => {
    g.game.system = { id: 'pf2e', documentTypes: { ActiveEffect: { condition: {} } } };
    expect(isDnd5e()).toBe(false);
    expect(isDnd5eV6()).toBe(false);
  });
});

describe('status effects', () => {
  const frightened = { id: 'frightened', name: 'Frightened', img: 'f.svg' };
  const prone = { id: 'prone', name: 'Prone', img: 'p.svg' };

  it('5.3: array storage', () => {
    g.CONFIG.statusEffects = [frightened, prone];
    expect(statusEffectList().map(e => e.id)).toEqual(['frightened', 'prone']);
    expect(findStatusEffect('prone')).toEqual(prone);
    expect(findStatusEffect('FRIGHTENED')).toEqual(frightened);
  });

  it('6.0: object keyed by id (ids filled from keys when missing)', () => {
    g.CONFIG.statusEffects = { frightened, prone: { name: 'Prone', img: 'p.svg' } };
    expect(statusEffectList().map(e => e.id)).toEqual(['frightened', 'prone']);
    expect(findStatusEffect('prone')?.name).toBe('Prone');
    expect(findStatusEffect('nope')).toBeUndefined();
  });

  it('missing config gives an empty list', () => {
    g.CONFIG.statusEffects = undefined;
    expect(statusEffectList()).toEqual([]);
  });
});

describe('chat roll kind', () => {
  it('5.3: flags.dnd5e.roll.type', () => {
    const msg: any = { type: 'base', flags: { dnd5e: { roll: { type: 'damage' } } } };
    expect(chatRollKind(msg)).toBe('damage');
    expect(isDamageRoll(msg)).toBe(true);
  });

  it('6.0: the ChatMessage subtype, flags gone', () => {
    expect(chatRollKind({ type: 'damage', flags: {} } as any)).toBe('damage');
    expect(chatRollKind({ type: 'attack', flags: {} } as any)).toBe('attack');
  });

  it('plain chat is not a roll', () => {
    expect(chatRollKind({ type: 'base', flags: {} } as any)).toBeNull();
    expect(isDamageRoll({ flags: {} } as any)).toBe(false);
  });
});

describe('rules version detection', () => {
  const actor = (system: any, flags: any = {}): any => ({ documentName: 'Actor', system, flags });

  it('a GM choice wins and is validated', () => {
    expect(detectRulesVersion(actor({ source: { rules: '2014' } }), '2024')).toEqual({
      version: '2024',
      source: 'gm',
    });
    expect(() => detectRulesVersion(actor({}), '2020' as any)).toThrow(/Unknown rules version/);
  });

  it('system.source.rules', () => {
    expect(detectRulesVersion(actor({ source: { rules: '2014' } }))).toEqual({
      version: '2014',
      source: 'system.source.rules',
    });
  });

  it('DDB sourceId: < 145 is 2014 (CoS = 6), MM 2024 = 147', () => {
    expect(detectRulesVersion(actor({ source: {} }, { ddbimporter: { sourceId: 6 } }))).toEqual({
      version: '2014',
      source: 'ddbimporter.sourceId',
    });
    expect(detectRulesVersion(actor({}, { ddbimporter: { sourceId: 147 } }))?.version).toBe('2024');
  });

  it('world rulesVersion setting as the last fallback', () => {
    world.setSetting('dnd5e', 'rulesVersion', 'modern');
    expect(worldRulesVersion()).toBe('2024');
    expect(detectRulesVersion(actor({}))).toEqual({ version: '2024', source: 'world-setting' });
    world.setSetting('dnd5e', 'rulesVersion', 'legacy');
    expect(detectRulesVersion(actor({}))?.version).toBe('2014');
  });

  it('nothing known: null', () => {
    expect(detectRulesVersion(actor({}))).toBeNull();
  });

  it('a DDB-imported embedded item follows its actor, not its own rules value', () => {
    const owner = actor({ source: { rules: '2014' } }, { ddbimporter: { sourceId: 6 } });
    const item: any = {
      documentName: 'Item',
      actor: owner,
      system: { source: { rules: '2024' } },
      flags: { ddbimporter: { id: 1 } },
    };
    expect(detectRulesVersion(item)).toEqual({ version: '2014', source: 'system.source.rules' });
  });

  it('a non-DDB item uses its own value', () => {
    const item: any = {
      documentName: 'Item',
      actor: actor({ source: { rules: '2014' } }),
      system: { source: { rules: '2024' } },
      flags: {},
    };
    expect(detectRulesVersion(item)?.version).toBe('2024');
  });
});

describe('rules tag', () => {
  it('builds the flag update and reads it back', () => {
    const doc: any = { documentName: 'Actor', system: { source: { rules: '2014' } }, flags: {} };
    const update = rulesTagUpdate(doc, undefined, '2026-09-27T00:00:00.000Z');
    expect(RULES_FLAG_PATH).toBe('flags.foundry-mcp-bridge.rules');
    expect(update).toEqual({
      [RULES_FLAG_PATH]: {
        version: '2014',
        source: 'system.source.rules',
        at: '2026-09-27T00:00:00.000Z',
      },
    });
    doc.flags['foundry-mcp-bridge'] = { rules: update[RULES_FLAG_PATH] };
    expect(readRulesTag(doc)).toEqual(update[RULES_FLAG_PATH]);
  });

  it('never writes DDB flags, and gives {} when the version is unknown', () => {
    const doc: any = { documentName: 'Actor', system: {}, flags: { ddbimporter: { id: 9 } } };
    expect(rulesTagUpdate(doc)).toEqual({});
    const tagged = rulesTagUpdate({ ...doc, system: { source: { rules: '2024' } } });
    expect(Object.keys(tagged).some(k => k.includes('ddbimporter'))).toBe(false);
  });

  it('ignores a malformed stored tag', () => {
    expect(
      readRulesTag({ flags: { 'foundry-mcp-bridge': { rules: { version: '5e' } } } } as any)
    ).toBeNull();
    expect(readRulesTag({ flags: {} } as any)).toBeNull();
  });

  it('creation data: detected from the data being created', () => {
    expect(rulesTagForCreate({ system: { source: { rules: '2024' } } }, undefined, 'T')).toEqual({
      version: '2024',
      source: 'system.source.rules',
      at: 'T',
    });
    expect(rulesTagForCreate({})).toBeNull();
  });
});
