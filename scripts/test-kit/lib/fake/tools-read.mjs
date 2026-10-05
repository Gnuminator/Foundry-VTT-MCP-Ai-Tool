/**
 * The fake's read-side tools and the two the builder writes with: world, characters, scenes,
 * compendium search and entries, creature discovery, token positions, actor creation. Result
 * shapes are copied from the real handlers (only the fields the kit reads).
 */
import {
  CREATURES,
  MONSTER_PACK,
  SIZE_CODE,
  compendiumEntry,
  findCreature,
} from './compendium.mjs';
import { ToolFailure, newId } from './state.mjs';

/** @param {any} v */
const num = v => (typeof v === 'number' ? v : Number(v));

/** Whether a creature matches `list-creatures-by-criteria` arguments. @param {any} c @param {any} a */
function matches(c, a) {
  const cr = a.challengeRating;
  if (cr !== undefined) {
    if (typeof cr === 'number' ? c.cr !== cr : c.cr < num(cr.min ?? 0) || c.cr > num(cr.max ?? 30))
      return false;
  }
  if (a.creatureType && c.type !== a.creatureType) return false;
  if (a.size && c.size !== a.size) return false;
  if (a.hasLegendaryActions === true && !c.legendary) return false;
  return true;
}

/** @type {Record<string, (w: import('./state.mjs').World, args: any) => any>} */
export const READ_TOOLS = {
  'get-world-info': w => ({
    id: w.worldId,
    title: w.title,
    system: { id: 'dnd5e', version: '6.0.5' },
    foundry: { version: '14.368' },
    users: { total: 3, active: 1, gms: 2, players: 1 },
    activeUsers: [{ id: 'fakeGmUser00001', name: 'Kit GM', isGM: true }],
    playerUsers: [{ id: 'fakePlayerUser01', name: 'Kit Player', active: false }],
  }),

  'list-characters': (w, args) => {
    const actors = [...w.actors.values()].filter(a => !args.type || a.type === args.type);
    return {
      characters: actors.map(a => ({ id: a.id, name: a.name, type: a.type, hasImage: true })),
      total: actors.length,
      filtered: args.type ? `Filtered by type: ${args.type}` : 'All characters',
    };
  },

  'list-scenes': w =>
    [...w.scenes.values()].map(s => ({
      id: s.id,
      name: s.name,
      active: s.id === w.activeSceneId,
      dimensions: { width: s.width * s.grid, height: s.height * s.grid },
      gridSize: s.grid,
      background: '',
      walls: s.walls,
      tokens: [...w.tokens.values()].filter(t => t.sceneId === s.id).length,
      lighting: s.lights,
      sounds: 0,
      navigation: true,
    })),

  'get-current-scene': (w, args) => {
    const scene = w.scenes.get(w.activeSceneId ?? '');
    if (!scene) throw new ToolFailure('Failed to get current scene: no active scene');
    const all = [...w.tokens.values()].filter(t => t.sceneId === scene.id);
    const shown = args.includeHidden ? all : all.filter(t => !t.hidden);
    return {
      id: scene.id,
      name: scene.name,
      active: true,
      dimensions: {
        width: scene.width * scene.grid,
        height: scene.height * scene.grid,
        padding: 0,
      },
      hasBackground: false,
      navigation: true,
      elements: { walls: scene.walls, lights: scene.lights, sounds: 0, notes: 0 },
      tokens: shown.map(t => ({
        id: t.id,
        name: t.name,
        position: { x: t.x * scene.grid, y: t.y * scene.grid },
        size: { width: 1, height: 1 },
        actorId: t.actorId,
        disposition: w.actors.get(t.actorId)?.type === 'character' ? 'friendly' : 'hostile',
        hidden: t.hidden,
        hasImage: true,
      })),
      tokenSummary: { total: shown.length, hasActors: shown.length, withoutActors: 0 },
    };
  },

  'search-compendium': (w, args) => {
    const query = String(args.query ?? '').toLowerCase();
    const results = CREATURES.filter(c => c.name.toLowerCase().includes(query)).map(c => ({
      id: c.id,
      name: c.name,
      type: 'npc',
      pack: { id: c.pack, label: c.pack === MONSTER_PACK ? 'Actors' : 'Monsters (SRD)' },
      description: '',
      hasImage: true,
      summary: `npc from ${c.pack}`,
    }));
    return {
      query: args.query,
      gameSystem: 'dnd5e',
      filterDescription: 'no filters',
      results,
      totalFound: results.length,
      showing: results.length,
      hasMore: false,
    };
  },

  'get-compendium-item': (w, args) => {
    const c = findCreature(String(args.packId), String(args.itemId));
    if (!c) throw new ToolFailure(`Failed to get compendium item ${args.packId}.${args.itemId}`);
    return compendiumEntry(c);
  },

  'list-creatures-by-criteria': (w, args) => {
    const found = CREATURES.filter(c => matches(c, args)).slice(0, args.limit ?? 50);
    return {
      gameSystem: 'dnd5e',
      creatures: found.map(c => ({
        id: c.id,
        name: c.name,
        pack: { id: c.pack, label: c.pack },
        challengeRating: c.cr,
        creatureType: c.type,
        size: c.size,
      })),
      totalFound: found.length,
    };
  },

  'get-character': (w, args) => {
    const id = String(args.identifier);
    const a = [...w.actors.values()].find(x => x.name === id || x.id === id);
    if (!a) throw new ToolFailure(`Failed to retrieve character "${id}": not found`);
    return {
      id: a.id,
      name: a.name,
      type: a.type,
      basicInfo: { hitPoints: { current: a.hp.value, max: a.hp.max, temp: a.hp.temp } },
      stats: {
        name: a.name,
        type: a.type,
        challengeRating: a.cr,
        level: a.level,
        hitPoints: { current: a.hp.value, max: a.hp.max, temp: a.hp.temp },
        creatureType: a.creatureType,
        size: a.size,
      },
      items: a.items.map(i => ({ id: i.id, name: i.name, type: i.type })),
      effects: [],
      hasImage: true,
    };
  },

  'get-token-positions': (w, args) => {
    const scene = w.scenes.get(String(args.sceneId ?? w.activeSceneId));
    if (!scene) throw new ToolFailure('Scene not found');
    const tokens = [...w.tokens.values()].filter(t => t.sceneId === scene.id);
    return {
      success: true,
      sceneId: scene.id,
      sceneName: scene.name,
      gridSize: scene.grid,
      tokenCount: tokens.length,
      tokens: tokens.map(t => ({
        tokenId: t.id,
        name: t.name,
        actorId: t.actorId,
        x: t.x * scene.grid,
        y: t.y * scene.grid,
        gridX: t.x,
        gridY: t.y,
        elevation: 0,
        category: 'npc',
        hidden: t.hidden,
        hp: { value: t.hp.value, max: t.hp.max },
        conditions: [],
      })),
    };
  },

  'create-actor-from-compendium': (w, args) => {
    const c = findCreature(String(args.packId), String(args.itemId));
    if (!c) throw new ToolFailure(`No compendium entry ${args.packId}.${args.itemId}`);
    const actors = (args.names ?? [c.name]).map((/** @type {string} */ name) => {
      const id = newId(w, 'npc');
      w.actors.set(id, {
        id,
        name,
        type: 'npc',
        hp: { value: c.hp, max: c.hp, temp: 0 },
        items: c.items.map((n, i) => ({
          id: newId(w, 'itm'),
          name: n,
          type: i === 0 ? 'weapon' : 'feat',
        })),
        cr: c.cr,
        creatureType: c.type,
        size: SIZE_CODE[/** @type {keyof typeof SIZE_CODE} */ (c.size)],
        level: 0,
        sourcePack: c.pack,
        sourceId: c.id,
      });
      return { id, name };
    });
    return { success: true, details: { actors } };
  },
};
