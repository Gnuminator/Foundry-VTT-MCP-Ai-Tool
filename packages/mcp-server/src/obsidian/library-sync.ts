/**
 * The Library sync (docs/design/OBSIDIAN-O4-DESIGN.md section 13): keeps one note per document
 * of the compendium packs named in the mirror settings (`libraryPacks`) under
 * `Campaigns/<world>/AI Tool/Library/`. Driven by the mirror pump, a step per cycle, each step
 * within a deadline and able to continue at the next cycle:
 *
 * - `refreshStep` (at start, when the pack list changes, every 30 minutes, or when asked): the
 *   Library index of the packs (`getLibraryIndex`, paged with an opaque cursor), a scan of the
 *   Library folder (note heads only), note paths for documents without a note (picked once,
 *   never renamed), the queue of documents whose note is missing, whose signature changed or
 *   whose links changed with the membership, and the trash for notes whose document left;
 * - `work` (every cycle until the queue is empty): fetch documents in batches
 *   (`getLibraryDocuments`), render and write their notes.
 *
 * Paths for the whole index exist before any note is written, so world notes and other Library
 * notes link to a Library note from the start. The notes are the state: `fvtt_sig` holds the
 * index signature, so an unchanged document is never fetched or written again. A small state
 * file (`.ai-tool-library.json`, ignored by Obsidian) keeps what a restart needs: the membership
 * the notes were rendered against, which lookups each note made (its links), and the queue.
 *
 * Safety: nothing is written unless the git guard passed (the caller checks), only inside
 * `AI Tool/Library/` (real-path fence), edited notes are never overwritten or trashed, and
 * notes are trashed only after a complete index and a complete scan (never for a pack that is
 * configured but missing today) and only when git ignores the vault trash too.
 */
import { createHash } from 'crypto';
import { promises as fsp, type Dirent } from 'fs';

import {
  LIBRARY_DOCUMENTS_QUERY,
  LIBRARY_INDEX_QUERY,
  LIBRARY_LIMITS,
  MODULE_ID,
  isFoundryUuid,
  type LibraryDocument,
  type LibraryIndexResponse,
  type LibraryIndexRow,
  type LibraryPackInfo,
} from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';

import { writeFileAtomic } from './atomic-write.js';
import { LIBRARY_ROOT } from './licensed-guard.js';
import {
  LIBRARY_NOTE_TYPES,
  libraryCategory,
  renderLibraryNote,
  type LibraryNoteContext,
} from './library-render.js';
import { pathKey, versionedSig, type LibraryLinks, type LinkContext } from './mirror-common.js';
import { allocateNotePaths, type PathRequest } from './mirror-paths.js';
import { parseFrontmatter } from './mirror-scan.js';
import { errorCode, errorMessage, NoteWriter, type WrittenCache } from './note-writer.js';
import { checkMarkdownOwnership, GENERATED_BY } from './ownership.js';

export const LIBRARY_INDEX_METHOD = `${MODULE_ID}.${LIBRARY_INDEX_QUERY}`;
export const LIBRARY_DOCUMENTS_METHOD = `${MODULE_ID}.${LIBRARY_DOCUMENTS_QUERY}`;
/** A refresh runs at least this often. */
export const LIBRARY_REFRESH_EVERY_MS = 30 * 60_000;
const QUERY_TIMEOUT_MS = 60_000;
/** A query needs at least this much time left before the deadline to start. */
const MIN_QUERY_MS = 2_000;
const SCAN_MAX_FILES = 60_000;
const SCAN_MAX_DEPTH = 6;
const HEAD_BYTES = 4096;
/** Note heads read between two deadline checks. */
const HEADS_PER_CHECK = 100;
const MAX_INDEX_PAGES = 1000;
const FENCE_PREFIX = `${LIBRARY_ROOT}/`;
/** What a restart needs (membership, lookups per note, queue); a dot file Obsidian ignores. */
export const LIBRARY_STATE_PATH = `${LIBRARY_ROOT}/.ai-tool-library.json`;

export interface LibraryStatus {
  /** Packs named in the settings. */
  packs: string[];
  /** Named packs this world does not have. */
  missingPacks: string[];
  /** Library notes per tag (`monster`, `spell`, ...). */
  counts: Record<string, number>;
  /** Documents waiting to be fetched. */
  pending: number;
  lastRefreshAt: string | null;
  /** Edited in Obsidian: never overwritten. */
  skipped: Array<{ path: string; reason: string }>;
  errors: Array<{ path: string; error: string }>;
}

interface LibraryNote {
  path: string;
  sig: string | null;
  owned: boolean | null;
}

/** One row of the membership: what a link to the entry depends on. */
type Member = [
  path: string,
  name: string,
  type: string,
  identifier: string,
  classIdentifier: string,
];

interface WorldLibrary {
  worldId: string;
  /** The pack list of the last completed refresh (joined), or null before it. */
  packsKey: string | null;
  rows: Map<string, LibraryIndexRow>;
  packs: Map<string, LibraryPackInfo>;
  missing: string[];
  allPacks: Map<string, string>;
  /** Notes found by the last scan plus our writes, by uuid. */
  notes: Map<string, LibraryNote>;
  /** Existing or allocated note path per indexed uuid. */
  paths: Map<string, string>;
  queue: string[];
  lastRefreshAt: number | null;
  refreshDue: boolean;
  /** Every queued fetch re-renders (a renderer change). */
  forceAll: boolean;
  /** The membership the notes were rendered against (last refresh, else the state file). */
  membership: Map<string, Member> | null;
  /** Hash of the membership of the last completed refresh, or null before it. */
  membershipHash: string | null;
  /** Lookups each note made when it was rendered (its links), by uuid. */
  deps: Map<string, string[]>;
  stateLoaded: boolean;
  stateDirty: boolean;
  cache: WrittenCache;
  skipped: Map<string, string>;
  errors: Map<string, string>;
  byName: Map<string, Map<string, string[]>> | null;
}

function newWorld(worldId: string): WorldLibrary {
  return {
    worldId,
    packsKey: null,
    rows: new Map(),
    packs: new Map(),
    missing: [],
    allPacks: new Map(),
    notes: new Map(),
    paths: new Map(),
    queue: [],
    lastRefreshAt: null,
    refreshDue: true,
    forceAll: false,
    membership: null,
    membershipHash: null,
    deps: new Map(),
    stateLoaded: false,
    stateDirty: false,
    cache: { written: new Map() },
    skipped: new Map(),
    errors: new Map(),
    byName: null,
  };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === 'object' && value !== null && !Array.isArray(value);
}

function cmp(a: string, b: string): number {
  return a < b ? -1 : a > b ? 1 : 0;
}

function hash12(text: string): string {
  return createHash('sha256').update(text).digest('hex').slice(0, 12);
}

/** The lookup keys a link to this entry answers (what changes when it comes, goes or moves). */
function memberKeys(uuid: string, member: Member): string[] {
  const [, name, type, identifier, classIdentifier] = member;
  const pack = uuid.split('.').slice(1, 3).join('.');
  const lower = name.trim().toLowerCase();
  const keys = [`u:${uuid}`, `n:${pack}:${lower}`];
  if (type === 'spell') keys.push(`s:${lower}`);
  if (type === 'class' && identifier) keys.push(`i:${identifier}`);
  if (type === 'subclass' && classIdentifier) keys.push(`c:${classIdentifier}`);
  return keys;
}

function sameMember(a: Member | undefined, b: Member | undefined): boolean {
  return a !== undefined && b !== undefined && a.every((value, i) => value === b[i]);
}

/** The parts of a Library index page we rely on, or an Error. */
function parseIndex(raw: unknown): LibraryIndexResponse {
  if (!isRecord(raw)) throw new Error('getLibraryIndex returned nothing usable');
  if (raw.success !== true) {
    throw new Error(
      `getLibraryIndex failed: ${typeof raw.error === 'string' ? raw.error : 'refused'}`
    );
  }
  if (
    typeof raw.worldId !== 'string' ||
    !Array.isArray(raw.entries) ||
    !Array.isArray(raw.packs) ||
    !(raw.next === null || typeof raw.next === 'string')
  ) {
    throw new Error('getLibraryIndex returned a malformed page');
  }
  return raw as unknown as LibraryIndexResponse;
}

function validRow(value: unknown): value is LibraryIndexRow {
  return (
    isRecord(value) &&
    isFoundryUuid(value.uuid) &&
    String(value.uuid).startsWith('Compendium.') &&
    typeof value.pack === 'string' &&
    typeof value.id === 'string' &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    typeof value.sig === 'string'
  );
}

function validDocument(value: unknown): value is LibraryDocument {
  return (
    isRecord(value) &&
    isFoundryUuid(value.uuid) &&
    typeof value.name === 'string' &&
    typeof value.type === 'string' &&
    (value.documentName === 'Actor' || value.documentName === 'Item') &&
    Array.isArray(value.facts) &&
    Array.isArray(value.links)
  );
}

// ---------------------------------------------------------------------------
// The folder scan (resumable)
// ---------------------------------------------------------------------------

/** A scan of `AI Tool/Library/` that can stop at a deadline and go on later. */
class LibraryScan {
  readonly notes = new Map<string, LibraryNote>();
  readonly taken = new Set<string>();
  complete = true;
  private readonly stack: Array<{ rel: string; depth: number }> = [{ rel: LIBRARY_ROOT, depth: 0 }];
  private readonly markdown: string[] = [];
  private files = 0;
  private head = 0;

  constructor(private readonly root: string) {}

  /** Scan until done (true) or until `deadline` (false: call again). */
  async step(now: () => number, deadline: number): Promise<boolean> {
    while (this.stack.length > 0) {
      if (now() > deadline) return false;
      const { rel, depth } = this.stack.pop() as { rel: string; depth: number };
      await this.readFolder(rel, depth);
    }
    while (this.head < this.markdown.length) {
      if (this.head % HEADS_PER_CHECK === 0 && now() > deadline) return false;
      await this.readHead(this.markdown[this.head] ?? '');
      this.head += 1;
    }
    return true;
  }

  private async readFolder(rel: string, depth: number): Promise<void> {
    let entries: Dirent[];
    try {
      entries = (await fsp.readdir(`${this.root}/${rel}`, { withFileTypes: true })).sort((a, b) =>
        cmp(a.name, b.name)
      );
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') this.complete = false;
      return;
    }
    const folders: string[] = [];
    for (const entry of entries) {
      if (this.files >= SCAN_MAX_FILES) {
        this.complete = false;
        return;
      }
      const childRel = `${rel}/${entry.name}`;
      if (entry.isSymbolicLink()) {
        this.taken.add(pathKey(childRel));
      } else if (entry.isDirectory()) {
        if (entry.name.startsWith('.')) continue;
        if (depth >= SCAN_MAX_DEPTH) {
          this.complete = false;
          continue;
        }
        folders.push(childRel);
      } else if (entry.isFile()) {
        this.files += 1;
        this.taken.add(pathKey(childRel));
        if (!entry.name.startsWith('.') && /\.md$/i.test(entry.name)) this.markdown.push(childRel);
      } else {
        this.taken.add(pathKey(childRel));
      }
    }
    // Depth first, in name order.
    for (const folder of folders.reverse()) this.stack.push({ rel: folder, depth: depth + 1 });
  }

  private async readHead(rel: string): Promise<void> {
    try {
      const handle = await fsp.open(`${this.root}/${rel}`, 'r');
      let head: string;
      try {
        const buffer = Buffer.alloc(HEAD_BYTES);
        const { bytesRead } = await handle.read(buffer, 0, HEAD_BYTES, 0);
        head = buffer.toString('utf8', 0, bytesRead);
      } finally {
        await handle.close();
      }
      const parsed = parseFrontmatter(head);
      if (parsed.status !== 'ok') return;
      const { type, fvtt_uuid: uuid, fvtt_sig: sig, generated_by: by } = parsed.values;
      if (by !== GENERATED_BY || !type || !LIBRARY_NOTE_TYPES.includes(type) || !uuid) return;
      if (!this.notes.has(uuid)) this.notes.set(uuid, { path: rel, sig, owned: null });
    } catch (error) {
      if (errorCode(error) !== 'ENOENT') this.complete = false;
    }
  }
}

/** One refresh in progress (index pages, then the scan), kept across cycles. */
interface RefreshRun {
  packsKey: string;
  packs: string[];
  rows: Map<string, LibraryIndexRow>;
  packInfo: Map<string, LibraryPackInfo>;
  missing: string[];
  allPacks: Map<string, string>;
  complete: boolean;
  after: string | null;
  pages: number;
  /** Index restarts after an 'Invalid cursor' answer. */
  restarts: number;
  indexDone: boolean;
  scan: LibraryScan;
}

export interface LibrarySyncDeps {
  foundry: Pick<FoundryClient, 'query'>;
  vaultDir: string;
  campaignRoot: string;
  worldId: string;
  openBase: string;
  now: () => number;
  /** World links for Library text (world notes, Open in Foundry). */
  linkContext(fromPath: string, uuid: string, selfName: string): LinkContext;
  image?(src: string, alt: string, width?: number): string | null;
  /** The real-path fence of the vault trash for one note (throws when it leads outside). */
  assertTrash(relPath: string): Promise<void>;
  /** Why notes whose document left must stay in place (git would see the trash), or null. */
  trashBlocked: string | null;
  /** Foundry's base URL from the index (for images). */
  onOrigin?(origin: string): void;
  /** Image ownership: each note's embeds are counted for its uuid (attachments). */
  owner?: {
    begin(uuid: string): void;
    end(committed: boolean): void;
    drop(uuid: string): void;
  };
}

export interface RefreshStepResult {
  /** The refresh finished (false: it goes on at the next step). */
  done: boolean;
  /** The set of Library notes (uuids, paths, names) differs from what the notes were rendered against. */
  membershipChanged: boolean;
}

/** One world's Library: index, note paths, fetch queue and writes. */
export class LibrarySync {
  private world: WorldLibrary;
  private run: RefreshRun | null = null;

  constructor(worldId: string) {
    this.world = newWorld(worldId);
  }

  get worldId(): string {
    return this.world.worldId;
  }

  /** A refresh at the next step (a reconcile asked for it). */
  requestRefresh(): void {
    this.world.refreshDue = true;
  }

  /** Re-render every Library note at the next refresh (a renderer change). */
  forceRender(): void {
    this.world.forceAll = true;
    this.world.refreshDue = true;
  }

  get pending(): number {
    return this.world.queue.length;
  }

  /** A refresh is part way through (index pages or the folder scan). */
  get refreshing(): boolean {
    return this.run !== null;
  }

  /** A refresh finished since start: the links reflect the packs. */
  get ready(): boolean {
    return this.world.lastRefreshAt !== null;
  }

  /** Hash of the membership (uuids, paths, names) of the last finished refresh, or null. */
  get membershipHash(): string | null {
    return this.world.membershipHash;
  }

  // -------------------------------------------------------------------------
  // Links
  // -------------------------------------------------------------------------

  /** Compendium links for world and Library notes (empty when no pack is picked). */
  links(): LibraryLinks {
    const world = this.world;
    return {
      byUuid: (uuid): { notePath: string | null; name: string | null } | null => {
        const row = world.rows.get(uuid);
        if (!row) return null;
        return { notePath: world.paths.get(uuid) ?? null, name: row.name };
      },
      legacy: (pack, idOrName): string | null => {
        const documentName = world.allPacks.get(pack);
        if (!documentName) return null;
        if (/^[A-Za-z0-9]{16}$/.test(idOrName)) {
          return `Compendium.${pack}.${documentName}.${idOrName}`;
        }
        const matches = this.byName(pack).get(idOrName.trim().toLowerCase()) ?? [];
        return matches.length >= 1 ? (matches[0] ?? null) : null;
      },
      spellByName: (name): string | null => {
        const key = name.trim().toLowerCase();
        for (const pack of world.packs.keys()) {
          const found = (this.byName(pack).get(key) ?? []).find(
            uuid => world.rows.get(uuid)?.type === 'spell'
          );
          if (found) return found;
        }
        return null;
      },
    };
  }

  /** Lower-cased name to uuids within one pack (built once per refresh). */
  private byName(pack: string): Map<string, string[]> {
    const world = this.world;
    if (world.byName === null) {
      world.byName = new Map<string, Map<string, string[]>>();
      for (const row of world.rows.values()) {
        const perPack = world.byName.get(row.pack) ?? new Map<string, string[]>();
        const key = row.name.trim().toLowerCase();
        perPack.set(key, [...(perPack.get(key) ?? []), row.uuid]);
        world.byName.set(row.pack, perPack);
      }
    }
    return world.byName.get(pack) ?? new Map<string, string[]>();
  }

  // -------------------------------------------------------------------------
  // State file
  // -------------------------------------------------------------------------

  private async loadState(deps: LibrarySyncDeps): Promise<void> {
    const world = this.world;
    if (world.stateLoaded) return;
    world.stateLoaded = true;
    let raw: unknown;
    try {
      raw = JSON.parse(
        await fsp.readFile(`${deps.campaignRoot}/${LIBRARY_STATE_PATH}`.replace(/\\/g, '/'), 'utf8')
      );
    } catch {
      return; // Missing or unreadable: the next refresh starts a new baseline.
    }
    if (!isRecord(raw) || raw.schema !== 1) return;
    if (isRecord(raw.membership)) {
      const membership = new Map<string, Member>();
      for (const [uuid, value] of Object.entries(raw.membership)) {
        if (
          Array.isArray(value) &&
          value.length === 5 &&
          value.every(part => typeof part === 'string')
        ) {
          membership.set(uuid, value as Member);
        }
      }
      world.membership = membership;
    }
    if (isRecord(raw.deps)) {
      for (const [uuid, value] of Object.entries(raw.deps)) {
        if (Array.isArray(value)) {
          world.deps.set(
            uuid,
            value.filter((key): key is string => typeof key === 'string')
          );
        }
      }
    }
    if (Array.isArray(raw.queue) && world.queue.length === 0) {
      world.queue = raw.queue.filter(
        (uuid): uuid is string => typeof uuid === 'string' && uuid.startsWith('Compendium.')
      );
    }
  }

  private async saveState(deps: LibrarySyncDeps): Promise<void> {
    const world = this.world;
    if (!world.stateDirty) return;
    const file = `${deps.campaignRoot}/${LIBRARY_STATE_PATH}`;
    const empty =
      (world.membership?.size ?? 0) === 0 && world.deps.size === 0 && world.queue.length === 0;
    if (
      empty &&
      !(await fsp.lstat(file).then(
        () => true,
        () => false
      ))
    ) {
      // Nothing to remember (no packs): no file in a Library that holds nothing.
      world.stateDirty = false;
      return;
    }
    const sorted = <T>(map: Map<string, T>): Record<string, T> =>
      Object.fromEntries([...map].sort(([a], [b]) => cmp(a, b)));
    const text = `${JSON.stringify({
      schema: 1,
      membership: world.membership ? sorted(world.membership) : null,
      deps: sorted(world.deps),
      queue: world.queue,
    })}\n`;
    try {
      const writer = new NoteWriter(deps.campaignRoot, deps.vaultDir, deps.worldId, world.cache);
      await writer.assertRealFence(LIBRARY_ROOT);
      await writeFileAtomic(file, text);
      world.stateDirty = false;
      world.errors.delete(LIBRARY_STATE_PATH);
    } catch (error) {
      world.errors.set(LIBRARY_STATE_PATH, `Library state not saved: ${errorMessage(error)}`);
    }
  }

  // -------------------------------------------------------------------------
  // Refresh
  // -------------------------------------------------------------------------

  /** Whether a refresh step should run now for these packs. */
  refreshDue(packs: readonly string[], now: number): boolean {
    const world = this.world;
    if (this.run !== null) return true;
    if (world.packsKey !== packs.join('\n')) return true;
    if (world.refreshDue) return true;
    return world.lastRefreshAt === null || now - world.lastRefreshAt >= LIBRARY_REFRESH_EVERY_MS;
  }

  /** A whole refresh in one go (tests, and callers without a deadline). */
  async refresh(
    packs: readonly string[],
    deps: LibrarySyncDeps
  ): Promise<{ membershipChanged: boolean }> {
    const result = await this.refreshStep(packs, deps, Number.POSITIVE_INFINITY);
    return { membershipChanged: result.membershipChanged };
  }

  /**
   * Go on with the refresh of `packs` until `deadline`: index pages, then the folder scan, then
   * paths, the queue and the trash. A refresh that does not finish goes on at the next call (a
   * changed pack list starts over). Throws when the index fails (it starts over next time).
   */
  async refreshStep(
    packs: readonly string[],
    deps: LibrarySyncDeps,
    deadline: number
  ): Promise<RefreshStepResult> {
    const key = packs.join('\n');
    if (this.run === null || this.run.packsKey !== key) {
      this.run = {
        packsKey: key,
        packs: [...packs],
        rows: new Map(),
        packInfo: new Map(),
        missing: [],
        allPacks: new Map(),
        complete: true,
        after: null,
        pages: 0,
        restarts: 0,
        indexDone: false,
        scan: new LibraryScan(deps.campaignRoot.replace(/\\/g, '/')),
      };
    }
    const run = this.run;
    const waiting: RefreshStepResult = { done: false, membershipChanged: false };
    await this.loadState(deps);
    try {
      while (!run.indexDone) {
        const left = deadline - deps.now();
        if (left < MIN_QUERY_MS) return waiting;
        await this.indexPage(run, deps, Math.min(QUERY_TIMEOUT_MS, left));
      }
      if (!(await run.scan.step(deps.now, deadline))) return waiting;
    } catch (error) {
      this.run = null;
      throw error;
    }
    this.run = null;
    return { done: true, membershipChanged: await this.finishRefresh(run, deps) };
  }

  /** One index page into the run. Also without packs: the list of all packs serves legacy links. */
  private async indexPage(
    run: RefreshRun,
    deps: LibrarySyncDeps,
    timeoutMs: number
  ): Promise<void> {
    if (run.pages >= MAX_INDEX_PAGES) throw new Error('getLibraryIndex paged without end');
    const raw: unknown = await deps.foundry.query(
      LIBRARY_INDEX_METHOD,
      run.after ? { packs: run.packs, after: run.after } : { packs: run.packs },
      { timeoutMs }
    );
    if (isRecord(raw) && raw.success !== true && raw.error === 'Invalid cursor' && run.after) {
      // The module no longer knows the cursor (packs changed under it): start the index over.
      run.rows.clear();
      run.after = null;
      run.pages = 0;
      run.complete = true;
      run.restarts += 1;
      if (run.restarts > 3) throw new Error('getLibraryIndex refused the cursor again and again');
      return;
    }
    const response = parseIndex(raw);
    if (response.worldId !== deps.worldId) {
      throw new Error(`Foundry answered for world "${response.worldId}"; Library skipped`);
    }
    if (run.pages === 0) {
      for (const info of response.packs) run.packInfo.set(info.id, info);
      run.missing = Array.isArray(response.missing)
        ? response.missing.filter(m => typeof m === 'string')
        : [];
      run.allPacks = new Map(
        (Array.isArray(response.allPacks) ? response.allPacks : [])
          .filter(
            p => isRecord(p) && typeof p.id === 'string' && typeof p.documentName === 'string'
          )
          .map(p => [p.id, p.documentName])
      );
      if (typeof response.origin === 'string' && response.origin) deps.onOrigin?.(response.origin);
    }
    for (const entry of response.entries) {
      if (validRow(entry) && run.packs.includes(entry.pack)) {
        run.rows.set(entry.uuid, { ...entry, sig: versionedSig(entry.sig) });
      } else {
        run.complete = false;
      }
    }
    run.pages += 1;
    if (response.next === null) {
      run.indexDone = true;
      return;
    }
    if (response.next === run.after)
      throw new Error('getLibraryIndex returned the same cursor twice');
    run.after = response.next;
  }

  /** Paths, membership, queue and trash from a finished index and scan. Returns membershipChanged. */
  private async finishRefresh(run: RefreshRun, deps: LibrarySyncDeps): Promise<boolean> {
    const world = this.world;
    const { rows, scan } = run;
    const complete = run.complete && scan.complete;

    // Paths: existing notes keep theirs; the rest are allocated once, in id order. Entries that
    // share a name in one folder but not a rules version are told apart by it ("Barbarian (2024)").
    const paths = new Map<string, string>();
    const requests: PathRequest[] = [];
    const sameName = new Map<string, Set<string>>();
    const nameKey = (folder: string, name: string): string =>
      `${folder}\u0000${name.trim().toLowerCase()}`;
    for (const row of rows.values()) {
      const k = nameKey(libraryCategory(row).folder, row.name);
      sameName.set(k, (sameName.get(k) ?? new Set()).add(row.rules ?? ''));
    }
    for (const row of rows.values()) {
      const note = scan.notes.get(row.uuid);
      if (note) {
        paths.set(row.uuid, note.path);
        continue;
      }
      const folder = libraryCategory(row).folder;
      const versions = sameName.get(nameKey(folder, row.name));
      const name = row.name || 'Untitled';
      requests.push({
        uuid: row.uuid,
        id: row.id,
        folder,
        name: versions && versions.size > 1 && row.rules ? `${name} (${row.rules})` : name,
        created: null,
      });
    }
    for (const [uuid, notePath] of allocateNotePaths(requests, new Map(), scan.taken)) {
      paths.set(uuid, notePath);
    }

    // Membership: what links to each entry depend on. Notes whose lookups touch a changed entry
    // re-render (a class note gains a subclass added later); a note without a record of its
    // lookups re-renders on any change.
    const membership = new Map<string, Member>();
    for (const [uuid, notePath] of paths) {
      const row = rows.get(uuid);
      if (!row) continue;
      membership.set(uuid, [
        notePath,
        row.name,
        row.type,
        row.identifier ?? '',
        row.classIdentifier ?? '',
      ]);
    }
    const changedKeys = new Set<string>();
    const baseline = world.membership;
    if (baseline !== null) {
      for (const [uuid, member] of membership) {
        const old = baseline.get(uuid);
        if (sameMember(member, old)) continue;
        for (const k of memberKeys(uuid, member)) changedKeys.add(k);
        if (old) for (const k of memberKeys(uuid, old)) changedKeys.add(k);
      }
      for (const [uuid, old] of baseline) {
        if (!membership.has(uuid)) for (const k of memberKeys(uuid, old)) changedKeys.add(k);
      }
    }
    const affected = (uuid: string): boolean => {
      if (changedKeys.size === 0) return false;
      const lookups = world.deps.get(uuid);
      return lookups === undefined || lookups.some(k => changedKeys.has(k));
    };

    // Notes whose document left the packs: trashed when we are sure (complete, pack not missing).
    const trash: Array<{ uuid: string; path: string }> = [];
    if (complete) {
      for (const [uuid, note] of scan.notes) {
        if (rows.has(uuid) || !note.path.startsWith(FENCE_PREFIX)) continue;
        const pack = uuid.split('.').slice(1, 3).join('.');
        if (run.missing.includes(pack)) continue;
        trash.push({ uuid, path: note.path });
      }
    }

    // Re-render everything only when asked (a renderer change); a restart re-renders nothing
    // that is unchanged. What the last refresh queued and was not written yet stays queued.
    const force = world.forceAll;
    const carried = new Set(world.queue);
    const queue = [...rows.values()]
      .filter(row => {
        const note = scan.notes.get(row.uuid);
        return (
          force || !note || note.sig !== row.sig || carried.has(row.uuid) || affected(row.uuid)
        );
      })
      .sort((a, b) => cmp(a.pack, b.pack) || cmp(a.name, b.name) || cmp(a.id, b.id))
      .map(row => row.uuid);

    world.packsKey = run.packsKey;
    world.rows = rows;
    world.packs = run.packInfo;
    world.missing = run.missing;
    world.allPacks = run.allPacks;
    world.notes = scan.notes;
    world.paths = paths;
    world.queue = queue;
    world.byName = null;
    world.membership = membership;
    world.membershipHash = hash12(
      [...membership]
        .sort(([a], [b]) => cmp(a, b))
        .map(([uuid, member]) => `${uuid}=${member.join('\t')}`)
        .join('\n')
    );
    world.lastRefreshAt = deps.now();
    world.refreshDue = !complete;
    world.forceAll = false;
    world.stateDirty = true;
    // A fresh writer cache per refresh: an edit in Obsidian since the last write is seen again.
    world.cache = { written: new Map() };
    if (!complete) {
      world.errors.set(
        LIBRARY_ROOT,
        'The Library index or folder scan was incomplete; no Library notes were trashed'
      );
    } else {
      world.errors.delete(LIBRARY_ROOT);
    }

    const TRASH_KEY = `${LIBRARY_ROOT} (trash)`;
    world.errors.delete(TRASH_KEY);
    if (trash.length > 0 && deps.trashBlocked !== null) {
      world.errors.set(
        TRASH_KEY,
        `${trash.length} Library note(s) whose entry is gone were left in place: ${deps.trashBlocked}`
      );
    } else if (trash.length > 0) {
      const writer = new NoteWriter(deps.campaignRoot, deps.vaultDir, deps.worldId, world.cache);
      for (const item of trash) {
        await deps.assertTrash(item.path);
        const result = await writer.trash(item.path, checkMarkdownOwnership);
        if (result === 'trashed' || result === 'missing') {
          world.notes.delete(item.uuid);
          world.deps.delete(item.uuid);
          deps.owner?.drop(item.uuid);
        }
      }
      for (const s of writer.skipped) world.skipped.set(s.path, s.reason);
      for (const e of writer.errors) world.errors.set(e.path, e.error);
    }
    for (const uuid of [...world.deps.keys()]) {
      if (!rows.has(uuid) && !world.notes.has(uuid)) world.deps.delete(uuid);
    }
    await this.saveState(deps);
    return changedKeys.size > 0;
  }

  // -------------------------------------------------------------------------
  // Work: fetch and write
  // -------------------------------------------------------------------------

  /**
   * The note context, built once per `work()`: each note gets a copy that records the lookups
   * it makes (its links), so a membership change re-renders exactly the notes it touches.
   */
  private contextFactory(deps: LibrarySyncDeps): (lookups: Set<string>) => LibraryNoteContext {
    const world = this.world;
    const links = this.links();
    const classes = new Map<string, { uuid: string; name: string }>();
    const subclasses = new Map<string, Array<{ uuid: string; name: string }>>();
    for (const row of world.rows.values()) {
      if (row.type === 'class' && row.identifier && !classes.has(row.identifier)) {
        classes.set(row.identifier, { uuid: row.uuid, name: row.name });
      }
      if (row.type === 'subclass' && row.classIdentifier) {
        subclasses.set(row.classIdentifier, [
          ...(subclasses.get(row.classIdentifier) ?? []),
          { uuid: row.uuid, name: row.name },
        ]);
      }
    }
    for (const list of subclasses.values()) {
      list.sort((a, b) => cmp(a.name, b.name) || cmp(a.uuid, b.uuid));
    }
    return lookups => {
      const library: LibraryLinks = {
        byUuid: uuid => {
          lookups.add(`u:${uuid}`);
          return links.byUuid(uuid);
        },
        legacy: (pack, idOrName) => {
          if (!/^[A-Za-z0-9]{16}$/.test(idOrName)) {
            lookups.add(`n:${pack}:${idOrName.trim().toLowerCase()}`);
          }
          return links.legacy(pack, idOrName);
        },
        spellByName: name => {
          lookups.add(`s:${name.trim().toLowerCase()}`);
          return links.spellByName?.(name) ?? null;
        },
      };
      return {
        worldId: deps.worldId,
        openBase: deps.openBase,
        linkContext: (fromPath, uuid, selfName) => ({
          ...deps.linkContext(fromPath, uuid, selfName),
          library,
        }),
        library,
        packLabel: pack => world.packs.get(pack)?.label ?? pack,
        classByIdentifier: (identifier): { uuid: string; name: string } | null => {
          lookups.add(`i:${identifier}`);
          return classes.get(identifier) ?? null;
        },
        subclassesOf: (identifier): Array<{ uuid: string; name: string }> => {
          lookups.add(`c:${identifier}`);
          return subclasses.get(identifier) ?? [];
        },
        ...(deps.image
          ? {
              image: (src: string, alt: string, width?: number) =>
                deps.image?.(src, alt, width) ?? null,
            }
          : {}),
      };
    };
  }

  /**
   * Fetch and write queued documents until `deadline`. Returns how many notes were written.
   * Throws only when the fence check fails (nothing is written then).
   */
  async work(deadline: number, deps: LibrarySyncDeps): Promise<number> {
    const world = this.world;
    if (world.queue.length === 0) return 0;
    const writer = new NoteWriter(deps.campaignRoot, deps.vaultDir, deps.worldId, world.cache);
    await writer.assertRealFence(LIBRARY_ROOT);
    const contextFor = this.contextFactory(deps);
    let written = 0;
    try {
      for (;;) {
        if (world.queue.length === 0) break;
        const left = deadline - deps.now();
        if (left < MIN_QUERY_MS) break;
        const batch = world.queue.slice(0, LIBRARY_LIMITS.documentsPerRequest);
        let raw: unknown;
        try {
          raw = await deps.foundry.query(
            LIBRARY_DOCUMENTS_METHOD,
            { uuids: batch },
            { timeoutMs: Math.min(QUERY_TIMEOUT_MS, left) }
          );
        } catch (error) {
          world.errors.set(LIBRARY_ROOT, `Library fetch failed: ${errorMessage(error)}`);
          return written;
        }
        if (!isRecord(raw) || raw.success !== true || !Array.isArray(raw.documents)) {
          world.errors.set(LIBRARY_ROOT, 'getLibraryDocuments returned nothing usable');
          return written;
        }
        if (raw.worldId !== deps.worldId) return written;
        const deferred = new Set(
          Array.isArray(raw.deferred)
            ? raw.deferred.filter((u): u is string => typeof u === 'string')
            : []
        );
        let done = 0;
        for (const value of raw.documents as unknown[]) {
          if (!validDocument(value)) continue;
          done += 1;
          if (await this.writeOne(value, writer, contextFor, deps)) written += 1;
        }
        // Missing documents are dropped; deferred ones stay at the front of the queue.
        world.queue = world.queue.filter(uuid => !batch.includes(uuid) || deferred.has(uuid));
        world.stateDirty = true;
        if (done === 0 && deferred.size === batch.length) return written; // no progress
        await new Promise(resolve => setImmediate(resolve));
      }
      if (world.queue.length === 0) world.errors.delete(LIBRARY_ROOT);
      return written;
    } finally {
      await this.saveState(deps);
    }
  }

  /** Render and write one fetched document. Returns whether the file was written. */
  private async writeOne(
    doc: LibraryDocument,
    writer: NoteWriter,
    contextFor: (lookups: Set<string>) => LibraryNoteContext,
    deps: LibrarySyncDeps
  ): Promise<boolean> {
    const world = this.world;
    const row = world.rows.get(doc.uuid);
    const notePath = world.paths.get(doc.uuid);
    if (!row || !notePath || !notePath.startsWith(FENCE_PREFIX)) return false;
    const lookups = new Set<string>();
    let committed = false;
    deps.owner?.begin(doc.uuid);
    try {
      let text: string;
      try {
        text = renderLibraryNote(doc, row, notePath, contextFor(lookups));
      } catch (error) {
        world.errors.set(notePath, errorMessage(error));
        return false;
      }
      const before = [writer.written.length, writer.skipped.length, writer.errors.length];
      await writer.owned(notePath, text, checkMarkdownOwnership);
      const skipped = writer.skipped.slice(before[1]);
      const errors = writer.errors.slice(before[2]);
      for (const s of skipped) world.skipped.set(s.path, s.reason);
      for (const e of errors) world.errors.set(e.path, e.error);
      if (skipped.length > 0 || errors.length > 0) return false;
      committed = true;
      world.skipped.delete(notePath);
      world.errors.delete(notePath);
      world.notes.set(doc.uuid, { path: notePath, sig: row.sig, owned: true });
      world.deps.set(doc.uuid, [...lookups].sort(cmp));
      return writer.written.length > (before[0] ?? 0);
    } finally {
      deps.owner?.end(committed);
    }
  }

  status(packs: readonly string[]): LibraryStatus {
    const world = this.world;
    const counts: Record<string, number> = {};
    for (const [uuid, note] of world.notes) {
      const row = world.rows.get(uuid);
      if (!row || !note.path.startsWith(FENCE_PREFIX)) continue;
      const tag = libraryCategory(row).tag;
      counts[tag] = (counts[tag] ?? 0) + 1;
    }
    const byPath = <T extends { path: string }>(list: T[]): T[] =>
      list.sort((a, b) => cmp(a.path, b.path));
    return {
      packs: [...packs],
      missingPacks: [...world.missing],
      counts,
      pending: world.queue.length,
      lastRefreshAt:
        world.lastRefreshAt === null ? null : new Date(world.lastRefreshAt).toISOString(),
      skipped: byPath([...world.skipped].map(([p, reason]) => ({ path: p, reason }))),
      errors: byPath([...world.errors].map(([p, error]) => ({ path: p, error }))),
    };
  }
}
