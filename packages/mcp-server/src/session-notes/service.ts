/**
 * Session notes into Foundry (recap lane, D-087).
 *
 * The session pipeline (`tools/session-notes publish`) stages a recorded session's notes here
 * over the host-only control method `session_notes`. The bridge keeps them in the world's bridge
 * vault (`gm/session-notes.<sessionId>.json`, so they survive restarts) and puts them into a
 * GM-only Foundry journal by itself as soon as it can: a GM client is connected, "Allow Write
 * Operations" is on and the `session-notes` switch is on. Every put is a guarded change (Recent
 * Changes, Live Feed, Undo); its Undo refuses when the GM edited a page or the Recap was already
 * revealed. The Recap page is queued for reveal; revealing it stays the GM's (destructive,
 * confirmed) action and marks the session approved, which starts the audio clock (D-072).
 */
import { MODULE_ID, type GuardedOp, type OpSnapshot } from '@gnuminator/shared';

import type { FoundryClient } from '../foundry-client.js';
import type { AppliedChange, GuardedWriteService } from '../guarded-write/service.js';
import type { HandoutsService } from '../handouts/service.js';
import type { Logger } from '../logger.js';
import { handleFeatureSwitches } from '../session-control.js';
import { REVEALS_FILE, newDocumentId } from '../tarokka/service.js';
import type { AuditEntry, AuditLog } from '../vault/audit.js';
import { isValidWorldId } from '../vault/paths.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

import { sanitizeNotesHtml } from './sanitize.js';
import {
  NOTES_FOLDER,
  PAGE_KEYS,
  PAGE_TITLES,
  SESSION_NOTES_FEATURE,
  SessionNotesError,
  type NotesItem,
  type NotesPage,
  type PageKey,
  type StoredNotes,
  type WaitingFor,
} from './types.js';

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;
const DATE = /^\d{4}-\d{2}-\d{2}$/;
const FILE_PREFIX = 'session-notes.';
const MAX_TITLE = 200;
const MAX_PAGE_HTML = 2_000_000;
/** Foundry's JournalEntryPage text format for HTML. */
const HTML_FORMAT = 1;
const NONE = 0;
const DEFAULT_TICK_MS = 30_000;
const DEFAULT_RETRY_MS = 3 * 60_000;

function fileFor(sessionId: string): string {
  return `${FILE_PREFIX}${sessionId}.json`;
}

function messageOf(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function unwrapModule<T>(response: unknown, what: string): T {
  const r = response as { success?: unknown; error?: unknown } | null | undefined;
  if (r && typeof r === 'object' && r.success === false) {
    throw new Error(`${what}: ${typeof r.error === 'string' ? r.error : 'refused by Foundry'}`);
  }
  return response as T;
}

function bad(message: string): SessionNotesError {
  return new SessionNotesError('bad-request', message);
}

function assertSessionId(value: unknown): string {
  if (typeof value !== 'string' || !SESSION_ID.test(value)) {
    throw bad('sessionId must be letters, digits, "-" or "_" (at most 80)');
  }
  return value;
}

/** Validated, sanitized pages in Foundry order (recap, summary, scenes). */
function readPages(value: unknown): NotesPage[] {
  if (!Array.isArray(value) || value.length === 0) throw bad('pages must be a non-empty list');
  const byKey = new Map<PageKey, NotesPage>();
  for (const raw of value as unknown[]) {
    const p = (raw ?? {}) as { key?: unknown; title?: unknown; html?: unknown };
    if (!(PAGE_KEYS as readonly unknown[]).includes(p.key)) {
      throw bad(`page key must be one of ${PAGE_KEYS.join(', ')}`);
    }
    const key = p.key as PageKey;
    if (byKey.has(key)) throw bad(`page "${key}" is given twice`);
    if (typeof p.html !== 'string' || p.html.length > MAX_PAGE_HTML) {
      throw bad(`page "${key}" needs html (at most ${MAX_PAGE_HTML} characters)`);
    }
    const html = sanitizeNotesHtml(p.html);
    if (!html) throw bad(`page "${key}" is empty after sanitizing`);
    const title =
      typeof p.title === 'string' && p.title.trim()
        ? p.title.trim().slice(0, MAX_TITLE)
        : PAGE_TITLES[key];
    byKey.set(key, { key, title, html });
  }
  if (!byKey.has('recap')) throw bad('the recap page is required');
  return PAGE_KEYS.filter(k => byKey.has(k)).map(k => byKey.get(k)!);
}

function statusOf(notes: StoredNotes): NotesItem['status'] {
  if (notes.approvedAt) return 'approved';
  return notes.put ? 'in-foundry' : 'staged';
}

export interface SessionNotesServiceOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected' | 'getConnectionSerial'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  audit: Pick<AuditLog, 'get'>;
  guardedWrites: Pick<
    GuardedWriteService,
    'createPlan' | 'applyPlan' | 'addRecordedListener' | 'setUndoGuard'
  >;
  handouts: Pick<HandoutsService, 'queuePage' | 'unqueuePage'>;
  logger: Logger;
  now?: () => number;
  /** How often the automatic put looks (default 30 s; it acts on a new connection or a stage). */
  tickMs?: number;
  /** How often it tries again while connected and something waits (default 3 minutes). */
  retryMs?: number;
}

interface Blockers {
  waitingFor: WaitingFor[];
  message?: string;
}

export class SessionNotesService {
  private readonly foundry: SessionNotesServiceOptions['foundryClient'];
  private readonly worldIds: SessionNotesServiceOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly audit: SessionNotesServiceOptions['audit'];
  private readonly guardedWrites: SessionNotesServiceOptions['guardedWrites'];
  private readonly handouts: SessionNotesServiceOptions['handouts'];
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly tickMs: number;
  private readonly retryMs: number;
  private timer: NodeJS.Timeout | null = null;
  private putLock: Promise<unknown> = Promise.resolve();
  private lastSerial = -1;
  private lastAttemptMs = 0;
  private kicked = false;
  private ticking = false;
  /** Work started outside a caller's await (passes, listeners), for `idle()`. */
  private readonly background = new Set<Promise<unknown>>();

  constructor(options: SessionNotesServiceOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.audit = options.audit;
    this.guardedWrites = options.guardedWrites;
    this.handouts = options.handouts;
    this.logger = options.logger.child({ component: 'SessionNotes' });
    this.now = options.now ?? ((): number => Date.now());
    this.tickMs = options.tickMs ?? DEFAULT_TICK_MS;
    this.retryMs = options.retryMs ?? DEFAULT_RETRY_MS;
    // Awaited by the apply or undo, so the dashboard reads the new state right after it.
    this.guardedWrites.addRecordedListener((worldId, changeId) => {
      const work = this.onRecorded(worldId, changeId).catch(error =>
        this.logger.warn('Session notes could not follow a recorded change', {
          error: messageOf(error),
        })
      );
      this.track(work);
      return work;
    });
    this.guardedWrites.setUndoGuard(SESSION_NOTES_FEATURE, (worldId, entry) =>
      this.undoConflict(worldId, entry)
    );
  }

  /** Start the automatic put (D-087). */
  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => this.track(this.tick()), this.tickMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /** Resolves once every pass and listener started so far has finished (tests, shutdown). */
  async idle(): Promise<void> {
    while (this.background.size > 0) await Promise.allSettled([...this.background]);
  }

  private track(work: Promise<unknown>): void {
    this.background.add(work);
    void work.finally(() => this.background.delete(work));
  }

  // -------------------------------------------------------------------------
  // Actions
  // -------------------------------------------------------------------------

  /** `stage` (pipeline): keep the notes; replaces an item that is still only staged. */
  async stage(params: Record<string, unknown>): Promise<NotesItem> {
    const sessionId = assertSessionId(params.sessionId);
    if (typeof params.date !== 'string' || !DATE.test(params.date)) {
      throw bad('date must be YYYY-MM-DD');
    }
    if (typeof params.title !== 'string' || !params.title.trim()) throw bad('title is required');
    const pages = readPages(params.pages);
    const languages = Array.isArray(params.languages)
      ? (params.languages as unknown[]).filter(
          (l): l is string => typeof l === 'string' && /^[a-z]{2}$/.test(l)
        )
      : [];
    const worldId = await this.worldFor(params.world);
    const date = params.date;
    const title = params.title.trim().slice(0, MAX_TITLE);
    const stored = await this.store.update<StoredNotes>(
      worldId,
      'gm',
      fileFor(sessionId),
      1,
      current => {
        const old = current?.data;
        if (old && (old.put !== undefined || old.approvedAt !== undefined)) {
          throw new SessionNotesError(
            'not-staged',
            `Session ${sessionId} is already ${statusOf(old) === 'approved' ? 'approved' : 'in Foundry'}; it is not staged again`
          );
        }
        return {
          sessionId,
          date,
          title,
          languages,
          pages,
          stagedAt: new Date(this.now()).toISOString(),
          autoPut: true,
        };
      }
    );
    this.kicked = true;
    this.track(Promise.resolve().then(() => this.tick()));
    return this.view(stored.data, await this.blockers());
  }

  /** `list` (dashboard): every session of the current world, newest first. */
  async list(): Promise<{ items: NotesItem[] }> {
    const worldId = await this.currentWorld();
    const all = await this.reconcile(worldId, await this.loadAll(worldId));
    const blockers = await this.blockers();
    const revealed = await this.revealedSources(worldId);
    const items = all
      .sort((a, b) =>
        a.date === b.date ? b.stagedAt.localeCompare(a.stagedAt) : b.date.localeCompare(a.date)
      )
      .map(n => this.view(n, blockers, revealed));
    return { items };
  }

  /** `get` (dashboard): the item with the page HTML (the preview). */
  async get(params: Record<string, unknown>): Promise<NotesItem> {
    const worldId = await this.currentWorld();
    const [notes] = await this.reconcile(worldId, [
      await this.load(worldId, assertSessionId(params.sessionId)),
    ]);
    if (!notes) throw new SessionNotesError('not-found', 'No such session notes in this world');
    const item = this.view(notes, await this.blockers(), await this.revealedSources(worldId));
    return { ...item, pages: notes.pages.map(p => ({ key: p.key, title: p.title, html: p.html })) };
  }

  /** `put` (dashboard, manual retry): into Foundry now, as one guarded change with Undo. */
  async put(params: Record<string, unknown>): Promise<AppliedChange & { item: NotesItem }> {
    const sessionId = assertSessionId(params.sessionId);
    const worldId = await this.currentWorld();
    return this.exclusivePut(() => this.putNow(worldId, sessionId, false));
  }

  /** `approve` (dashboard): "Approve without revealing" starts the audio clock too. */
  async approve(params: Record<string, unknown>): Promise<NotesItem> {
    const sessionId = assertSessionId(params.sessionId);
    const worldId = await this.currentWorld();
    const by =
      typeof params.by === 'string' && params.by.trim() ? params.by.trim().slice(0, 80) : 'GM';
    const notes = await this.mutate(worldId, sessionId, n => {
      if (!n.approvedAt) {
        n.approvedAt = new Date(this.now()).toISOString();
        n.approvedBy = by;
      }
    });
    return this.view(notes, await this.blockers(), await this.revealedSources(worldId));
  }

  /** `status` (pipeline): works while Foundry is closed (it searches every world's vault). */
  async status(params: Record<string, unknown>): Promise<NotesItem> {
    const sessionId = assertSessionId(params.sessionId);
    let worldId: string | null = null;
    if (params.world !== undefined) {
      if (!isValidWorldId(params.world)) throw bad('world is not a valid world id');
      worldId = params.world;
    } else if (this.foundry.isConnected()) {
      worldId = await this.worldIds.current().catch(() => null);
    }
    const worlds = worldId ? [worldId] : await this.store.listWorlds();
    for (const w of worlds) {
      const env = await this.store.read<StoredNotes>(w, 'gm', fileFor(sessionId));
      if (env) return this.view(env.data, await this.blockers(), await this.revealedSources(w));
    }
    throw new SessionNotesError('not-found', `No session notes ${sessionId} in the bridge vault`);
  }

  // -------------------------------------------------------------------------
  // Automatic put (D-087)
  // -------------------------------------------------------------------------

  /** One pass: put every waiting item when a GM client is connected and the switches allow it. */
  async tick(): Promise<void> {
    if (this.ticking || !this.foundry.isConnected()) return;
    const serial = this.foundry.getConnectionSerial();
    const now = this.now();
    const due =
      this.kicked || serial !== this.lastSerial || now - this.lastAttemptMs >= this.retryMs;
    if (!due) return;
    this.ticking = true;
    this.kicked = false;
    this.lastSerial = serial;
    this.lastAttemptMs = now;
    try {
      const worldId = await this.worldIds.current();
      const all = await this.reconcile(worldId, await this.loadAll(worldId));
      const waiting = all.filter(n => n.autoPut && !n.put);
      if (waiting.length === 0) return;
      const blockers = await this.blockers();
      if (blockers.waitingFor.length > 0) return;
      for (const notes of waiting) {
        try {
          await this.exclusivePut(() => this.putNow(worldId, notes.sessionId, true));
          this.logger.info('Session notes put into Foundry', { sessionId: notes.sessionId });
        } catch (error) {
          // Put by hand meanwhile: nothing to report.
          if (error instanceof SessionNotesError && error.code === 'not-staged') continue;
          const message = messageOf(error);
          this.logger.warn('Automatic put of session notes failed', {
            sessionId: notes.sessionId,
            error: message,
          });
          await this.mutate(worldId, notes.sessionId, n => {
            n.lastError = message;
          }).catch(() => undefined);
        }
      }
    } catch (error) {
      this.logger.warn('Session notes pass failed', { error: messageOf(error) });
    } finally {
      this.ticking = false;
    }
  }

  // -------------------------------------------------------------------------

  private exclusivePut<T>(fn: () => Promise<T>): Promise<T> {
    const run = this.putLock.then(fn, fn);
    this.putLock = run.catch(() => undefined);
    return run;
  }

  private async putNow(
    worldId: string,
    sessionId: string,
    auto: boolean
  ): Promise<AppliedChange & { item: NotesItem }> {
    const notes = await this.load(worldId, sessionId);
    if (notes.put) {
      throw new SessionNotesError('not-staged', `Session ${sessionId} is already in Foundry`);
    }
    if (auto && !notes.autoPut) {
      throw new SessionNotesError('not-staged', `Session ${sessionId} waits for a manual put`);
    }
    const blockers = await this.blockers();
    if (blockers.waitingFor.includes('foundry')) {
      throw new SessionNotesError('not-connected', blockers.message ?? 'Foundry is not connected');
    }
    if (blockers.waitingFor.includes('writes-off')) {
      throw new SessionNotesError('writes-off', blockers.message ?? 'Write operations are off');
    }
    if (blockers.waitingFor.includes('feature-off')) {
      throw new SessionNotesError('feature-off', blockers.message ?? 'Session notes are off');
    }

    const folder = unwrapModule<{ folderId?: unknown }>(
      await this.foundry.query('foundry-mcp-bridge.ensureJournalFolder', { name: NOTES_FOLDER }),
      'Journal folder refused'
    );
    if (typeof folder?.folderId !== 'string') {
      throw new Error(`Foundry did not give the "${NOTES_FOLDER}" folder`);
    }
    const entryId = newDocumentId();
    const journalUuid = `JournalEntry.${entryId}`;
    const pageIds = new Map<PageKey, string>(notes.pages.map(p => [p.key, newDocumentId()]));
    const name = `${notes.date}: ${notes.title}`;
    const op: GuardedOp = {
      kind: 'create',
      documentName: 'JournalEntry',
      keepId: true,
      data: {
        _id: entryId,
        name,
        folder: folder.folderId,
        ownership: { default: NONE },
        flags: { [MODULE_ID]: { sessionNotes: true, sessionId } },
        pages: notes.pages.map((p, i) => ({
          _id: pageIds.get(p.key),
          name: p.title,
          type: 'text',
          sort: (i + 1) * 100_000,
          text: { content: p.html, format: HTML_FORMAT },
        })),
      },
    };
    const pageList = notes.pages.map(p => p.title).join(', ');
    const plan = await this.guardedWrites.createPlan({
      feature: SESSION_NOTES_FEATURE,
      summary: `Put the session notes "${name}" into Foundry (GM-only journal in "${NOTES_FOLDER}": ${pageList}; the Recap is queued for reveal)${auto ? ', automatically' : ''}`,
      ops: [op],
    });
    const applied = await this.guardedWrites.applyPlan(plan.planId, { confirm: true });

    const pageUuids: Partial<Record<PageKey, string>> = {};
    for (const [key, id] of pageIds) pageUuids[key] = `${journalUuid}.JournalEntryPage.${id}`;
    const recapPageUuid = pageUuids.recap!;
    // Read every page back (Foundry can drop writes silently, P-064) and keep its modified
    // time for the Undo's edit check.
    const pageTimes: Record<string, number | null> = {};
    let readBackError: string | undefined;
    try {
      const ops: GuardedOp[] = [];
      for (const p of notes.pages) {
        const uuid = pageUuids[p.key]!;
        ops.push({ kind: 'delete', uuid });
        ops.push({ kind: 'update', uuid, changes: { 'text.content': p.html } });
      }
      const snaps = unwrapModule<OpSnapshot[]>(
        await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', { ops }),
        'Read-back refused'
      );
      const problems: string[] = [];
      notes.pages.forEach((p, i) => {
        const time = snaps[2 * i];
        const text = snaps[2 * i + 1];
        pageTimes[pageUuids[p.key]!] = time?.modifiedTime ?? null;
        const stored = text?.values?.find(v => v.path === 'text.content');
        if (!time?.exists) problems.push(`page "${p.title}" is missing`);
        else if (!stored?.present || String(stored.value).trim() !== p.html.trim()) {
          problems.push(`page "${p.title}" holds different text`);
        }
      });
      if (problems.length > 0) readBackError = `Read back from Foundry: ${problems.join('; ')}`;
    } catch (error) {
      readBackError = `Read back from Foundry failed: ${messageOf(error)}`;
    }
    if (readBackError) this.logger.warn(readBackError, { sessionId });

    try {
      await this.handouts.queuePage({ pageUuid: recapPageUuid });
    } catch (error) {
      this.logger.warn('Could not queue the Recap for reveal', { error: messageOf(error) });
    }

    const updated = await this.mutate(worldId, sessionId, n => {
      n.put = {
        changeId: applied.changeId,
        putAt: applied.appliedAt,
        journalUuid,
        recapPageUuid,
        pageUuids,
        pageTimes,
        auto,
      };
      n.autoPut = true;
      if (readBackError) n.lastError = readBackError;
      else delete n.lastError;
    });
    const item = this.view(updated, { waitingFor: [] }, await this.revealedSources(worldId));
    return { ...applied, item };
  }

  /** Approval on reveal, and back to staged after an Undo of a put. */
  private async onRecorded(worldId: string, changeId: string): Promise<void> {
    const entry = await this.audit.get(worldId, changeId);
    if (!entry) return;
    if (entry.feature === SESSION_NOTES_FEATURE && entry.mode === 'undo' && entry.undoOf) {
      const notes = (await this.loadAll(worldId)).find(n => n.put?.changeId === entry.undoOf);
      if (!notes?.put) return;
      const recap = notes.put.recapPageUuid;
      await this.mutate(worldId, notes.sessionId, n => {
        delete n.put;
        // The GM took it back: no automatic put again until a manual one.
        n.autoPut = false;
        delete n.lastError;
      });
      await this.handouts.unqueuePage({ pageUuid: recap }).catch(() => undefined);
      return;
    }
    if (entry.feature === 'handouts' && entry.mode === 'apply') {
      const revealed = await this.revealedSources(worldId);
      for (const notes of await this.loadAll(worldId)) {
        if (!notes.put || notes.approvedAt !== undefined) continue;
        if (!revealed.has(notes.put.recapPageUuid)) continue;
        await this.mutate(worldId, notes.sessionId, n => {
          n.approvedAt ??= entry.appliedAt;
          n.approvedBy ??= 'reveal';
        });
      }
    }
  }

  /** The Undo guard: refuse when the Recap reached the players or the GM edited a page. */
  private async undoConflict(worldId: string, entry: AuditEntry): Promise<string | null> {
    const notes = (await this.loadAll(worldId)).find(n => n.put?.changeId === entry.changeId);
    if (!notes?.put) return null;
    const revealed = await this.revealedSources(worldId);
    if (revealed.has(notes.put.recapPageUuid)) {
      return 'the Recap was revealed to the players (their copy in Handouts would stay); hide it first, then undo';
    }
    const uuids = Object.keys(notes.put.pageTimes);
    if (uuids.length === 0) return null;
    const snaps = unwrapModule<OpSnapshot[]>(
      await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', {
        ops: uuids.map(uuid => ({ kind: 'delete', uuid })),
      }),
      'Snapshot refused'
    );
    const edited: string[] = [];
    uuids.forEach((uuid, i) => {
      const snap = snaps[i];
      const was = notes.put!.pageTimes[uuid];
      if (snap?.exists && was !== null && snap.modifiedTime !== was) {
        edited.push(`"${snap.name ?? uuid}"`);
      }
    });
    return edited.length > 0
      ? `the page${edited.length === 1 ? '' : 's'} ${edited.join(', ')} changed in Foundry since the notes were put there`
      : null;
  }

  // -------------------------------------------------------------------------

  /**
   * Notes whose journal is gone from Foundry (the GM deleted it by hand) go back to staged: the
   * put record is cleared, the Recap leaves the reveal queue, and the bridge does not put them
   * again by itself ("Put in Foundry" does). One snapshot query for every item in Foundry; on any
   * doubt (no answer, Foundry closed) nothing changes.
   */
  private async reconcile(worldId: string, all: StoredNotes[]): Promise<StoredNotes[]> {
    const placed = all.filter(n => n.put !== undefined);
    if (placed.length === 0 || !this.foundry.isConnected()) return all;
    let snaps: OpSnapshot[];
    try {
      snaps = unwrapModule<OpSnapshot[]>(
        await this.foundry.query('foundry-mcp-bridge.snapshotGuardedOps', {
          ops: placed.map(n => ({ kind: 'delete', uuid: n.put!.journalUuid })),
        }),
        'Snapshot refused'
      );
    } catch {
      return all;
    }
    if (!Array.isArray(snaps) || snaps.length !== placed.length) return all;
    const result = new Map(all.map(n => [n.sessionId, n]));
    for (const [i, notes] of placed.entries()) {
      if (snaps[i]?.exists !== false) continue;
      const { journalUuid, recapPageUuid } = notes.put!;
      const updated = await this.mutate(worldId, notes.sessionId, n => {
        if (n.put?.journalUuid !== journalUuid) return;
        delete n.put;
        n.autoPut = false;
        n.lastError = `The journal "${n.date}: ${n.title}" is no longer in Foundry; "Put in Foundry" puts the notes back`;
      }).catch(() => null);
      if (!updated) continue;
      result.set(notes.sessionId, updated);
      await this.handouts.unqueuePage({ pageUuid: recapPageUuid }).catch(() => undefined);
      this.logger.info('Session notes journal is gone from Foundry; back to staged', {
        sessionId: notes.sessionId,
      });
    }
    return all.map(n => result.get(n.sessionId) ?? n);
  }

  /** What blocks a put right now (one query to the module). */
  private async blockers(): Promise<Blockers> {
    if (!this.foundry.isConnected()) {
      return { waitingFor: ['foundry'], message: 'No GM Foundry client is connected' };
    }
    try {
      const state = await handleFeatureSwitches((method, data) =>
        this.foundry.query(method, data ?? {})
      );
      const waitingFor: WaitingFor[] = [];
      let message: string | undefined;
      if (!state.writesAllowed) {
        waitingFor.push('writes-off');
        message = '"Allow Write Operations" is off in the module settings';
      }
      const feature = state.features.find(f => f.id === SESSION_NOTES_FEATURE);
      if (!feature?.enabled) {
        waitingFor.push('feature-off');
        message ??= feature
          ? `The switch "${feature.name}" is off`
          : 'The module has no session notes switch (update the module)';
      }
      return message ? { waitingFor, message } : { waitingFor };
    } catch (error) {
      return { waitingFor: ['foundry'], message: messageOf(error) };
    }
  }

  /** Page uuids that have a reveal copy in "Handouts" (`gm/reveals.json`). */
  private async revealedSources(worldId: string): Promise<Set<string>> {
    const env = await this.store.read<{ pages?: Record<string, { copiedFrom?: string }> }>(
      worldId,
      'gm',
      REVEALS_FILE
    );
    const out = new Set<string>();
    for (const page of Object.values(env?.data?.pages ?? {})) {
      if (typeof page?.copiedFrom === 'string') out.add(page.copiedFrom);
    }
    return out;
  }

  private view(
    notes: StoredNotes,
    blockers: Blockers,
    revealed: Set<string> = new Set()
  ): NotesItem {
    const put = notes.put;
    return {
      sessionId: notes.sessionId,
      date: notes.date,
      title: notes.title,
      status: statusOf(notes),
      languages: notes.languages,
      pages: notes.pages.map(p => ({ key: p.key, title: p.title })),
      stagedAt: notes.stagedAt,
      ...(put
        ? {
            putAt: put.putAt,
            changeId: put.changeId,
            journalUuid: put.journalUuid,
            recapPageUuid: put.recapPageUuid,
          }
        : {}),
      ...(notes.approvedAt ? { approvedAt: notes.approvedAt } : {}),
      ...(notes.approvedBy ? { approvedBy: notes.approvedBy } : {}),
      recapRevealed: put ? revealed.has(put.recapPageUuid) : false,
      autoPut: notes.autoPut,
      waitingFor: put !== undefined || !notes.autoPut ? [] : blockers.waitingFor,
      ...(notes.lastError ? { lastError: notes.lastError } : {}),
    };
  }

  private async currentWorld(): Promise<string> {
    try {
      return await this.worldIds.current();
    } catch (error) {
      throw new SessionNotesError('not-connected', messageOf(error));
    }
  }

  private async worldFor(world: unknown): Promise<string> {
    if (world !== undefined && world !== null && world !== '') {
      if (!isValidWorldId(world)) throw bad('world is not a valid world id');
      return world;
    }
    if (this.foundry.isConnected()) return this.currentWorld();
    throw new SessionNotesError(
      'no-world',
      'Foundry is not connected, so the world is unknown: pass "world" or stage again later'
    );
  }

  private async load(worldId: string, sessionId: string): Promise<StoredNotes> {
    const env = await this.store.read<StoredNotes>(worldId, 'gm', fileFor(sessionId));
    if (!env) {
      throw new SessionNotesError('not-found', `No session notes ${sessionId} in this world`);
    }
    return env.data;
  }

  private async loadAll(worldId: string): Promise<StoredNotes[]> {
    const files = (await this.store.list(worldId, 'gm')).filter(
      f => f.startsWith(FILE_PREFIX) && f.endsWith('.json')
    );
    const out: StoredNotes[] = [];
    for (const file of files) {
      try {
        const env = await this.store.read<StoredNotes>(worldId, 'gm', file);
        if (env?.data?.sessionId) out.push(env.data);
      } catch (error) {
        this.logger.warn('Unreadable session notes file', { file, error: messageOf(error) });
      }
    }
    return out;
  }

  private async mutate(
    worldId: string,
    sessionId: string,
    fn: (notes: StoredNotes) => void
  ): Promise<StoredNotes> {
    const env = await this.store.update<StoredNotes>(
      worldId,
      'gm',
      fileFor(sessionId),
      1,
      current => {
        if (!current) {
          throw new SessionNotesError('not-found', `No session notes ${sessionId} in this world`);
        }
        const copy = structuredClone(current.data);
        fn(copy);
        return copy;
      }
    );
    return env.data;
  }
}
