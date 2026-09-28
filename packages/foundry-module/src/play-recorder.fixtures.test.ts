/**
 * PlayRecorder dnd5e message-shape coverage (O3).
 *
 * play-recorder.test.ts already feeds both the dnd5e 6.0 (Foundry 14,
 * `message.type` + `message.system`) and 5.3 (Foundry 13, `flags.dnd5e`) shapes
 * for chat rolls. It only exercises the 6.0 shape for item-use and rest cards,
 * so this file fills in the missing 5.3 (`flags.dnd5e.item`,
 * `flags.dnd5e.rest.type`) coverage for those two kinds and checks that both
 * shapes produce equivalent records (docs/OBSIDIAN-PLAN.md O3 test list, item 1;
 * see `systems/dnd5e/chat-roll-kind.ts`).
 */
import type { PlayRecord } from '@gnuminator/shared';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { createTestWorld, type TestWorld } from './test-support/foundry-mock/index.js';
import { makeFixtureActor, makeLegacyFixtureMessage } from './test-support/play-log-fixtures.js';
import { PlayRecorder, playRecordKeys } from './play-recorder.js';

let world: TestWorld;
let restore: () => void;
let recorder: PlayRecorder;

function setup(): void {
  world = createTestWorld({ currentUser: { isGM: true } });
  restore = world.install();
  recorder = new PlayRecorder();
  recorder.registerHooks();
}

beforeEach(() => {
  setup();
});

afterEach(() => {
  restore();
});

/** The version-independent part of a record: what a caller should see the
 * same way regardless of which dnd5e message shape produced it. */
function coreFields(record: PlayRecord): Pick<PlayRecord, 'kind' | 'item' | 'data'> {
  return { kind: record.kind, item: record.item, data: record.data };
}

describe('item usage: 5.3 flags.dnd5e vs 6.0 message.system', () => {
  it('a legacy (5.3) usage card (flags.dnd5e.item, no roll.type) records an item-use', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);

    const legacy = makeLegacyFixtureMessage({
      id: 'u-legacy',
      speaker: { actor: actor.id },
      dnd5eFlags: {
        item: { uuid: 'Item.fireball', name: 'Fireball', type: 'spell' },
        spellLevel: 5,
      },
      t: 1000,
    });
    Hooks.callAll('createChatMessage', legacy, {}, 'u1');

    const [record] = recorder.getPlayRecords({}).records;
    expect(record.kind).toBe('item-use');
    expect(record.item).toEqual({ uuid: 'Item.fireball', name: 'Fireball', type: 'spell' });
    expect(record.data).toEqual({ spellLevel: 5 });
    expect(record.key).toBe(playRecordKeys.itemUse('u-legacy'));
  });

  it('the same usage reported through each shape yields the same kind, item and data', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);

    const modern = {
      id: 'u-modern',
      type: 'usage',
      speaker: { actor: actor.id },
      rolls: [],
      system: { item: { uuid: 'Item.fireball', name: 'Fireball', type: 'spell' }, level: 5 },
      flags: {},
      _stats: { modifiedTime: 1000 },
    };
    const legacy = makeLegacyFixtureMessage({
      id: 'u-legacy2',
      speaker: { actor: actor.id },
      dnd5eFlags: {
        item: { uuid: 'Item.fireball', name: 'Fireball', type: 'spell' },
        spellLevel: 5,
      },
      t: 2000,
    });
    Hooks.callAll('createChatMessage', modern, {}, 'u1');
    Hooks.callAll('createChatMessage', legacy, {}, 'u1');

    const [modernRecord, legacyRecord] = recorder.getPlayRecords({}).records;
    expect(coreFields(modernRecord)).toEqual(coreFields(legacyRecord));
  });
});

describe('rest: 5.3 flags.dnd5e.rest.type vs 6.0 message.system.type', () => {
  it('a legacy (5.3) rest card (flags.dnd5e.rest.type, no roll.type) records a rest', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);

    const legacy = makeLegacyFixtureMessage({
      id: 'r-legacy',
      speaker: { actor: actor.id },
      dnd5eFlags: { rest: { type: 'long' } },
      t: 1000,
    });
    Hooks.callAll('createChatMessage', legacy, {}, 'u1');

    const [record] = recorder.getPlayRecords({}).records;
    expect(record.kind).toBe('rest');
    expect(record.data).toEqual({ restType: 'long' });
    expect(record.key).toBe(playRecordKeys.rest(actor.uuid, 'r-legacy'));
  });

  it('the same rest reported through each shape yields the same kind and data', () => {
    const actor = makeFixtureActor();
    world.actors.add(actor);

    const modern = {
      id: 'r-modern',
      type: 'rest',
      speaker: { actor: actor.id },
      rolls: [],
      system: { type: 'short' },
      flags: {},
      _stats: { modifiedTime: 1000 },
    };
    const legacy = makeLegacyFixtureMessage({
      id: 'r-legacy2',
      speaker: { actor: actor.id },
      dnd5eFlags: { rest: { type: 'short' } },
      t: 2000,
    });
    Hooks.callAll('createChatMessage', modern, {}, 'u1');
    Hooks.callAll('createChatMessage', legacy, {}, 'u1');

    const [modernRecord, legacyRecord] = recorder.getPlayRecords({}).records;
    expect(coreFields(modernRecord)).toEqual(coreFields(legacyRecord));
  });
});
