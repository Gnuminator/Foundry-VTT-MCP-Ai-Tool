/**
 * Hand-written type declarations for the parts of the Foundry VTT v14 core API
 * this module uses.
 *
 * They replace `@league-of-foundry-developers/foundry-vtt-types` 9.x, which
 * described the wrong generation (v9) and pulled in more than 200 packages
 * (including two "critical" dev advisories). Rules for this file:
 *
 * - Declare what the module touches, typed to the v14 shapes (API docs built from
 *   14.365, release notes up to 14.368, source of 14.368). Documents the module
 *   reads as data (tokens, notes, walls, lights, regions, playlists, tables) and
 *   rolls live in the sibling `foundry-v14-*.d.ts` files with their full schema.
 * - Game-system data (`system`) is the empty `FoundryActorSystem` /
 *   `FoundryItemSystem` here, so this file stays system-agnostic; the system
 *   adapter augments them (`src/systems/dnd5e/system-data.d.ts`).
 * - Where v13 and v14 differ, the field is optional or documented here, and the
 *   code reads it through the adapter's feature detection.
 *
 * jQuery comes from `@types/jquery` (v14 still ships jQuery 3).
 */

declare global {
  // -------------------------------------------------------------------------
  // Documents
  // -------------------------------------------------------------------------

  /** Ownership level names accepted by `testUserPermission`. */
  type FoundryOwnershipLevelName = 'NONE' | 'LIMITED' | 'OBSERVER' | 'OWNER';

  /** Database operation options (`{render, diff, recursive, keepId, ...}`). */
  type FoundryOperation = Record<string, unknown>;

  /** Members shared by every Document instance. */
  interface FoundryDocument {
    readonly id: string;
    readonly uuid: string;
    readonly documentName: string;
    readonly parent: FoundryDocument | null;
    /** Raw source data (what is stored in the database). */
    readonly _source: Record<string, any>;
    flags: Record<string, Record<string, unknown> | undefined>;
    getFlag(scope: string, key: string): unknown;
    setFlag(scope: string, key: string, value: unknown): Promise<this>;
    unsetFlag(scope: string, key: string): Promise<this>;
    update(data: Record<string, unknown>, operation?: FoundryOperation): Promise<this | undefined>;
    delete(operation?: FoundryOperation): Promise<this | undefined>;
    toObject(source?: boolean): Record<string, any>;
    testUserPermission(
      user: User,
      permission: FoundryOwnershipLevelName | number,
      options?: { exact?: boolean }
    ): boolean;
    readonly isOwner: boolean;
    /** The document's sheet application, when it has one. */
    readonly sheet: { render(force?: boolean, options?: Record<string, unknown>): unknown } | null;
    canUserModify(user: User, action: 'create' | 'update' | 'delete', data?: object): boolean;
    createEmbeddedDocuments(
      embeddedName: string,
      data: Record<string, unknown>[],
      operation?: FoundryOperation
    ): Promise<FoundryDocument[]>;
    updateEmbeddedDocuments(
      embeddedName: string,
      updates: Record<string, unknown>[],
      operation?: FoundryOperation
    ): Promise<FoundryDocument[]>;
    deleteEmbeddedDocuments(
      embeddedName: string,
      ids: string[],
      operation?: FoundryOperation
    ): Promise<FoundryDocument[]>;
  }

  /** Static side of a Document class (`Actor.create`, `Item.updateDocuments`, ...). */
  interface FoundryDocumentClass<T> {
    readonly documentName: string;
    readonly implementation: FoundryDocumentClass<T>;
    create(data: Record<string, unknown>, operation?: FoundryOperation): Promise<T | undefined>;
    createDocuments(data: Record<string, unknown>[], operation?: FoundryOperation): Promise<T[]>;
    updateDocuments(updates: Record<string, unknown>[], operation?: FoundryOperation): Promise<T[]>;
    deleteDocuments(ids: string[], operation?: FoundryOperation): Promise<T[]>;
  }

  /** A top-level (world) document with a name, image, folder and ownership. */
  interface FoundryWorldDocument extends FoundryDocument {
    name: string;
    readonly folder: Folder | null;
    readonly ownership: Record<string, number>;
  }

  /**
   * Game-system data of an Actor or Item. Empty here; the system adapter augments them
   * (`src/systems/dnd5e/system-data.d.ts`).
   */
  interface FoundryActorSystem {}
  interface FoundryItemSystem {}

  interface Actor extends FoundryWorldDocument {
    readonly type: string;
    img: string;
    system: FoundryActorSystem;
    readonly items: FoundryCollection<Item>;
    readonly effects: FoundryCollection<ActiveEffect>;
    readonly prototypeToken: FoundryPrototypeToken;
    /** True for the synthetic actor of an unlinked token. */
    readonly isToken: boolean;
    /** The token of a synthetic actor, else null. */
    readonly token: TokenDocument | null;
    readonly hasPlayerOwner: boolean;
    /** Status ids currently applied (core, v11+). */
    readonly statuses: Set<string>;
    toggleStatusEffect(
      statusId: string,
      options?: { active?: boolean; overlay?: boolean; levels?: number }
    ): Promise<ActiveEffect | boolean | undefined>;
    getActiveTokens(linked?: boolean, document?: false): Token[];
    getActiveTokens(linked: boolean, document: true): TokenDocument[];
    getRollData(): Record<string, unknown>;
  }

  interface Item extends FoundryWorldDocument {
    readonly type: string;
    img: string;
    system: FoundryItemSystem;
    readonly effects: FoundryCollection<ActiveEffect>;
    /** The owning actor for embedded items, else null. */
    readonly actor: Actor | null;
  }

  /**
   * v14 ActiveEffect. `changes` moved to `system.changes` (14.353) with a string
   * `type` instead of the numeric `mode` (14.352); `duration` became
   * `{value, units, expiry}` (14.353); `icon` was removed for `img` (14.349).
   * The legacy v13 fields stay optional so the adapter can read both shapes.
   */
  interface ActiveEffect extends FoundryDocument {
    name: string;
    img: string;
    readonly type?: string;
    disabled: boolean;
    readonly statuses: Set<string>;
    origin: string | null;
    system?: Record<string, unknown>;
    /** v13 shape (v14 keeps a deprecated compatibility getter). */
    changes?: { key: string; mode?: number; type?: string; value: unknown; priority?: number }[];
    duration: Record<string, any>;
    readonly isTemporary: boolean;
    /** v14: whether the effect's duration has run out. */
    readonly expired?: boolean;
  }

  interface ChatMessage extends FoundryDocument {
    content: string;
    flavor?: string;
    readonly author?: User | null;
    readonly speaker: ChatSpeakerData;
    whisper: string[];
    blind: boolean;
    readonly type?: string;
    readonly isRoll: boolean;
    readonly rolls: Roll[];
    readonly visible: boolean;
    system?: Record<string, unknown>;
  }

  interface ChatSpeakerData {
    scene?: string | null;
    actor?: string | null;
    token?: string | null;
    alias?: string;
  }

  interface ChatMessageClass extends FoundryDocumentClass<ChatMessage> {
    getSpeaker(options?: {
      scene?: Scene | null;
      actor?: Actor | null | undefined;
      token?: TokenDocument | null;
      alias?: string;
    }): ChatSpeakerData;
  }

  interface User extends FoundryDocument {
    name: string;
    readonly isGM: boolean;
    readonly active: boolean;
    readonly role: number;
    readonly character: Actor | null;
    readonly color: unknown;
    readonly targets: FoundryUserTargets;
    readonly isSelf: boolean;
    hasPermission(permission: string): boolean;
    hasRole(role: string | number, options?: { exact?: boolean }): boolean;
    updateTokenTargets(targetIds?: string[]): void;
    /**
     * Send a query to this user's client (v13+). The receiving handler is
     * `CONFIG.queries[name]`; since 14.352 it also receives the sender (see
     * {@link FoundryQueryContext}).
     */
    query(name: string, data?: unknown, options?: { timeout?: number }): Promise<unknown>;
  }

  interface Folder extends FoundryDocument {
    name: string;
    readonly type: string;
    readonly folder: Folder | null;
  }

  interface JournalEntry extends FoundryWorldDocument {
    readonly pages: FoundryCollection<JournalEntryPage>;
  }

  interface JournalEntryPage extends FoundryDocument {
    name: string;
    readonly type: string;
    readonly ownership: Record<string, number>;
    text: { content?: string; format?: number; markdown?: string };
    /** Media source for image/pdf/video pages. */
    src?: string | null;
    /** Image pages: the caption shown under the image (`image.caption`). */
    image?: { caption?: string };
  }

  /** v14 Scene Level (14.353+): backgrounds and elevation live here now. */
  interface SceneLevel extends FoundryDocument {
    name: string;
    background: { src: string | null; tint?: string; alphaThreshold?: number; color?: string };
    elevation: { bottom: number; top: number };
  }

  interface Scene extends FoundryWorldDocument {
    readonly active: boolean;
    navName: string;
    width: number;
    height: number;
    readonly grid: { size: number; distance: number; units: string; type: number };
    /** Derived canvas dimensions (padding included). */
    readonly dimensions: {
      width: number;
      height: number;
      sceneWidth: number;
      sceneHeight: number;
      /** The scene area inside the padding (client/documents/scene.mjs:507). */
      sceneRect: { x: number; y: number; width: number; height: number };
    };
    environment: {
      darknessLevel: number;
      darknessLock?: boolean;
      globalLight: { enabled: boolean; bright: boolean; [key: string]: unknown };
      [key: string]: unknown;
    };
    readonly tokens: FoundryCollection<TokenDocument>;
    readonly notes: FoundryCollection<NoteDocument>;
    readonly walls: FoundryCollection<WallDocument>;
    readonly lights: FoundryCollection<AmbientLightDocument>;
    readonly regions: FoundryCollection<RegionDocument>;
    /**
     * v13 only: removed in 14.352 (templates became Regions); 14.368 keeps an empty compat
     * getter. Read only behind `supportsMeasuredTemplates()`.
     */
    readonly templates?: FoundryCollection<FoundryDocument>;
    /** v14 only (14.353+). */
    readonly levels?: FoundryCollection<SceneLevel>;
    /** v14 only: id of the level shown first. */
    readonly initialLevel?: string | SceneLevel | null;
    activate(): Promise<this>;
    view(): Promise<this>;
  }

  interface Combatant extends FoundryDocument {
    name: string;
    readonly actor: Actor | null;
    readonly token: TokenDocument | null;
    readonly tokenId: string | null;
    readonly sceneId: string | null;
    readonly actorId: string | null;
    initiative: number | null;
    hidden: boolean;
    defeated: boolean;
  }

  interface Combat extends FoundryDocument {
    readonly combatants: FoundryCollection<Combatant>;
    readonly combatant: Combatant | null;
    round: number;
    turn: number | null;
    readonly started: boolean;
    readonly active: boolean;
    readonly scene: Scene | null;
    nextTurn(): Promise<this>;
    previousTurn(): Promise<this>;
    nextRound(): Promise<this>;
    startCombat(): Promise<this>;
    endCombat(): Promise<this | undefined>;
    rollInitiative(ids: string[], options?: Record<string, unknown>): Promise<this>;
  }

  // -------------------------------------------------------------------------
  // Collections (core `Collection` extends Map but iterates values)
  // -------------------------------------------------------------------------

  interface FoundryCollection<T> {
    readonly size: number;
    readonly contents: T[];
    get(key: string, options?: { strict?: boolean }): T | undefined;
    getName(name: string, options?: { strict?: boolean }): T | undefined;
    has(key: string): boolean;
    find(predicate: (value: T, index: number) => boolean): T | undefined;
    filter(predicate: (value: T, index: number) => boolean): T[];
    map<R>(transformer: (value: T, index: number) => R): R[];
    some(predicate: (value: T, index: number) => boolean): boolean;
    reduce<R>(reducer: (accumulator: R, value: T, index: number) => R, initial: R): R;
    forEach(callback: (value: T, key: string) => void): void;
    keys(): IterableIterator<string>;
    values(): IterableIterator<T>;
    entries(): IterableIterator<[string, T]>;
    [Symbol.iterator](): IterableIterator<T>;
  }

  interface Users extends FoundryCollection<User> {
    /** The active GM with the lowest id (v11+), or null. */
    readonly activeGM: User | null;
    readonly current: User | null;
  }

  interface Scenes extends FoundryCollection<Scene> {
    readonly active: Scene | null | undefined;
    readonly current: Scene | null | undefined;
    readonly viewed: Scene | null | undefined;
  }

  interface CompendiumMetadata {
    id: string;
    name: string;
    label: string;
    type: string;
    system?: string;
    packageName: string;
    packageType: string;
    ownership?: Record<string, string>;
    /** @deprecated removed in v10 (replaced by `ownership`); always undefined on v14. */
    private?: boolean;
  }

  interface CompendiumIndexEntry {
    _id: string;
    name: string;
    type?: string;
    img?: string;
    uuid?: string;
    [field: string]: unknown;
  }

  interface CompendiumCollection<T = any> extends FoundryCollection<T> {
    readonly collection: string;
    readonly metadata: CompendiumMetadata;
    readonly documentName: string;
    readonly title: string;
    readonly visible: boolean;
    readonly index: FoundryCollection<CompendiumIndexEntry>;
    readonly indexed: boolean;
    getIndex(options?: { fields?: string[] }): Promise<FoundryCollection<CompendiumIndexEntry>>;
    getDocument(id: string): Promise<T | undefined | null>;
    getDocuments(query?: Record<string, unknown>): Promise<T[]>;
  }

  // -------------------------------------------------------------------------
  // Game, settings, packages
  // -------------------------------------------------------------------------

  interface ClientSettings {
    get(namespace: string, key: string): unknown;
    set(namespace: string, key: string, value: unknown): Promise<unknown>;
    register(namespace: string, key: string, config: Record<string, unknown>): void;
    registerMenu(namespace: string, key: string, config: Record<string, unknown>): void;
  }

  interface FoundryPackage {
    readonly id: string;
    readonly title: string;
    readonly version: string;
    readonly active?: boolean;
    readonly api?: unknown;
    readonly compatibility?: { minimum?: string; verified?: string; maximum?: string };
    readonly relationships?: Record<string, unknown>;
    /** Manifest `flags`, keyed by scope. */
    readonly flags?: Record<string, Record<string, unknown> | undefined>;
  }

  interface FoundryModule extends FoundryPackage {
    readonly active: boolean;
  }

  /** `game.system`; `documentTypes` lists the system's subtypes per document name. */
  interface FoundrySystem extends FoundryPackage {
    readonly documentTypes: Record<string, Record<string, unknown>>;
  }

  /**
   * `game.world` is a package (a DataModel), not a Document: it has no
   * `setFlag`, `getFlag` or `update` in v13 or v14.
   */
  interface FoundryWorld {
    readonly id: string;
    readonly title: string;
    readonly system?: string;
    /** The join page details (I-086): description HTML, background path, join theme. */
    readonly description?: string;
    readonly background?: string | null;
    readonly joinTheme?: string;
    updateSource(changes: Record<string, unknown>): unknown;
  }

  interface Game {
    readonly ready: boolean;
    readonly version: string;
    readonly release: { generation: number; build: number; version?: string };
    readonly world: FoundryWorld;
    readonly system: FoundrySystem;
    readonly modules: FoundryCollection<FoundryModule>;
    /** The current user; null only before the `setup` hook. */
    readonly user: User;
    readonly users: Users;
    readonly actors: FoundryCollection<Actor>;
    readonly items: FoundryCollection<Item>;
    readonly scenes: Scenes;
    readonly journal: FoundryCollection<JournalEntry>;
    readonly messages: FoundryCollection<ChatMessage>;
    readonly folders: FoundryCollection<Folder>;
    readonly playlists: FoundryCollection<PlaylistDocument>;
    readonly combats: FoundryCollection<Combat> & { readonly active?: Combat | null };
    readonly combat: Combat | null;
    readonly tables: FoundryCollection<RollTableDocument>;
    readonly packs: FoundryCollection<CompendiumCollection>;
    readonly settings: ClientSettings;
    readonly socket: {
      emit(event: string, ...args: unknown[]): void;
      on(event: string, handler: (...args: any[]) => void): void;
      off(event: string, handler?: (...args: any[]) => void): void;
    };
    readonly i18n: {
      readonly lang: string;
      localize(key: string): string;
      format(key: string, data?: Record<string, unknown>): string;
      has(key: string): boolean;
    };
    readonly time: { readonly worldTime: number };
    readonly paused: boolean;
  }

  // -------------------------------------------------------------------------
  // CONFIG, CONST, foundry namespace
  // -------------------------------------------------------------------------

  /**
   * Context passed to a `CONFIG.queries` handler. v13 passes only `timeout`;
   * since 14.352 the requesting User is passed too (foundryvtt#13418). The API
   * docs do not list `user` yet, so treat a missing `user` as "reject".
   */
  interface FoundryQueryContext {
    timeout?: number;
    user?: User;
  }

  type FoundryQueryHandler = (data: any, context?: FoundryQueryContext) => unknown;

  interface FoundryStatusEffect {
    id: string;
    name: string;
    img: string;
    [field: string]: unknown;
  }

  interface FoundryConfig {
    queries: Record<string, FoundryQueryHandler>;
    /** Array in core and dnd5e 5.x; an object keyed by id in dnd5e 6.0. */
    statusEffects: FoundryStatusEffect[] | Record<string, FoundryStatusEffect>;
    [key: string]: any;
  }

  interface FoundryConst {
    readonly DOCUMENT_OWNERSHIP_LEVELS: {
      readonly INHERIT: -1;
      readonly NONE: 0;
      readonly LIMITED: 1;
      readonly OBSERVER: 2;
      readonly OWNER: 3;
    };
    readonly USER_ROLES: {
      readonly NONE: 0;
      readonly PLAYER: 1;
      readonly TRUSTED: 2;
      readonly ASSISTANT: 3;
      readonly GAMEMASTER: 4;
    };
    readonly TOKEN_DISPOSITIONS: {
      readonly SECRET: -2;
      readonly HOSTILE: -1;
      readonly NEUTRAL: 0;
      readonly FRIENDLY: 1;
    };
    readonly CHAT_MESSAGE_STYLES: {
      readonly OTHER: 0;
      readonly OOC: 1;
      readonly IC: 2;
      readonly EMOTE: 3;
    };
    /** @deprecated since 14.355 (`CONFIG.ChatMessage.modes`); removed in v16. */
    readonly DICE_ROLL_MODES?: Record<string, string>;
    readonly [key: string]: unknown;
  }

  interface FoundryUtils {
    randomID(length?: number): string;
    deepClone<T>(original: T): T;
    mergeObject<T extends object>(original: T, other?: object, options?: object): T;
    getProperty(object: object, key: string): unknown;
    setProperty(object: object, key: string, value: unknown): boolean;
    hasProperty(object: object, key: string): boolean;
    flattenObject(object: object): Record<string, unknown>;
    expandObject(object: Record<string, unknown>): Record<string, unknown>;
    diffObject(original: object, other: object, options?: object): Record<string, unknown>;
    objectsEqual(a: unknown, b: unknown): boolean;
    isEmpty(value: unknown): boolean;
    isNewerVersion(v1: string | number, v0: string | number): boolean;
    /** A server path with the route prefix, e.g. `getRoute('setup')` is `/setup`. */
    getRoute(path: string): string;
  }

  interface FoundryFilePicker {
    browse(
      source: string,
      target: string,
      options?: Record<string, unknown>
    ): Promise<{ files: string[]; dirs: string[] }>;
    upload(
      source: string,
      path: string,
      file: File,
      body?: Record<string, unknown>,
      options?: Record<string, unknown>
    ): Promise<unknown>;
    createDirectory(
      source: string,
      target: string,
      options?: Record<string, unknown>
    ): Promise<unknown>;
  }

  interface FoundryNamespace {
    readonly utils: FoundryUtils;
    readonly applications: {
      readonly apps: { readonly FilePicker: { readonly implementation: FoundryFilePicker } };
      readonly [key: string]: unknown;
    };
    /** v14 exposes `foundry.data.ActiveEffectTypeDataModel` (core generation 14 marker). */
    readonly data: { readonly [key: string]: unknown };
    readonly documents: {
      readonly collections: {
        /** The journal collection class: `Journal.show` is Foundry's Show Players. */
        readonly Journal: {
          show(
            doc: FoundryDocument,
            options?: { force?: boolean; users?: string[] }
          ): Promise<FoundryDocument>;
        };
        readonly [key: string]: unknown;
      };
      readonly [key: string]: unknown;
    };
  }

  // -------------------------------------------------------------------------
  // Canvas, hooks, UI, applications, dice
  // -------------------------------------------------------------------------

  interface FoundryCanvas {
    readonly ready: boolean;
    readonly scene: Scene | null;
    readonly grid: { readonly size: number; readonly distance: number } | null;
    /** v14: the level currently viewed. */
    readonly level?: { readonly id: string } | null;
    readonly screenDimensions?: [number, number];
    /** PIXI stage; `pivot` is the view centre in scene pixels (client/canvas/board.mjs:230). */
    readonly stage?: { readonly pivot: { x: number; y: number } };
    /** Undefined until the tokens layer is initialised. */
    readonly tokens?: TokenLayer;
    /** Synchronous jump (client/canvas/board.mjs:1756); `animatePan` returns a Promise. */
    pan(position: { x?: number; y?: number; scale?: number }): void;
    animatePan(view: {
      x?: number;
      y?: number;
      scale?: number;
      duration?: number;
      speed?: number;
    }): Promise<boolean>;
  }

  interface FoundryHooks {
    on(hook: string, fn: (...args: any[]) => unknown): number;
    once(hook: string, fn: (...args: any[]) => unknown): number;
    off(hook: string, fn: number | ((...args: any[]) => unknown)): void;
    call(hook: string, ...args: unknown[]): boolean;
    callAll(hook: string, ...args: unknown[]): boolean;
  }

  /** A shown notification (v13+ returns it from `info/warn/error`). */
  interface FoundryNotification {
    readonly id: number;
    remove(): void;
    update(options: { message?: string; pct?: number }): void;
  }

  interface FoundryUi {
    readonly notifications: {
      info(message: string, options?: Record<string, unknown>): FoundryNotification;
      warn(message: string, options?: Record<string, unknown>): FoundryNotification;
      error(message: string, options?: Record<string, unknown>): FoundryNotification;
    };
  }

  /** Application V1 base (deprecated in v14, removed in v16). */
  class FormApplication {
    constructor(object?: unknown, options?: Record<string, unknown>);
    static get defaultOptions(): Record<string, unknown>;
    readonly element: JQuery;
    readonly options: Record<string, unknown>;
    render(force?: boolean, options?: Record<string, unknown>): this;
    close(options?: Record<string, unknown>): Promise<void>;
    getData(options?: Record<string, unknown>): unknown;
    activateListeners(html: JQuery): void;
    protected _updateObject(event: Event, formData?: Record<string, unknown>): Promise<unknown>;
  }

  /** Resolve a document by UUID (world, embedded or compendium). */
  function fromUuid(
    uuid: string,
    options?: Record<string, unknown>
  ): Promise<FoundryDocument | null>;

  const game: Game;
  const CONFIG: FoundryConfig;
  const CONST: FoundryConst;
  const foundry: FoundryNamespace;
  const canvas: FoundryCanvas | undefined;
  const Hooks: FoundryHooks;
  const ui: FoundryUi;

  const Actor: FoundryDocumentClass<Actor>;
  const Item: FoundryDocumentClass<Item>;
  const ChatMessage: ChatMessageClass;
  const User: FoundryDocumentClass<User>;
  const Folder: FoundryDocumentClass<Folder>;
  const JournalEntry: FoundryDocumentClass<JournalEntry>;

  interface Window {
    foundryMCPBridge?: any;
  }
}

export {};
