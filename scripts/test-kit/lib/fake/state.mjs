/**
 * The fake world: a small in-memory game (actors with HP, tokens, scenes, one combat, guarded
 * changes with undo, a session log and play stats) that the fake's tools and GM actions work on.
 * It is not dnd5e. It is just enough state for the kit's scenarios to exercise the engine.
 */

/** @typedef {{value: number, max: number, temp: number}} Hp */
/** @typedef {{id: string, name: string, type: 'character' | 'npc', hp: Hp, items: Array<{id: string, name: string, type: string, sourceUuid?: string}>, cr: number, creatureType: string, size: string, level: number, sourcePack?: string, sourceId?: string, ownership?: Record<string, number>, sheet?: any}} FakeActor */
/** @typedef {{id: string, sceneId: string, actorId: string, name: string, x: number, y: number, hidden: boolean, hp: Hp}} FakeToken */
/** @typedef {{id: string, tokenId: string, actorId: string, name: string, initiative: number, hidden: boolean, category: string}} FakeCombatant */

/**
 * @param {{world: string, moduleVersion: string}} opts
 */
export function createWorld({ world, moduleVersion }) {
  return {
    worldId: world,
    title: 'AI Tool Kit (fake)',
    moduleVersion,
    gmActions: false,
    /** @type {Map<string, FakeActor>} */
    actors: new Map(),
    /** @type {Map<string, string>} */
    folders: new Map(),
    /** @type {Map<string, any>} */
    scenes: new Map(),
    /** @type {string | null} */
    activeSceneId: null,
    /** @type {Map<string, FakeToken>} */
    tokens: new Map(),
    /** @type {null | {id: string, sceneId: string, round: number, turn: number, combatants: FakeCombatant[], timeline: Array<{round: number, combatant: string, actions: any[]}>}} */
    combat: null,
    /** @type {Map<string, any>} */
    plans: new Map(),
    /** @type {any[]} */
    changes: [],
    /** @type {any[]} */
    log: [],
    /** @type {Array<{startedAt: string, endedAt: string | null}>} */
    sessions: [],
    /** @type {any[]} */
    combats: [],
    /** The combat that ended last, for the play-by-play. @type {any} */
    lastCombat: null,
    /**
     * Faults a test can switch on: feature names whose grant uuid does not resolve; quirks of
     * exerciseActor ("<actor name>|<feature identifier>" -> throws, noCard, noConsume, drift, refuse);
     * a rest that forgets the pact slots.
     */
    faults: {
      unresolved: /** @type {Set<string>} */ (new Set()),
      quirks: /** @type {Map<string, string>} */ (new Map()),
      restNoPact: false,
      /** quirks of the origin actions (lib/fake/origins.mjs): "<quirk>" or "<quirk>:<name>" */
      origin: /** @type {Set<string>} */ (new Set()),
    },
    seq: 0,
    rng: 20261005,
    lastMs: 0,
  };
}

/** @typedef {ReturnType<typeof createWorld>} World */

/** A 16 character id, like Foundry's. @param {World} w @param {string} [prefix] */
export function newId(w, prefix = '') {
  w.seq += 1;
  return `${prefix}${String(w.seq).padStart(5, '0')}`.padEnd(16, 'x').slice(0, 16);
}

/** A repeatable pseudo random number from 1 to `sides`. @param {World} w @param {number} sides */
export function roll(w, sides) {
  w.rng = (Math.imul(w.rng, 1664525) + 1013904223) >>> 0;
  return 1 + (w.rng % sides);
}

/** A millisecond clock that never repeats, so the log stays ordered. @param {World} w */
export function tick(w) {
  w.lastMs = Math.max(Date.now(), w.lastMs + 1);
  return w.lastMs;
}

/**
 * Adds a session log event (the shape of get-session-log's events).
 * @param {World} w
 * @param {string} eventType
 * @param {{actor?: FakeActor | null, description: string, details?: object}} e
 */
export function addEvent(w, eventType, { actor = null, description, details = {} }) {
  const timestampMs = tick(w);
  const event = {
    id: `evt-${timestampMs.toString(36)}-${w.log.length + 1}`,
    timestamp: new Date(timestampMs).toISOString(),
    timestampMs,
    eventType,
    actorName: actor ? actor.name : null,
    actorId: actor ? actor.id : null,
    description,
    details,
  };
  w.log.push(event);
  return event;
}

/**
 * The play-session record the stats tools read: the newest started session, or an implicit one.
 * @param {World} w
 */
export function currentSession(w) {
  if (!w.sessions.length)
    w.sessions.push({ startedAt: new Date(tick(w)).toISOString(), endedAt: null });
  return w.sessions[w.sessions.length - 1];
}

/**
 * Note an HP change in the stats of the running combat.
 * @param {World} w
 * @param {FakeActor} actor
 * @param {'damage' | 'healing'} kind
 * @param {number} amount
 */
export function noteHpInStats(w, actor, kind, amount) {
  if (!w.combat) return;
  const record = w.combats.find(c => c.combatId === w.combat?.id);
  if (!record) return;
  const tally = kind === 'damage' ? record.damageTaken : record.healing;
  tally[actor.name] = (tally[actor.name] ?? 0) + amount;
}

/** The token's name or the actor's, for the token on the active scene. @param {World} w @param {string} name */
export function findTarget(w, name) {
  const onScene = [...w.tokens.values()].filter(t => t.sceneId === w.activeSceneId);
  const token = onScene.find(t => t.name === name || t.id === name);
  if (token) return { token, actor: /** @type {FakeActor} */ (w.actors.get(token.actorId)) };
  const actor = [...w.actors.values()].find(a => a.name === name || a.id === name);
  const own = actor && onScene.find(t => t.actorId === actor.id);
  if (actor && own) return { token: own, actor };
  return null;
}

/** @param {World} w @param {FakeToken} token */
export function documentUuid(w, token) {
  return `Scene.${token.sceneId}.Token.${token.id}.Actor.${token.actorId}`;
}

/** The error a tool raises; the server turns it into the dashboard's 422 reply. */
export class ToolFailure extends Error {
  /** @param {string} message */
  constructor(message) {
    super(message);
    this.name = 'ToolFailure';
  }
}
