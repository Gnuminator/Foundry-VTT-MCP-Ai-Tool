/**
 * Test helper: an in-memory fake of the module query `getExportIndex`
 * (docs/design/OBSIDIAN-O4-DESIGN.md section 1) with the contract's semantics, for the
 * Obsidian mirror pump tests. The real query is tested in the module
 * (`packages/foundry-module/src/export-index.test.ts`).
 *
 * Semantics kept from the module: fixed order (kinds `actor, scene, journal,
 * item`, then id ascending) and a `"<kind>:<id>"` cursor; `kinds`,
 * `excludeFolderIds` (the entry's own folder id), `storyItemTypes`;
 * `sinceModifiedTime` (entries with a null time are always sent); `uuids`
 * (ignores `since`); `idsOnly` rows; `includeText` (only opted-in journals keep
 * page text, and the text is never part of the signature: a page's own
 * `modified` is); `watermark` over the whole universe at call time; the
 * `clientId` and `usersSignature` of the "page load"; `{success: false}` on
 * demand.
 */
import { createHash } from 'crypto';

import {
  DEFAULT_STORY_ITEM_TYPES,
  EXPORT_INDEX_LIMITS,
  EXPORT_INDEX_QUERY,
  EXPORT_KINDS,
  MODULE_ID,
  type ExportActorEntry,
  type ExportEntry,
  type ExportEntryBase,
  type ExportIdEntry,
  type ExportIndexFailure,
  type ExportIndexRequest,
  type ExportIndexResponse,
  type ExportItemEntry,
  type ExportJournalEntry,
  type ExportKind,
  type ExportPageEntry,
  type ExportSceneEntry,
} from '@gnuminator/shared';

export const EXPORT_INDEX_METHOD = `${MODULE_ID}.${EXPORT_INDEX_QUERY}`;

/** A 16-character Foundry id from a short seed (`fid('wolf')` = `wolf000000000000`). */
export function fid(seed: string): string {
  return seed
    .replace(/[^A-Za-z0-9]/g, '')
    .padEnd(16, '0')
    .slice(0, 16);
}

const DOCUMENT_NAMES: Record<ExportKind, string> = {
  actor: 'Actor',
  scene: 'Scene',
  journal: 'JournalEntry',
  item: 'Item',
};

// ---------------------------------------------------------------------------
// Entry builders (sig is filled in by the fake; `modified` defaults to 1000)
// ---------------------------------------------------------------------------

function base(kind: ExportKind, seed: string, name: string): ExportEntryBase {
  const id = fid(seed);
  return {
    uuid: `${DOCUMENT_NAMES[kind]}.${id}`,
    id,
    kind,
    name,
    folder: null,
    created: 1,
    modified: 1000,
    sig: '',
    playerAccess: 'none',
    playerVisible: false,
    rules: null,
  };
}

export function pcEntry(
  seed: string,
  name: string,
  over: Partial<ExportActorEntry> = {}
): ExportActorEntry {
  return {
    ...base('actor', seed, name),
    kind: 'actor',
    actorType: 'character',
    pc: true,
    owners: ['Player'],
    hpMax: 28,
    ac: 18,
    size: 'med',
    alignment: 'neutral good',
    disposition: 'friendly',
    tokenName: name,
    playerName: name,
    level: 3,
    classes: [{ name: 'Fighter', levels: 3, subclass: null }],
    species: 'Human',
    background: 'Soldier',
    cr: null,
    creatureType: null,
    sourceBook: null,
    features: [{ name: 'Second Wind', type: 'feat' }],
    notableItems: [],
    playerAccess: 'owner',
    playerVisible: true,
    rules: '2024',
    img: null,
    statBlock: null,
    ...over,
  };
}

export function npcEntry(
  seed: string,
  name: string,
  over: Partial<ExportActorEntry> = {}
): ExportActorEntry {
  return {
    ...base('actor', seed, name),
    kind: 'actor',
    actorType: 'npc',
    pc: false,
    owners: [],
    hpMax: 11,
    ac: 13,
    size: 'med',
    alignment: 'unaligned',
    disposition: 'hostile',
    tokenName: name,
    playerName: 'Unknown creature',
    level: null,
    classes: [],
    species: null,
    background: null,
    cr: 0.25,
    creatureType: 'beast',
    sourceBook: null,
    features: [{ name: 'Bite', type: 'weapon' }],
    notableItems: [],
    rules: '2014',
    img: null,
    statBlock: null,
    ...over,
  };
}

export function sceneEntry(
  seed: string,
  name: string,
  over: Partial<ExportSceneEntry> = {}
): ExportSceneEntry {
  return {
    ...base('scene', seed, name),
    kind: 'scene',
    navName: null,
    navigation: false,
    journal: null,
    pins: [],
    map: null,
    ...over,
  };
}

/** A journal page; `html` makes it a text page (its text is sent only when the journal is opted in). */
export function pageEntry(
  journalSeed: string,
  pageSeed: string,
  name: string,
  html: string | null,
  over: Partial<ExportPageEntry> = {}
): ExportPageEntry {
  const id = fid(pageSeed);
  return {
    uuid: `JournalEntry.${fid(journalSeed)}.JournalEntryPage.${id}`,
    id,
    name,
    type: html === null ? 'image' : 'text',
    category: null,
    sort: 0,
    modified: 1000,
    playerAccess: 'none',
    playerVisible: false,
    ...(html === null ? {} : { text: { format: 'html', content: html, truncated: false } }),
    ...over,
  };
}

export function journalEntry(
  seed: string,
  name: string,
  pages: ExportPageEntry[],
  over: Partial<ExportJournalEntry> = {}
): ExportJournalEntry {
  return {
    ...base('journal', seed, name),
    kind: 'journal',
    categories: [],
    textIncluded: false,
    pages,
    pagesTotal: pages.length,
    ...over,
  };
}

export function itemEntry(
  seed: string,
  name: string,
  over: Partial<ExportItemEntry> = {}
): ExportItemEntry {
  return {
    ...base('item', seed, name),
    kind: 'item',
    itemType: 'weapon',
    rarity: 'rare',
    attunement: null,
    magical: true,
    identified: true,
    playerName: name,
    holders: [],
    rules: '2014',
    ...over,
  };
}

// ---------------------------------------------------------------------------
// The fake module query
// ---------------------------------------------------------------------------

/** A page without its text: what the signature covers (never the text itself). */
function pageWithoutText(page: ExportPageEntry): ExportPageEntry {
  const { text: _text, textOmitted: _omitted, ...rest } = page;
  return rest;
}

/** The entry as the module would send it for this request (text only for opted-in journals). */
function shape(entry: ExportEntry, request: ExportIndexRequest): ExportEntry {
  if (entry.kind !== 'journal') return entry;
  const folderIds = request.includeText?.folderIds ?? [];
  const journalIds = request.includeText?.journalIds ?? [];
  const optedIn =
    journalIds.includes(entry.id) || (entry.folder !== null && folderIds.includes(entry.folder.id));
  return {
    ...entry,
    textIncluded: optedIn,
    pages: entry.pages.map(page => {
      if (page.type !== 'text') return pageWithoutText(page);
      if (!optedIn) return pageWithoutText(page);
      return page.text === undefined
        ? { ...page, text: { format: 'html', content: '', truncated: false } }
        : page;
    }),
  };
}

/** cyrb53-like stand-in: a stable hash over the exported fields except `modified`, `sig` and page text. */
function signature(entry: ExportEntry): string {
  const { modified: _modified, sig: _sig, ...fields } = entry;
  const covered =
    entry.kind === 'journal'
      ? { ...fields, pages: entry.pages.map(pageWithoutText) }
      : (fields as Record<string, unknown>);
  return createHash('sha256').update(JSON.stringify(covered)).digest('hex').slice(0, 14);
}

function compareIds(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

export class FakeExportIndex {
  worldId = 'test-world';
  clientId = 'client-1';
  usersSignature = 'users-1';
  connected = true;
  /** Entries per page (overrides the contract default, to force paging). */
  pageLimit: number | null = null;
  truncated: ExportIndexResponse['truncated'] = [];
  /** The next query answers `{success: false, error}`. */
  failNext: string | null = null;
  /** Runs after a response is built and before it is returned (mutate the world "mid-cycle"). */
  afterQuery: ((request: ExportIndexRequest, response: ExportIndexResponse) => void) | null = null;
  /** Runs before a query is answered; may wait (hold a cycle in flight). */
  beforeQuery: ((request: ExportIndexRequest) => Promise<void> | void) | null = null;
  readonly requests: ExportIndexRequest[] = [];
  private readonly docs = new Map<string, ExportEntry>();

  /** Add or replace a document (its `sig` is computed per request). */
  put(entry: ExportEntry): void {
    this.docs.set(entry.uuid, structuredClone(entry));
  }

  /** Change a document in place: `fn` gets a copy to edit; `modified` is set to `modified` when given. */
  edit<T extends ExportEntry>(uuid: string, fn: (entry: T) => void, modified?: number): void {
    const current = this.docs.get(uuid);
    if (!current) throw new Error(`No fake document ${uuid}`);
    const copy = structuredClone(current) as T;
    fn(copy);
    if (modified !== undefined) copy.modified = modified;
    this.docs.set(uuid, copy);
  }

  get(uuid: string): ExportEntry | undefined {
    return this.docs.get(uuid);
  }

  remove(uuid: string): void {
    this.docs.delete(uuid);
  }

  /** The current signature of a document as the fake would send it for `request`. */
  sigOf(uuid: string, request: ExportIndexRequest = {}): string {
    const entry = this.docs.get(uuid);
    if (!entry) throw new Error(`No fake document ${uuid}`);
    return signature(shape(entry, request));
  }

  isConnected = (): boolean => this.connected;

  /** Answers to the Library queries (default: no packs, an empty Library). */
  library: (method: string, data: unknown) => unknown = method =>
    method.endsWith('.getLibraryIndex')
      ? {
          success: true,
          schema: 1,
          worldId: this.worldId,
          origin: '',
          packs: [],
          missing: [],
          allPacks: [],
          entries: [],
          next: null,
        }
      : {
          success: true,
          schema: 1,
          worldId: this.worldId,
          documents: [],
          missing: [],
          deferred: [],
        };

  query = async (method: string, data?: unknown): Promise<unknown> => {
    if (method.endsWith('.getLibraryIndex') || method.endsWith('.getLibraryDocuments')) {
      if (!this.connected) throw new Error('Foundry VTT module not connected');
      return this.library(method, data);
    }
    if (method !== EXPORT_INDEX_METHOD) throw new Error(`Unexpected query ${method}`);
    if (!this.connected) throw new Error('Foundry VTT module not connected');
    const request = structuredClone((data ?? {}) as ExportIndexRequest);
    this.requests.push(request);
    await this.beforeQuery?.(request);
    if (this.failNext !== null) {
      const failure: ExportIndexFailure = { success: false, error: this.failNext };
      this.failNext = null;
      return failure;
    }
    const response = this.answer(request);
    this.afterQuery?.(request, response);
    return response;
  };

  private universe(request: ExportIndexRequest): ExportEntry[] {
    const kinds = request.kinds ?? [...EXPORT_KINDS];
    const excluded = new Set(request.excludeFolderIds ?? []);
    const storyTypes = new Set(request.storyItemTypes ?? DEFAULT_STORY_ITEM_TYPES);
    return [...this.docs.values()]
      .filter(entry => kinds.includes(entry.kind))
      .filter(entry => entry.folder === null || !excluded.has(entry.folder.id))
      .filter(entry => entry.kind !== 'item' || storyTypes.has(entry.itemType))
      .sort(
        (a, b) =>
          EXPORT_KINDS.indexOf(a.kind) - EXPORT_KINDS.indexOf(b.kind) || compareIds(a.id, b.id)
      );
  }

  private answer(request: ExportIndexRequest): ExportIndexResponse {
    const universe = this.universe(request);
    const watermark = universe.reduce((max, entry) => Math.max(max, entry.modified ?? 0), 0);
    let selected = universe;
    if (request.uuids) {
      const wanted = new Set(request.uuids.slice(0, EXPORT_INDEX_LIMITS.uuidsPerRequest));
      selected = selected.filter(entry => wanted.has(entry.uuid));
    } else if (!request.idsOnly && typeof request.sinceModifiedTime === 'number') {
      const since = request.sinceModifiedTime;
      selected = selected.filter(entry => entry.modified === null || entry.modified > since);
    }
    if (request.after) {
      const [kind, id] = request.after.split(':') as [ExportKind, string];
      const rank = EXPORT_KINDS.indexOf(kind);
      selected = selected.filter(entry => {
        const r = EXPORT_KINDS.indexOf(entry.kind);
        return r > rank || (r === rank && entry.id > id);
      });
    }
    const limit =
      this.pageLimit ??
      (request.idsOnly
        ? EXPORT_INDEX_LIMITS.idsPageDefault
        : (request.limit ?? EXPORT_INDEX_LIMITS.pageDefault));
    const page = selected.slice(0, limit);
    const more = selected.length > page.length;
    const last = page[page.length - 1];
    const shaped = page.map(entry => {
      const sent = shape(entry, request);
      return { ...sent, sig: signature(sent) };
    });
    const entries: ExportEntry[] | ExportIdEntry[] = request.idsOnly
      ? shaped.map(e => ({ uuid: e.uuid, kind: e.kind, sig: e.sig, modified: e.modified }))
      : shaped;
    return {
      success: true,
      schema: 1,
      worldId: this.worldId,
      clientId: this.clientId,
      watermark,
      usersSignature: this.usersSignature,
      entries,
      next: more && last ? `${last.kind}:${last.id}` : null,
      truncated: structuredClone(this.truncated),
      buildMs: 1,
    };
  }
}
