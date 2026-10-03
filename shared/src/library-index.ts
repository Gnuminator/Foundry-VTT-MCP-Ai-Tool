/**
 * The Obsidian Library (docs/design/OBSIDIAN-O4-DESIGN.md section 13): notes for compendium
 * content (monsters, items, spells, classes, subclasses, features, species, backgrounds,
 * feats) from the packs the GM picks in the mirror settings.
 *
 * Two GM-only module queries feed it: `getLibraryIndex` lists the picked packs' documents with a
 * signature each (cheap, from the pack index), and `getLibraryDocuments` returns the full content
 * of the documents whose signature changed. Licensed book content passes through here: it only
 * ever lands in the GM's own vault, in folders the mirror keeps gitignored.
 *
 * The module never imports this file at runtime; it mirrors the constants and a contract test
 * pins the copies (like `export-index.ts`).
 */
import type { ExportStatBlock, RulesTag } from './export-index.js';

export const LIBRARY_INDEX_QUERY = 'getLibraryIndex';
export const LIBRARY_DOCUMENTS_QUERY = 'getLibraryDocuments';
export const LIBRARY_SCHEMA = 1;

/**
 * The pattern source of a compendium pack id (`<package>.<pack>`: `world.ddb-monsters`,
 * `dnd5e.spells`). The module and the mirror settings both build their `RegExp` from it.
 */
export const LIBRARY_PACK_ID_PATTERN = '^[A-Za-z0-9][\\w-]{0,63}\\.[\\w-]{1,64}$';

export const LIBRARY_LIMITS = {
  /** Packs one settings list may name. */
  packs: 100,
  /** Index rows per page (a page also stops at `indexPageBytes`). */
  indexPageMax: 1000,
  /** JSON bytes of the rows in one index page; at least one row is always returned. */
  indexPageBytes: 512 * 1024,
  /** Documents per `getLibraryDocuments` call. */
  documentsPerRequest: 40,
  /** Description HTML per document; beyond it `truncated`. */
  descriptionBytes: 256 * 1024,
  /** JSON bytes per documents response; at least one document is always returned. */
  responseBudgetBytes: 1536 * 1024,
  /** Advancement links per document. */
  linksPerDocument: 300,
  /** Facts per document. */
  factsPerDocument: 30,
} as const;

export interface LibraryIndexRequest {
  /** Pack ids (`world.ddb-monsters`, `dnd5e.spells`). */
  packs: string[];
  /**
   * Paging cursor: the `next` of the previous response, passed back unchanged. It is opaque to
   * the caller (the module reads it as `<packIndex>:<docId>`: the next page starts strictly
   * after that row, in request pack order then document id, so a change between pages never
   * skips a row). Send the same `packs` list with every page.
   */
  after?: string | null;
}

export interface LibraryPackInfo {
  id: string;
  label: string;
  /** `Actor`, `Item`, `JournalEntry`, ... (only Actor and Item packs get notes). */
  documentName: string;
  packageType: string;
  packageName: string;
  /** Documents in the pack. */
  total: number;
}

export interface LibraryIndexRow {
  uuid: string;
  pack: string;
  id: string;
  name: string;
  /** Document type (`npc`, `spell`, `feat`, `class`, ...). */
  type: string;
  /** `system.type.value` (feat kinds such as `class`, `race`, `feat`), or null. */
  subtype: string | null;
  /** The pack folder the document sits in, as the top-most folder name that is not a rules grouping, or null. */
  group: string | null;
  /** `system.identifier` (classes, subclasses), or null. */
  identifier: string | null;
  /** `system.classIdentifier` (subclasses), or null. */
  classIdentifier: string | null;
  /** `system.source.rules` (`2014` or `2024`), or null: tells same-named entries apart. */
  rules: RulesTag | null;
  /** Signature over name, type, folder, image and modified time: changes when the note would. */
  sig: string;
}

export interface LibraryIndexResponse {
  success: true;
  schema: 1;
  worldId: string;
  /**
   * Absolute base URL of Foundry including any route prefix, no trailing slash; join it with a
   * data path as `${origin}/${path}`. Empty when the client has no http(s) location.
   */
  origin: string;
  /** The requested packs that exist, in request order. */
  packs: LibraryPackInfo[];
  /** Requested pack ids that do not exist in this world. */
  missing: string[];
  /** Every pack in the world (id and document type), for legacy `@Compendium[pack.id]` links. */
  allPacks: Array<{ id: string; documentName: string }>;
  entries: LibraryIndexRow[];
  /** Opaque cursor for the next page (pass it back as `after`), null when done. */
  next: string | null;
}

export interface LibraryDocumentsRequest {
  /** Compendium uuids (max `documentsPerRequest`). */
  uuids: string[];
}

export interface LibraryFact {
  label: string;
  value: string;
}

/** A link from advancement (features a class grants, options a feat offers). */
export interface LibraryLink {
  uuid: string;
  name: string | null;
  /** Character level (classes) or null. */
  level: number | null;
  kind: 'grant' | 'choice';
}

export interface LibraryDocument {
  uuid: string;
  pack: string;
  id: string;
  name: string;
  documentName: 'Actor' | 'Item';
  type: string;
  subtype: string | null;
  /** The document's image path, or null when it is a default icon. */
  img: string | null;
  /** `PHB p. 211`, or null. */
  source: string | null;
  rules: RulesTag | null;
  /** Labelled facts (level and school, rarity, hit die, prerequisites, ...). */
  facts: LibraryFact[];
  /** Description HTML (raw: enrichers are rewritten by the backend), or null. */
  description: string | null;
  /** NPCs only. */
  statBlock: ExportStatBlock | null;
  links: LibraryLink[];
  truncated: boolean;
}

export interface LibraryDocumentsResponse {
  success: true;
  schema: 1;
  worldId: string;
  documents: LibraryDocument[];
  /** Requested uuids that could not be loaded (deleted meanwhile). */
  missing: string[];
  /** Requested uuids left for another call (the response budget ran out). */
  deferred: string[];
}
