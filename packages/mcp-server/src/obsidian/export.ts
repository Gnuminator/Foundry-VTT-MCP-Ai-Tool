/**
 * Export the bridge vault into the GM's Obsidian vault (docs/OBSIDIAN-PLAN.md,
 * O1+O2).
 *
 * One way only: bridge vault -> Markdown/Canvas/Base. Ownership rules:
 *
 * - `Campaigns/<worldId>/AI Tool/` belongs to the exporter: its notes are
 *   rebuilt on every export (a note whose text did not change is left alone,
 *   and one the GM edited is skipped, both via `ownership.ts`).
 * - `Campaigns/<worldId>/Home.md` and `Prep/` are the GM's: created once if
 *   missing, never rewritten.
 * - Nothing outside `Campaigns/<worldId>/` is written. Writes are atomic
 *   (dot-prefixed temp file + rename, `atomic-write.ts`).
 * - A note this export no longer produces, but that is still ours (or a
 *   legacy O1 note), is moved to `.trash/` instead of deleted; an edited or
 *   foreign note is left in place. A failure writing one note is caught so
 *   the rest of the export still runs.
 *
 * Read-only on the bridge vault; the notes are GM-only (the Obsidian vault is
 * the GM's private note app, never a player-facing place).
 */
import { promises as fsp } from 'fs';
import * as path from 'path';

import { PLAY_LOG_FILE, type PlayRecord } from '@gnuminator/shared';

import { buildStats } from '../stats/build.js';
import type { StatsModel } from '../stats/types.js';
import type { AuditEntry, AuditLog } from '../vault/audit.js';
import type { VaultStore } from '../vault/store.js';

import { writeFileAtomic } from './atomic-write.js';
import { mergeChangeHistory, type ChangeEntry } from './audit-merge.js';
import { groupWithPlayRecords, type SessionEvent } from './grouping.js';
import {
  baseOwnershipCheck,
  checkCanvasOwnership,
  checkMarkdownOwnership,
  type OwnershipResult,
} from './ownership.js';
import {
  renderCampaignHome,
  renderCampaignStatsNote,
  renderChangesBase,
  renderChangesNote,
  renderPcStatsBase,
  renderPcStatsNote,
  renderSessionNote,
  renderSessionsBase,
  renderSpreadCanvas,
  renderStatusNote,
  renderTarokkaArchiveNote,
  renderTarokkaNote,
  renderTarokkaReadingsBase,
  safeFileName,
  type TarokkaLinks,
  type TarokkaReadingData,
} from './render.js';

const SESSION_FILE = /^(\d{4}-\d{2}-\d{2})\.jsonl$/;
const AUDIT_HISTORY_FILE = 'audit-log.jsonl';

/** Folders whose notes not produced this run are pruned to `.trash/` (item 9). */
const MANAGED_FOLDERS = [
  'AI Tool/Sessions',
  'AI Tool/Changes',
  'AI Tool/Tarokka/Archive',
  'AI Tool/Stats/PCs',
] as const;

/** Parsed session-log and play-log files reused across export calls, plus the
 * text last written per note path (contract 4). */
export interface ExportCache {
  logs: Map<string, { size: number; mtimeMs: number; events: SessionEvent[] }>;
  playLogs: Map<string, { size: number; mtimeMs: number; records: PlayRecord[] }>;
  written: Map<string, string>;
}

export function newExportCache(): ExportCache {
  return { logs: new Map(), playLogs: new Map(), written: new Map() };
}

export interface ExportResult {
  worldId: string;
  root: string;
  written: string[];
  unchanged: string[];
  created: string[];
  skipped: Array<{ path: string; reason: string }>;
  trashed: string[];
  errors: Array<{ path: string; error: string }>;
}

interface TarokkaFile {
  current?: TarokkaReadingData;
  archive?: Record<string, TarokkaReadingData>;
  revealJournal?: { uuid?: string };
}

interface TarokkaConfig {
  cardNames?: Record<string, string>;
  links?: Partial<Record<string, Record<string, TarokkaLinks>>>;
}

function isCompleteReading(value: unknown): value is TarokkaReadingData {
  const r = value as Partial<TarokkaReadingData> | undefined;
  return Boolean(r && typeof r.readingId === 'string' && r.positions);
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

function errorCode(error: unknown): string | undefined {
  return (error as NodeJS.ErrnoException | undefined)?.code;
}

/** Where a world's notes go: `<vaultDir>/Campaigns/<worldId>`. */
export function campaignDir(vaultDir: string, worldId: string): string {
  if (!/^[a-z0-9][a-z0-9_-]{0,63}$/i.test(worldId)) throw new Error(`Bad world id "${worldId}"`);
  return path.join(path.resolve(vaultDir), 'Campaigns', worldId);
}

/** Writes generated notes under one campaign folder, enforcing the ownership
 * rules and the path fence, and tracking what happened for `ExportResult`. */
class NoteWriter {
  readonly written: string[] = [];
  readonly unchanged: string[] = [];
  readonly created: string[] = [];
  readonly skipped: Array<{ path: string; reason: string }> = [];
  readonly trashed: string[] = [];
  readonly errors: Array<{ path: string; error: string }> = [];
  private readonly produced = new Set<string>();

  /** How many notes this export produced so far. */
  get producedCount(): number {
    return this.produced.size;
  }

  constructor(
    private readonly root: string,
    private readonly vaultDir: string,
    private readonly worldId: string,
    private readonly cache: ExportCache
  ) {}

  private resolve(relPath: string): string {
    const full = path.resolve(this.root, relPath);
    const rel = path.relative(this.root, full);
    if (rel.startsWith('..') || path.isAbsolute(rel)) {
      throw new Error(`Refusing to write outside ${this.root}: ${relPath}`);
    }
    return full;
  }

  /** Write a note the exporter owns: skipped when an existing file fails the
   * ownership check, otherwise written (or left alone when unchanged). */
  async owned(
    relPath: string,
    text: string,
    check: (existingText: string) => OwnershipResult
  ): Promise<void> {
    try {
      const full = this.resolve(relPath);
      this.produced.add(relPath);
      if (this.cache.written.get(relPath) === text) {
        this.unchanged.push(relPath);
        return;
      }
      const current = await fsp.readFile(full, 'utf8').catch(error => {
        if (errorCode(error) === 'ENOENT') return null;
        throw error;
      });
      let same = current === text;
      if (current !== null) {
        const result = check(current);
        if (!result.owned) {
          this.skipped.push({ path: relPath, reason: result.reason });
          return;
        }
        same ||= result.same === true;
      }
      if (same) {
        this.unchanged.push(relPath);
        this.cache.written.set(relPath, text);
        return;
      }
      await writeFileAtomic(full, text);
      this.written.push(relPath);
      this.cache.written.set(relPath, text);
    } catch (error) {
      this.errors.push({ path: relPath, error: errorMessage(error) });
    }
  }

  /** Create a GM-owned file or folder once; never touch it again. */
  async createOnce(relPath: string, text: string | null): Promise<void> {
    try {
      const full = this.resolve(relPath);
      const exists = await fsp.stat(full).then(
        () => true,
        () => false
      );
      if (exists) return;
      if (text === null) {
        await fsp.mkdir(full, { recursive: true });
      } else {
        await fsp.mkdir(path.dirname(full), { recursive: true });
        await fsp.writeFile(full, text, { encoding: 'utf8', flag: 'wx' });
      }
      this.created.push(relPath);
    } catch (error) {
      this.errors.push({ path: relPath, error: errorMessage(error) });
    }
  }

  /** A managed folder's notes not produced this run: moved to `.trash/` when
   * still ours (or legacy), left in place (and listed as skipped) otherwise. */
  async pruneManaged(
    folder: string,
    check: (existingText: string) => OwnershipResult
  ): Promise<void> {
    const dirFull = this.resolve(folder);
    let names: string[];
    try {
      names = await fsp.readdir(dirFull);
    } catch (error) {
      if (errorCode(error) === 'ENOENT') return;
      this.errors.push({ path: folder, error: errorMessage(error) });
      return;
    }
    for (const name of names) {
      const relPath = `${folder}/${name}`;
      if (this.produced.has(relPath)) continue;
      try {
        const full = this.resolve(relPath);
        const stat = await fsp.stat(full);
        if (!stat.isFile()) continue;
        const text = await fsp.readFile(full, 'utf8');
        const result = check(text);
        if (!result.owned) {
          this.skipped.push({ path: relPath, reason: result.reason });
          continue;
        }
        await this.moveToTrash(relPath);
      } catch (error) {
        this.errors.push({ path: relPath, error: errorMessage(error) });
      }
    }
  }

  private async moveToTrash(relPath: string): Promise<void> {
    const source = this.resolve(relPath);
    const targetBase = path.join(this.vaultDir, '.trash', 'Campaigns', this.worldId, relPath);
    await fsp.mkdir(path.dirname(targetBase), { recursive: true });
    const ext = path.extname(targetBase);
    const stem = targetBase.slice(0, targetBase.length - ext.length);
    let target = targetBase;
    for (
      let n = 1;
      await fsp.stat(target).then(
        () => true,
        () => false
      );
      n++
    ) {
      target = `${stem} ${n}${ext}`;
    }
    await fsp.rename(source, target);
    this.trashed.push(relPath);
  }
}

const PREP_README = [
  '---',
  'type: readme',
  '---',
  '# Prep',
  '',
  'Your campaign notes: session plans, NPCs, locations, threads. The AI Tool never writes here.',
  '',
].join('\n');

/** All session-log events across every dated file, using the cache when a
 * file's size and mtime are unchanged. */
async function loadSessionEvents(
  store: VaultStore,
  worldId: string,
  cache: ExportCache
): Promise<SessionEvent[]> {
  const files = (await store.list(worldId, 'sessions')).filter(f => SESSION_FILE.test(f));
  const all: SessionEvent[] = [];
  for (const file of files) {
    const full = store.filePath(worldId, 'sessions', file);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;
    const cached = cache.logs.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      all.push(...cached.events);
      continue;
    }
    const events = (await store.readLines(worldId, 'sessions', file)) as SessionEvent[];
    cache.logs.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, events });
    all.push(...events);
  }
  return all;
}

function isPlayRecordLike(value: unknown): value is PlayRecord {
  const r = value as Partial<PlayRecord> | null;
  return (
    !!r &&
    typeof r === 'object' &&
    typeof r.key === 'string' &&
    typeof r.t === 'number' &&
    Number.isFinite(r.t) &&
    typeof r.kind === 'string'
  );
}

/** All play records across every `<date>.play.jsonl` file (contract 3),
 * cached like {@link loadSessionEvents}. A line that does not look like a
 * PlayRecord is dropped, never thrown. */
async function loadPlayRecords(
  store: VaultStore,
  worldId: string,
  cache: ExportCache
): Promise<PlayRecord[]> {
  const files = (await store.list(worldId, 'sessions')).filter(f => PLAY_LOG_FILE.test(f));
  const all: PlayRecord[] = [];
  for (const file of files) {
    const full = store.filePath(worldId, 'sessions', file);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;
    const cached = cache.playLogs.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      all.push(...cached.records);
      continue;
    }
    const records = (await store.readLines(worldId, 'sessions', file)).filter(isPlayRecordLike);
    cache.playLogs.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, records });
    all.push(...records);
  }
  return all;
}

/** A PC's stats-note file name, sanitized, with a uuid suffix only on a
 * collision (docs/OBSIDIAN-PLAN.md section 5: id suffix only on collision). */
function pcStatsFileNames(stats: StatsModel): Map<string, string> {
  const used = new Set<string>();
  const names = new Map<string, string>();
  for (const pc of stats.pcs) {
    const base = safeFileName(pc.name);
    const name = used.has(base) ? `${base} (${pc.uuid.slice(-6)})` : base;
    used.add(name);
    names.set(pc.uuid, name);
  }
  return names;
}

/** Render one world's bridge vault into `<vaultDir>/Campaigns/<worldId>/`. */
export async function exportWorldToObsidian(options: {
  store: VaultStore;
  audit: Pick<AuditLog, 'list'>;
  worldId: string;
  vaultDir: string;
  cache?: ExportCache;
}): Promise<ExportResult> {
  const { store, audit, worldId } = options;
  const cache = options.cache ?? newExportCache();
  const root = campaignDir(options.vaultDir, worldId);
  const writer = new NoteWriter(root, path.resolve(options.vaultDir), worldId, cache);

  await writer.createOnce('Home.md', renderCampaignHome(worldId));
  await writer.createOnce('Prep', null);
  await writer.createOnce('Prep/README.md', PREP_README);

  // Sessions: group the union of session-log events and play records into
  // play sessions (shared contract 5), one note per group, sharing the exact
  // same grouping and numbering as the stats below.
  const events = await loadSessionEvents(store, worldId, cache);
  const playRecords = await loadPlayRecords(store, worldId, cache);
  const stats = buildStats({ worldId, logEvents: events, playRecords });
  const groups = groupWithPlayRecords(events, playRecords);
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const sessionStats = stats.sessions[i];
    if (!group || !sessionStats) continue;
    if (group.events.length === 0 && group.playRecords.length === 0) continue;
    const relPath = `AI Tool/Sessions/${sessionStats.label}.md`;
    await writer.owned(
      relPath,
      renderSessionNote(
        worldId,
        { events: group.events, startedBy: group.startedBy, endedBy: group.endedBy },
        sessionStats
      ),
      checkMarkdownOwnership
    );
  }

  // Change log: merge the append-only history with the audit ring, one note
  // per month.
  const ring: AuditEntry[] = await audit.list(worldId, 500);
  const jsonl = await store.readLines(worldId, 'gm', AUDIT_HISTORY_FILE);
  const merged = mergeChangeHistory(ring, jsonl);
  const byMonth = new Map<string, ChangeEntry[]>();
  for (const e of merged) {
    const month = e.appliedAt.slice(0, 7);
    const list = byMonth.get(month) ?? [];
    list.push(e);
    byMonth.set(month, list);
  }
  for (const [month, list] of byMonth) {
    await writer.owned(
      `AI Tool/Changes/${month}.md`,
      renderChangesNote(worldId, month, list),
      checkMarkdownOwnership
    );
  }

  // Tarokka (only when the world has used it).
  const tarokka = (await store.read<TarokkaFile>(worldId, 'gm', 'tarokka.json'))?.data;
  if (tarokka) {
    const config = (await store.read<TarokkaConfig>(worldId, 'gm', 'tarokka-config.json'))?.data;
    const reading = isCompleteReading(tarokka.current) ? tarokka.current : null;
    const archiveIds = Object.entries(tarokka.archive ?? {})
      .filter(([, value]) => isCompleteReading(value))
      .map(([id]) => id)
      .sort();
    await writer.owned(
      'AI Tool/Tarokka/Current reading.md',
      renderTarokkaNote(worldId, reading, {
        ...(config?.links ? { links: config.links } : {}),
        ...(config?.cardNames ? { cardNames: config.cardNames } : {}),
        archived: archiveIds,
        revealJournalUuid: tarokka.revealJournal?.uuid ?? null,
      }),
      checkMarkdownOwnership
    );
    for (const id of archiveIds) {
      const archived = tarokka.archive?.[id];
      if (!isCompleteReading(archived)) continue;
      await writer.owned(
        `AI Tool/Tarokka/Archive/${safeFileName(id)}.md`,
        renderTarokkaArchiveNote(worldId, archived, {
          ...(config?.links ? { links: config.links } : {}),
          ...(config?.cardNames ? { cardNames: config.cardNames } : {}),
        }),
        checkMarkdownOwnership
      );
    }
    await writer.owned(
      'AI Tool/Tarokka/Spread.canvas',
      renderSpreadCanvas(reading, config?.cardNames ?? {}),
      checkCanvasOwnership
    );
  }

  // Stats (O3): campaign totals plus one note per PC, derived from the play
  // log (contract 5), never stored as truth (rebuilt from the logs every run).
  await writer.owned(
    'AI Tool/Stats/Campaign.md',
    renderCampaignStatsNote(worldId, stats),
    checkMarkdownOwnership
  );
  const pcFileNames = pcStatsFileNames(stats);
  for (const pc of stats.pcs) {
    const name = pcFileNames.get(pc.uuid) ?? safeFileName(pc.name);
    await writer.owned(
      `AI Tool/Stats/PCs/${name}.md`,
      renderPcStatsNote(worldId, pc),
      checkMarkdownOwnership
    );
  }

  // Bases: a fixed set, compared by content (Obsidian re-saves them).
  const bases: Array<[string, string]> = [
    ['Sessions.base', renderSessionsBase(worldId)],
    ['Changes.base', renderChangesBase(worldId)],
    ['Tarokka readings.base', renderTarokkaReadingsBase(worldId)],
    ['PC stats.base', renderPcStatsBase(worldId)],
  ];
  for (const [file, text] of bases) {
    await writer.owned(`AI Tool/Bases/${file}`, text, baseOwnershipCheck(text));
  }

  // Prune managed folders: a note we no longer produce, but that is still
  // ours (or legacy O1), moves to .trash/ instead of being deleted.
  for (const folder of MANAGED_FOLDERS) {
    await writer.pruneManaged(folder, checkMarkdownOwnership);
  }

  // Status, written last, summarizing everything above (not itself).
  await writer.owned(
    'AI Tool/_status.md',
    renderStatusNote(worldId, {
      notesManaged: writer.producedCount,
      skipped: [...writer.skipped],
      errors: [...writer.errors],
    }),
    checkMarkdownOwnership
  );

  return {
    worldId,
    root,
    written: writer.written,
    unchanged: writer.unchanged,
    created: writer.created,
    skipped: writer.skipped,
    trashed: writer.trashed,
    errors: writer.errors,
  };
}
