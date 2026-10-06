/**
 * Export the bridge vault into the GM's Obsidian vault (docs/design/OBSIDIAN-PLAN.md,
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

import {
  PLAY_LOG_FILE,
  USAGE_CATALOG,
  USAGE_LOG_FILE_RE,
  isUsageName,
  type PlayRecord,
  type UsageEvent,
} from '@gnuminator/shared';

import { buildStats } from '../stats/build.js';
import type { StatsModel } from '../stats/types.js';
import { buildUsageModel } from '../stats/usage.js';
import type { AuditEntry, AuditLog } from '../vault/audit.js';
import type { VaultStore } from '../vault/store.js';

import { mergeChangeHistory, type ChangeEntry } from './audit-merge.js';
import { groupWithPlayRecords, type SessionEvent } from './grouping.js';
import { campaignDir, NoteWriter } from './note-writer.js';
import { baseOwnershipCheck, checkCanvasOwnership, checkMarkdownOwnership } from './ownership.js';
import { createPrepTemplates } from './prep-templates.js';
import { renderUsageNote, USAGE_NOTE_PATH } from './render-usage.js';
import { loadSessionNotesLinks, sessionNotesLines } from './session-notes-links.js';
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

/** Moved to `note-writer.ts` with `NoteWriter`; still exported from here. */
export { campaignDir };

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
  usageLogs: Map<string, { size: number; mtimeMs: number; events: UsageEvent[] }>;
  written: Map<string, string>;
}

export function newExportCache(): ExportCache {
  return { logs: new Map(), playLogs: new Map(), usageLogs: new Map(), written: new Map() };
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

const PREP_README = [
  '---',
  'type: readme',
  '---',
  '# Prep',
  '',
  'Your campaign notes: session plans, NPCs, locations, threads. The AI Tool never changes them.',
  '',
  '- **Templates** for an NPC, a location, a quest and a session plan are in `Templates/`. Point',
  "  Obsidian's Templates (or Templater) template folder at it, or copy one by hand.",
  '- **New prep note for this:** on a Foundry note (an NPC, a scene, a quest journal), the AI Tool',
  '  plugin makes a prep note from the matching template, with `fvtt_uuid` filled in and a link',
  '  back.',
  '- **What Claude reads:** when you ask Claude to prep, it reads the newest session plan and the',
  '  notes whose `fvtt_uuid` is the current scene, a creature on it or an open quest. Set',
  '  `ai_context: false` to keep a note out.',
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
      for (const item of cached.events) all.push(item);
      continue;
    }
    const events = (await store.readLines(worldId, 'sessions', file)) as SessionEvent[];
    cache.logs.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, events });
    for (const item of events) all.push(item);
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
      for (const item of cached.records) all.push(item);
      continue;
    }
    const records = (await store.readLines(worldId, 'sessions', file)).filter(isPlayRecordLike);
    cache.playLogs.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, records });
    for (const item of records) all.push(item);
  }
  return all;
}

function isUsageEventLike(value: unknown): value is UsageEvent {
  const e = value as Partial<UsageEvent> | null;
  return (
    !!e &&
    typeof e === 'object' &&
    typeof e.key === 'string' &&
    typeof e.t === 'number' &&
    Number.isFinite(e.t) &&
    isUsageName(e.name) &&
    typeof e.kind === 'string' &&
    typeof e.who === 'object' &&
    e.who !== null
  );
}

/** All usage events across every `<date>.usage.jsonl` file (I-084), cached like
 * {@link loadPlayRecords}. A line that does not look like a UsageEvent is dropped. */
async function loadUsageEvents(
  store: VaultStore,
  worldId: string,
  cache: ExportCache
): Promise<UsageEvent[]> {
  const files = (await store.list(worldId, 'sessions')).filter(f => USAGE_LOG_FILE_RE.test(f));
  const all: UsageEvent[] = [];
  for (const file of files) {
    const full = store.filePath(worldId, 'sessions', file);
    const stat = await fsp.stat(full).catch(() => null);
    if (!stat) continue;
    const cached = cache.usageLogs.get(file);
    if (cached && cached.size === stat.size && cached.mtimeMs === stat.mtimeMs) {
      for (const item of cached.events) all.push(item);
      continue;
    }
    const events = (await store.readLines(worldId, 'sessions', file)).filter(isUsageEventLike);
    cache.usageLogs.set(file, { size: stat.size, mtimeMs: stat.mtimeMs, events });
    for (const item of events) all.push(item);
  }
  return all;
}

/** A PC's stats-note file name, sanitized, with a uuid suffix only on a
 * collision (docs/design/OBSIDIAN-PLAN.md section 5: id suffix only on collision). */
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
  /** The MCP tool names, for the usage note's "tools never run" list (null/absent: left out). */
  toolNames?: readonly string[] | null;
}): Promise<ExportResult> {
  const { store, audit, worldId } = options;
  const cache = options.cache ?? newExportCache();
  const root = campaignDir(options.vaultDir, worldId);
  const writer = new NoteWriter(root, path.resolve(options.vaultDir), worldId, cache);

  await writer.createOnce('Home.md', renderCampaignHome(worldId));
  await writer.createOnce('Prep', null);
  await writer.createOnce('Prep/README.md', PREP_README);
  await createPrepTemplates(writer);

  // Sessions: group the union of session-log events and play records into
  // play sessions (shared contract 5), one note per group, sharing the exact
  // same grouping and numbering as the stats below.
  const events = await loadSessionEvents(store, worldId, cache);
  const playRecords = await loadPlayRecords(store, worldId, cache);
  const stats = buildStats({ worldId, logEvents: events, playRecords });
  const groups = groupWithPlayRecords(events, playRecords);
  const notesLinks = await loadSessionNotesLinks(store, worldId, root);
  const sessionNotes = new Set<string>();
  for (let i = 0; i < groups.length; i++) {
    const group = groups[i];
    const sessionStats = stats.sessions[i];
    if (!group || !sessionStats) continue;
    if (group.events.length === 0 && group.playRecords.length === 0) continue;
    const relPath = `AI Tool/Sessions/${sessionStats.label}.md`;
    sessionNotes.add(sessionStats.label);
    await writer.owned(
      relPath,
      renderSessionNote(
        worldId,
        { events: group.events, startedBy: group.startedBy, endedBy: group.endedBy },
        sessionStats,
        sessionNotesLines(notesLinks.filter(link => link.date === sessionStats.date))
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

  // Usage log (I-084): GM vault only, written only once the world has usage events.
  const usageEvents = await loadUsageEvents(store, worldId, cache);
  const hasUsage = usageEvents.length > 0;
  if (hasUsage) {
    const usageModel = buildUsageModel({
      events: usageEvents,
      catalog: USAGE_CATALOG,
      toolNames: options.toolNames ?? null,
      sessions: stats.sessions,
    });
    await writer.owned(
      USAGE_NOTE_PATH,
      renderUsageNote(worldId, usageModel),
      checkMarkdownOwnership
    );
  }

  // Stats (O3): campaign totals plus one note per PC, derived from the play
  // log (contract 5), never stored as truth (rebuilt from the logs every run).
  const pcFileNames = pcStatsFileNames(stats);
  const pcNotes = new Map(
    stats.pcs.map(pc => [pc.uuid, pcFileNames.get(pc.uuid) ?? safeFileName(pc.name)])
  );
  await writer.owned(
    'AI Tool/Stats/Campaign.md',
    renderCampaignStatsNote(worldId, stats, { usageNote: hasUsage, sessionNotes, pcNotes }),
    checkMarkdownOwnership
  );
  for (const pc of stats.pcs) {
    const name = pcNotes.get(pc.uuid) ?? safeFileName(pc.name);
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
