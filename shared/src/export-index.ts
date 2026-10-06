/**
 * Foundry export index (docs/design/OBSIDIAN-O4-DESIGN.md sections 1 and 6, Obsidian O4).
 *
 * The module query `getExportIndex` lists the world's PCs, NPCs, scenes,
 * journals (with their pages) and story items for the Obsidian mirror, computed
 * on a GM client. It is GM data: hidden NPCs, GM-only journals and opted-in
 * page text all pass through it, so it only ever lands in the GM's own vault.
 *
 * The module never imports this file at runtime (a browser cannot resolve
 * `@gnuminator/shared`); it imports the types and mirrors the constants, and a
 * contract test pins the copies. Never exported (section 1.7): page text of
 * journals that are not opted in, PC biographies, appearance and traits (a
 * player character never gets a stat block), item descriptions, flags, HP
 * values, effects, token lists, token art and positions, chat, settings, user
 * details beyond owner names. Deliberately exported since the Library (section
 * 13), GM-only: an NPC's stat block (feature texts and the NPC biography), the
 * actor portrait path (`img`), the scene map path (`map`), the figure HTML of
 * an image page of an opted-in journal, and the `origin` of Foundry (absolute
 * base URL including any route prefix, no trailing slash). Compendium content
 * comes through the Library queries (`library-index.ts`).
 */

/** Module query name (prefixed with the module id on the wire). */
export const EXPORT_INDEX_QUERY = 'getExportIndex';
export const EXPORT_INDEX_SCHEMA = 1;

export type ExportKind = 'actor' | 'scene' | 'journal' | 'item';
/** Fixed kind order for paging (section 1.4): kinds in this order, then id ascending. */
export const EXPORT_KINDS: readonly ExportKind[] = ['actor', 'scene', 'journal', 'item'];

/** The highest ownership level any non-GM user holds (section 4). */
export type PlayerAccess = 'none' | 'limited' | 'observer' | 'owner';
export type RulesTag = '2014' | '2024';

/** World item types mirrored as story items by default (section 1.2). */
export const DEFAULT_STORY_ITEM_TYPES: readonly string[] = [
  'weapon',
  'equipment',
  'consumable',
  'tool',
  'loot',
  'container',
];

/**
 * A Foundry document uuid: world (`Actor.<16>`, embedded
 * `JournalEntry.<16>.JournalEntryPage.<16>`) or compendium
 * (`Compendium.<package>.<pack>.<Type>.<16>`). The same pattern
 * `gm-helper-queries.ts` enforces for `open-in-foundry`.
 */
export const FOUNDRY_UUID_SOURCE =
  '^(?:Compendium\\.[\\w-]+\\.[\\w-]+\\.)?[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16}(?:\\.[A-Z][A-Za-z]+\\.[A-Za-z0-9]{16})*$';
/** Longest uuid accepted anywhere (the module's `parseUuidPayload` limit). */
export const FOUNDRY_UUID_MAX_LENGTH = 300;

export function isFoundryUuid(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length <= FOUNDRY_UUID_MAX_LENGTH &&
    new RegExp(FOUNDRY_UUID_SOURCE).test(value)
  );
}

/** Paging, size and world limits (section 1.4, plus per-entry list caps from 1.2). */
export const EXPORT_INDEX_LIMITS = {
  pageDefault: 200,
  pageMax: 500,
  idsPageDefault: 5000,
  idsPageMax: 10000,
  /** JSON bytes per response; at least one entry is always returned. */
  responseBudgetBytes: 512 * 1024,
  responseHardCapBytes: 2.5 * 1024 * 1024,
  /** Text per page; beyond it `text.truncated` is true. */
  textPerPageBytes: 512 * 1024,
  /** Text per journal; later pages get `text: null, textOmitted: 'budget'`. */
  textPerJournalBytes: 2 * 1024 * 1024,
  uuidsPerRequest: 500,
  /** Names, labels, folder path segments. */
  nameChars: 200,
  featuresPerActor: 80,
  notableItemsPerActor: 40,
  pinsPerScene: 300,
  /** Token rows (tokens folded by actor, name, disposition and hidden). */
  tokensPerScene: 200,
  pagesPerJournal: 1000,
  holdersPerItem: 20,
  /** Feature and description HTML per stat block. */
  statBlockBytes: 256 * 1024,
  /** Paths (images). */
  pathChars: 1024,
  /** World caps, reported in `truncated`. */
  worldCaps: { actor: 5000, scene: 1000, journal: 3000, item: 5000 },
} as const;

// ---------------------------------------------------------------------------
// Request
// ---------------------------------------------------------------------------

export interface ExportIndexRequest {
  /** Default: all four. */
  kinds?: ExportKind[];
  /** Server ms; entries whose effective modified time is greater. */
  sinceModifiedTime?: number;
  /** Fetch exactly these top-level docs (max 500); ignores `sinceModifiedTime`. */
  uuids?: string[];
  /** Reconciliation mode: `ExportIdEntry` rows only. */
  idsOnly?: boolean;
  /** Journals whose page text is sent: these folders (subfolders included) and journals. */
  includeText?: { folderIds: string[]; journalIds: string[] };
  /** Never export documents in these folders (subfolders included); any kind. */
  excludeFolderIds?: string[];
  /** Default `DEFAULT_STORY_ITEM_TYPES`. */
  storyItemTypes?: string[];
  /** Paging cursor from the previous response. */
  after?: string | null;
  /** Entries per page (see `EXPORT_INDEX_LIMITS`). */
  limit?: number;
}

// ---------------------------------------------------------------------------
// Entries
// ---------------------------------------------------------------------------

export interface ExportFolderRef {
  id: string;
  /** Folder names root to leaf. */
  path: string[];
}

/** Fields every entry carries (section 1.2). */
export interface ExportEntryBase {
  uuid: string;
  id: string;
  kind: ExportKind;
  /** The source name (`_source.name`; for items never the unidentified name). */
  name: string;
  folder: ExportFolderRef | null;
  /** `_stats.createdTime`, server ms. */
  created: number | null;
  /** Effective modified time (section 1.3), server ms. */
  modified: number | null;
  /** Signature over the exported fields (section 1.5); the backend only compares it. */
  sig: string;
  playerAccess: PlayerAccess;
  playerVisible: boolean;
  /** dnd5e rules version for actors and items; null for scenes and journals. */
  rules: RulesTag | null;
}

export type TokenDisposition = 'secret' | 'hostile' | 'neutral' | 'friendly';

/** One labelled stat block line (`Armor Class` / `13 (natural armor)`). */
export interface StatBlockLine {
  label: string;
  value: string;
}

/**
 * An NPC's stat block as dnd5e lays it out (`NPCData#_prepareEmbedContext`, dnd5e 6.0.5):
 * plain text lines plus the raw HTML of each feature (enrichers are rewritten by the backend).
 */
export interface ExportStatBlock {
  rules: RulesTag;
  /** `Medium undead, neutral evil`. */
  tag: string;
  /** Armor Class, Initiative (2024), Hit Points, Speed. */
  upper: StatBlockLine[];
  abilities: Array<{ key: string; label: string; score: number; mod: number; save: number }>;
  /** Saving Throws, Skills, damage and condition traits, Senses, Languages, Challenge, PB. */
  lower: StatBlockLine[];
  /** Traits, Actions, Bonus Actions, Reactions, Legendary Actions, Mythic Actions, in that order. */
  sections: Array<{
    key: string;
    label: string;
    /** HTML before the entries (the legendary actions intro), or null. */
    intro: string | null;
    entries: Array<{ name: string; html: string }>;
  }>;
  /** Embedded spells (names link to their Library notes through `sourceUuid`). */
  spells: Array<{ name: string; level: number; sourceUuid: string | null }>;
  /** The actor's biography HTML (adventure text; GM vault only), or null. */
  description: string | null;
  /** Feature or description text was cut at `EXPORT_INDEX_LIMITS.statBlockBytes`. */
  truncated: boolean;
}

export interface ExportActorEntry extends ExportEntryBase {
  kind: 'actor';
  actorType: 'character' | 'npc';
  /** `hasPlayerOwner` (the M2 rule): a player-owned `npc` is a PC too. */
  pc: boolean;
  /** Names of non-GM users with OWNER. */
  owners: string[];
  hpMax: number | null;
  ac: number | null;
  /** dnd5e size key (`med`, `lg`, ...). */
  size: string | null;
  alignment: string | null;
  /** The prototype token's disposition. */
  disposition: TokenDisposition | null;
  /** The prototype token's name. */
  tokenName: string | null;
  /** The name players see: the prototype token's name when its display mode shows it, else `Unknown creature`. */
  playerName: string;
  /** Character only (else null / empty). */
  level: number | null;
  classes: Array<{ name: string; levels: number; subclass: string | null }>;
  species: string | null;
  background: string | null;
  /** NPC only (else null). */
  cr: number | null;
  creatureType: string | null;
  sourceBook: string | null;
  /** Embedded item names only (max `featuresPerActor`). */
  features: Array<{ name: string; type: string }>;
  /** Magical, or uncommon and rarer, embedded items (max `notableItemsPerActor`). */
  notableItems: Array<{ name: string; sourceUuid: string | null }>;
  /** The portrait's path (`img`), relative to Foundry's data root or a URL; null when default. */
  img: string | null;
  /** NPC only (else null): the full stat block. */
  statBlock: ExportStatBlock | null;
  /**
   * What the actor was made from: `_stats.compendiumSource`, else `_stats.duplicateSource`;
   * null when neither is set or it names the actor itself. Absent from modules before the
   * graph links (an older module on the table): read it as null.
   */
  sourceUuid?: string | null;
}

export interface ExportScenePin {
  label: string | null;
  entryUuid: string | null;
  pageUuid: string | null;
}

/**
 * The scene's tokens, folded: one row per world actor, token name, disposition and hidden
 * flag, with the number of tokens behind it. Positions are never here: tokens move all the
 * time, and the row is part of the scene's `sig`.
 */
export interface ExportSceneToken {
  /** The token's own name (what the map shows). */
  name: string;
  /** The world actor (`Actor.<id>`), or null when the token has none or it is gone. */
  actorUuid: string | null;
  /** The world actor's type (`npc`, `character`, ...), or null without one. */
  actorType: string | null;
  /** Linked to the world actor (a unique NPC or a PC) rather than its own copy. */
  actorLink: boolean;
  disposition: TokenDisposition | null;
  hidden: boolean;
  count: number;
}

export interface ExportSceneEntry extends ExportEntryBase {
  kind: 'scene';
  navName: string | null;
  navigation: boolean;
  journal: { uuid: string; pageUuid: string | null } | null;
  /** Map Notes (max `pinsPerScene`). */
  pins: ExportScenePin[];
  /** Tokens (max `tokensPerScene` rows); absent from older modules. */
  tokens?: ExportSceneToken[];
  /** The map image (the background of the scene's first level), or null. */
  map: string | null;
}

export interface ExportPageText {
  format: 'html' | 'markdown';
  content: string;
  truncated: boolean;
}

export interface ExportPageEntry {
  uuid: string;
  id: string;
  name: string;
  /** Core `text`/`image`/`pdf`/`video` plus dnd5e page types. */
  type: string;
  /** Category id, or null. */
  category: string | null;
  sort: number;
  modified: number | null;
  playerAccess: PlayerAccess;
  /** Some single player can observe the journal AND the page (the M2 rule). */
  playerVisible: boolean;
  /**
   * Present only on text and image pages of an opted-in journal (an image page sends a small
   * HTML figure of its image and caption, so it gets a page note like a text page).
   */
  text?: ExportPageText | null;
  /** Set with `text: null` when the journal's text budget ran out. */
  textOmitted?: 'budget';
}

export interface ExportJournalEntry extends ExportEntryBase {
  kind: 'journal';
  categories: Array<{ id: string; name: string; sort: number }>;
  /** The journal is opted in for page text. */
  textIncluded: boolean;
  /** Max `pagesPerJournal`, in sort order. */
  pages: ExportPageEntry[];
  /** Page count before the cap. */
  pagesTotal: number;
}

export interface ExportItemHolder {
  uuid: string;
  name: string;
  /** `source`: the embedded item's duplicate/compendium source is this item; `name`: same name (magical items only). */
  match: 'source' | 'name';
}

export interface ExportItemEntry extends ExportEntryBase {
  kind: 'item';
  itemType: string;
  rarity: string | null;
  attunement: string | null;
  magical: boolean;
  identified: boolean;
  /** The prepared name, which dnd5e replaces with the unidentified name on every client. */
  playerName: string;
  /** Max `holdersPerItem`. */
  holders: ExportItemHolder[];
}

export type ExportEntry =
  | ExportActorEntry
  | ExportSceneEntry
  | ExportJournalEntry
  | ExportItemEntry;

/** Reconciliation row (`idsOnly`). */
export interface ExportIdEntry {
  uuid: string;
  kind: ExportKind;
  sig: string;
  modified: number | null;
}

// ---------------------------------------------------------------------------
// Response
// ---------------------------------------------------------------------------

export interface ExportIndexResponse {
  success: true;
  schema: 1;
  worldId: string;
  /** Random per module page load (a reload means: reconcile). */
  clientId: string;
  /** Max effective modified time over ALL exportable docs at call time. */
  watermark: number;
  /** Hash of every user's id, role and banned flag. */
  usersSignature: string;
  entries: ExportEntry[] | ExportIdEntry[];
  /** Cursor `"<kind>:<id>"` of the last entry; null when done. */
  next: string | null;
  truncated: Array<{ kind: ExportKind; total: number; cap: number }>;
  buildMs: number;
  /**
   * Absolute base URL of Foundry including any route prefix, no trailing slash (for example
   * `http://localhost:30000` or `https://host/foundry`); the bridge fetches images from
   * `${origin}/${path}`. Empty when the client has no http(s) location.
   */
  origin?: string;
}

export interface ExportIndexFailure {
  success: false;
  error: string;
}

// ---------------------------------------------------------------------------
// The dashboard's /open route (section 6)
// ---------------------------------------------------------------------------

/** Required on `POST /api/open` (a custom header forces a CORS preflight). */
export const OPEN_REQUEST_HEADER = 'x-cogm-request';
export const OPEN_REQUEST_VALUE = 'open';

export interface OpenLinkRequest {
  uuid: string;
  /** The GM whose screen to use when several GMs are logged in. */
  userId?: string;
}

export interface OpenLinkResult {
  opened: boolean;
  documentName: string;
  name: string | null;
  userId: string;
}

export type OpenLinkErrorCode =
  | 'gm-required'
  | 'bad-request'
  | 'bad-uuid'
  | 'cross-site'
  | 'choose-gm'
  | 'rate-limited'
  | 'bridge';

export interface OpenLinkError {
  code: OpenLinkErrorCode;
  error: string;
  /** With `choose-gm`: the GMs to pick from. */
  gms?: Array<{ id: string; name: string }>;
}
