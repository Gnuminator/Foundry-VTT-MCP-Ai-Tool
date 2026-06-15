/**
 * Document builders for the Foundry-mock harness.
 *
 * Foundry documents are duck-typed at the points `data-access.ts` touches them
 * (it reads `.id` / `.name` / `.system` / `.items` and casts to `any` almost
 * everywhere), so these builders return plain objects shaped like the real
 * documents rather than a deep class hierarchy. Each factory takes a partial
 * override so a test can express only the fields it cares about; everything
 * else gets a sensible dnd5e-flavoured default.
 *
 * Embedded document sets (`actor.items`, `actor.effects`, `scene.tokens`, …)
 * are real {@link MockCollection}s so the same `.get/.find/.filter/.map` surface
 * works at every level. A small set of write helpers (`update`, `getFlag`,
 * `setFlag`, `toObject`) is attached so the write-path domains can be
 * characterized later without reshaping the harness.
 *
 * Test-only: excluded from the shipped build (see `tsconfig.json`).
 */

import { MockCollection } from './collection.js';

/** Anything shaped enough to live in a {@link MockCollection}. */
type AnyDoc = Record<string, any> & { id?: string | null; name?: string | null };

function deepClone<T>(value: T): T {
  return value === undefined ? value : JSON.parse(JSON.stringify(value));
}

/**
 * Attach the common Foundry document instance methods (mutating, in-memory).
 * Kept intentionally small — extend per-domain as write characterization needs.
 */
function withDocumentMethods<T extends AnyDoc>(doc: T): T {
  const d = doc as any;
  d.flags ??= {};
  d.getFlag = (scope: string, key: string) => d.flags?.[scope]?.[key];
  d.setFlag = (scope: string, key: string, value: unknown) => {
    (d.flags[scope] ??= {})[key] = value;
    return Promise.resolve(d);
  };
  d.unsetFlag = (scope: string, key: string) => {
    delete d.flags?.[scope]?.[key];
    return Promise.resolve(d);
  };
  d.update = (changes: Record<string, any>) => {
    applyFlatChanges(d, changes);
    return Promise.resolve(d);
  };
  d.toObject = () => stripMethods(d);
  return doc;
}

/** Strip the attached helper functions so `toObject()` yields plain data. */
function stripMethods(doc: AnyDoc): AnyDoc {
  const out: AnyDoc = {};
  for (const [k, v] of Object.entries(doc)) {
    if (typeof v === 'function') continue;
    if (v instanceof MockCollection) {
      out[k] = v.map(child =>
        typeof (child as any).toObject === 'function' ? (child as any).toObject() : child
      );
    } else {
      out[k] = v;
    }
  }
  return deepClone(out);
}

/**
 * Apply a Foundry-style flat update (`"system.attributes.hp.value": 3`) plus
 * shallow nested objects onto a document in place. Enough for the write paths
 * data-access exercises (it builds explicit change objects).
 */
function applyFlatChanges(target: AnyDoc, changes: Record<string, any>): void {
  for (const [path, value] of Object.entries(changes)) {
    if (path.includes('.')) {
      const parts = path.split('.');
      let node: any = target;
      for (let i = 0; i < parts.length - 1; i++) {
        node[parts[i]!] ??= {};
        node = node[parts[i]!];
      }
      node[parts[parts.length - 1]!] = value;
    } else {
      target[path] = value;
    }
  }
}

// --- Actors & embedded docs --------------------------------------------------

export interface MakeItemOptions {
  id?: string;
  name?: string;
  type?: string;
  img?: string;
  system?: Record<string, any>;
  _source?: Record<string, any>;
  [extra: string]: any;
}

export function makeItem(opts: MakeItemOptions = {}): AnyDoc {
  const {
    id = randomId('item'),
    name = 'Item',
    type = 'loot',
    img,
    system = {},
    _source,
    ...rest
  } = opts;
  return withDocumentMethods({
    id,
    name,
    type,
    ...(img ? { img } : {}),
    system,
    _source: _source ?? { system: deepClone(system) },
    ...rest,
  });
}

export interface MakeEffectOptions {
  id?: string;
  name?: string;
  label?: string;
  icon?: string;
  disabled?: boolean;
  duration?: Record<string, any>;
  statuses?: Iterable<string>;
  _source?: Record<string, any>;
  [extra: string]: any;
}

export function makeEffect(opts: MakeEffectOptions = {}): AnyDoc {
  const { id = randomId('effect'), name = 'Effect', disabled = false, statuses, ...rest } = opts;
  return withDocumentMethods({
    id,
    name,
    disabled,
    ...(statuses ? { statuses: new Set(statuses) } : {}),
    ...rest,
  });
}

export interface MakeActorOptions {
  id?: string;
  name?: string;
  type?: string;
  img?: string;
  system?: Record<string, any>;
  items?: AnyDoc[];
  effects?: AnyDoc[];
  ownership?: Record<string, number>;
  _source?: Record<string, any>;
  [extra: string]: any;
}

export function makeActor(opts: MakeActorOptions = {}): AnyDoc {
  const {
    id = randomId('actor'),
    name = 'Actor',
    type = 'character',
    img,
    system = {},
    items = [],
    effects = [],
    ownership,
    _source,
    ...rest
  } = opts;
  return withDocumentMethods({
    id,
    name,
    type,
    ...(img ? { img } : {}),
    system,
    items: new MockCollection(items),
    effects: new MockCollection(effects),
    ...(ownership ? { ownership } : {}),
    _source: _source ?? { system: deepClone(system) },
    ...rest,
  });
}

// --- Scenes & embedded docs --------------------------------------------------

export interface MakeSceneOptions {
  id?: string;
  name?: string;
  img?: string;
  width?: number;
  height?: number;
  padding?: number;
  active?: boolean;
  navigation?: boolean;
  tokens?: AnyDoc[];
  walls?: AnyDoc[];
  lights?: AnyDoc[];
  sounds?: AnyDoc[];
  notes?: AnyDoc[];
  _source?: Record<string, any>;
  [extra: string]: any;
}

export function makeScene(opts: MakeSceneOptions = {}): AnyDoc {
  const {
    id = randomId('scene'),
    name = 'Scene',
    img,
    width = 4000,
    height = 3000,
    padding = 0.25,
    active = false,
    navigation = true,
    tokens = [],
    walls = [],
    lights = [],
    sounds = [],
    notes = [],
    _source,
    ...rest
  } = opts;
  return withDocumentMethods({
    id,
    name,
    ...(img ? { img } : {}),
    width,
    height,
    padding,
    active,
    navigation,
    tokens: new MockCollection(tokens),
    walls: new MockCollection(walls),
    lights: new MockCollection(lights),
    sounds: new MockCollection(sounds),
    notes: new MockCollection(notes),
    _source: _source ?? { background: { src: img ?? null } },
    ...rest,
  });
}

export interface MakeTokenOptions {
  id?: string;
  name?: string;
  x?: number;
  y?: number;
  width?: number;
  height?: number;
  actorId?: string;
  hidden?: boolean;
  disposition?: number;
  texture?: { src?: string };
  [extra: string]: any;
}

export function makeToken(opts: MakeTokenOptions = {}): AnyDoc {
  const {
    id = randomId('token'),
    name = 'Token',
    x = 0,
    y = 0,
    width = 1,
    height = 1,
    hidden = false,
    disposition = 0,
    texture = { src: '' },
    ...rest
  } = opts;
  return { id, name, x, y, width, height, hidden, disposition, texture, ...rest };
}

export function makeNote(
  opts: { id?: string; text?: string; x?: number; y?: number; [k: string]: any } = {}
): AnyDoc {
  const { id = randomId('note'), text = '', x = 0, y = 0, ...rest } = opts;
  return { id, text, x, y, ...rest };
}

// --- Users, packs, world, system --------------------------------------------

export interface MakeUserOptions {
  id?: string;
  name?: string;
  active?: boolean;
  isGM?: boolean;
  [extra: string]: any;
}

export function makeUser(opts: MakeUserOptions = {}): AnyDoc {
  const { id = randomId('user'), name = 'User', active = true, isGM = false, ...rest } = opts;
  return { id, name, active, isGM, ...rest };
}

export interface MakePackOptions {
  id?: string;
  label?: string;
  type?: string;
  system?: string;
  private?: boolean;
  /** Documents the pack would resolve via `getDocuments()` / `getIndex()`. */
  documents?: AnyDoc[];
  [extra: string]: any;
}

export function makePack(opts: MakePackOptions = {}): AnyDoc {
  const {
    id = 'world.pack',
    label = 'Pack',
    type = 'Actor',
    system = 'dnd5e',
    private: isPrivate = false,
    documents = [],
    ...rest
  } = opts;
  const docs = new MockCollection(documents);
  return {
    // Foundry packs expose their identity through `metadata`.
    metadata: { id, label, type, system, private: isPrivate, packageName: id.split('.')[0] },
    documentName: type,
    index: new MockCollection(
      documents.map(d => ({ id: d.id, name: d.name, type: (d as any).type }))
    ),
    getDocuments: async () => docs.contents,
    getDocument: async (docId: string) => docs.get(docId),
    getIndex: async () =>
      new MockCollection(documents.map(d => ({ id: d.id, name: d.name, type: (d as any).type }))),
    ...rest,
  };
}

// --- Deterministic ids -------------------------------------------------------

let idCounter = 0;

/** Reset the deterministic id counter (call in `beforeEach` for stable ids). */
export function resetIdCounter(): void {
  idCounter = 0;
}

/**
 * Deterministic 16-char id (Foundry id length) so tests are reproducible and
 * `getCharacterInfo`'s `identifier.length === 16` ID-vs-name branch is exercised.
 */
export function randomId(prefix = 'doc'): string {
  idCounter += 1;
  const base = `${prefix}${idCounter}`;
  return (base + 'xxxxxxxxxxxxxxxx').slice(0, 16);
}
