/**
 * Picker candidates (`listRefChoices`): what each kind lists, how the parent
 * parameter and filters narrow it, and the query / limit handling.
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  MockCollection,
  createTestWorld,
  makeCombat,
  makeCombatant,
  makeItem,
  makeJournalPage,
  makeNote,
  makePack,
  makeToken,
  type TestWorld,
} from '../test-support/foundry-mock/index.js';

import { MAX_REF_LIMIT, MODULE_REF_KINDS, listRefChoices } from './ref-choices.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
});

afterEach(() => {
  restore?.();
});

function install(): void {
  restore = world.install();
}

describe('tokens', () => {
  it('lists the current scene by default, grouped by disposition, hidden ones marked', async () => {
    const goblin = world.addActor({ id: 'a-goblin', name: 'Goblin', type: 'npc' });
    const scene = world.addScene({
      id: 'scene-1',
      name: 'Barovia',
      tokens: [
        makeToken({ id: 't1', name: 'Goblin', disposition: -1, hidden: true, actorId: goblin.id }),
        makeToken({ id: 't2', name: 'Ireena', disposition: 1 }),
      ],
    });
    world.addScene({
      id: 'scene-2',
      name: 'Vallaki',
      tokens: [makeToken({ id: 't3', name: 'Guard' })],
    });
    world.setActiveScene(scene.id);
    install();

    const result = await listRefChoices({ kind: 'token' });
    expect(result.note).toBe('Tokens on "Barovia"');
    expect(result.choices.map(c => [c.id, c.name, c.group, c.hidden ?? false])).toEqual([
      ['t2', 'Ireena', 'Friendly', false],
      ['t1', 'Goblin', 'Hostile', true],
    ]);
    expect(result.choices[1].detail).toContain('hidden');
    expect(result.choices[1].detail).toMatch(/at \d+, \d+$/);

    const other = await listRefChoices({ kind: 'token', parent: 'Vallaki' });
    expect(other.choices.map(c => c.id)).toEqual(['t3']);
    expect((await listRefChoices({ kind: 'token', parent: 'nope' })).note).toBe('No scene "nope"');
  });

  it('says so when there is no current scene', async () => {
    install();
    expect(await listRefChoices({ kind: 'token' })).toEqual({
      kind: 'token',
      choices: [],
      truncated: false,
      note: 'No current scene',
    });
  });
});

describe('actors and their items', () => {
  it('filters actors by type and player ownership', async () => {
    world.addActor({ id: 'pc', name: 'Aria', type: 'character', hasPlayerOwner: true });
    world.addActor({ id: 'npc', name: 'Strahd', type: 'npc' });
    install();
    const all = await listRefChoices({ kind: 'actor' });
    expect(all.choices.map(c => c.name).sort()).toEqual(['Aria', 'Strahd']);
    const npcs = await listRefChoices({ kind: 'actor', filter: { types: ['npc'] } });
    expect(npcs.choices.map(c => c.id)).toEqual(['npc']);
    const pcs = await listRefChoices({ kind: 'actor', filter: { playerOwned: true } });
    expect(pcs.choices.map(c => c.id)).toEqual(['pc']);
    expect(pcs.choices[0].detail).toBe('character, player-owned');
  });

  it('lists actors on the current scene first when asked (I-017)', async () => {
    world.addActor({ id: 'pc', name: 'Aria', type: 'character' });
    const zombie = world.addActor({ id: 'z', name: 'Zombie', type: 'npc' });
    world.addActor({ id: 'b', name: 'Bat', type: 'npc' });
    const scene = world.addScene({
      id: 'scene-1',
      name: 'Barovia',
      tokens: [makeToken({ id: 't1', name: 'Zombie', actorId: zombie.id })],
    });
    world.setActiveScene(scene.id);
    install();

    const first = await listRefChoices({ kind: 'actor', filter: { onSceneFirst: true } });
    expect(first.choices[0]).toMatchObject({ id: 'z', group: 'On this scene' });
    expect(
      first.choices
        .map(c => c.id)
        .slice(1)
        .sort()
    ).toEqual(['b', 'pc']);

    const plain = await listRefChoices({ kind: 'actor' });
    expect(plain.choices.find(c => c.id === 'z')?.group).toBe('npc');
  });

  it("lists the parent actor's items by type", async () => {
    world.addActor({
      id: 'npc',
      name: 'Strahd',
      type: 'npc',
      items: [
        makeItem({ id: 'i1', name: 'Bite', type: 'weapon' }),
        makeItem({ id: 'i2', name: 'Fireball', type: 'spell' }),
      ],
    });
    install();
    expect((await listRefChoices({ kind: 'actor-item' })).note).toBe('Choose the actor first');
    const weapons = await listRefChoices({
      kind: 'actor-item',
      parent: 'Strahd',
      filter: { types: ['weapon'] },
    });
    expect(weapons.choices.map(c => c.name)).toEqual(['Bite']);
    const byId = await listRefChoices({ kind: 'actor-item', parent: 'npc' });
    expect(byId.choices).toHaveLength(2);
  });
});

describe('journals, pages, compendiums', () => {
  it('lists pages of one journal or of all journals', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Quests',
      pages: [makeJournalPage({ id: 'p1', name: 'Find Ireena' })],
    });
    world.addJournal({
      id: 'j2',
      name: 'Lore',
      pages: [makeJournalPage({ id: 'p2', name: 'Mists' })],
    });
    install();
    const all = await listRefChoices({ kind: 'journal-page' });
    expect(all.choices.map(c => [c.name, c.group])).toEqual([
      ['Find Ireena', 'Quests'],
      ['Mists', 'Lore'],
    ]);
    const one = await listRefChoices({ kind: 'journal-page', parent: 'j2' });
    expect(one.choices.map(c => c.id)).toEqual(['p2']);
  });

  it('lists packs by document class and searches entries', async () => {
    world.addPack(
      makePack({
        id: 'dnd5e.monsters',
        label: 'Monsters',
        type: 'Actor',
        documents: [
          world.addActor({ id: 'm1', name: 'Wolf', type: 'npc' }),
          world.addActor({ id: 'm2', name: 'Dire Wolf', type: 'npc' }),
        ],
      })
    );
    world.addPack(makePack({ id: 'dnd5e.items', label: 'Items', type: 'Item', documents: [] }));
    install();
    const actorPacks = await listRefChoices({
      kind: 'compendium-pack',
      filter: { documentName: 'Actor' },
    });
    expect(actorPacks.choices.map(c => c.id)).toEqual(['dnd5e.monsters']);

    const inPack = await listRefChoices({ kind: 'compendium-entry', parent: 'dnd5e.monsters' });
    expect(inPack.choices.map(c => c.name)).toEqual(['Wolf', 'Dire Wolf']);
    expect(inPack.choices[0].uuid).toBe('Compendium.dnd5e.monsters.Actor.m1');

    const unscoped = await listRefChoices({ kind: 'compendium-entry' });
    expect(unscoped.note).toMatch(/at least 2 letters/);
    const searched = await listRefChoices({ kind: 'compendium-entry', query: 'dire' });
    expect(searched.choices.map(c => c.id)).toEqual(['m2']);
  });
});

describe('combat, users, conditions, notes, templates', () => {
  it('lists combatants of the active combat', async () => {
    install();
    expect((await listRefChoices({ kind: 'combatant' })).note).toBe('No active combat');
    world.setCombat(
      makeCombat({
        combatants: new MockCollection([
          makeCombatant({
            id: 'c1',
            name: 'Goblin',
            initiative: 12,
            hidden: true,
            defeated: false,
          }),
          makeCombatant({
            id: 'c2',
            name: 'Aria',
            initiative: null,
            hidden: false,
            defeated: false,
          }),
        ]),
      })
    );
    const result = await listRefChoices({ kind: 'combatant' });
    expect(result.choices.map(c => [c.id, c.detail])).toEqual([
      ['c1', 'initiative 12, hidden'],
      ['c2', 'no initiative'],
    ]);
  });

  it('filters users by role', async () => {
    world.addUser({ id: 'u1', name: 'Claude', isGM: true, role: 4 });
    world.addUser({ id: 'u2', name: 'Player', isGM: false, role: 1, active: false });
    install();
    const gms = await listRefChoices({ kind: 'user', filter: { role: 'gm' } });
    expect(gms.choices.map(c => c.name)).toEqual(['Claude']);
    const players = await listRefChoices({ kind: 'user', filter: { role: 'player' } });
    expect(players.choices).toEqual([
      expect.objectContaining({ id: 'u2', detail: 'Player, offline', group: 'Players' }),
    ]);
  });

  it('lists conditions from the array or object shape of CONFIG.statusEffects', async () => {
    install();
    const config = globalThis.CONFIG as { statusEffects: unknown };
    config.statusEffects = [{ id: 'prone', name: 'Prone', img: '' }];
    expect((await listRefChoices({ kind: 'condition' })).choices).toEqual([
      { id: 'prone', name: 'Prone' },
    ]);
    config.statusEffects = { dead: { id: 'dead', name: 'Dead', img: '' } };
    expect((await listRefChoices({ kind: 'condition' })).choices.map(c => c.id)).toEqual(['dead']);
  });

  it("lists map notes, and lists only this tool's template Regions on v14", async () => {
    const scene = world.addScene({
      id: 's',
      name: 'Village',
      notes: [makeNote({ id: 'n1', text: 'Blood on the Vine' })],
    });
    world.setActiveScene(scene.id);
    install();
    expect((await listRefChoices({ kind: 'note' })).choices.map(c => c.name)).toEqual([
      'Blood on the Vine',
    ]);

    // MeasuredTemplate removed on v14 (14.352): templates are Regions, and only
    // this tool's own flagged ones are listed (never a hand-made GM region).
    delete (scene as { templates?: unknown }).templates;
    (scene as { regions?: unknown }).regions = {
      contents: [
        {
          id: 'r1',
          uuid: 'Scene.s.Region.r1',
          flags: { 'foundry-mcp-bridge': { template: { shape: 'circle', distance: 20 } } },
        },
        { id: 'gm-made', uuid: 'Scene.s.Region.gm-made', flags: {} },
      ],
    };
    const templates = await listRefChoices({ kind: 'template' });
    expect(templates.note).toMatch(/Regions/);
    expect(templates.choices).toEqual([{ id: 'r1', uuid: 'Scene.s.Region.r1', name: 'circle 20' }]);

    // Seen live on 14.368: `scene.templates` still exists (empty) and so does the
    // deprecated class; the Scene's embedded types decide (found in M3).
    (scene as { templates?: unknown }).templates = { contents: [] };
    const g = globalThis as { foundry: { documents: Record<string, unknown> } };
    const savedDocuments = g.foundry.documents;
    g.foundry.documents = {
      ...savedDocuments,
      BaseMeasuredTemplate: class {},
      BaseScene: class {
        static metadata = { embedded: { Note: 'notes', Region: 'regions', Level: 'levels' } };
      },
    };
    try {
      const onV14 = await listRefChoices({ kind: 'template' });
      expect(onV14.choices.map(c => c.id)).toEqual(['r1']);
    } finally {
      g.foundry.documents = savedDocuments;
    }
  });
});

describe('modules', () => {
  it('lists modules, and the game system only when asked', async () => {
    world.addModule({ id: 'lib-wrapper', title: 'libWrapper', active: true, version: '1.0' });
    install();
    const modules = await listRefChoices({ kind: 'module' });
    expect(modules.choices.map(c => c.group)).not.toContain('System');
    expect(modules.choices.map(c => c.id)).toContain('lib-wrapper');
    const withSystem = await listRefChoices({ kind: 'module', filter: { includeSystem: true } });
    expect(withSystem.choices[0]).toMatchObject({ group: 'System' });
  });
});

describe('skills and abilities (dnd5e)', () => {
  it('lists keys with labels', async () => {
    install();
    const config = globalThis.CONFIG as { DND5E: Record<string, unknown> };
    config.DND5E.skills = { prc: { label: 'Perception', ability: 'wis' } };
    config.DND5E.abilities = { str: { label: 'Strength', abbreviation: 'str' } };
    expect((await listRefChoices({ kind: 'skill' })).choices).toEqual([
      { id: 'prc', name: 'Perception', detail: 'wis' },
    ]);
    expect((await listRefChoices({ kind: 'ability' })).choices[0]).toMatchObject({
      id: 'str',
      name: 'Strength',
    });
  });
});

describe('request handling', () => {
  it('rejects unknown kinds and covers every module kind', async () => {
    install();
    await expect(listRefChoices({ kind: 'plan' })).rejects.toThrow(/Unknown kind "plan"/);
    for (const kind of MODULE_REF_KINDS) {
      await expect(listRefChoices({ kind, query: 'zz' })).resolves.toMatchObject({ kind });
    }
  });

  it('narrows by query over name, detail and group, and caps with truncated', async () => {
    for (let i = 0; i < 5; i++) world.addActor({ id: `a${i}`, name: `Zombie ${i}`, type: 'npc' });
    world.addActor({ id: 'pc', name: 'Aria', type: 'character' });
    install();
    const zombies = await listRefChoices({ kind: 'actor', query: 'zombie', limit: 2 });
    expect(zombies.choices).toHaveLength(2);
    expect(zombies.truncated).toBe(true);
    const byType = await listRefChoices({ kind: 'actor', query: 'CHARACTER' });
    expect(byType.choices.map(c => c.id)).toEqual(['pc']);
    const clamped = await listRefChoices({ kind: 'actor', limit: 99999 });
    expect(clamped.choices.length).toBeLessThanOrEqual(MAX_REF_LIMIT);
  });

  it('searches any world document by name for uuid pickers', async () => {
    world.addActor({ id: 'a1', name: 'Ismark' });
    world.addJournal({
      id: 'j1',
      name: 'Ismark notes',
      pages: [makeJournalPage({ id: 'p1', name: 'Ismark' })],
    });
    install();
    expect((await listRefChoices({ kind: 'document', query: 'i' })).note).toMatch(/2 letters/);
    const found = await listRefChoices({ kind: 'document', query: 'ismark' });
    expect(found.choices.map(c => c.group)).toEqual(['JournalEntry', 'Actor', 'JournalEntryPage']);
    const pagesOnly = await listRefChoices({
      kind: 'document',
      query: 'ismark',
      filter: { documentName: 'JournalEntryPage' },
    });
    expect(pagesOnly.choices.map(c => c.detail)).toEqual(['Ismark notes']);
  });
});
