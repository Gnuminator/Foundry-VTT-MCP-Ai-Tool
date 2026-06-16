/**
 * createTestWorld + global installation for the Foundry-mock harness.
 *
 * `data-access.ts` reads the world through ambient browser globals that Foundry
 * injects (`game`, `ui`, `CONST`, `CONFIG`, `foundry.utils`, `Hooks`, and the
 * document-class constructors). A test builds a {@link TestWorld}, installs it
 * onto `globalThis`, exercises a `FoundryDataAccess` method, and tears the
 * globals down again — the same pattern the existing `session-events.test.ts`
 * uses, generalized so every data-access domain can reuse it.
 *
 * Test-only: excluded from the shipped build (see `tsconfig.json`).
 */

import { MockCollection, type Identified } from './collection.js';
import {
  makeActor,
  makeCombat,
  makeDocument,
  makeJournal,
  makeModule,
  makePack,
  makeScene,
  makeUser,
  resetIdCounter,
  type MakeActorOptions,
  type MakeCombatOptions,
  type MakeJournalOptions,
  type MakeModuleOptions,
  type MakePackOptions,
  type MakeSceneOptions,
  type MakeUserOptions,
} from './documents.js';

type AnyDoc = Record<string, any> & Identified;

export interface TestWorldOptions {
  /** dnd5e by default — the only supported system after the Phase 2.5 trim. */
  systemId?: string;
  systemVersion?: string;
  foundryVersion?: string;
  worldId?: string;
  worldTitle?: string;
  /** The acting user (`game.user`). Defaults to an active GM. */
  currentUser?: MakeUserOptions;
}

/**
 * An in-memory Foundry world. Mutate it through the `add*` helpers, then
 * {@link install} it onto `globalThis`.
 */
export class TestWorld {
  readonly actors = new MockCollection<AnyDoc>();
  readonly scenes = new MockCollection<AnyDoc>();
  readonly users = new MockCollection<AnyDoc>();
  readonly journal = new MockCollection<AnyDoc>();
  readonly items = new MockCollection<AnyDoc>();
  readonly messages = new MockCollection<AnyDoc>();
  readonly packs = new MockCollection<AnyDoc>();
  readonly folders = new MockCollection<AnyDoc>();
  readonly playlists = new MockCollection<AnyDoc>();
  readonly combats = new MockCollection<AnyDoc>();
  /** `game.modules` — a Map (Foundry's module registry has `.get`/`.values`). */
  readonly modules = new Map<string, AnyDoc>();

  /** Module-setting store (`game.settings.get(module, key)`), keyed `module.key`. */
  readonly settings = new Map<string, unknown>();
  /** The scene `game.scenes.current` resolves to. */
  currentSceneId: string | null = null;
  /** The combat `game.combat` resolves to (the active encounter). */
  currentCombat: AnyDoc | null = null;
  /** Notifications captured from `ui.notifications.*`. */
  readonly notifications: Array<{ level: string; message: string }> = [];

  constructor(
    readonly options: Required<Omit<TestWorldOptions, 'currentUser'>> & { currentUser: AnyDoc }
  ) {}

  /**
   * Register a document into a world collection and give it a top-level
   * `delete()` bound to that collection (used by rollback / delete paths).
   */
  private register(coll: MockCollection<AnyDoc>, doc: AnyDoc): AnyDoc {
    coll.add(doc);
    (doc as any).delete = () => {
      coll.delete(doc.id ?? '');
      return Promise.resolve(doc);
    };
    return doc;
  }

  addActor(opts?: MakeActorOptions): AnyDoc {
    return this.register(this.actors, makeActor(opts));
  }

  addScene(opts?: MakeSceneOptions): AnyDoc {
    const scene = this.register(this.scenes, makeScene(opts));
    if (scene.active && this.currentSceneId === null) this.currentSceneId = scene.id ?? null;
    return scene;
  }

  addUser(opts?: MakeUserOptions): AnyDoc {
    const user = makeUser(opts);
    this.users.add(user);
    return user;
  }

  addPack(opts?: MakePackOptions): AnyDoc {
    const pack = makePack(opts);
    this.packs.set(pack.metadata.id, pack);
    return pack;
  }

  addJournal(opts?: MakeJournalOptions): AnyDoc {
    return this.register(this.journal, makeJournal(opts));
  }

  /** Register a generic world item (`game.items`). */
  addItem(opts?: Record<string, any>): AnyDoc {
    return this.register(this.items, makeDocument(opts));
  }

  /** Register a folder (`game.folders`). */
  addFolder(opts?: Record<string, any>): AnyDoc {
    return this.register(this.folders, makeDocument(opts));
  }

  /** Register a chat message (`game.messages`). */
  addMessage(opts?: Record<string, any>): AnyDoc {
    return this.register(this.messages, makeDocument(opts));
  }

  addModule(opts?: MakeModuleOptions): AnyDoc {
    const module = makeModule(opts);
    this.modules.set(module.id ?? '', module);
    return module;
  }

  /** Set the active combat (`game.combat`) and register it under `game.combats`. */
  setCombat(opts?: MakeCombatOptions): AnyDoc {
    const combat = makeCombat(opts);
    this.combats.add(combat);
    this.currentCombat = combat;
    return combat;
  }

  /** Set the active scene (what `game.scenes.current` returns). */
  setActiveScene(sceneId: string): void {
    this.currentSceneId = sceneId;
  }

  setSetting(moduleId: string, key: string, value: unknown): void {
    this.settings.set(`${moduleId}.${key}`, value);
  }

  /**
   * Satisfy the write-permission gate (`permissionManager.checkWritePermission`
   * reads `allowWriteOperations`). Call before exercising a write path; omit it
   * to characterize the ACCESS_DENIED branch. Returns `this` for chaining.
   */
  enableWrites(maxActorsPerRequest = 20): this {
    this.setSetting('foundry-mcp-bridge', 'allowWriteOperations', true);
    this.setSetting('foundry-mcp-bridge', 'maxActorsPerRequest', maxActorsPerRequest);
    return this;
  }

  /** Build the `game` global from the current world state. */
  buildGame(): Record<string, any> {
    // `game.scenes.current` is a live getter on the scenes collection.
    Object.defineProperty(this.scenes, 'current', {
      configurable: true,
      get: () => (this.currentSceneId ? this.scenes.get(this.currentSceneId) : undefined),
    });
    Object.defineProperty(this.scenes, 'active', {
      configurable: true,
      get: () => (this.currentSceneId ? this.scenes.get(this.currentSceneId) : undefined),
    });
    const game: Record<string, any> = {
      ready: true,
      version: this.options.foundryVersion,
      system: { id: this.options.systemId, version: this.options.systemVersion },
      // `game.world` carries flag accessors — the write-path `auditLog` stores its
      // audit trail in world flags, so exercising it keeps the write paths honest.
      world: (() => {
        const flags: Record<string, any> = {};
        return {
          id: this.options.worldId,
          title: this.options.worldTitle,
          getFlag: (scope: string, key: string) => flags[scope]?.[key],
          setFlag: (scope: string, key: string, value: unknown) => {
            (flags[scope] ??= {})[key] = value;
            return Promise.resolve(value);
          },
        };
      })(),
      user: this.options.currentUser,
      actors: this.actors,
      scenes: this.scenes,
      users: this.users,
      journal: this.journal,
      items: this.items,
      messages: this.messages,
      packs: this.packs,
      folders: this.folders,
      playlists: this.playlists,
      modules: this.modules,
      combats: this.combats,
      socket: { emit: () => undefined, on: () => undefined },
      settings: {
        get: (moduleId: string, key: string) => this.settings.get(`${moduleId}.${key}`),
        set: (moduleId: string, key: string, value: unknown) => {
          this.settings.set(`${moduleId}.${key}`, value);
          return Promise.resolve(value);
        },
      },
    };
    // `game.combat` is a live getter so tests can set the combat before or after install.
    Object.defineProperty(game, 'combat', {
      configurable: true,
      get: () => this.currentCombat,
    });
    return game;
  }

  /** Install this world's globals onto `globalThis`. Returns an uninstall fn. */
  install(): () => void {
    return installFoundryGlobals(this);
  }
}

/**
 * Build a {@link TestWorld} with dnd5e defaults and an active GM user. Resets
 * the deterministic id counter so ids are stable run-to-run.
 */
export function createTestWorld(opts: TestWorldOptions = {}): TestWorld {
  resetIdCounter();
  const currentUser = makeUser({
    id: 'gm',
    name: 'Gamemaster',
    active: true,
    isGM: true,
    ...opts.currentUser,
  });
  return new TestWorld({
    systemId: opts.systemId ?? 'dnd5e',
    systemVersion: opts.systemVersion ?? '4.0.0',
    foundryVersion: opts.foundryVersion ?? '13.331',
    worldId: opts.worldId ?? 'test-world',
    worldTitle: opts.worldTitle ?? 'Test World',
    currentUser,
  });
}

// --- Global install/teardown -------------------------------------------------

const FOUNDRY_GLOBAL_KEYS = [
  'game',
  'ui',
  'CONST',
  'CONFIG',
  'foundry',
  'Hooks',
  'Actor',
  'Item',
  'Scene',
  'Folder',
  'ChatMessage',
  'JournalEntry',
  'Combat',
  'Roll',
  'fromUuid',
] as const;

/**
 * Install Foundry's ambient globals from a {@link TestWorld}. Captures whatever
 * was there before and restores it on teardown so suites don't leak into each
 * other.
 */
export function installFoundryGlobals(world: TestWorld): () => void {
  const g = globalThis as any;
  const saved = new Map<string, unknown>();
  for (const key of FOUNDRY_GLOBAL_KEYS) saved.set(key, g[key]);
  // Per-install counter for foundry.utils.randomID (stable within a test).
  let randomIdSeq = 0;

  g.game = world.buildGame();
  g.ui = {
    notifications: {
      info: (m: string) => world.notifications.push({ level: 'info', message: m }),
      warn: (m: string) => world.notifications.push({ level: 'warn', message: m }),
      error: (m: string) => world.notifications.push({ level: 'error', message: m }),
    },
  };
  g.CONST = {
    TOKEN_DISPOSITIONS: { HOSTILE: -1, NEUTRAL: 0, FRIENDLY: 1, SECRET: -2 },
    CHAT_MESSAGE_STYLES: { OTHER: 0, OOC: 1, IC: 2, EMOTE: 3 },
    DICE_ROLL_MODES: {
      PUBLIC: 'publicroll',
      PRIVATE: 'gmroll',
      BLIND: 'blindroll',
      SELF: 'selfroll',
    },
    DOCUMENT_OWNERSHIP_LEVELS: { NONE: 0, LIMITED: 1, OBSERVER: 2, OWNER: 3 },
  };
  g.CONFIG = { DND5E: {}, statusEffects: [], Actor: {}, Item: {} };
  g.foundry = {
    utils: {
      deepClone: <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
      duplicate: <T>(v: T): T => (v === undefined ? v : JSON.parse(JSON.stringify(v))),
      // Unique per call (transaction ids and created-doc ids must not collide).
      // Fixed-width zero-padded counter so e.g. seq 1 and 10 never alias.
      randomID: (length = 16): string =>
        `r${String((randomIdSeq += 1)).padStart(Math.max(1, length - 1), '0')}`.slice(0, length),
      mergeObject: (original: any, other: any = {}) => ({ ...original, ...other }),
      getProperty: (obj: any, path: string) =>
        path.split('.').reduce((node, key) => (node == null ? undefined : node[key]), obj),
      setProperty: (obj: any, path: string, value: unknown) => {
        const parts = path.split('.');
        let node = obj;
        for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
        node[parts[parts.length - 1]] = value;
        return true;
      },
      isEmpty: (v: any) => v == null || (typeof v === 'object' && Object.keys(v).length === 0),
      expandObject: (flat: Record<string, any>) => {
        const out: any = {};
        for (const [path, value] of Object.entries(flat)) {
          const parts = path.split('.');
          let node = out;
          for (let i = 0; i < parts.length - 1; i++) node = node[parts[i]] ??= {};
          node[parts[parts.length - 1]] = value;
        }
        return out;
      },
    },
  };
  const hooks: Record<string, Array<(...a: any[]) => void>> = {};
  g.Hooks = {
    on: (name: string, cb: (...a: any[]) => void) => (hooks[name] ??= []).push(cb),
    once: () => undefined,
    off: () => undefined,
    call: (name: string, ...args: any[]) => (hooks[name] ?? []).forEach(cb => cb(...args)),
    callAll: (name: string, ...args: any[]) => (hooks[name] ?? []).forEach(cb => cb(...args)),
  };
  // Document-class globals. The static factories register new documents into the
  // world (so they're findable + deletable, e.g. for rollback). Foundry's `create`
  // accepts a single object or an array; `createDocuments`/`updateDocuments`/
  // `deleteDocuments` are the batched forms used by the world-item write paths.
  const firstOf = (data: any) => (Array.isArray(data) ? data[0] : data);
  const asArray = (v: any) => (Array.isArray(v) ? v : v == null ? [] : [v]);
  const docClass = (addOne: (d: any) => AnyDoc, coll: MockCollection<AnyDoc>) => ({
    create: async (data: any) => addOne(firstOf(data)),
    createDocuments: async (arr: any[] = []) => asArray(arr).map(d => addOne(d)),
    updateDocuments: async (updates: any[] = []) => {
      const out: AnyDoc[] = [];
      for (const u of asArray(updates)) {
        const doc = coll.get(u?._id ?? u?.id);
        if (doc) {
          const { _id, id, ...changes } = u;
          await (doc as any).update(changes);
          out.push(doc);
        }
      }
      return out;
    },
    deleteDocuments: async (ids: string[] = []) => {
      asArray(ids).forEach(id => coll.delete(id));
      return ids;
    },
  });
  g.Actor = docClass(d => world.addActor(d), world.actors);
  g.Item = docClass(d => world.addItem(d), world.items);
  g.Scene = docClass(d => world.addScene(d), world.scenes);
  g.Folder = docClass(d => world.addFolder(d), world.folders);
  g.JournalEntry = docClass(d => world.addJournal(d), world.journal);
  g.ChatMessage = {
    create: async (data: any) => world.addMessage(firstOf(data)),
    // Foundry's getSpeaker({scene,actor,token,alias}) — we only need the alias
    // (the world/GM voice falls back to actor.name) for the chat write paths.
    getSpeaker: ({ actor, alias, token, scene }: any = {}) => ({
      scene: scene?.id ?? null,
      actor: actor?.id ?? null,
      token: token?.id ?? null,
      alias: alias ?? actor?.name ?? null,
    }),
  };
  g.Combat = function MockCombat() {};
  g.Roll = function MockRoll(formula: string) {
    return { formula, evaluate: async () => ({ total: 0 }), total: 0 };
  };
  g.fromUuid = async () => null;

  return function uninstall(): void {
    for (const [key, value] of saved) {
      if (value === undefined) delete g[key];
      else g[key] = value;
    }
  };
}
