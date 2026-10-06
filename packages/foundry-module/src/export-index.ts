/**
 * Foundry export index (docs/design/OBSIDIAN-O4-DESIGN.md sections 1 and 4, Obsidian
 * O4, chunk C2): the module query `getExportIndex`. It lists the world's PCs,
 * NPCs, scenes, journals (with their pages) and story items for the Obsidian
 * mirror, computed on a GM client where the full, unfiltered world lives.
 *
 * It is GM data: hidden NPCs, GM-only journals and opted-in page text all pass
 * through it, so it only ever lands in the GM's own vault, and only a GM
 * client answers (even with `allowNonGmAccess` on). Everything here is a read.
 *
 * Never exported (design 1.7): page text of journals that are not opted in (the
 * `text` key does not exist on their pages), PC biographies, appearance and traits
 * (a player character, or any actor a player owns, never gets a stat block), story
 * item descriptions, `flags`, `system` fields that are not listed below, HP value and
 * temp HP, conditions and effects, token lists, token art and positions, chat, combat,
 * settings, users beyond owner names, compendium content (the Library queries in
 * `library-index.ts` carry that).
 *
 * Deliberately exported since the Library (design 13), all of it GM-only data for the
 * GM's own vault: an NPC's stat block (its feature texts and its NPC biography, as
 * `statBlock`; built only on a full page, the signature uses a cheap proxy), the actor
 * portrait path (`img`), the scene map path (`map`), the figure HTML of an image
 * page of an opted-in journal, and `origin` (the absolute Foundry base URL including
 * any route prefix, no trailing slash).
 *
 * The wire contract is owned by `shared/src/export-index.ts`. Its types are
 * imported (type-only imports vanish from the build); its runtime values are
 * mirrored here, because the browser cannot resolve `@gnuminator/shared`.
 * `export-index.contract.test.ts` pins the copies to the shared ones.
 *
 * Foundry 14.368 sources this file is built on (`C:\FoundryTest\app`):
 * - `common/abstract/document.mjs:386-395` `getUserLevel` (ownership[user] ?? default
 *   ?? NONE, INHERIT defers to the parent) and `:407-415` `testUserPermission` (a GM is
 *   OWNER, a banned user NONE).
 * - `common/documents/user.mjs:113` `isBanned` is `role === USER_ROLES.NONE`.
 * - `client/documents/folder.mjs:104-107` `Folder#ancestors` (parent first) and
 *   `:364-373` `getSubfolders` (by `_source.folder`).
 * - `client/documents/abstract/client-document.mjs:163-165` `hasPlayerOwner`.
 * - `common/data/fields.mjs:4035-4070` `_stats` (`createdTime`, `modifiedTime`,
 *   `compendiumSource`, `duplicateSource`); Folder, Actor, Item, Scene, JournalEntry,
 *   JournalEntryPage and JournalEntryCategory carry it, a Note does NOT
 *   (`common/documents/note.mjs:45-57`).
 * - `common/documents/scene.mjs:70-72` `navigation`, `navName`; `:149` `notes`;
 *   `:158-159` `journal`, `journalEntryPage`.
 * - `common/documents/journal-entry.mjs:28-31` embedded `categories` / `pages`;
 *   `common/documents/journal-entry-page.mjs:32-100` text `{content, markdown, format}`,
 *   `category`, `sort`, `ownership` (default INHERIT).
 * - `common/constants.mjs:989-1000` `JOURNAL_ENTRY_PAGE_FORMATS` (HTML 1, MARKDOWN 2),
 *   `:1151-1170` `TOKEN_DISPOSITIONS`, `:1237` `USER_ROLES`.
 * dnd5e 6.0.5 (`C:\FoundryTest\data\Data\systems\dnd5e\dnd5e.mjs`): `rarities` set with
 * the `rarity` getter (:29524, :29627-29632), string `attunement` (:29240, :29274),
 * `properties` with `mgc` (:29299, :29358), `identified` (:29397) and the unidentified
 * name overwrite (:29434-29441), `details.race` / `details.background` as local documents
 * (:11575-11590, :84160), NPC `details.type` / `details.cr` (:85288-85296), `source`
 * (:5552-5565).
 */
import type {
  ExportActorEntry,
  ExportActorLink,
  ExportEntry,
  ExportFolderRef,
  ExportIdEntry,
  ExportIndexFailure,
  ExportIndexResponse,
  ExportItemEntry,
  ExportItemHolder,
  ExportJournalEntry,
  ExportKind,
  ExportPageEntry,
  ExportPageText,
  ExportSceneEntry,
  ExportScenePin,
  ExportSceneToken,
  PlayerAccess,
  RulesTag,
  TokenDisposition,
} from '@gnuminator/shared';
import {
  clip,
  compare,
  contentsOf,
  cyrb53,
  dig,
  fitJsonBytes,
  identifierOf,
  jsonStringBytes,
  nonEmpty,
  num,
  rec,
  signature,
  sourceName,
  str,
  maxTime,
  timeOf,
  utf8Bytes,
  type Rec,
} from './doc-read.js';
import { MODULE_ID } from './constants.js';
import { buildStatBlock } from './stat-block.js';
import { detectRulesVersion, readRulesTag } from './systems/dnd5e/rules-version.js';
import {
  UNKNOWN_CREATURE,
  pageAccessForPlayers,
  tokenNameForPlayers,
} from './player-visibility.js';

// ---------------------------------------------------------------------------
// Mirrored contract values (pinned by export-index.contract.test.ts)
// ---------------------------------------------------------------------------

/** Module query name (mirror of the shared `EXPORT_INDEX_QUERY`). */
export const EXPORT_INDEX_QUERY = 'getExportIndex';
export const EXPORT_INDEX_SCHEMA = 1;

/** Fixed kind order for paging (mirror of the shared `EXPORT_KINDS`). */
export const EXPORT_KINDS: readonly ExportKind[] = ['actor', 'scene', 'journal', 'item'];

/** World item types mirrored as story items by default (mirror of the shared list). */
export const DEFAULT_STORY_ITEM_TYPES: readonly string[] = [
  'weapon',
  'equipment',
  'consumable',
  'tool',
  'loot',
  'container',
];

/** A Foundry document uuid (mirror of the shared pattern). */
export const FOUNDRY_UUID_SOURCE =
  '^(?:Compendium\\.[\\w-]+\\.[\\w-]+\\.)?[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16}(?:\\.[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16})*$';
export const FOUNDRY_UUID_MAX_LENGTH = 300;

/** Paging, size and world limits (mirror of the shared limits). */
export const EXPORT_INDEX_LIMITS = {
  pageDefault: 200,
  pageMax: 500,
  idsPageDefault: 5000,
  idsPageMax: 10000,
  responseBudgetBytes: 512 * 1024,
  responseHardCapBytes: 2.5 * 1024 * 1024,
  textPerPageBytes: 512 * 1024,
  textPerJournalBytes: 2 * 1024 * 1024,
  uuidsPerRequest: 500,
  nameChars: 200,
  featuresPerActor: 80,
  notableItemsPerActor: 40,
  pinsPerScene: 300,
  tokensPerScene: 200,
  pagesPerJournal: 1000,
  actorLinksPerJournal: 500,
  holdersPerItem: 20,
  statBlockBytes: 256 * 1024,
  pathChars: 1024,
  worldCaps: { actor: 5000, scene: 1000, journal: 3000, item: 5000 },
} as const;

const LIMITS = EXPORT_INDEX_LIMITS;

const DOCUMENT_NAMES: Record<ExportKind, string> = {
  actor: 'Actor',
  scene: 'Scene',
  journal: 'JournalEntry',
  item: 'Item',
};

/** A document's uuid; derived from its type and id when a (mock) document has none. */
function uuidOf(doc: Rec, documentName: string, parentUuid?: string): string {
  const own = nonEmpty(doc.uuid);
  if (own) return own;
  const id = str(doc.id) ?? '';
  return parentUuid ? `${parentUuid}.${documentName}.${id}` : `${documentName}.${id}`;
}

/**
 * An image path worth copying into the vault: relative to Foundry's data root or an http(s)
 * URL, at most `pathChars`; null for Foundry's placeholder icons (`icons/svg/...`) and blanks.
 */
export function imagePath(value: unknown): string | null {
  const path = nonEmpty(value)?.trim() ?? null;
  if (!path || path.length > LIMITS.pathChars) return null;
  if (/^\/?icons\/svg\//i.test(path)) return null;
  if (/^(data|blob|javascript):/i.test(path)) return null;
  return path;
}

/** `&`, `<`, `>` and `"` as entities, for the small HTML an image page sends. */
function escapeHtml(text: string): string {
  return text
    .replace(/&/g, '&amp;')
    .replace(/</g, '&lt;')
    .replace(/>/g, '&gt;')
    .replace(/"/g, '&quot;');
}

// ---------------------------------------------------------------------------
// Foundry constants (read defensively, with the verified defaults)
// ---------------------------------------------------------------------------

interface ConstShape {
  readonly USER_ROLES?: { readonly NONE?: number };
  readonly TOKEN_DISPOSITIONS?: Partial<
    Record<'SECRET' | 'HOSTILE' | 'NEUTRAL' | 'FRIENDLY', number>
  >;
  readonly JOURNAL_ENTRY_PAGE_FORMATS?: { readonly MARKDOWN?: number };
}

function constants(): ConstShape {
  return typeof CONST === 'undefined' ? {} : (CONST as unknown as ConstShape);
}

/** `USER_ROLES.NONE`: a user with this role is banned (`common/documents/user.mjs:113`). */
function bannedRole(): number {
  return constants().USER_ROLES?.NONE ?? 0;
}

function markdownFormat(): number {
  return constants().JOURNAL_ENTRY_PAGE_FORMATS?.MARKDOWN ?? 2;
}

function dispositionName(value: unknown): TokenDisposition | null {
  const level = num(value);
  if (level === null) return null;
  const table = constants().TOKEN_DISPOSITIONS;
  const secret = table?.SECRET ?? -2;
  const hostile = table?.HOSTILE ?? -1;
  const neutral = table?.NEUTRAL ?? 0;
  const friendly = table?.FRIENDLY ?? 1;
  if (level === secret) return 'secret';
  if (level === hostile) return 'hostile';
  if (level === neutral) return 'neutral';
  if (level === friendly) return 'friendly';
  return null;
}

/**
 * Journal categories exist only where the schema says so: the embedded
 * collection table of `BaseJournalEntry` lists `JournalEntryCategory`
 * (`common/documents/journal-entry.mjs:28-31`, Foundry 14). Detected by that
 * schema fact, never by class or property presence.
 */
function journalCategoriesSupported(): boolean {
  const namespace = (globalThis as unknown as { foundry?: unknown }).foundry;
  return (
    dig(
      namespace,
      'documents',
      'BaseJournalEntry',
      'metadata',
      'embedded',
      'JournalEntryCategory'
    ) === 'categories'
  );
}

// ---------------------------------------------------------------------------
// Hashing and sizes
// ---------------------------------------------------------------------------

function makeClientId(): string {
  const bytes = new Uint8Array(8);
  const cryptoApi = (globalThis as unknown as { crypto?: Crypto }).crypto;
  if (cryptoApi && typeof cryptoApi.getRandomValues === 'function') {
    cryptoApi.getRandomValues(bytes);
  } else {
    for (let i = 0; i < bytes.length; i++) bytes[i] = Math.floor(Math.random() * 256);
  }
  return Array.from(bytes, byte => byte.toString(16).padStart(2, '0')).join('');
}

/** Random per module page load: a reload tells the backend to reconcile. */
const CLIENT_ID = makeClientId();

function now(): number {
  return typeof performance !== 'undefined' ? performance.now() : Date.now();
}

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

const ID_PATTERN = /^[A-Za-z0-9]{16}$/;
const CURSOR_PATTERN = /^(actor|scene|journal|item):([A-Za-z0-9]{16})$/;
const UUID_PATTERN = new RegExp(FOUNDRY_UUID_SOURCE);
/** Bounds on hostile request arrays (the valid caps are lower or equal). */
const MAX_REQUEST_ITEMS = 5000;
const MAX_STORY_TYPES = 100;
const MAX_TYPE_CHARS = 64;

interface Cursor {
  kind: ExportKind;
  id: string;
}

interface NormalizedRequest {
  kinds: ExportKind[];
  since: number | null;
  uuids: string[] | null;
  idsOnly: boolean;
  textFolderIds: Set<string>;
  textJournalIds: Set<string>;
  excludeFolderIds: Set<string>;
  storyItemTypes: Set<string>;
  after: Cursor | null;
  limit: number;
}

function idSet(value: unknown): Set<string> {
  const out = new Set<string>();
  if (!Array.isArray(value)) return out;
  for (const entry of (value as unknown[]).slice(0, MAX_REQUEST_ITEMS)) {
    if (typeof entry === 'string' && ID_PATTERN.test(entry)) out.add(entry);
  }
  return out;
}

function validUuids(value: unknown): string[] | null {
  if (!Array.isArray(value)) return null;
  const out = new Set<string>();
  for (const entry of (value as unknown[]).slice(0, MAX_REQUEST_ITEMS)) {
    if (
      typeof entry === 'string' &&
      entry.length <= FOUNDRY_UUID_MAX_LENGTH &&
      UUID_PATTERN.test(entry)
    ) {
      out.add(entry);
      if (out.size >= LIMITS.uuidsPerRequest) break;
    }
  }
  return [...out];
}

function storyTypes(value: unknown): Set<string> {
  if (!Array.isArray(value)) return new Set(DEFAULT_STORY_ITEM_TYPES);
  const out = new Set<string>();
  for (const entry of (value as unknown[]).slice(0, MAX_STORY_TYPES)) {
    if (typeof entry === 'string' && entry.length > 0 && entry.length <= MAX_TYPE_CHARS) {
      out.add(entry);
    }
  }
  return out;
}

/** Validate and clamp a raw request; a malformed cursor is the one hard error. */
function normalizeRequest(data: unknown): NormalizedRequest | ExportIndexFailure {
  const raw = rec(data) ?? {};
  const idsOnly = raw.idsOnly === true;

  const requested = Array.isArray(raw.kinds) ? new Set<unknown>(raw.kinds as unknown[]) : null;
  const kinds = EXPORT_KINDS.filter(kind => requested === null || requested.has(kind));

  const defaultLimit = idsOnly ? LIMITS.idsPageDefault : LIMITS.pageDefault;
  const maxLimit = idsOnly ? LIMITS.idsPageMax : LIMITS.pageMax;
  const limitRaw = num(raw.limit);
  const limit =
    limitRaw === null ? defaultLimit : Math.min(maxLimit, Math.max(1, Math.floor(limitRaw)));

  let after: Cursor | null = null;
  const cursorRaw = raw.after;
  if (cursorRaw !== undefined && cursorRaw !== null && cursorRaw !== '') {
    const match = typeof cursorRaw === 'string' ? CURSOR_PATTERN.exec(cursorRaw) : null;
    if (!match) return { success: false, error: 'Invalid cursor' };
    after = { kind: match[1] as ExportKind, id: match[2] ?? '' };
  }

  const includeText = rec(raw.includeText);
  return {
    kinds,
    since: num(raw.sinceModifiedTime),
    uuids: validUuids(raw.uuids),
    idsOnly,
    textFolderIds: idSet(includeText?.folderIds),
    textJournalIds: idSet(includeText?.journalIds),
    excludeFolderIds: idSet(raw.excludeFolderIds),
    storyItemTypes: storyTypes(raw.storyItemTypes),
    after,
    limit,
  };
}

// ---------------------------------------------------------------------------
// Call context: players, folders, holders
// ---------------------------------------------------------------------------

interface FolderInfo {
  ref: ExportFolderRef;
  /** The folder's own id and its ancestors' ids. */
  chainIds: string[];
  time: number | null;
}

interface EmbeddedRef {
  actorUuid: string;
  actorName: string;
  time: number | null;
}

interface HolderIndex {
  bySource: Map<string, Array<EmbeddedRef & { actorId: string }>>;
  byName: Map<string, Array<EmbeddedRef & { actorId: string }>>;
}

interface HolderResult {
  rows: ExportItemHolder[];
  time: number | null;
}

interface Context {
  request: NormalizedRequest;
  /** Non-GM users. Banned users are in the list: Foundry's own permission test gives them NONE. */
  players: Rec[];
  categories: boolean;
  folderCache: Map<string, FolderInfo | null>;
  holderIndex: HolderIndex | null;
  holderCache: Map<string, HolderResult>;
  npcIndex: NpcIndex | null;
  /** Compendium actor uuid -> the world NPC it stands for (null: none or ambiguous). */
  actorLinkCache: Map<string, { actorUuid: string; match: 'source' | 'name' } | null>;
}

interface NpcIndex {
  /** Compendium source uuid -> world NPCs made from it. */
  bySource: Map<string, Rec[]>;
  /** Lowercased name -> world NPCs. */
  byName: Map<string, Rec[]>;
}

/** The parent chain of a folder (parent first), bounded against cycles. */
function ancestorsOf(folder: Rec): Rec[] {
  const raw = folder.ancestors;
  if (!Array.isArray(raw)) return [];
  const out: Rec[] = [];
  for (const entry of (raw as unknown[]).slice(0, 64)) {
    const r = rec(entry);
    if (r) out.push(r);
  }
  return out;
}

/** The document's folder as an object: `doc.folder`, else the world folder for `_source.folder`. */
function folderOf(doc: Rec): Rec | null {
  const direct = doc.folder;
  const asObject = rec(direct);
  if (asObject) return asObject;
  const id = nonEmpty(direct) ?? nonEmpty(dig(doc, '_source', 'folder'));
  if (!id) return null;
  const folders = rec(rec(game as unknown)?.folders);
  const get = folders?.get;
  const found =
    typeof get === 'function' ? rec((get as (key: string) => unknown).call(folders, id)) : null;
  return found;
}

function folderInfoFor(ctx: Context, doc: Rec): FolderInfo | null {
  const folder = folderOf(doc);
  const id = folder ? nonEmpty(folder.id) : null;
  if (!folder || !id) return null;
  const cached = ctx.folderCache.get(id);
  if (cached !== undefined) return cached;
  const ancestors = ancestorsOf(folder);
  const chain = [folder, ...ancestors];
  const info: FolderInfo = {
    ref: {
      id,
      path: [...ancestors]
        .reverse()
        .concat(folder)
        .map(f => clip(str(f.name) ?? '')),
    },
    chainIds: chain.map(f => nonEmpty(f.id)).filter((x): x is string => x !== null),
    time: maxTime(chain.map(timeOf)),
  };
  ctx.folderCache.set(id, info);
  return info;
}

function inFolders(info: FolderInfo | null, ids: ReadonlySet<string>): boolean {
  return info !== null && ids.size > 0 && info.chainIds.some(id => ids.has(id));
}

/** Whether `user` holds at least `level` on `doc`, by Foundry's own test. */
function permitted(doc: Rec, user: Rec, level: 'OWNER' | 'OBSERVER' | 'LIMITED'): boolean {
  const test = doc.testUserPermission;
  return (
    typeof test === 'function' &&
    (test as (user: unknown, level: string) => unknown).call(doc, user, level) === true
  );
}

/** The highest level any non-GM user holds on `doc` (section 4). */
function highestPlayerLevel(ctx: Context, doc: Rec): PlayerAccess {
  let best: PlayerAccess = 'none';
  for (const user of ctx.players) {
    if (permitted(doc, user, 'OWNER')) return 'owner';
    if (best !== 'observer' && permitted(doc, user, 'OBSERVER')) best = 'observer';
    else if (best === 'none' && permitted(doc, user, 'LIMITED')) best = 'limited';
  }
  return best;
}

function atLeast(level: PlayerAccess, minimum: 'limited' | 'observer'): boolean {
  if (level === 'owner' || level === 'observer') return true;
  return minimum === 'limited' && level === 'limited';
}

function usersSignature(): string {
  const users = contentsOf(rec(game as unknown)?.users);
  const rows = users
    .map(user => {
      const role = num(user.role);
      return { id: str(user.id) ?? '', role, banned: role !== null && role === bannedRole() };
    })
    .sort((a, b) => compare(a.id, b.id));
  return cyrb53(JSON.stringify(rows)).toString(36);
}

// ---------------------------------------------------------------------------
// Documents: identity, item traits, rules
// ---------------------------------------------------------------------------

function embeddedItems(actor: Rec): Rec[] {
  return contentsOf(actor.items);
}

function hasProperty(properties: unknown, key: string): boolean {
  if (properties instanceof Set) return properties.has(key);
  return Array.isArray(properties) && (properties as unknown[]).includes(key);
}

/** dnd5e marks a magic item with the `mgc` property (`dnd5e.mjs:29299`, `:29358`). */
function isMagical(item: Rec): boolean {
  return hasProperty(dig(item, 'system', 'properties'), 'mgc');
}

/** dnd5e 6 keeps a `rarity` getter over the `rarities` set; 5.x keeps the string field. */
function rarityOf(item: Rec): string | null {
  return nonEmpty(dig(item, 'system', 'rarity'));
}

const NOTABLE_RARITIES: ReadonlySet<string> = new Set([
  'uncommon',
  'rare',
  'veryRare',
  'legendary',
  'artifact',
]);

function sourceUuidOf(item: Rec): string | null {
  return (
    nonEmpty(dig(item, '_stats', 'duplicateSource')) ??
    nonEmpty(dig(item, '_stats', 'compendiumSource'))
  );
}

/**
 * An actor's source: the compendium entry first (an NPC's Library monster), else the world
 * actor it was duplicated from. Adventure Muncher writes the actor's own id there; that is
 * no source.
 */
function actorSourceUuidOf(actor: Rec, ownUuid: string): string | null {
  const own = new Set([ownUuid, `Actor.${str(actor.id) ?? ''}`]);
  for (const value of actorSources(actor)) {
    if (!own.has(value)) return value;
  }
  return null;
}

/**
 * An actor's recorded sources in order: `_stats.compendiumSource`, `_stats.duplicateSource`,
 * then the pre-v12 `flags.core.sourceId` that older imports still carry.
 */
function actorSources(actor: Rec): string[] {
  return [
    nonEmpty(dig(actor, '_stats', 'compendiumSource')),
    nonEmpty(dig(actor, '_stats', 'duplicateSource')),
    nonEmpty(dig(actor, 'flags', 'core', 'sourceId')),
  ].filter((x): x is string => x !== null);
}

function rulesOf(doc: Rec): RulesTag | null {
  try {
    const tag = readRulesTag(doc as unknown as FoundryDocument);
    if (tag) return tag.version;
    return detectRulesVersion(doc as unknown as Actor)?.version ?? null;
  } catch {
    return null;
  }
}

function createdOf(doc: Rec): number | null {
  return num(dig(doc, '_stats', 'createdTime'));
}

// ---------------------------------------------------------------------------
// Holders (item -> actors that carry it)
// ---------------------------------------------------------------------------

function buildHolderIndex(): HolderIndex {
  const index: HolderIndex = { bySource: new Map(), byName: new Map() };
  const actors = contentsOf(rec(game as unknown)?.actors);
  for (const actor of actors) {
    const actorId = str(actor.id);
    if (!actorId) continue;
    const actorUuid = uuidOf(actor, 'Actor');
    const actorName = sourceName(actor);
    for (const item of embeddedItems(actor)) {
      const ref = { actorId, actorUuid, actorName, time: timeOf(item) };
      const sources = new Set(
        [
          nonEmpty(dig(item, '_stats', 'duplicateSource')),
          nonEmpty(dig(item, '_stats', 'compendiumSource')),
        ].filter((x): x is string => x !== null)
      );
      for (const source of sources) {
        const list = index.bySource.get(source) ?? [];
        list.push(ref);
        index.bySource.set(source, list);
      }
      const name = sourceName(item);
      const named = index.byName.get(name) ?? [];
      named.push(ref);
      index.byName.set(name, named);
    }
  }
  return index;
}

/**
 * The actors carrying a world item: an embedded item whose duplicate or
 * compendium source is this item (`source`), else, for a magical item, an
 * embedded item with the same name (`name`). One row per actor, at most
 * `holdersPerItem`; `time` is the newest change of the embedded items behind the
 * kept rows.
 */
function holdersFor(ctx: Context, item: Rec, itemUuid: string): HolderResult {
  const cached = ctx.holderCache.get(itemUuid);
  if (cached) return cached;
  ctx.holderIndex ??= buildHolderIndex();
  const index = ctx.holderIndex;

  const perActor = new Map<
    string,
    { uuid: string; name: string; match: 'source' | 'name'; times: Array<number | null> }
  >();
  for (const ref of index.bySource.get(itemUuid) ?? []) {
    const row = perActor.get(ref.actorId) ?? {
      uuid: ref.actorUuid,
      name: ref.actorName,
      match: 'source' as const,
      times: [],
    };
    row.times.push(ref.time);
    perActor.set(ref.actorId, row);
  }
  if (isMagical(item)) {
    const bySource = new Set(perActor.keys());
    for (const ref of index.byName.get(sourceName(item)) ?? []) {
      if (bySource.has(ref.actorId)) continue;
      const row = perActor.get(ref.actorId) ?? {
        uuid: ref.actorUuid,
        name: ref.actorName,
        match: 'name' as const,
        times: [],
      };
      row.times.push(ref.time);
      perActor.set(ref.actorId, row);
    }
  }

  const kept = [...perActor.values()]
    .sort((a, b) => compare(a.name, b.name) || compare(a.uuid, b.uuid))
    .slice(0, LIMITS.holdersPerItem);
  const result: HolderResult = {
    rows: kept.map(row => ({ uuid: row.uuid, name: row.name, match: row.match })),
    time: maxTime(kept.flatMap(row => row.times)),
  };
  ctx.holderCache.set(itemUuid, result);
  return result;
}

// ---------------------------------------------------------------------------
// The exportable universe: candidates with their effective modified time
// ---------------------------------------------------------------------------

interface Candidate {
  kind: ExportKind;
  id: string;
  uuid: string;
  doc: Rec;
  /** Effective modified time (design 1.3); null when no document in the set carries one. */
  time: number | null;
}

/** Design 1.3: the newest change among the document and what its entry is made of. */
function effectiveTime(ctx: Context, kind: ExportKind, doc: Rec, uuid: string): number | null {
  const own = timeOf(doc);
  const folder = folderInfoFor(ctx, doc)?.time ?? null;
  switch (kind) {
    case 'actor':
      return maxTime([own, folder, ...embeddedItems(doc).map(timeOf)]);
    case 'scene':
      // Never tokens: they move all the time. A Note has no `_stats` in Foundry 14.368
      // (`common/documents/note.mjs:45-57`), so pin edits are caught by `sig` only, and so
      // are token rows (added, removed, renamed, hidden), which never carry positions.
      return maxTime([own, folder, ...contentsOf(doc.notes).map(timeOf)]);
    case 'journal':
      return maxTime([
        own,
        folder,
        ...contentsOf(doc.pages).map(timeOf),
        ...(ctx.categories ? contentsOf(doc.categories).map(timeOf) : []),
      ]);
    case 'item':
      return maxTime([own, folder, holdersFor(ctx, doc, uuid).time]);
  }
}

function worldCollection(kind: ExportKind): unknown {
  const world = rec(game as unknown);
  switch (kind) {
    case 'actor':
      return world?.actors;
    case 'scene':
      return world?.scenes;
    case 'journal':
      return world?.journal;
    case 'item':
      return world?.items;
  }
}

function exportable(ctx: Context, kind: ExportKind, doc: Rec): boolean {
  if (kind === 'actor') return doc.type === 'character' || doc.type === 'npc';
  if (kind === 'item')
    return typeof doc.type === 'string' && ctx.request.storyItemTypes.has(doc.type);
  return true;
}

function collectUniverse(ctx: Context): {
  list: Candidate[];
  truncated: ExportIndexResponse['truncated'];
} {
  const list: Candidate[] = [];
  const truncated: ExportIndexResponse['truncated'] = [];
  for (const kind of ctx.request.kinds) {
    const docs: Array<{ id: string; doc: Rec }> = [];
    for (const doc of contentsOf(worldCollection(kind))) {
      const id = nonEmpty(doc.id);
      if (!id || !exportable(ctx, kind, doc)) continue;
      if (inFolders(folderInfoFor(ctx, doc), ctx.request.excludeFolderIds)) continue;
      docs.push({ id, doc });
    }
    docs.sort((a, b) => compare(a.id, b.id));
    const cap = LIMITS.worldCaps[kind];
    if (docs.length > cap) truncated.push({ kind, total: docs.length, cap });
    for (const { id, doc } of docs.slice(0, cap)) {
      const uuid = uuidOf(doc, DOCUMENT_NAMES[kind]);
      list.push({ kind, id, uuid, doc, time: effectiveTime(ctx, kind, doc, uuid) });
    }
  }
  return { list, truncated };
}

function kindRank(kind: ExportKind): number {
  return EXPORT_KINDS.indexOf(kind);
}

function afterCursor(candidate: Candidate, cursor: Cursor): boolean {
  const a = kindRank(candidate.kind);
  const b = kindRank(cursor.kind);
  return a > b || (a === b && candidate.id > cursor.id);
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

type Common = Omit<ExportActorEntry, 'modified' | 'sig' | keyof ActorOnly>;
type ActorOnly = Pick<
  ExportActorEntry,
  | 'actorType'
  | 'pc'
  | 'owners'
  | 'hpMax'
  | 'ac'
  | 'size'
  | 'alignment'
  | 'disposition'
  | 'tokenName'
  | 'playerName'
  | 'level'
  | 'classes'
  | 'species'
  | 'background'
  | 'cr'
  | 'creatureType'
  | 'sourceBook'
  | 'features'
  | 'notableItems'
  | 'img'
  | 'statBlock'
  | 'sourceUuid'
>;

/** Fields shared by every kind, without `modified` and `sig` (the signature is taken over the rest). */
function commonFields(
  ctx: Context,
  c: Candidate,
  access: PlayerAccess,
  visible: boolean,
  withRules: boolean
): Omit<Common, 'kind'> {
  return {
    uuid: c.uuid,
    id: c.id,
    name: sourceName(c.doc),
    folder: folderInfoFor(ctx, c.doc)?.ref ?? null,
    created: createdOf(c.doc),
    playerAccess: access,
    playerVisible: visible,
    rules: withRules ? rulesOf(c.doc) : null,
  };
}

function linkedName(value: unknown): string | null {
  const doc = rec(value);
  if (!doc) return null;
  const name = sourceName(doc);
  return name.length > 0 ? name : null;
}

function classesOf(items: Rec[]): ExportActorEntry['classes'] {
  const subclasses = items.filter(item => item.type === 'subclass');
  return items
    .filter(item => item.type === 'class')
    .map(item => {
      const identifier = identifierOf(item);
      const subclass = subclasses.find(
        candidate => nonEmpty(dig(candidate, 'system', 'classIdentifier')) === identifier
      );
      return {
        name: sourceName(item),
        levels: num(dig(item, 'system', 'levels')) ?? 0,
        subclass: subclass ? sourceName(subclass) : null,
      };
    })
    .sort((a, b) => b.levels - a.levels || compare(a.name, b.name));
}

function creatureTypeOf(system: unknown): string | null {
  const type = rec(dig(system, 'details', 'type'));
  const value = nonEmpty(type?.value);
  if (value && value !== 'custom') return value;
  return nonEmpty(type?.custom) ?? (value === 'custom' ? null : value);
}

/**
 * What the signature holds in place of an NPC's stat block: the actor's and each embedded item's
 * modified time, plus the rules tag. Cheap, so an ids reconcile never builds a stat block just
 * to hash it. Null when a document carries no modified time (then the stat block itself is
 * hashed, which is correct and only costs time).
 */
function statBlockProxy(doc: Rec, items: Rec[]): object | null {
  const own = timeOf(doc);
  if (own === null) return null;
  const times: Array<[string, number]> = [];
  for (const item of items) {
    const time = timeOf(item);
    if (time === null) return null;
    times.push([str(item.id) ?? '', time]);
  }
  times.sort((a, b) => compare(a[0], b[0]));
  return { rules: rulesOf(doc), own, items: times };
}

interface ActorBuilt {
  fields: Omit<ExportActorEntry, 'modified' | 'sig'>;
  /** The fields the signature is taken over: the stat block replaced by its proxy. */
  signed: object;
}

/** `withStatBlock` false (an ids page) leaves `fields.statBlock` null; the signature is the same. */
function actorFields(ctx: Context, c: Candidate, withStatBlock: boolean): ActorBuilt {
  const doc = c.doc;
  const npc = doc.type === 'npc';
  const pc = doc.hasPlayerOwner === true;
  const access = highestPlayerLevel(ctx, doc);
  const items = embeddedItems(doc);
  const token = rec(doc.prototypeToken);
  const system = doc.system;
  const tokenName = token ? str(token.name) : null;
  const playerName = token
    ? tokenNameForPlayers(token as Parameters<typeof tokenNameForPlayers>[0], pc)
    : pc
      ? sourceName(doc)
      : UNKNOWN_CREATURE;

  const hasStatBlock = npc && !pc;
  const blockDoc = (): ExportActorEntry['statBlock'] =>
    buildStatBlock(doc, rulesOf(doc), LIMITS.statBlockBytes);
  const built = {
    ...commonFields(ctx, c, access, atLeast(access, 'observer'), true),
    kind: 'actor' as const,
    actorType: (npc ? 'npc' : 'character') as ExportActorEntry['actorType'],
    pc,
    owners: ctx.players
      .filter(user => permitted(doc, user, 'OWNER'))
      .map(user => clip(str(user.name) ?? ''))
      .sort(compare),
    hpMax: num(dig(system, 'attributes', 'hp', 'max')),
    ac: num(dig(system, 'attributes', 'ac', 'value')),
    size: nonEmpty(dig(system, 'traits', 'size')),
    alignment: nonEmpty(dig(system, 'details', 'alignment')),
    disposition: dispositionName(token?.disposition),
    tokenName: tokenName === null ? null : clip(tokenName),
    playerName: clip(playerName),
    level: npc ? null : num(dig(system, 'details', 'level')),
    classes: npc ? [] : classesOf(items),
    species: npc ? null : linkedName(dig(system, 'details', 'race')),
    background: npc ? null : linkedName(dig(system, 'details', 'background')),
    cr: npc ? num(dig(system, 'details', 'cr')) : null,
    creatureType: npc ? creatureTypeOf(system) : null,
    sourceBook: npc
      ? (nonEmpty(dig(system, 'source', 'book')) ?? nonEmpty(dig(system, 'source', 'custom')))
      : null,
    features: items
      .map(item => ({ name: sourceName(item), type: str(item.type) ?? '' }))
      .sort((a, b) => compare(a.type, b.type) || compare(a.name, b.name))
      .slice(0, LIMITS.featuresPerActor),
    notableItems: items
      .filter(item => isMagical(item) || NOTABLE_RARITIES.has(rarityOf(item) ?? ''))
      .map(item => ({ name: sourceName(item), sourceUuid: sourceUuidOf(item) }))
      .sort((a, b) => compare(a.name, b.name) || compare(a.sourceUuid ?? '', b.sourceUuid ?? ''))
      .slice(0, LIMITS.notableItemsPerActor),
    img: imagePath(doc.img),
    sourceUuid: actorSourceUuidOf(doc, c.uuid),
  };
  const statBlock = hasStatBlock && withStatBlock ? blockDoc() : null;
  const proxy = hasStatBlock ? (statBlockProxy(doc, items) ?? statBlock ?? blockDoc()) : null;
  return { fields: { ...built, statBlock }, signed: { ...built, statBlock: proxy } };
}

function noteLabel(note: Rec): string | null {
  // `Note#label` falls back to a localized "Unknown" (`client/documents/note.mjs:87-110`);
  // the pin keeps only real names.
  const text = nonEmpty(note.text);
  if (text) return clip(text);
  const page = linkedName(note.page);
  if (page) return page;
  return linkedName(note.entry);
}

/**
 * The scene's tokens folded by world actor, name, disposition and hidden flag
 * (`common/documents/token.mjs`: `actorId`, `actorLink`, `name`, `disposition`, `hidden`).
 * An unlinked token's synthetic actor is not a world document, so the row names the world
 * actor behind it (`actorId`); a token whose actor is gone keeps its name only.
 */
function sceneTokens(doc: Rec): ExportSceneToken[] {
  const actors = rec(rec(game as unknown)?.actors);
  const get = actors?.get;
  const rows = new Map<string, ExportSceneToken>();
  for (const token of contentsOf(doc.tokens)) {
    const actorId = nonEmpty(token.actorId) ?? nonEmpty(dig(token, '_source', 'actorId'));
    const actor =
      actorId && typeof get === 'function'
        ? rec((get as (key: string) => unknown).call(actors, actorId))
        : null;
    const row: ExportSceneToken = {
      name: clip(str(token.name) ?? (actor ? sourceName(actor) : '')),
      actorUuid: actor ? uuidOf(actor, 'Actor') : null,
      actorType: actor ? nonEmpty(actor.type) : null,
      actorLink: token.actorLink === true,
      disposition: dispositionName(token.disposition),
      hidden: token.hidden === true,
      count: 1,
    };
    const key = JSON.stringify([
      row.actorUuid,
      row.name,
      row.actorLink,
      row.disposition,
      row.hidden,
    ]);
    const seen = rows.get(key);
    if (seen) seen.count += 1;
    else rows.set(key, row);
  }
  return [...rows.values()]
    .sort(
      (a, b) =>
        compare(a.name, b.name) ||
        compare(a.actorUuid ?? '', b.actorUuid ?? '') ||
        Number(a.hidden) - Number(b.hidden) ||
        compare(a.disposition ?? '', b.disposition ?? '') ||
        Number(a.actorLink) - Number(b.actorLink)
    )
    .slice(0, LIMITS.tokensPerScene);
}

function sceneFields(ctx: Context, c: Candidate): Omit<ExportSceneEntry, 'modified' | 'sig'> {
  const doc = c.doc;
  const access = highestPlayerLevel(ctx, doc);
  const navigation = doc.navigation === true;

  const journalDoc = rec(doc.journal);
  const journalId = journalDoc
    ? nonEmpty(journalDoc.id)
    : (nonEmpty(doc.journal) ?? nonEmpty(dig(doc, '_source', 'journal')));
  const journalUuid = journalDoc
    ? uuidOf(journalDoc, 'JournalEntry')
    : journalId
      ? `JournalEntry.${journalId}`
      : null;
  const pageId =
    nonEmpty(doc.journalEntryPage) ?? nonEmpty(dig(doc, '_source', 'journalEntryPage'));

  const pins: ExportScenePin[] = contentsOf(doc.notes)
    .map(note => ({ id: str(note.id) ?? '', note }))
    .sort((a, b) => compare(a.id, b.id))
    .slice(0, LIMITS.pinsPerScene)
    .map(({ note }) => {
      const entryId = nonEmpty(note.entryId);
      const notePageId = nonEmpty(note.pageId);
      return {
        label: noteLabel(note),
        entryUuid: entryId ? `JournalEntry.${entryId}` : null,
        pageUuid:
          entryId && notePageId ? `JournalEntry.${entryId}.JournalEntryPage.${notePageId}` : null,
      };
    });

  const navName = nonEmpty(doc.navName);
  // Foundry 14 keeps the map on the scene's levels; `background` reads the first one.
  const firstLevel = contentsOf(doc.levels)[0] ?? null;
  const map =
    imagePath(dig(doc, 'background', 'src')) ?? imagePath(dig(firstLevel, 'background', 'src'));
  return {
    ...commonFields(ctx, c, access, navigation && atLeast(access, 'limited'), false),
    kind: 'scene',
    navName: navName === null ? null : clip(navName),
    navigation,
    journal: journalUuid
      ? {
          uuid: journalUuid,
          pageUuid: pageId ? `${journalUuid}.JournalEntryPage.${pageId}` : null,
        }
      : null,
    pins,
    tokens: sceneTokens(doc),
    map,
  };
}

// ---------------------------------------------------------------------------
// Compendium actor links -> world NPCs (journal page text)
// ---------------------------------------------------------------------------

/** `Compendium.pkg.pack[.Actor].id` in any link form; `@Compendium[pkg.pack.id]` (legacy). */
const COMPENDIUM_ID_LINK = /Compendium\.([\w-]+)\.([\w-]+)\.(?:Actor\.)?([A-Za-z0-9]{16})(?!\w)/g;
const LEGACY_COMPENDIUM_LINK = /@Compendium\[([\w-]+)\.([\w-]+)\.([A-Za-z0-9]{16})\]/g;

function nameKey(name: string): string {
  return name.normalize('NFC').trim().toLowerCase();
}

function buildNpcIndex(): NpcIndex {
  const index: NpcIndex = { bySource: new Map(), byName: new Map() };
  for (const actor of contentsOf(rec(game as unknown)?.actors)) {
    if (actor.type !== 'npc' || !nonEmpty(actor.id)) continue;
    for (const source of new Set(actorSources(actor))) {
      if (!source.startsWith('Compendium.')) continue;
      const list = index.bySource.get(source) ?? [];
      list.push(actor);
      index.bySource.set(source, list);
    }
    const key = nameKey(sourceName(actor));
    if (!key) continue;
    const named = index.byName.get(key) ?? [];
    named.push(actor);
    index.byName.set(key, named);
  }
  return index;
}

/** The pack's index entry name for an Actor pack, else null (`CompendiumCollection#index`). */
function compendiumActorName(collection: string, id: string): string | null {
  const packs = rec(rec(game as unknown)?.packs);
  const get = packs?.get;
  const pack =
    typeof get === 'function' ? rec((get as (k: string) => unknown).call(packs, collection)) : null;
  if (!pack || pack.documentName !== 'Actor') return null;
  const index = rec(pack.index);
  const lookup = index?.get;
  const entry =
    typeof lookup === 'function' ? rec((lookup as (k: string) => unknown).call(index, id)) : null;
  return nonEmpty(entry?.name);
}

/**
 * The world NPC a compendium actor stands for (the user's rule, 2026-10-06): the one NPC made
 * from it (several: the one among them with its name); else the only world NPC whose name is the
 * compendium actor's name (case-insensitive). Ambiguous or none: null, and the link stays a
 * Library link.
 */
function worldActorFor(
  ctx: Context,
  collection: string,
  id: string
): { compendiumUuid: string; actorUuid: string; match: 'source' | 'name' } | null {
  const compendiumUuid = `Compendium.${collection}.Actor.${id}`;
  let found = ctx.actorLinkCache.get(compendiumUuid);
  if (found === undefined) {
    found = null;
    const name = compendiumActorName(collection, id);
    if (name !== null) {
      ctx.npcIndex ??= buildNpcIndex();
      const fromSource = ctx.npcIndex.bySource.get(compendiumUuid) ?? [];
      const pool =
        fromSource.length > 0 ? fromSource : (ctx.npcIndex.byName.get(nameKey(name)) ?? []);
      const picked =
        pool.length === 1
          ? pool
          : pool.filter(actor => nameKey(sourceName(actor)) === nameKey(name));
      const actor = picked.length === 1 ? picked[0] : undefined;
      if (actor) {
        found = {
          actorUuid: uuidOf(actor, 'Actor'),
          match: fromSource.length > 0 ? 'source' : 'name',
        };
      }
    }
    ctx.actorLinkCache.set(compendiumUuid, found);
  }
  return found ? { compendiumUuid, ...found } : null;
}

/** The compendium actors an opted-in journal's text pages link to that stand for a world NPC. */
function journalActorLinks(ctx: Context, pageDocs: Rec[]): ExportActorLink[] {
  const links = new Map<string, ExportActorLink>();
  for (const page of pageDocs) {
    if ((str(page.type) ?? 'text') !== 'text') continue;
    const { content } = pageText(page);
    if (!content.includes('Compendium')) continue;
    for (const pattern of [COMPENDIUM_ID_LINK, LEGACY_COMPENDIUM_LINK]) {
      for (const match of content.matchAll(pattern)) {
        const collection = `${match[1] ?? ''}.${match[2] ?? ''}`;
        const key = `Compendium.${collection}.Actor.${match[3] ?? ''}`;
        if (links.has(key)) continue;
        const link = worldActorFor(ctx, collection, match[3] ?? '');
        if (link) links.set(key, link);
      }
    }
  }
  return [...links.values()]
    .sort((a, b) => compare(a.compendiumUuid, b.compendiumUuid))
    .slice(0, LIMITS.actorLinksPerJournal);
}

interface JournalBuilt {
  fields: Omit<ExportJournalEntry, 'modified' | 'sig'>;
  /** The page documents behind `fields.pages`, same order. */
  pageDocs: Rec[];
}

/**
 * Whether the journal is opted in for page text: its folder chain or its own id was named, or it
 * holds a recorded session's notes (flag `sessionNotes`, put there by the bridge, D-087), which
 * the GM vault gets with their text without any opt-in.
 */
function textOptedIn(ctx: Context, c: Candidate): boolean {
  return (
    dig(c.doc, 'flags', MODULE_ID, 'sessionNotes') === true ||
    ctx.request.textJournalIds.has(c.id) ||
    inFolders(folderInfoFor(ctx, c.doc), ctx.request.textFolderIds)
  );
}

function journalFields(ctx: Context, c: Candidate): JournalBuilt {
  const doc = c.doc;
  const access = highestPlayerLevel(ctx, doc);
  const observed = atLeast(access, 'observer');
  const uuid = c.uuid;

  const categories = ctx.categories
    ? contentsOf(doc.categories)
        .map(category => ({
          id: str(category.id) ?? '',
          name: sourceName(category),
          sort: num(category.sort) ?? 0,
        }))
        .sort((a, b) => a.sort - b.sort || compare(a.id, b.id))
    : [];

  const allPages = contentsOf(doc.pages)
    .map(page => ({ page, id: str(page.id) ?? '', sort: num(page.sort) ?? 0 }))
    .sort((a, b) => a.sort - b.sort || compare(a.id, b.id));
  const kept = allPages.slice(0, LIMITS.pagesPerJournal);

  const pages: ExportPageEntry[] = kept.map(({ page, id, sort }) => ({
    uuid: uuidOf(page, 'JournalEntryPage', uuid),
    id,
    name: sourceName(page),
    type: str(page.type) ?? 'text',
    category: ctx.categories ? nonEmpty(page.category) : null,
    sort,
    modified: timeOf(page),
    playerAccess: highestPlayerLevel(ctx, page),
    playerVisible: pageAccessForPlayers(page as unknown as JournalEntryPage).page,
  }));

  const textIncluded = textOptedIn(ctx, c);
  return {
    fields: {
      ...commonFields(ctx, c, access, observed, false),
      kind: 'journal',
      categories,
      textIncluded,
      pages,
      pagesTotal: allPages.length,
      actorLinks: textIncluded
        ? journalActorLinks(
            ctx,
            kept.map(entry => entry.page)
          )
        : [],
    },
    pageDocs: kept.map(entry => entry.page),
  };
}

/** An image page as a small figure (its image and caption), so it gets a page note. */
function imagePageHtml(page: Rec): { format: 'html'; content: string } | null {
  const src = imagePath(page.src);
  if (src === null) return null;
  const caption = nonEmpty(dig(page, 'image', 'caption'));
  const figcaption = caption ? `<figcaption>${escapeHtml(caption)}</figcaption>` : '';
  return {
    format: 'html',
    content: `<figure><img src="${escapeHtml(src)}" alt="${escapeHtml(caption ?? '')}">${figcaption}</figure>`,
  };
}

function pageText(page: Rec): { format: 'html' | 'markdown'; content: string } {
  const text = rec(page.text);
  if (num(text?.format) === markdownFormat()) {
    return { format: 'markdown', content: str(text?.markdown) ?? '' };
  }
  return { format: 'html', content: str(text?.content) ?? '' };
}

/**
 * Attach page text to an opted-in journal's text pages: each page at most
 * `textPerPageBytes` (then `truncated`), the journal at most `textPerJournalBytes`
 * (the page that would pass it and every later one get `text: null,
 * textOmitted: 'budget'`). Pages of other types keep no `text` key.
 */
function withPageText(built: JournalBuilt, stripAll: boolean): ExportPageEntry[] {
  let used = 0;
  let exhausted = stripAll;
  return built.fields.pages.map((row, index) => {
    const source = built.pageDocs[index];
    const image = row.type === 'image' ? imagePageHtml(source ?? {}) : null;
    if (row.type !== 'text' && image === null) return row;
    if (exhausted) return { ...row, text: null, textOmitted: 'budget' };
    const { format, content } = image ?? pageText(source ?? {});
    const fitted = fitJsonBytes(content, LIMITS.textPerPageBytes);
    const size = jsonStringBytes(fitted.content);
    if (used + size > LIMITS.textPerJournalBytes) {
      exhausted = true;
      return { ...row, text: null, textOmitted: 'budget' };
    }
    used += size;
    const text: ExportPageText = { format, content: fitted.content, truncated: fitted.truncated };
    return { ...row, text };
  });
}

function itemFields(ctx: Context, c: Candidate): Omit<ExportItemEntry, 'modified' | 'sig'> {
  const doc = c.doc;
  const access = highestPlayerLevel(ctx, doc);
  return {
    ...commonFields(ctx, c, access, atLeast(access, 'observer'), true),
    kind: 'item',
    itemType: str(doc.type) ?? '',
    rarity: rarityOf(doc),
    attunement: nonEmpty(dig(doc, 'system', 'attunement')),
    magical: isMagical(doc),
    identified: dig(doc, 'system', 'identified') !== false,
    playerName: clip(str(doc.name) ?? ''),
    holders: holdersFor(ctx, doc, c.uuid).rows,
  };
}

type Mode = 'ids' | 'full' | 'no-text';

function buildRow(ctx: Context, c: Candidate, mode: Mode): ExportEntry | ExportIdEntry {
  let entry: ExportEntry;
  switch (c.kind) {
    case 'actor': {
      const built = actorFields(ctx, c, mode !== 'ids');
      entry = { ...built.fields, modified: c.time, sig: signature(built.signed) };
      break;
    }
    case 'scene': {
      const built = sceneFields(ctx, c);
      entry = { ...built, modified: c.time, sig: signature(built) };
      break;
    }
    case 'item': {
      const built = itemFields(ctx, c);
      entry = { ...built, modified: c.time, sig: signature(built) };
      break;
    }
    case 'journal': {
      // The signature covers the text-less fields (each page's own modified time is one of
      // them), so page text never moves it and never has to be built for an ids page.
      const built = journalFields(ctx, c);
      const pages =
        mode !== 'ids' && built.fields.textIncluded
          ? withPageText(built, mode === 'no-text')
          : built.fields.pages;
      entry = { ...built.fields, pages, modified: c.time, sig: signature(built.fields) };
      break;
    }
  }
  if (mode === 'ids') return { uuid: c.uuid, kind: c.kind, sig: entry.sig, modified: c.time };
  return entry;
}

// ---------------------------------------------------------------------------
// getExportIndex
// ---------------------------------------------------------------------------

/**
 * The absolute base URL this client reaches Foundry at, including any route prefix and with no
 * trailing slash (`https://host:30000` or `https://host/foundry`); the backend joins
 * `${origin}/${path}` to fetch a data file. The prefix comes from `foundry.utils.getRoute('/')`
 * (`common/utils/helpers.mjs:698`, which reads `ROUTE_PREFIX`); empty when `location` is
 * missing or not http(s).
 */
export function foundryOrigin(): string {
  const origin = str(dig(globalThis, 'location', 'origin'));
  if (!origin || !/^https?:\/\//.test(origin)) return '';
  let prefix = '';
  const getRoute = dig(globalThis, 'foundry', 'utils', 'getRoute');
  if (typeof getRoute === 'function') {
    try {
      const route = (getRoute as (path: string) => unknown)('/');
      if (typeof route === 'string') prefix = new URL(route, origin).pathname;
    } catch {
      // keep the bare origin
    }
  }
  return `${origin}${prefix}`.replace(/\/+$/, '');
}

/**
 * Build one page of the export index. GM clients only (design 1.6): a non-GM
 * client is refused here even when `allowNonGmAccess` lets it call other reads.
 */
export function getExportIndex(data: unknown): ExportIndexResponse | ExportIndexFailure {
  if (!game.user?.isGM) return { success: false, error: 'Access denied' };
  const started = now();

  const request = normalizeRequest(data);
  if ('success' in request) return request;

  const world = rec(game as unknown);
  const ctx: Context = {
    request,
    players: contentsOf(world?.users).filter(user => user.isGM !== true),
    categories: journalCategoriesSupported(),
    folderCache: new Map(),
    holderIndex: null,
    holderCache: new Map(),
    npcIndex: null,
    actorLinkCache: new Map(),
  };

  const universe = collectUniverse(ctx);
  const watermark = maxTime(universe.list.map(candidate => candidate.time)) ?? 0;

  let selected = universe.list;
  if (request.uuids !== null) {
    const wanted = new Set(request.uuids);
    selected = selected.filter(candidate => wanted.has(candidate.uuid));
  } else if (!request.idsOnly && request.since !== null) {
    const since = request.since;
    selected = selected.filter(candidate => candidate.time === null || candidate.time > since);
  }
  if (request.after) {
    const cursor = request.after;
    selected = selected.filter(candidate => afterCursor(candidate, cursor));
  }

  const rows: Array<ExportEntry | ExportIdEntry> = [];
  let bytes = 0;
  let last: Candidate | null = null;
  let more = false;
  for (const candidate of selected) {
    if (rows.length >= request.limit) {
      more = true;
      break;
    }
    let row = buildRow(ctx, candidate, request.idsOnly ? 'ids' : 'full');
    let size = utf8Bytes(JSON.stringify(row));
    if (size > LIMITS.responseHardCapBytes && !request.idsOnly) {
      row = buildRow(ctx, candidate, 'no-text');
      size = utf8Bytes(JSON.stringify(row));
    }
    if (rows.length > 0 && bytes + size > LIMITS.responseBudgetBytes) {
      more = true;
      break;
    }
    rows.push(row);
    bytes += size;
    last = candidate;
  }

  return {
    success: true,
    schema: EXPORT_INDEX_SCHEMA,
    worldId: str(dig(world, 'world', 'id')) ?? '',
    clientId: CLIENT_ID,
    watermark,
    usersSignature: usersSignature(),
    entries: rows as ExportEntry[] | ExportIdEntry[],
    next: more && last ? `${last.kind}:${last.id}` : null,
    truncated: universe.truncated,
    buildMs: Math.round(now() - started),
    origin: foundryOrigin(),
  };
}
