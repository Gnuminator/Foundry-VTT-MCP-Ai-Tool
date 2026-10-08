/**
 * The Foundry mirror pump (docs/design/OBSIDIAN-O4-DESIGN.md section 2, Obsidian O4).
 *
 * Polls the module query `getExportIndex` and keeps one note per mirrored
 * Foundry document under `Campaigns/<worldId>/AI Tool/Foundry/`, plus the
 * mirror's bases and `_status.md`. The notes are the state: the pump keeps no
 * bridge-vault file. What it holds in memory (watermark, clientId,
 * usersSignature, settings hash, the note map of the last scan) is rebuilt by
 * a reconcile at start.
 *
 * Cycles (one at a time; a cycle that passes 60 s is abandoned):
 * - incremental, every `pollMs`: entries modified after `watermark - 2 s`;
 *   the new watermark is the FIRST page's `watermark` (a failed or abandoned
 *   cycle keeps the old one);
 * - reconcile, at start, when `clientId`, `usersSignature` or the settings
 *   hash change, and every 10 minutes (at most once per 60 s except right
 *   after a settings change): a fresh scan, `idsOnly` rows for every mirrored
 *   kind, a fetch (`uuids`, batches of 500) of every row whose `sig` differs
 *   from its note's `fvtt_sig` or that has no note, and the deletes by set
 *   arithmetic (a note whose uuid has no row goes to the vault `.trash/`).
 *
 * Safety rules (the part that trashes notes in the GM's vault):
 * - nothing is written or trashed unless the settings say `enabled: true`, and
 *   nothing before the real-path fences pass (`AI Tool/Foundry`,
 *   `AI Tool/Bases`, and `.trash` inside the vault);
 * - notes are created and trashed only when the last scan was complete (no
 *   read errors, no limit hit): a note missing from an incomplete scan might
 *   just be unread;
 * - only notes inside `AI Tool/Foundry/` are written or trashed; a note the
 *   GM moved elsewhere is never written again and never duplicated; an edited
 *   note is never overwritten or trashed (`checkMarkdownOwnership`, re-checked
 *   on the file itself right before each write or trash);
 * - notes of a kind whose world cap was hit are never trashed for a missing
 *   row (the document may lie beyond the cap), nor page notes of a journal
 *   whose page list was cut;
 * - the only bridge-vault inputs are the mirror settings and `gm/reveals.json`
 *   (the `revealed` flag per page, design 7.3).
 *
 * Licensed content (design 13): the Library (`AI Tool/Library/`, compendium notes, see
 * `library-sync.ts`) and image copies (`AI Tool/Attachments/`, `attachments.ts`) are written
 * only after `LicensedGuard` confirmed git ignores them, and world notes carry licensed text
 * (stat blocks, opted-in page text, images) only when git ignores the whole mirror folder.
 * World notes go first; the Library refresh, Library writes and image copies then get their own
 * time slices and continue at the next cycle, so a first sync of thousands of entries spreads
 * over several cycles. Only the very first Library refresh after a start runs before the world
 * notes (they wait for its links instead of being written twice).
 *
 * What else shapes a world note (the guard's answers, the Library packs and membership) is a
 * short hash appended to the signature in `fvtt_sig`, so a change of it re-renders the notes,
 * also when it happened while the bridge was down.
 *
 * Folders (I-100): a note goes in its kind folder plus the document's Foundry folder path
 * (`AI Tool/Foundry/Journals/<Foundry folders>/<Name>.md`); page notes sit in their journal's
 * page folder. A fetched entry whose unedited note sits in another folder (a new layout, or the
 * document moved in Foundry; the folder is part of the signature) moves there once, by rename
 * (`NoteWriter.move`), its page notes with it. An edited note stays and is listed in the status.
 * Links in other notes are rebuilt from the uuid-to-path maps, so a cycle that moved a note asks
 * for a full re-render (a forced reconcile, after the 60 s throttle) to point them at the new
 * paths. A journal's page folder never takes the name of a Foundry folder beside it: such a
 * journal gets a suffixed name instead.
 */
import { createHash } from 'crypto';
import { promises as fsp } from 'fs';
import * as path from 'path';

import {
  EXPORT_INDEX_LIMITS,
  EXPORT_INDEX_QUERY,
  EXPORT_KINDS,
  MODULE_ID,
  isFoundryUuid,
  type ExportEntry,
  type ExportIdEntry,
  type ExportIndexRequest,
  type ExportIndexResponse,
  type ExportJournalEntry,
  type ExportKind,
} from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';
import type { Logger } from '../logger.js';
import { REVEALS_FILE } from '../tarokka/service.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import {
  emptyMirrorStatus,
  MIRROR_FOLDERS,
  MIRROR_NOTE_TYPES,
  MIRROR_ROOT,
  MIRROR_STATUS_PATH,
  pathKey,
  versionedSig,
  type LinkContext,
  type LinkTarget,
  type MirrorNoteType,
  type MirrorRenderContext,
  type MirrorSettings,
  type MirrorStatus,
  type RenderedNote,
  type ScannedNote,
} from './mirror-common.js';
import { ADVENTURES_FOLDER, collectAdventureHubs, matchBookNote } from './adventure-hubs.js';
import { AttachmentStore, type Fetcher } from './attachments.js';
import { LibrarySync, type LibrarySyncDeps } from './library-sync.js';
import {
  ATTACHMENTS_ROOT,
  LIBRARY_ROOT,
  LicensedGuard,
  runGit,
  type GitRunner,
  type GuardResult,
} from './licensed-guard.js';
import {
  allocateNotePaths,
  folderOf,
  folderPath,
  inFolder,
  pageNoteFolder,
  type PathRequest,
} from './mirror-paths.js';
import {
  folderText,
  isAdventureHubText,
  mirrorNoteType,
  renderAdventureHub,
  renderMirrorBases,
  renderMirrorNote,
  renderMirrorStatusNote,
  sameMirrorContent,
} from './mirror-render.js';
import { scanCampaign, type MirrorScan } from './mirror-scan.js';
import { readMirrorSettings } from './mirror-settings.js';
import {
  campaignDir,
  errorCode,
  errorMessage,
  KEPT_AT_OLD_PATH,
  NoteWriter,
  type OwnedOptions,
  type WrittenCache,
} from './note-writer.js';
import { baseOwnershipCheck, checkMarkdownOwnership, type OwnershipResult } from './ownership.js';
import { EMPTY_SEEN_INDEX, parseSeenIndex, SEEN_INDEX_FILE, type SeenIndex } from './seen-in.js';

/** Wire name of the module query (`foundry-mcp-bridge.getExportIndex`). */
export const EXPORT_INDEX_METHOD = `${MODULE_ID}.${EXPORT_INDEX_QUERY}`;
/** A cycle that runs longer is abandoned (checked between pages and between note writes). */
export const MIRROR_CYCLE_LIMIT_MS = 60_000;
/** Reconciles run at most this often, except right after a settings change. */
export const RECONCILE_MIN_INTERVAL_MS = 60_000;
/** A reconcile runs at least this often. */
export const RECONCILE_EVERY_MS = 10 * 60_000;
/** Incremental overlap below the watermark (equal timestamps; renders are idempotent). */
export const WATERMARK_OVERLAP_MS = 2_000;

const BASES_FOLDER = 'AI Tool/Bases';
const FENCE_PREFIX = `${MIRROR_ROOT}/`;
/** Yield to the event loop every this many note writes or trashes. */
const YIELD_EVERY = 50;
const UUID_BATCH = EXPORT_INDEX_LIMITS.uuidsPerRequest;
/** A cursor loop longer than this is a module bug, not a world. */
const MAX_PAGES_PER_QUERY = 10_000;
/** Status path for problems that belong to the campaign folder as a whole. */
const CAMPAIGN_PATH = '.';
/** Time per cycle for the Library refresh and fetches, then image copies (after the world notes). */
const LICENSED_SLICE_MS = 30_000;
const IMAGE_SLICE_MS = 20_000;
/** The first Library refresh after a start, before the world notes (it goes on next cycle). */
const FIRST_REFRESH_SLICE_MS = 20_000;
/** The connector's own default for a module query. */
const EXPORT_QUERY_TIMEOUT_MS = 10_000;

function hash8(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 8);
}

/** The settings that shape Library notes (their links into world notes): all but `enabled` and the packs. */
function libraryRenderKey(settings: MirrorSettings): string {
  return JSON.stringify([
    settings.kinds,
    settings.text,
    settings.excludeFolderIds,
    settings.storyItemTypes,
  ]);
}

type TopType = Exclude<MirrorNoteType, 'journal-page'>;

const KIND_OF_TYPE: Record<MirrorNoteType, ExportKind> = {
  pc: 'actor',
  npc: 'actor',
  scene: 'scene',
  journal: 'journal',
  'journal-page': 'journal',
  'story-item': 'item',
};

/** The kind folder of each note type (section 3.1); the Foundry folder path goes below it. */
const FOLDER_OF_TYPE: Record<TopType, string> = {
  pc: MIRROR_FOLDERS.pc,
  npc: MIRROR_FOLDERS.npc,
  scene: MIRROR_FOLDERS.scene,
  journal: MIRROR_FOLDERS.journal,
  'story-item': MIRROR_FOLDERS.item,
};
/** `AI Tool/Foundry/<Kind>`: segments of a kind folder. */
const KIND_FOLDER_DEPTH = 3;

/**
 * The folder a top-level note belongs in: its kind folder plus the entry's Foundry folders. An
 * actor note keeps the kind folder it sits in (PCs or NPCs) when its type flips: a PC that loses
 * its player owner stays where it is (section 3.1; the bases filter by tag, not by folder).
 */
function noteFolder(type: TopType, entry: ExportEntry, notePath?: string): string {
  let kind = FOLDER_OF_TYPE[type];
  if ((type === 'pc' || type === 'npc') && notePath !== undefined) {
    for (const actors of [MIRROR_FOLDERS.pc, MIRROR_FOLDERS.npc]) {
      if (pathKey(notePath).startsWith(pathKey(`${actors}/`))) kind = actors;
    }
  }
  return folderPath(kind, entry.folder?.path ?? []);
}

/** `pathKey` of every folder of `folder` below its kind folder (the Foundry folders it implies). */
function foundryFolderKeys(folder: string): string[] {
  const parts = folder.split('/');
  const keys: string[] = [];
  for (let n = parts.length; n > KIND_FOLDER_DEPTH; n--) {
    keys.push(pathKey(parts.slice(0, n).join('/')));
  }
  return keys;
}

const PAGE_UUID = /^(JournalEntry\.[A-Za-z0-9]{16})\.JournalEntryPage\.([A-Za-z0-9]{16})$/;

export interface ObsidianMirrorPumpOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  /** The GM's Obsidian vault (`FOUNDRY_AI_OBSIDIAN_DIR`). */
  vaultDir: string;
  logger: Pick<Logger, 'info' | 'warn'>;
  /** Incremental interval (`FOUNDRY_AI_MIRROR_POLL_MS`, already clamped). */
  pollMs: number;
  /** Validated `FOUNDRY_AI_OPEN_BASE`. */
  openBase: string;
  /** Validated `FOUNDRY_AI_FOUNDRY_URL` (where images are fetched), or null to use the GM client's origin. */
  foundryUrl?: string | null;
  now?: () => number;
  /** Tests: git and HTTP stand-ins. */
  git?: GitRunner;
  fetcher?: Fetcher;
}

/** The licensed-content helpers of one world (design 13). */
interface Licensed {
  guard: LicensedGuard;
  attachments: AttachmentStore;
  library: LibrarySync;
  guardResult: GuardResult | null;
  /** The Library's last failure outside the sync's own error list, or null. */
  libraryError: string | null;
}

/** Stops the cycle; nothing more is written (world changed, fence refused). */
class CycleAbort extends Error {
  constructor(
    message: string,
    readonly noStatus: boolean
  ) {
    super(message);
  }
}

// ---------------------------------------------------------------------------
// Small helpers
// ---------------------------------------------------------------------------

function isMirrorNoteType(type: string): type is MirrorNoteType {
  return (MIRROR_NOTE_TYPES as readonly string[]).includes(type);
}

function insideFence(relPath: string): boolean {
  return relPath.startsWith(FENCE_PREFIX);
}

/** The note types the settings enable (a journal enables its page notes). */
function enabledTypes(settings: MirrorSettings): Set<MirrorNoteType> {
  const types = new Set<MirrorNoteType>();
  for (const kind of settings.kinds) {
    if (kind === 'journal') {
      types.add('journal');
      types.add('journal-page');
    } else {
      types.add(kind === 'item' ? 'story-item' : kind);
    }
  }
  return types;
}

/** The export kinds to request (actors when PCs or NPCs are on; post-filtered by type). */
function requestKinds(settings: MirrorSettings): ExportKind[] {
  const kinds = new Set<ExportKind>();
  for (const kind of settings.kinds) kinds.add(kind === 'pc' || kind === 'npc' ? 'actor' : kind);
  return EXPORT_KINDS.filter(kind => kinds.has(kind));
}

function baseRequest(settings: MirrorSettings): ExportIndexRequest {
  return {
    kinds: requestKinds(settings),
    includeText: {
      folderIds: [...settings.text.folderIds],
      journalIds: [...settings.text.journalIds],
    },
    excludeFolderIds: [...settings.excludeFolderIds],
    storyItemTypes: [...settings.storyItemTypes],
  };
}

/** The journal uuid of a page note (from its uuid, else its `fvtt_journal`). */
function journalOfPage(note: ScannedNote): string | null {
  return PAGE_UUID.exec(note.uuid)?.[1] ?? note.journalUuid;
}

function chunks<T>(items: readonly T[], size: number): T[][] {
  const out: T[][] = [];
  for (let i = 0; i < items.length; i += size) out.push(items.slice(i, i + size));
  return out;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function yieldNow(): Promise<void> {
  return new Promise(resolve => setImmediate(resolve));
}

/** `child` is `parent` itself or lies below it. */
function isInside(parent: string, child: string): boolean {
  const rel = path.relative(parent, child);
  if (rel === '') return true;
  if (path.isAbsolute(rel)) return false;
  return rel !== '..' && !rel.startsWith(`..${path.sep}`);
}

/** `realpath` of `target`, or of its deepest existing ancestor plus the missing tail. */
async function realpathOfDeepest(target: string): Promise<string> {
  const tail: string[] = [];
  let current = path.resolve(target);
  for (;;) {
    try {
      const real = await fsp.realpath(current);
      return tail.length > 0 ? path.join(real, ...tail) : real;
    } catch (error) {
      const code = errorCode(error);
      if (code !== 'ENOENT' && code !== 'ENOTDIR') throw error;
      const isLink = await fsp.lstat(current).then(
        () => true,
        () => false
      );
      if (isLink) throw new Error(`Refusing a link that leads nowhere: ${current}`);
      const parent = path.dirname(current);
      if (parent === current) throw error;
      tail.unshift(path.basename(current));
      current = parent;
    }
  }
}

async function exists(full: string): Promise<boolean> {
  return fsp.lstat(full).then(
    () => true,
    () => false
  );
}

// ---------------------------------------------------------------------------
// Responses
// ---------------------------------------------------------------------------

/** A usable `getExportIndex` page, or an Error to fail the cycle with. */
function parseResponse(raw: unknown, sigInputs: string): ExportIndexResponse {
  if (!isRecord(raw)) throw new Error('getExportIndex returned nothing usable');
  if (raw.success !== true) {
    const reason = typeof raw.error === 'string' && raw.error ? raw.error : 'refused';
    throw new Error(`getExportIndex failed: ${reason}`);
  }
  if (
    typeof raw.worldId !== 'string' ||
    typeof raw.clientId !== 'string' ||
    typeof raw.usersSignature !== 'string' ||
    typeof raw.watermark !== 'number' ||
    !Number.isFinite(raw.watermark) ||
    !Array.isArray(raw.entries) ||
    !(raw.next === null || typeof raw.next === 'string')
  ) {
    throw new Error('getExportIndex returned a malformed page');
  }
  const truncated = Array.isArray(raw.truncated) ? raw.truncated : [];
  // Notes store the signature with the renderer version and the other inputs, so a change of
  // either re-renders them.
  const entries = (raw.entries as unknown[]).map(entry =>
    isRecord(entry) && typeof entry.sig === 'string'
      ? { ...entry, sig: versionedSig(entry.sig, sigInputs) }
      : entry
  );
  return {
    ...(raw as unknown as ExportIndexResponse),
    entries: entries as ExportIndexResponse['entries'],
    truncated,
  };
}

/** A reconcile row we can trust; any other row fails the whole reconcile (a lost row would trash a note). */
function parseIdRow(value: unknown): ExportIdEntry {
  if (
    !isRecord(value) ||
    !isFoundryUuid(value.uuid) ||
    typeof value.kind !== 'string' ||
    !(EXPORT_KINDS as readonly string[]).includes(value.kind) ||
    typeof value.sig !== 'string'
  ) {
    throw new Error('getExportIndex returned a malformed reconcile row');
  }
  return value as unknown as ExportIdEntry;
}

/** Enough of an entry to route it; the renderer checks the rest. */
function isEntryLike(value: unknown): value is ExportEntry {
  return (
    isRecord(value) &&
    isFoundryUuid(value.uuid) &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.sig === 'string' &&
    typeof value.kind === 'string' &&
    (EXPORT_KINDS as readonly string[]).includes(value.kind) &&
    (value.kind !== 'journal' || Array.isArray(value.pages))
  );
}

// ---------------------------------------------------------------------------
// State
// ---------------------------------------------------------------------------

type Listed = { path: string; uuid: string };

/** Everything the pump remembers about one world (reset when the world changes). */
interface WorldState {
  worldId: string;
  /** Hash of the settings of the last cycle (null before the first). */
  settingsHash: string | null;
  /** The next reconcile treats every row as a mismatch (settings changed). */
  forceAll: boolean;
  /** A trigger asked for a reconcile (clientId, users, a stale note map, a request). */
  reconcileDue: boolean;
  /** The next reconcile may run inside the 60 s throttle (settings changed). */
  bypassThrottle: boolean;
  lastReconcileAttemptAt: number | null;
  /** Last reconcile that completed. */
  lastReconcileAt: number | null;
  watermark: number | null;
  clientId: string | null;
  usersSignature: string | null;
  /** The writer cache: fresh on every reconcile, shared by the incremental cycles after it. */
  cache: WrittenCache;
  /** Winning top-level notes by uuid (inside or outside the fence), from the last scan plus our writes. */
  notes: Map<string, ScannedNote>;
  /** Winning page notes by page uuid. */
  pages: Map<string, ScannedNote>;
  prep: Map<string, string>;
  stats: Map<string, string>;
  /** `pathKey` of every file under the fence (last scan plus our creations). */
  taken: Set<string>;
  /** The last scan had no errors and hit no limit: creates and trashes are allowed. */
  scanComplete: boolean;
  /** Uuids in the last completed reconcile's rows plus every entry fetched since (null before). */
  known: Set<string> | null;
  /** Kinds whose world cap was hit at the last reconcile. */
  truncatedKinds: Set<ExportKind>;
  /** Fetched but not mirrored (an actor of a type that is off), with the sig it had. */
  filteredOut: Map<string, string>;
  /** Current names (fetched entries and pages, else scanned notes). */
  names: Map<string, string>;
  /** Journal uuid to the page uuids that should have a page note (text pages of an opted-in journal). */
  expectedPages: Map<string, string[]>;
  /** The revealed page uuids of the last cycle (null before). */
  revealed: Set<string> | null;
  /** The "Seen in" index of the last cycle (R4; null until the first load). */
  seen: SeenIndex | null;
  /** Top-level uuids to fetch at the next cycle (a journal whose reveal state changed). */
  pendingRefetch: Set<string>;
  skipped: Map<string, string>;
  errors: Map<string, string>;
  movedByGm: Listed[];
  duplicates: Listed[];
  keptDeleted: Listed[];
  truncated: ExportIndexResponse['truncated'];
  /** The lasting status facts last rendered into `_status.md`. */
  statusFingerprint: string | null;
  /** Library, image copies and their git guard (created at the first cycle). */
  licensed: Licensed | null;
  /** The signature inputs of the last cycle's world notes (null before the first). */
  sigInputs: string | null;
  /** `pathKey` of the Foundry folders under the kind folders (from the scan and fetched entries). */
  folderDirs: Set<string>;
  /** Edited notes that stay in a folder they no longer belong in (listed in the status). */
  keptOld: Set<string>;
  /** `libraryRenderKey` of the last settings (null before the first). */
  libraryRenderKey: string | null;
}

function newWorldState(worldId: string): WorldState {
  return {
    worldId,
    settingsHash: null,
    forceAll: false,
    reconcileDue: false,
    bypassThrottle: false,
    lastReconcileAttemptAt: null,
    lastReconcileAt: null,
    watermark: null,
    clientId: null,
    usersSignature: null,
    cache: { written: new Map() },
    notes: new Map(),
    pages: new Map(),
    prep: new Map(),
    stats: new Map(),
    taken: new Set(),
    scanComplete: false,
    known: null,
    truncatedKinds: new Set(),
    filteredOut: new Map(),
    names: new Map(),
    expectedPages: new Map(),
    revealed: null,
    seen: null,
    pendingRefetch: new Set(),
    skipped: new Map(),
    errors: new Map(),
    movedByGm: [],
    duplicates: [],
    keptDeleted: [],
    truncated: [],
    statusFingerprint: null,
    licensed: null,
    sigInputs: null,
    libraryRenderKey: null,
    folderDirs: new Set(),
    keptOld: new Set(),
  };
}

/** One cycle's working set. */
interface Cycle {
  state: WorldState;
  settings: MirrorSettings;
  enabled: Set<MirrorNoteType>;
  writer: NoteWriter;
  root: string;
  revealed: ReadonlySet<string>;
  deadline: number;
  reconcile: boolean;
  /** Creates and trashes allowed (the scan behind the note map was complete). */
  allowChanges: boolean;
  /** Notes written that did not exist before. */
  created: number;
  /** Writes and trashes since the last yield. */
  sinceYield: number;
  /** Appended to every export signature this cycle (`versionedSig`). */
  sigInputs: string;
  /** A reconcile ran to its end this cycle (unused images may be collected). */
  reconciled: boolean;
  /** The Library refresh already had its turn this cycle. */
  libraryTried: boolean;
  /** Notes moved to their new folder this cycle (their links elsewhere need a re-render). */
  moved: number;
}

type WriteOutcome = 'written' | 'unchanged' | 'skipped' | 'error';

/** Where a rendered note belongs in the note map. */
interface NoteMeta {
  uuid: string;
  type: MirrorNoteType;
  sig: string | null;
  name: string;
  journalUuid: string | null;
  /** The note's `folder` property (Foundry folder names joined with `/`), or null. */
  folder: string | null;
  isNew: boolean;
  /** The note moves here from this path before it is written (its folder changed). */
  moveFrom?: string;
}

/** New and moved note paths of one batch of entries. */
interface Allocation {
  top: Map<string, string>;
  pages: Map<string, string>;
  /** Uuid (top level or page) to the path its note moves away from. */
  moves: Map<string, string>;
}

// ---------------------------------------------------------------------------
// The pump
// ---------------------------------------------------------------------------

export class ObsidianMirrorPump {
  private readonly foundry: ObsidianMirrorPumpOptions['foundryClient'];
  private readonly worldIds: ObsidianMirrorPumpOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly vaultDir: string;
  private readonly logger: ObsidianMirrorPumpOptions['logger'];
  private readonly pollMs: number;
  private readonly openBase: string;
  private readonly foundryUrl: string | null;
  private readonly git: GitRunner;
  private readonly fetcher: Fetcher | undefined;
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<void> | null = null;
  private state: WorldState | null = null;
  private current: MirrorStatus;
  /** What was last logged as a problem (logged once until it changes or recovers). */
  private loggedProblems = '';
  private loggedError: string | null = null;

  constructor(options: ObsidianMirrorPumpOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.vaultDir = path.resolve(options.vaultDir);
    this.logger = options.logger;
    this.pollMs = options.pollMs;
    this.openBase = options.openBase;
    this.foundryUrl = options.foundryUrl ?? null;
    this.git = options.git ?? runGit;
    this.fetcher = options.fetcher;
    this.now = options.now ?? ((): number => Date.now());
    this.current = this.freshStatus(null, false);
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.tick(), this.pollMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** The live status for `get-obsidian-mirror` (a copy). */
  status(): MirrorStatus {
    return structuredClone(this.current);
  }

  /** Ask for a reconcile at the next cycle (subject to the 60 s throttle). */
  requestReconcile(): void {
    if (this.state) this.state.reconcileDue = true;
  }

  /** Run one cycle; a call while one runs returns the running one. Never rejects. */
  tick(): Promise<void> {
    if (this.inFlight) return this.inFlight;
    const run = this.runCycle().finally(() => {
      this.inFlight = null;
    });
    this.inFlight = run;
    return run;
  }

  private freshStatus(worldId: string | null, enabled: boolean): MirrorStatus {
    return emptyMirrorStatus({ enabled, vaultDirSet: true, worldId, openBase: this.openBase });
  }

  private async runCycle(): Promise<void> {
    if (!this.foundry.isConnected()) return;
    let cycle: Cycle | null = null;
    try {
      const worldId = await this.worldIds.current();
      if (this.state?.worldId !== worldId) {
        this.state = newWorldState(worldId);
        this.current = this.freshStatus(worldId, false);
      }
      const state = this.state;
      const settings = await this.loadSettings(state);
      if (!settings) return;
      const reconcile = this.reconcileNow(state);
      if (!reconcile && state.watermark === null) return; // waiting out the reconcile throttle
      cycle = await this.openCycle(state, settings);
      if (await this.prepareLicensed(cycle)) await this.worldNotes(cycle);
      await this.workLicensed(cycle);
      await this.finish(cycle, null);
    } catch (error) {
      if (cycle) await this.finish(cycle, error);
      else this.recordFailure(error);
    }
  }

  /**
   * The signature inputs of world notes: the guard's answers, the Library packs and the Library
   * membership (all of them change what a world note says or links to).
   */
  private sigInputsFor(cycle: Cycle): string {
    const licensed = cycle.state.licensed;
    const guard = licensed?.guardResult ?? null;
    const membership = guard?.ok ? (licensed?.library.membershipHash ?? 'none') : 'off';
    return hash8(
      JSON.stringify([
        guard?.licensedOk === true,
        guard?.ok === true,
        cycle.settings.libraryPacks,
        membership,
      ])
    );
  }

  /** The world notes of this cycle: a reconcile when one is due, else an incremental pass. */
  private async worldNotes(cycle: Cycle): Promise<void> {
    const state = cycle.state;
    const inputs = this.sigInputsFor(cycle);
    if (state.sigInputs !== null && state.sigInputs !== inputs) {
      // What shapes the notes changed: the reconcile finds every note with the old inputs.
      state.reconcileDue = true;
      state.bypassThrottle = true;
    }
    state.sigInputs = inputs;
    cycle.sigInputs = inputs;
    const reconcile = this.reconcileNow(state);
    if (!reconcile && state.watermark === null) return; // waiting out the reconcile throttle
    try {
      if (reconcile) {
        // A fresh writer cache per reconcile (the writer holds this same object).
        state.cache.written.clear();
        cycle.reconcile = true;
        await this.reconcile(cycle);
      } else {
        await this.incremental(cycle);
      }
    } finally {
      if (cycle.moved > 0) {
        // Notes rendered before a note moved still link to its old path: render them all again.
        state.forceAll = true;
        state.reconcileDue = true;
      }
    }
  }

  /** The settings, or null when the mirror is off (unreadable settings count as off). */
  private async loadSettings(state: WorldState): Promise<MirrorSettings | null> {
    let loaded: { settings: MirrorSettings; hash: string };
    try {
      loaded = await readMirrorSettings(this.store, state.worldId);
    } catch (error) {
      this.current = this.freshStatus(state.worldId, false);
      this.recordFailure(
        new Error(`Mirror settings unreadable, mirror off: ${errorMessage(error)}`)
      );
      return null;
    }
    const changed = state.settingsHash !== null && state.settingsHash !== loaded.hash;
    state.settingsHash = loaded.hash;
    if (!loaded.settings.enabled) {
      // Off: forget everything but the settings hash, so switching it on again
      // is a settings change (a forced reconcile, not throttled).
      const hash = state.settingsHash;
      this.state = newWorldState(state.worldId);
      this.state.settingsHash = hash;
      this.current = this.freshStatus(state.worldId, false);
      this.recover();
      return null;
    }
    const libraryKey = libraryRenderKey(loaded.settings);
    if (changed) {
      state.forceAll = true;
      state.reconcileDue = true;
      state.bypassThrottle = true;
      // Library notes re-render only for settings they use (pack changes reach them through
      // the refresh and its membership).
      if (state.libraryRenderKey !== null && state.libraryRenderKey !== libraryKey) {
        state.licensed?.library.forceRender();
      }
      state.licensed?.guard.reset();
    }
    state.libraryRenderKey = libraryKey;
    return loaded.settings;
  }

  /** Whether this cycle reconciles (see the header for when). */
  private reconcileNow(state: WorldState): boolean {
    const now = this.now();
    const due =
      state.watermark === null ||
      state.lastReconcileAt === null ||
      state.reconcileDue ||
      now - state.lastReconcileAt >= RECONCILE_EVERY_MS;
    if (!due) return false;
    if (state.bypassThrottle || state.lastReconcileAttemptAt === null) return true;
    return now - state.lastReconcileAttemptAt >= RECONCILE_MIN_INTERVAL_MS;
  }

  private async openCycle(state: WorldState, settings: MirrorSettings): Promise<Cycle> {
    const root = campaignDir(this.vaultDir, state.worldId);
    const writer = new NoteWriter(root, this.vaultDir, state.worldId, state.cache);
    const cycle: Cycle = {
      state,
      settings,
      enabled: enabledTypes(settings),
      writer,
      root,
      revealed: new Set(),
      deadline: this.now() + MIRROR_CYCLE_LIMIT_MS,
      reconcile: false,
      allowChanges: state.scanComplete,
      created: 0,
      sinceYield: 0,
      sigInputs: '',
      reconciled: false,
      libraryTried: false,
      moved: 0,
    };
    // Fences before anything else: a link or junction must not lead a write
    // or a trash move out of the vault.
    try {
      await writer.assertRealFence(MIRROR_ROOT);
      await writer.assertRealFence(BASES_FOLDER);
      await writer.assertRealFence(ADVENTURES_FOLDER);
      await this.assertTrashFence(state.worldId, '');
    } catch (error) {
      throw new CycleAbort(errorMessage(error), true);
    }
    cycle.revealed = await this.loadRevealed(cycle);
    await this.loadSeen(state);
    return cycle;
  }

  /**
   * The vault trash folder that `relPath` would be moved into (the trash root
   * itself for an empty path) must really lie inside the vault: a junction
   * there would move the GM's note out of the vault.
   */
  private async assertTrashFence(worldId: string, relPath: string): Promise<void> {
    const realVault = await realpathOfDeepest(this.vaultDir);
    const segments = relPath ? path.posix.dirname(relPath).split('/') : [];
    const target = path.join(this.vaultDir, '.trash', 'Campaigns', worldId, ...segments);
    const realTarget = await realpathOfDeepest(target);
    if (!isInside(realVault, realTarget)) {
      throw new Error(
        `Refusing to trash: the vault .trash folder leads outside the vault (${realTarget}); is there a link or junction?`
      );
    }
  }

  /** `gm/reveals.json` page uuids (the only bridge-vault input besides the settings). */
  private async loadRevealed(cycle: Cycle): Promise<Set<string>> {
    const state = cycle.state;
    const stored = await this.store.read<{ pages?: unknown }>(state.worldId, 'gm', REVEALS_FILE);
    const pages = stored?.data?.pages;
    const revealed = new Set<string>();
    if (isRecord(pages)) {
      for (const value of Object.values(pages)) {
        const uuid = isRecord(value) ? value.uuid : null;
        if (isFoundryUuid(uuid) && PAGE_UUID.test(uuid)) revealed.add(uuid);
      }
    }
    // A page whose reveal state changed: its journal's notes need a render.
    const before = state.revealed;
    if (before && cycle.enabled.has('journal')) {
      const changed = [...revealed].filter(uuid => !before.has(uuid));
      changed.push(...[...before].filter(uuid => !revealed.has(uuid)));
      for (const uuid of changed) {
        const journal = PAGE_UUID.exec(uuid)?.[1];
        if (journal) state.pendingRefetch.add(journal);
      }
    }
    state.revealed = revealed;
    return revealed;
  }

  /**
   * The "Seen in" index the export writes next to the session notes (R4). A missing or bad
   * file is an empty index. An NPC or scene whose session list changed is rendered again (the
   * first load renders every one); one without a note yet is made by the normal flow.
   */
  private async loadSeen(state: WorldState): Promise<void> {
    let seen: SeenIndex = EMPTY_SEEN_INDEX;
    try {
      seen = parseSeenIndex(
        (await this.store.read<unknown>(state.worldId, 'gm', SEEN_INDEX_FILE))?.data
      );
    } catch (error) {
      this.logger.warn('Obsidian mirror: the Seen in index could not be read', {
        worldId: state.worldId,
        error: errorMessage(error),
      });
    }
    const before = state.seen;
    const lists = (index: SeenIndex, uuid: string): string =>
      JSON.stringify(index.actors[uuid] ?? index.scenes[uuid] ?? []);
    const uuids = new Set([
      ...Object.keys(seen.actors),
      ...Object.keys(seen.scenes),
      ...(before ? [...Object.keys(before.actors), ...Object.keys(before.scenes)] : []),
    ]);
    for (const uuid of uuids) {
      if (before === null) state.pendingRefetch.add(uuid);
      else if (lists(before, uuid) !== lists(seen, uuid) && state.notes.has(uuid)) {
        state.pendingRefetch.add(uuid);
      }
    }
    state.seen = seen;
  }

  private checkDeadline(cycle: Cycle): void {
    if (this.now() > cycle.deadline) {
      throw new Error(
        `Mirror cycle abandoned after ${MIRROR_CYCLE_LIMIT_MS / 1000} s; it resumes at the next tick`
      );
    }
  }

  /** After each note write or trash: yield every 50, and stop at the deadline. */
  private async pace(cycle: Cycle): Promise<void> {
    cycle.sinceYield += 1;
    if (cycle.sinceYield >= YIELD_EVERY) {
      cycle.sinceYield = 0;
      await yieldNow();
    }
    this.checkDeadline(cycle);
  }

  // -------------------------------------------------------------------------
  // Queries
  // -------------------------------------------------------------------------

  /** One page; a page of another world resets the state and ends the cycle. */
  private async queryPage(cycle: Cycle, request: ExportIndexRequest): Promise<ExportIndexResponse> {
    const left = cycle.deadline - this.now();
    const raw: unknown = await this.foundry.query(EXPORT_INDEX_METHOD, request, {
      timeoutMs: Math.max(1_000, Math.min(EXPORT_QUERY_TIMEOUT_MS, left)),
    });
    const response = parseResponse(raw, cycle.sigInputs);
    if (response.worldId !== cycle.state.worldId) {
      if (this.state === cycle.state) this.state = null;
      throw new CycleAbort(
        `Foundry answered for world "${response.worldId}" while the bridge expects "${cycle.state.worldId}"; mirror state reset`,
        true
      );
    }
    cycle.state.truncated = response.truncated;
    if (typeof response.origin === 'string') {
      cycle.state.licensed?.attachments.setOrigin(response.origin);
    }
    return response;
  }

  /** Every page of one request, one after another, in cursor order. */
  private async forEachPage(
    cycle: Cycle,
    request: ExportIndexRequest,
    onPage: (response: ExportIndexResponse, index: number) => Promise<void> | void
  ): Promise<void> {
    let after: string | null = null;
    for (let index = 0; ; index++) {
      if (index >= MAX_PAGES_PER_QUERY) throw new Error('getExportIndex paged without end');
      this.checkDeadline(cycle);
      const response = await this.queryPage(cycle, after ? { ...request, after } : request);
      await onPage(response, index);
      if (response.next === null) return;
      if (response.next === after) throw new Error('getExportIndex returned the same cursor twice');
      after = response.next;
    }
  }

  /** A reload of the module page or a change of users means: reconcile. */
  private noteClient(state: WorldState, response: ExportIndexResponse): void {
    if (state.clientId !== null && state.clientId !== response.clientId) state.reconcileDue = true;
    if (state.usersSignature !== null && state.usersSignature !== response.usersSignature) {
      state.reconcileDue = true;
    }
    state.clientId = response.clientId;
    state.usersSignature = response.usersSignature;
  }

  /** Fetch these top-level uuids (batches of 500) and render them. */
  private async fetchAndApply(cycle: Cycle, uuids: readonly string[]): Promise<void> {
    for (const batch of chunks(uuids, UUID_BATCH)) {
      await this.forEachPage(
        cycle,
        { ...baseRequest(cycle.settings), uuids: batch },
        async page => {
          this.noteClient(cycle.state, page);
          await this.applyEntries(cycle, page.entries);
        }
      );
    }
  }

  // -------------------------------------------------------------------------
  // Incremental cycle
  // -------------------------------------------------------------------------

  private async incremental(cycle: Cycle): Promise<void> {
    const state = cycle.state;
    const watermark = state.watermark ?? 0;
    // The FIRST page's watermark: anything modified after that call is newer.
    const first: { watermark: number | null } = { watermark: null };
    await this.forEachPage(
      cycle,
      { ...baseRequest(cycle.settings), sinceModifiedTime: watermark - WATERMARK_OVERLAP_MS },
      async (page, index) => {
        if (index === 0) first.watermark = page.watermark;
        this.noteClient(state, page);
        await this.applyEntries(cycle, page.entries);
      }
    );
    const refetch = [...state.pendingRefetch];
    if (refetch.length > 0) {
      await this.fetchAndApply(cycle, refetch);
      for (const uuid of refetch) state.pendingRefetch.delete(uuid);
    }
    if (first.watermark !== null) state.watermark = first.watermark;
  }

  // -------------------------------------------------------------------------
  // Reconcile
  // -------------------------------------------------------------------------

  private adoptScan(state: WorldState, scan: MirrorScan, complete: boolean): void {
    state.notes = new Map(scan.mirror);
    state.pages = new Map(scan.pages);
    // A prep note the GM added, moved or removed changes the note it links back from (I-121):
    // render that note again, even though its document did not change.
    for (const uuid of new Set([...state.prep.keys(), ...scan.prep.keys()])) {
      if (state.prep.get(uuid) !== scan.prep.get(uuid)) state.pendingRefetch.add(uuid);
    }
    state.prep = scan.prep;
    state.stats = scan.stats;
    state.taken = new Set(scan.takenPaths);
    state.scanComplete = complete;
    for (const note of [...scan.mirror.values(), ...scan.pages.values()]) {
      if (note.name !== null && !state.names.has(note.uuid)) state.names.set(note.uuid, note.name);
    }
    const listed = (note: ScannedNote): Listed => ({ path: note.path, uuid: note.uuid });
    state.movedByGm = scan.movedByGm.map(listed);
    state.duplicates = scan.duplicates.map(listed);
    // A fresh view of the lasting problems: edited notes inside the fence (those left in a
    // folder they no longer belong in say so), and what the scan could not read.
    state.skipped = new Map();
    const keptOld = new Set<string>();
    for (const note of [...scan.mirror.values(), ...scan.pages.values()]) {
      if (!note.insideFence || note.owned) continue;
      const kept = state.keptOld.has(note.path);
      if (kept) keptOld.add(note.path);
      state.skipped.set(note.path, kept ? KEPT_AT_OLD_PATH : 'edited in Obsidian');
    }
    state.keptOld = keptOld;
    // The Foundry folders the notes sit in (journal page folders must not take their names).
    for (const note of scan.mirror.values()) {
      if (!note.insideFence) continue;
      for (const key of foundryFolderKeys(folderOf(note.path))) state.folderDirs.add(key);
    }
    state.errors = new Map(scan.errors.map(e => [e.path || CAMPAIGN_PATH, e.error]));
    if (scan.limitsHit.length > 0) {
      state.errors.set(
        CAMPAIGN_PATH,
        `The vault scan stopped at the ${scan.limitsHit.join(' and ')} limit; no notes are created or trashed until it completes`
      );
    }
  }

  private needsFetch(state: WorldState, row: ExportIdEntry, forceAll: boolean): boolean {
    if (forceAll) return true;
    const note = state.notes.get(row.uuid);
    if (!note) return state.filteredOut.get(row.uuid) !== row.sig;
    if (note.sig !== row.sig) return true;
    // A page note the GM deleted comes back once its journal is fetched again.
    const expected = state.expectedPages.get(row.uuid);
    return expected?.some(uuid => !state.pages.has(uuid)) ?? false;
  }

  private async reconcile(cycle: Cycle): Promise<void> {
    const state = cycle.state;
    state.lastReconcileAttemptAt = this.now();
    state.bypassThrottle = false;
    const forceAll = state.forceAll;

    const scan = await scanCampaign(this.vaultDir, state.worldId);
    this.checkDeadline(cycle);
    const complete = scan.errors.length === 0 && scan.limitsHit.length === 0;
    this.adoptScan(state, scan, complete);
    cycle.allowChanges = complete;

    const rows = new Map<string, ExportIdEntry>();
    const first: { page: ExportIndexResponse | null } = { page: null };
    await this.forEachPage(
      cycle,
      { ...baseRequest(cycle.settings), idsOnly: true },
      (page, index) => {
        if (index === 0) first.page = page;
        this.noteClient(state, page);
        for (const value of page.entries) {
          const row = parseIdRow(value);
          rows.set(row.uuid, row);
        }
      }
    );
    const head = first.page;
    if (head === null) throw new Error('getExportIndex returned no reconcile page');
    state.truncatedKinds = new Set(head.truncated.map(t => t.kind));

    const toFetch = new Set<string>();
    for (const row of rows.values()) {
      if (this.needsFetch(state, row, forceAll)) toFetch.add(row.uuid);
    }
    // Pending uuids stay pending until the fetch below succeeds: a reconcile that aborts must not
    // lose a refetch nothing else would trigger again (a changed Seen in list). Gone ones drop.
    const refetched: string[] = [];
    for (const uuid of state.pendingRefetch) {
      if (rows.has(uuid)) {
        toFetch.add(uuid);
        refetched.push(uuid);
      } else {
        state.pendingRefetch.delete(uuid);
      }
    }

    if (complete) {
      await this.reconcileDeletes(cycle, rows, toFetch);
    } else {
      this.logger.warn(
        'Obsidian mirror: the vault scan was incomplete, no notes created or trashed',
        {
          worldId: state.worldId,
          limitsHit: scan.limitsHit,
          errors: scan.errors.length,
        }
      );
    }

    state.known = new Set(rows.keys());
    await this.fetchAndApply(cycle, [...toFetch]);
    for (const uuid of refetched) state.pendingRefetch.delete(uuid);
    await this.writeBases(cycle);
    await this.writeHubs(cycle);

    state.watermark = head.watermark;
    state.lastReconcileAt = this.now();
    state.forceAll = false;
    // An incomplete scan is retried at the next allowed reconcile.
    state.reconcileDue = !complete;
    this.current.lastReconcileAt = new Date(state.lastReconcileAt).toISOString();
    cycle.reconciled = complete;
  }

  // -------------------------------------------------------------------------
  // Deletes
  // -------------------------------------------------------------------------

  /**
   * Set arithmetic over a complete scan (design 2.3): a note inside the fence
   * whose uuid has no row is trashed (deleted in Foundry, or excluded); an
   * edited one stays and is listed as kept. A note whose type is off is
   * trashed too, unless its entry is fetched this cycle (the fetch decides,
   * because a PC that lost its player is an NPC now). Page notes follow their
   * journal.
   */
  private async reconcileDeletes(
    cycle: Cycle,
    rows: ReadonlyMap<string, ExportIdEntry>,
    toFetch: ReadonlySet<string>
  ): Promise<void> {
    const state = cycle.state;
    const actorsRequested = cycle.enabled.has('pc') || cycle.enabled.has('npc');
    const kindRequested = (type: MirrorNoteType): boolean =>
      KIND_OF_TYPE[type] === 'actor' ? actorsRequested : cycle.enabled.has(type);
    const kept: Listed[] = [];

    for (const note of [...state.notes.values()]) {
      if (!note.insideFence || !isMirrorNoteType(note.type)) continue;
      const type = note.type;
      let deleted = false;
      let off = false;
      if (!rows.has(note.uuid)) {
        if (!kindRequested(type)) off = true;
        else if (!state.truncatedKinds.has(KIND_OF_TYPE[type])) deleted = true;
      } else if (!cycle.enabled.has(type) && !toFetch.has(note.uuid)) {
        off = true;
      }
      if (!deleted && !off) continue;
      const result = await this.trashNote(cycle, note);
      if (result === 'kept' && deleted && state.skipped.has(note.path)) {
        kept.push({ path: note.path, uuid: note.uuid });
      }
      if (type === 'journal') {
        for (const page of [...state.pages.values()]) {
          if (journalOfPage(page) !== note.uuid || !page.insideFence) continue;
          const pageResult = await this.trashNote(cycle, page);
          if (pageResult === 'kept' && deleted && state.skipped.has(page.path)) {
            kept.push({ path: page.path, uuid: page.uuid });
          }
        }
      }
    }

    // Page notes whose journal is gone (its index note may be gone already).
    for (const page of [...state.pages.values()]) {
      if (!page.insideFence) continue;
      const journal = journalOfPage(page);
      if (journal !== null && rows.has(journal) && cycle.enabled.has('journal-page')) continue;
      const off = !cycle.enabled.has('journal-page');
      if (!off && state.truncatedKinds.has('journal')) continue;
      const result = await this.trashNote(cycle, page);
      if (result === 'kept' && !off && state.skipped.has(page.path)) {
        kept.push({ path: page.path, uuid: page.uuid });
      }
    }

    state.keptDeleted = kept;
    for (const item of kept) state.skipped.delete(item.path);
  }

  /** Trash one note inside the fence (the writer re-checks ownership on the file). */
  private async trashNote(
    cycle: Cycle,
    note: ScannedNote
  ): Promise<'trashed' | 'kept' | 'missing'> {
    const state = cycle.state;
    if (!cycle.allowChanges || !note.insideFence) return 'kept';
    try {
      await this.assertTrashFence(state.worldId, note.path);
    } catch (error) {
      throw new CycleAbort(errorMessage(error), false);
    }
    const skippedBefore = cycle.writer.skipped.length;
    const errorsBefore = cycle.writer.errors.length;
    const result = await cycle.writer.trash(note.path, checkMarkdownOwnership);
    if (result === 'trashed' || result === 'missing') {
      const map = note.type === 'journal-page' ? state.pages : state.notes;
      if (map.get(note.uuid)?.path === note.path) map.delete(note.uuid);
      if (note.type !== 'journal-page') state.licensed?.attachments.dropOwner(note.uuid);
      state.taken.delete(pathKey(note.path));
      state.skipped.delete(note.path);
      state.errors.delete(note.path);
    } else {
      for (const s of cycle.writer.skipped.slice(skippedBefore))
        state.skipped.set(s.path, s.reason);
      for (const e of cycle.writer.errors.slice(errorsBefore)) state.errors.set(e.path, e.error);
    }
    await this.pace(cycle);
    return result;
  }

  /** Page notes of a freshly fetched journal whose page is gone, or whose text is off. */
  private async trashOrphanPages(cycle: Cycle, entry: ExportJournalEntry): Promise<void> {
    const state = cycle.state;
    const listed = new Map(entry.pages.map(page => [page.uuid, page]));
    const cut = entry.pagesTotal > entry.pages.length;
    for (const note of [...state.pages.values()]) {
      if (!note.insideFence || journalOfPage(note) !== entry.uuid) continue;
      const page = listed.get(note.uuid);
      const orphan = !entry.textIncluded
        ? true
        : page === undefined
          ? !cut
          : page.text === undefined; // no longer a text page
      if (orphan) await this.trashNote(cycle, note);
    }
  }

  // -------------------------------------------------------------------------
  // Rendering and writing
  // -------------------------------------------------------------------------

  private rememberNames(state: WorldState, entry: ExportEntry): void {
    state.names.set(entry.uuid, entry.name);
    if (entry.kind === 'journal') {
      for (const page of entry.pages) state.names.set(page.uuid, page.name);
    }
  }

  /** Render and write fetched entries (both cycle kinds). */
  private async applyEntries(cycle: Cycle, raw: readonly unknown[]): Promise<void> {
    const state = cycle.state;
    const accepted: ExportEntry[] = [];
    for (const value of raw) {
      if (!isEntryLike(value)) {
        state.errors.set(CAMPAIGN_PATH, 'getExportIndex sent an entry that is not usable; skipped');
        continue;
      }
      state.known?.add(value.uuid);
      this.rememberNames(state, value);
      if (!cycle.enabled.has(mirrorNoteType(value))) {
        // Fetched but not mirrored: remembered so a reconcile does not fetch it
        // again while its sig stays the same; an existing note of it goes.
        state.filteredOut.set(value.uuid, value.sig);
        const note = state.notes.get(value.uuid);
        if (note?.insideFence) await this.trashNote(cycle, note);
        continue;
      }
      state.filteredOut.delete(value.uuid);
      accepted.push(value);
    }
    if (accepted.length === 0) return;

    const allocation = this.allocate(cycle, accepted);
    const ctx = this.renderContext(cycle, allocation.top, allocation.pages);
    for (const entry of accepted) {
      this.checkDeadline(cycle);
      await this.renderAndWrite(cycle, entry, ctx, allocation);
      if (entry.kind === 'journal') {
        state.expectedPages.set(
          entry.uuid,
          entry.textIncluded ? entry.pages.filter(p => p.text).map(p => p.uuid) : []
        );
        if (cycle.allowChanges) await this.trashOrphanPages(cycle, entry);
      }
    }
  }

  /**
   * Note paths for entries (and text pages) without a note, and new paths for unedited notes
   * whose folder changed (they move when written); none while creates are blocked. A journal
   * with page text never takes the name of a Foundry folder beside it (its page folder would
   * mix with that folder): it gets a suffixed name, and an existing one moves to it.
   */
  private allocate(cycle: Cycle, entries: readonly ExportEntry[]): Allocation {
    const state = cycle.state;
    const moves = new Map<string, string>();
    if (!cycle.allowChanges) return { top: new Map(), pages: new Map(), moves };
    const folders = new Map<string, string>();
    const learned = new Set<string>();
    for (const entry of entries) {
      const note = state.notes.get(entry.uuid);
      const current = note?.insideFence ? note.path : undefined;
      const folder = noteFolder(mirrorNoteType(entry) as TopType, entry, current);
      folders.set(entry.uuid, folder);
      for (const key of foundryFolderKeys(folder)) {
        if (!state.folderDirs.has(key)) learned.add(key);
        state.folderDirs.add(key);
      }
    }
    if (learned.size > 0) {
      // A journal fetched earlier whose page folder is now also a Foundry folder: fetch it again
      // so it moves to a suffixed name.
      const batch = new Set(entries.map(entry => entry.uuid));
      for (const note of state.notes.values()) {
        if (note.type !== 'journal' || !note.insideFence || batch.has(note.uuid)) continue;
        if (learned.has(pathKey(pageNoteFolder(note.path)))) state.pendingRefetch.add(note.uuid);
      }
    }

    const requests: PathRequest[] = [];
    for (const entry of entries) {
      const folder = folders.get(entry.uuid) ?? '';
      const ownsFolder = entry.kind === 'journal' && entry.textIncluded;
      const note = state.notes.get(entry.uuid);
      if (note) {
        if (!note.insideFence) continue; // the GM moved it out: never written again
        const misplaced =
          !inFolder(note.path, folder) ||
          (ownsFolder && state.folderDirs.has(pathKey(pageNoteFolder(note.path))));
        if (!misplaced) {
          state.keptOld.delete(note.path);
          continue;
        }
        if (!note.owned) {
          this.keepAtOldPath(state, note.path);
          continue;
        }
        moves.set(entry.uuid, note.path);
      }
      requests.push({
        uuid: entry.uuid,
        id: entry.id,
        folder,
        name: entry.name,
        created: entry.created,
        ...(ownsFolder ? { ownsFolder: true } : {}),
      });
    }
    const taken = new Set(state.taken);
    const top = allocateNotePaths(requests, new Map(), taken, state.folderDirs);
    for (const allocated of top.values()) taken.add(pathKey(allocated));

    const pageRequests: PathRequest[] = [];
    for (const entry of entries) {
      if (entry.kind !== 'journal' || !entry.textIncluded) continue;
      const journalPath = top.get(entry.uuid) ?? state.notes.get(entry.uuid)?.path;
      if (journalPath === undefined) continue;
      const folder = pageNoteFolder(journalPath);
      if (!insideFence(folder)) continue; // the GM moved the index note: no new page notes
      for (const page of entry.pages) {
        if (!page.text) continue;
        const existing = state.pages.get(page.uuid);
        if (existing) {
          if (!existing.insideFence || inFolder(existing.path, folder)) continue;
          if (!existing.owned) {
            this.keepAtOldPath(state, existing.path);
            continue;
          }
          moves.set(page.uuid, existing.path);
        }
        pageRequests.push({ uuid: page.uuid, id: page.id, folder, name: page.name, created: null });
      }
    }
    const pages = allocateNotePaths(pageRequests, new Map(), taken);
    return { top, pages, moves };
  }

  /** An edited note in a folder it no longer belongs in: it stays, and the status says why. */
  private keepAtOldPath(state: WorldState, notePath: string): void {
    state.keptOld.add(notePath);
    state.skipped.set(notePath, KEPT_AT_OLD_PATH);
  }

  private renderContext(
    cycle: Cycle,
    top: ReadonlyMap<string, string>,
    pages: ReadonlyMap<string, string>
  ): MirrorRenderContext {
    const state = cycle.state;
    const kinds = requestKinds(cycle.settings);
    // A new or moved note's allocated path first (a moved note links at its new place).
    const notePath = (uuid: string): string | null =>
      top.get(uuid) ?? state.notes.get(uuid)?.path ?? null;
    const pageNotePath = (uuid: string): string | null =>
      pages.get(uuid) ?? state.pages.get(uuid)?.path ?? null;
    /** Not in the world for sure: only scenes and journals, only with complete rows (section 5). */
    const certainlyMissing = (topUuid: string): boolean => {
      const documentName = topUuid.split('.')[0];
      const kind: ExportKind | null =
        documentName === 'Scene' ? 'scene' : documentName === 'JournalEntry' ? 'journal' : null;
      return (
        kind !== null &&
        state.known !== null &&
        state.lastReconcileAt !== null &&
        kinds.includes(kind) &&
        cycle.settings.excludeFolderIds.length === 0 &&
        !state.truncatedKinds.has(kind) &&
        !state.known.has(topUuid)
      );
    };
    const resolve = (uuid: string): LinkTarget | null => {
      if (!isFoundryUuid(uuid) || uuid.startsWith('Compendium.')) {
        return { notePath: null, name: null };
      }
      const page = PAGE_UUID.exec(uuid);
      if (page) {
        const [, journalUuid = '', pageId = ''] = page;
        const name = state.names.get(uuid) ?? null;
        const pagePath = pageNotePath(uuid);
        if (pagePath !== null) return { notePath: pagePath, name };
        const journalPath = notePath(journalUuid);
        if (journalPath !== null) return { notePath: journalPath, name, blockId: `p-${pageId}` };
        return certainlyMissing(journalUuid) ? null : { notePath: null, name };
      }
      const parts = uuid.split('.');
      const topUuid = parts.slice(0, 2).join('.');
      const name = parts.length === 2 ? (state.names.get(topUuid) ?? null) : null;
      const found = notePath(topUuid);
      if (found !== null) return { notePath: found, name };
      return certainlyMissing(topUuid) ? null : { notePath: null, name };
    };
    let byName: Map<string, string[]> | null = null;
    const findByName = (documentName: string, name: string): string | null => {
      if (byName === null) {
        byName = new Map();
        for (const [uuid, known] of state.names) {
          const parts = uuid.split('.');
          if (parts.length !== 2) continue;
          const key = `${parts[0]}\u0000${known}`;
          byName.set(key, [...(byName.get(key) ?? []), uuid]);
        }
      }
      const matches = byName.get(`${documentName}\u0000${name}`) ?? [];
      return matches.length === 1 ? (matches[0] ?? null) : null;
    };
    const licensed = state.licensed;
    // Licensed text and images go into world notes only when git ignores the mirror folder.
    const licensedOk = licensed?.guardResult?.licensedOk === true;
    return {
      openBase: this.openBase,
      notePath,
      pageNotePath,
      resolve,
      findByName,
      revealedPageUuids: cycle.revealed,
      statsNotePath: uuid => state.stats.get(uuid) ?? null,
      prepNotePath: uuid => state.prep.get(uuid) ?? null,
      seenSessions: uuid => state.seen?.actors[uuid] ?? state.seen?.scenes[uuid] ?? [],
      ...(licensed ? { library: licensed.library.links() } : {}),
      ...(licensed && licensedOk
        ? {
            image: (src: string, alt: string, width?: number) =>
              licensed.attachments.embed(src, alt, width),
          }
        : {}),
      withholdLicensed: !licensedOk,
    };
  }

  // -------------------------------------------------------------------------
  // Licensed content: the Library and image copies (design 13)
  // -------------------------------------------------------------------------

  private licensedFor(state: WorldState, root: string): Licensed {
    if (state.licensed) return state.licensed;
    const licensed: Licensed = {
      guard: new LicensedGuard(root, this.git, this.now),
      attachments: new AttachmentStore(
        root,
        state.worldId,
        this.foundryUrl,
        this.fetcher,
        this.now
      ),
      library: new LibrarySync(state.worldId),
      guardResult: null,
      libraryError: null,
    };
    state.licensed = licensed;
    return licensed;
  }

  private libraryDeps(cycle: Cycle): LibrarySyncDeps {
    const state = cycle.state;
    const licensed = this.licensedFor(state, cycle.root);
    const guard = licensed.guardResult;
    // One render context per call (per refresh step or work slice), not per note.
    let world: MirrorRenderContext | null = null;
    return {
      foundry: this.foundry,
      vaultDir: this.vaultDir,
      campaignRoot: cycle.root,
      worldId: state.worldId,
      openBase: this.openBase,
      now: this.now,
      linkContext: (fromPath: string, uuid: string, selfName: string): LinkContext => {
        world ??= this.renderContext(cycle, new Map(), new Map());
        const ctx = world;
        const findByName = ctx.findByName;
        return {
          pageUuid: uuid,
          openBase: this.openBase,
          resolve: target => ctx.resolve(target),
          ...(findByName
            ? { findByName: (kind: string, name: string) => findByName(kind, name) }
            : {}),
          fromPath,
          image: (src: string, alt: string) => licensed.attachments.embed(src, alt),
          selfName,
        };
      },
      image: (src: string, alt: string, width?: number) =>
        licensed.attachments.embed(src, alt, width),
      assertTrash: relPath => this.assertTrashFence(state.worldId, relPath),
      trashBlocked: guard?.trashOk ? null : (guard?.trashReason ?? 'the git guard has not run'),
      onOrigin: origin => licensed.attachments.setOrigin(origin),
      owner: {
        begin: uuid => licensed.attachments.beginOwner(uuid),
        end: committed => licensed.attachments.endOwner(committed),
        drop: uuid => licensed.attachments.dropOwner(uuid),
      },
    };
  }

  /**
   * Before the world notes: the git guard (the Library and image copies write only when git
   * ignores them; world notes carry licensed text only when it ignores the whole mirror folder)
   * and the image manifest. Until the first Library refresh after a start has finished, it runs
   * here, within a slice, and the world notes wait for it (returns false): written without the
   * Library links, they would all be written again a cycle later.
   */
  private async prepareLicensed(cycle: Cycle): Promise<boolean> {
    const state = cycle.state;
    const licensed = this.licensedFor(state, cycle.root);
    let guard: GuardResult;
    try {
      guard = await licensed.guard.check();
    } catch (error) {
      const reason = errorMessage(error);
      guard = {
        ok: false,
        reason,
        repo: null,
        licensedOk: false,
        licensedReason: reason,
        trashOk: false,
        trashReason: reason,
      };
    }
    if (guard.ok) {
      try {
        await cycle.writer.assertRealFence(ATTACHMENTS_ROOT);
        await cycle.writer.assertRealFence(LIBRARY_ROOT);
      } catch (error) {
        guard = { ...guard, ok: false, reason: errorMessage(error) };
      }
    }
    licensed.guardResult = guard;
    licensed.attachments.setAllowed(guard.ok, guard.reason);
    if (!guard.ok) return true;
    await licensed.attachments.load();
    const packs = cycle.settings.libraryPacks;
    if (licensed.library.ready || !licensed.library.refreshDue(packs, this.now())) return true;
    const end = Math.min(cycle.deadline - 30_000, this.now() + FIRST_REFRESH_SLICE_MS);
    return this.refreshLibrary(cycle, end);
  }

  /** One Library refresh step until `end`. Returns false only while it is still part way. */
  private async refreshLibrary(cycle: Cycle, end: number): Promise<boolean> {
    const licensed = this.licensedFor(cycle.state, cycle.root);
    cycle.libraryTried = true;
    try {
      const step = await licensed.library.refreshStep(
        cycle.settings.libraryPacks,
        this.libraryDeps(cycle),
        end
      );
      if (step.done) licensed.libraryError = null;
      return step.done;
    } catch (error) {
      licensed.libraryError = `Library refresh failed: ${errorMessage(error)}`;
      licensed.library.requestRefresh();
      return true;
    }
  }

  /**
   * After the world notes, each within a slice and able to go on next cycle: the Library
   * refresh when one is due, Library fetches and writes, image copies, and after a complete
   * reconcile the images no note uses any more go to the vault trash.
   */
  private async workLicensed(cycle: Cycle): Promise<void> {
    const licensed = cycle.state.licensed;
    const guard = licensed?.guardResult;
    if (!licensed || !guard?.ok) return;
    const end = Math.min(cycle.deadline - 2_000, this.now() + LICENSED_SLICE_MS);
    const packs = cycle.settings.libraryPacks;
    if (!cycle.libraryTried && licensed.library.refreshDue(packs, this.now()) && this.now() < end) {
      await this.refreshLibrary(cycle, end);
    }
    if (licensed.library.ready && licensed.library.pending > 0 && this.now() < end) {
      try {
        await licensed.library.work(end, this.libraryDeps(cycle));
      } catch (error) {
        licensed.libraryError = `Library write refused: ${errorMessage(error)}`;
      }
    }
    const imagesEnd = Math.min(cycle.deadline - 1_000, this.now() + IMAGE_SLICE_MS);
    if (this.now() < imagesEnd) await licensed.attachments.flush(imagesEnd);
    if (cycle.reconciled && cycle.allowChanges && guard.trashOk) {
      await licensed.attachments.collectGarbage(cycle.deadline - 1_000, rel =>
        this.trashAttachment(cycle, rel)
      );
    }
  }

  /** One unused image to the vault trash (fenced; any file there is ours to move). */
  private async trashAttachment(
    cycle: Cycle,
    relPath: string
  ): Promise<'trashed' | 'kept' | 'missing'> {
    const state = cycle.state;
    if (!relPath.startsWith(`${ATTACHMENTS_ROOT}/`)) return 'kept';
    try {
      await this.assertTrashFence(state.worldId, relPath);
    } catch (error) {
      state.errors.set(relPath, errorMessage(error));
      return 'kept';
    }
    const errorsBefore = cycle.writer.errors.length;
    const result = await cycle.writer.trash(relPath, () => ({ owned: true, legacy: false }));
    for (const e of cycle.writer.errors.slice(errorsBefore)) state.errors.set(e.path, e.error);
    if (result !== 'kept') state.errors.delete(relPath);
    return result;
  }

  /** Render one entry (a journal renders its page notes too) and write what is ours to write. */
  private async renderAndWrite(
    cycle: Cycle,
    entry: ExportEntry,
    ctx: MirrorRenderContext,
    allocation: Allocation
  ): Promise<void> {
    // The images this entry's notes embed are counted for it (unused ones are collected later).
    const attachments = cycle.state.licensed?.attachments;
    attachments?.beginOwner(entry.uuid);
    let committed = false;
    try {
      committed = await this.renderAndWriteOwned(cycle, entry, ctx, allocation);
    } finally {
      attachments?.endOwner(committed);
    }
  }

  /** `renderAndWrite` inside the owner scope; true when every note was written or unchanged. */
  private async renderAndWriteOwned(
    cycle: Cycle,
    entry: ExportEntry,
    ctx: MirrorRenderContext,
    allocation: Allocation
  ): Promise<boolean> {
    const { top, pages, moves } = allocation;
    const state = cycle.state;
    let notes: RenderedNote[];
    let complete = true;
    try {
      notes = renderMirrorNote(state.worldId, entry, ctx);
    } catch (error) {
      if (entry.kind !== 'journal') {
        state.errors.set(ctx.notePath(entry.uuid) ?? entry.uuid, errorMessage(error));
        return false;
      }
      notes = this.renderJournalIsolated(cycle, entry, ctx);
      complete = false;
    }
    if (notes.length === 0) return false;
    const type = mirrorNoteType(entry);
    const pageByPath = new Map<string, { uuid: string; name: string }>();
    if (entry.kind === 'journal') {
      for (const page of entry.pages) {
        const pagePath = ctx.pageNotePath(page.uuid);
        if (pagePath !== null) pageByPath.set(pagePath, { uuid: page.uuid, name: page.name });
      }
    }
    for (const note of notes) {
      const page = pageByPath.get(note.path);
      const uuid = page ? page.uuid : entry.uuid;
      const moveFrom = moves.get(uuid);
      const base: NoteMeta = page
        ? {
            uuid: page.uuid,
            type: 'journal-page',
            sig: null,
            name: page.name,
            journalUuid: entry.uuid,
            folder: folderText(entry),
            isNew: pages.has(page.uuid) && moveFrom === undefined,
          }
        : {
            uuid: entry.uuid,
            type,
            sig: entry.sig,
            name: entry.name,
            journalUuid: null,
            folder: folderText(entry),
            isNew: top.has(entry.uuid) && moveFrom === undefined,
          };
      const meta: NoteMeta = moveFrom === undefined ? base : { ...base, moveFrom };
      const outcome = await this.writeRendered(cycle, note, meta);
      if (outcome !== 'written' && outcome !== 'unchanged') complete = false;
    }
    return complete;
  }

  /**
   * A journal whose render threw (the converter, on some page): find the
   * failing pages by rendering one text page at a time, record them, and
   * render the journal without them, so one bad page does not stop the index
   * note or the other pages.
   */
  private renderJournalIsolated(
    cycle: Cycle,
    entry: ExportJournalEntry,
    ctx: MirrorRenderContext
  ): RenderedNote[] {
    const state = cycle.state;
    const failing = new Set<string>();
    const textPages = entry.textIncluded
      ? entry.pages.filter(page => page.text && ctx.pageNotePath(page.uuid) !== null)
      : [];
    for (const page of textPages) {
      const only: MirrorRenderContext = {
        ...ctx,
        pageNotePath: uuid => (uuid === page.uuid ? ctx.pageNotePath(uuid) : null),
      };
      try {
        renderMirrorNote(state.worldId, entry, only);
      } catch (error) {
        failing.add(page.uuid);
        state.errors.set(ctx.pageNotePath(page.uuid) ?? page.uuid, errorMessage(error));
      }
    }
    const reduced: MirrorRenderContext = {
      ...ctx,
      pageNotePath: uuid => (failing.has(uuid) ? null : ctx.pageNotePath(uuid)),
    };
    try {
      return renderMirrorNote(state.worldId, entry, reduced);
    } catch (error) {
      state.errors.set(ctx.notePath(entry.uuid) ?? entry.uuid, errorMessage(error));
      return [];
    }
  }

  /** Write one rendered note, keeping the note map in step. */
  private async writeRendered(
    cycle: Cycle,
    note: RenderedNote,
    meta: NoteMeta
  ): Promise<WriteOutcome | 'not written'> {
    const state = cycle.state;
    // Only inside the fence; a note the GM moved elsewhere is never written again.
    if (!insideFence(note.path)) return 'not written';
    if (meta.moveFrom !== undefined) {
      const moved = await this.moveNote(cycle, meta, note.path);
      if (moved !== 'moved') return moved === 'missing' ? 'not written' : 'skipped';
    }
    const present = await exists(path.join(cycle.root, note.path));
    if (meta.isNew === present) {
      // A new path that is taken now, or a known note that is gone (deleted or
      // moved since the scan): leave it to a reconcile with a fresh scan.
      state.reconcileDue = true;
      return 'not written';
    }
    const outcome = await this.writeOwned(cycle, note.path, note.text, checkMarkdownOwnership, {
      same: sameMirrorContent,
    });
    const map = meta.type === 'journal-page' ? state.pages : state.notes;
    const previous = map.get(meta.uuid);
    if (outcome === 'written' || outcome === 'unchanged') {
      map.set(meta.uuid, {
        path: note.path,
        uuid: meta.uuid,
        type: meta.type,
        sig: meta.sig,
        insideFence: true,
        owned: true,
        name: meta.name,
        journalUuid: meta.journalUuid,
        folder: meta.folder,
      });
      if (meta.isNew) {
        cycle.created += 1;
        state.taken.add(pathKey(note.path));
      }
    } else if (outcome === 'skipped' && previous) {
      map.set(meta.uuid, { ...previous, owned: false });
    }
    await this.pace(cycle);
    return outcome;
  }

  /**
   * Move one note to its new folder before it is written (the writer re-checks ownership on the
   * file and renames it, so there is never a second copy). The note map follows the move; an
   * edited note stays where it is, and a note that is gone is left to a reconcile.
   */
  private async moveNote(
    cycle: Cycle,
    meta: NoteMeta,
    to: string
  ): Promise<'moved' | 'kept' | 'missing'> {
    const { writer, state } = cycle;
    const from = meta.moveFrom ?? to;
    const counts = [writer.skipped.length, writer.errors.length];
    const result = await writer.move(from, to, checkMarkdownOwnership);
    const map = meta.type === 'journal-page' ? state.pages : state.notes;
    const previous = map.get(meta.uuid);
    if (result === 'moved') {
      if (previous) map.set(meta.uuid, { ...previous, path: to });
      state.taken.delete(pathKey(from));
      state.taken.add(pathKey(to));
      state.skipped.delete(from);
      state.errors.delete(from);
      state.keptOld.delete(from);
      cycle.moved += 1;
    } else if (result === 'missing') {
      state.reconcileDue = true;
    } else {
      for (const s of writer.skipped.slice(counts[0])) {
        state.skipped.set(s.path, s.reason);
        state.keptOld.add(s.path);
      }
      for (const e of writer.errors.slice(counts[1])) state.errors.set(e.path, e.error);
      if (previous && writer.skipped.length > (counts[0] ?? 0)) {
        map.set(meta.uuid, { ...previous, owned: false });
      }
    }
    return result;
  }

  /** `NoteWriter.owned` plus what happened, mirrored into the lasting status maps. */
  private async writeOwned(
    cycle: Cycle,
    relPath: string,
    text: string,
    check: (existingText: string) => OwnershipResult,
    options: OwnedOptions = {}
  ): Promise<WriteOutcome> {
    const { writer, state } = cycle;
    const counts = [writer.written.length, writer.skipped.length, writer.errors.length];
    await writer.owned(relPath, text, check, options);
    const skipped = writer.skipped.slice(counts[1]);
    const errors = writer.errors.slice(counts[2]);
    for (const s of skipped) {
      state.skipped.set(s.path, state.keptOld.has(s.path) ? KEPT_AT_OLD_PATH : s.reason);
    }
    for (const e of errors) state.errors.set(e.path, e.error);
    if (errors.length > 0) return 'error';
    if (skipped.length > 0) return 'skipped';
    state.skipped.delete(relPath);
    state.errors.delete(relPath);
    return writer.written.length > (counts[0] ?? 0) ? 'written' : 'unchanged';
  }

  /** The mirror's bases, compared by content (a deleted base comes back at the next reconcile). */
  private async writeBases(cycle: Cycle): Promise<void> {
    for (const base of renderMirrorBases(cycle.state.worldId)) {
      this.checkDeadline(cycle);
      await this.writeOwned(cycle, base.path, base.text, baseOwnershipCheck(base.text));
    }
  }

  /**
   * Adventure hub notes (I-105) from the note map, after a reconcile: one per adventure folder,
   * linking its notes and the book's Library hub. A hub whose adventure is gone goes to the
   * vault trash (only an unedited one). Only after a complete scan: the note map of an
   * incomplete one may miss notes, and the hubs would lose their links.
   */
  private async writeHubs(cycle: Cycle): Promise<void> {
    const state = cycle.state;
    if (!cycle.allowChanges) return;
    const library = state.licensed?.library;
    const books = library?.ready ? library.bookNotes() : new Map<string, string>();
    const wanted = new Set<string>();
    for (const hub of collectAdventureHubs(
      [...state.notes.values()].map(note => ({
        ...note,
        name: state.names.get(note.uuid) ?? note.name,
      }))
    )) {
      this.checkDeadline(cycle);
      wanted.add(pathKey(hub.path));
      const note = renderAdventureHub(state.worldId, hub, matchBookNote(hub.name, books));
      await this.writeOwned(cycle, note.path, note.text, checkMarkdownOwnership);
    }
    const folder = path.join(cycle.root, ...ADVENTURES_FOLDER.split('/'));
    const files = await fsp.readdir(folder, { withFileTypes: true }).catch(() => []);
    for (const file of files) {
      if (!file.isFile() || !file.name.toLowerCase().endsWith('.md')) continue;
      const rel = `${ADVENTURES_FOLDER}/${file.name}`;
      if (wanted.has(pathKey(rel))) continue;
      const text = await fsp.readFile(path.join(folder, file.name), 'utf8').catch(() => '');
      if (!isAdventureHubText(text)) continue;
      try {
        await this.assertTrashFence(state.worldId, rel);
      } catch (error) {
        throw new CycleAbort(errorMessage(error), false);
      }
      const skippedBefore = cycle.writer.skipped.length;
      const errorsBefore = cycle.writer.errors.length;
      const result = await cycle.writer.trash(rel, checkMarkdownOwnership);
      if (result === 'trashed' || result === 'missing') {
        state.skipped.delete(rel);
        state.errors.delete(rel);
      } else {
        for (const s of cycle.writer.skipped.slice(skippedBefore))
          state.skipped.set(s.path, s.reason);
        for (const e of cycle.writer.errors.slice(errorsBefore)) state.errors.set(e.path, e.error);
      }
    }
  }

  // -------------------------------------------------------------------------
  // Status and logs
  // -------------------------------------------------------------------------

  /** The status from the note map and the lasting problem lists. */
  private buildStatus(cycle: Cycle): MirrorStatus {
    const state = cycle.state;
    const status = this.freshStatus(state.worldId, true);
    status.lastCycleAt = this.current.lastCycleAt;
    status.lastReconcileAt = this.current.lastReconcileAt;
    for (const note of state.notes.values()) {
      if (note.insideFence && isMirrorNoteType(note.type)) status.counts[note.type] += 1;
    }
    for (const note of state.pages.values()) {
      if (note.insideFence) status.counts['journal-page'] += 1;
    }
    const byPath = <T extends { path: string }>(rows: T[]): T[] =>
      rows.sort((a, b) => (a.path < b.path ? -1 : a.path > b.path ? 1 : 0));
    status.skipped = byPath([...state.skipped].map(([p, reason]) => ({ path: p, reason })));
    status.movedByGm = byPath([...state.movedByGm]);
    status.duplicates = byPath([...state.duplicates]);
    status.keptDeleted = byPath([...state.keptDeleted]);
    status.truncated = structuredClone(state.truncated);
    status.errors = byPath([...state.errors].map(([p, error]) => ({ path: p, error })));
    const licensed = state.licensed;
    if (licensed) {
      const guard = licensed.guardResult;
      const library = licensed.library.status(cycle.settings.libraryPacks);
      status.library = {
        ...library,
        errors: licensed.libraryError
          ? [...library.errors, { path: 'AI Tool/Library', error: licensed.libraryError }]
          : library.errors,
        blocked: guard && !guard.ok ? guard.reason : null,
      };
      const notes = [
        guard?.ok ? guard.reason : null,
        guard?.ok && !guard.trashOk ? guard.trashReason : null,
      ].filter((note): note is string => note !== null);
      status.images = {
        ...licensed.attachments.status(),
        note: notes.length > 0 ? notes.join('. ') : null,
      };
      status.licensedText = guard
        ? { allowed: guard.licensedOk, reason: guard.licensedOk ? null : guard.licensedReason }
        : null;
    }
    return status;
  }

  private async finish(cycle: Cycle, error: unknown): Promise<void> {
    const { writer, state } = cycle;
    const trashed = writer.trashed.length;
    const written = writer.written.length - cycle.created;
    const moved = writer.moved.length;
    const changed = writer.written.length + trashed + moved > 0;
    const abort = error instanceof CycleAbort ? error : null;
    if (this.state !== state) {
      // The world changed under the cycle: its state is gone.
      this.current = this.freshStatus(null, false);
      this.recordFailure(error);
      return;
    }
    this.current = this.buildStatus(cycle);
    if (!error) this.current.lastCycleAt = new Date(this.now()).toISOString();

    if (!abort?.noStatus) {
      // `_status.md` holds only lasting facts: rendered when a note changed,
      // when those facts changed, and at a reconcile (a deleted one comes back).
      const fingerprint = JSON.stringify([
        this.current.counts,
        this.current.skipped,
        this.current.movedByGm,
        this.current.duplicates,
        this.current.keptDeleted,
        this.current.truncated,
        this.current.errors,
        this.current.library && {
          ...this.current.library,
          pending: null,
          lastRefreshAt: null,
        },
        this.current.images && { ...this.current.images, pending: null },
        this.current.licensedText,
      ]);
      if (changed || cycle.reconcile || fingerprint !== state.statusFingerprint) {
        try {
          const note = renderMirrorStatusNote(state.worldId, this.current);
          const outcome = await this.writeOwned(
            cycle,
            note.path,
            note.text,
            checkMarkdownOwnership
          );
          if (outcome === 'written' || outcome === 'unchanged') {
            state.statusFingerprint = fingerprint;
          }
        } catch (statusError) {
          state.errors.set(MIRROR_STATUS_PATH, errorMessage(statusError));
        }
      }
    }

    if (changed) {
      this.logger.info('Obsidian mirror updated', {
        worldId: state.worldId,
        written: Math.max(0, written),
        created: cycle.created,
        moved,
        trashed,
      });
    }
    const problems = JSON.stringify([this.current.skipped, this.current.errors]);
    if (problems !== this.loggedProblems) {
      this.loggedProblems = problems;
      if (this.current.skipped.length > 0 || this.current.errors.length > 0) {
        this.logger.warn(
          'Obsidian mirror skipped or failed notes (see AI Tool/Foundry/_status.md)',
          {
            worldId: state.worldId,
            skipped: this.current.skipped.map(s => `${s.path}: ${s.reason}`),
            errors: this.current.errors.map(e => `${e.path}: ${e.error}`),
          }
        );
      }
    }
    if (error) this.recordFailure(error);
    else this.recover();
  }

  /** A failed cycle: kept in the status, logged once until it changes or recovers. */
  private recordFailure(error: unknown): void {
    const message = errorMessage(error);
    this.current.lastError = message;
    if (message !== this.loggedError) {
      this.logger.warn('Obsidian mirror cycle failed', { error: message });
      this.loggedError = message;
    }
  }

  private recover(): void {
    this.current.lastError = null;
    if (this.loggedError !== null) {
      this.logger.info('Obsidian mirror recovered');
      this.loggedError = null;
    }
  }
}
