/**
 * Backend change-journal pump (I-109 part 2).
 *
 * The Foundry module's change journal (`shared/src/change-journal.ts`) keeps the
 * newest 5000 `ChangeRecord`s per GM browser page load, lost on reload. The
 * backend polls it (`foundry-mcp-bridge.getChangeJournal`) and appends every
 * record to the GM vault, one JSON line per record, in
 * `<dataDir>/<worldId>/gm/changes-<local-date>.jsonl` (local date of the
 * record's `t`; the vault keeps one flat folder per area, so the date is part of
 * the file name). Only the GM side reads these: they hold every player's
 * changes with the values before and after.
 *
 * Cursor, reload detection, the ring-wrap loss log and the dedupe by `key` work
 * exactly as in `play-log-pump.ts`: the state `{ clientId, lastSeq }` is kept per
 * world in `gm/changes-pump-state.json`; a new `clientId` means the module
 * reloaded and the pump re-asks from `sinceSeq: 0`. The one difference is the
 * page size: the module answers at most `CHANGE_JOURNAL_MAX_LIMIT` (500) records
 * per call, so the pump asks again from the last record it got until a page
 * comes back short, and the cursor follows the last record read, not the
 * module's `latestSeq`.
 *
 * `pullNow()` lets a reader fetch the newest records first (single-flight, shared
 * with the timer's poll). After every non-empty append `onAppended` gets the
 * records that were written, so the history index (`change-history.ts`) stays
 * current without re-reading the files.
 *
 * Retention: once a day (and on the first poll) the pump removes journal files older
 * than `CHANGE_JOURNAL_RETENTION_DAYS` (the span the history index lists) and, while
 * the files still hold more than `maxBytes` in all, the oldest ones (never the newest).
 * Records can be 256 KB each, and the Pi's vault is an SD card. The day after the newest
 * removed file is kept in the state file as `historyFrom`: the history is complete from
 * that day on (`historyStart`), and the undo planner refuses a rewind that reaches back
 * before it. Records older than it are not written again (a re-pull from seq 0 after a GM
 * browser reload would otherwise recreate a removed file). A file that cannot be removed
 * (a Windows lock) is retried after `RETENTION_RETRY_MS`, the others are still removed.
 * A day's file that an append takes over `maxBytes` keeps its newest half (`capDays`),
 * `completeFrom` moves past the records it lost, as for lost records below, and the actions
 * the cut went through are kept as `cutActions`, which the history leaves out whole.
 *
 * Lost records: when the buffer no longer holds the record after the one the pump asked for
 * (the ring wrapped before the pump read it, on any page; or, after a reload or on first
 * contact, before the pump ever saw the new buffer), the "records lost" warning is logged and
 * the state keeps `completeFrom`, the time of the oldest record the buffer still held;
 * `historyStart` moves up to it, so a rewind across the gap is refused instead of skipping
 * changes without a word. Known gaps it cannot see: a GM browser reload while the bridge was
 * down loses the old page's unread records with no trace (the new `clientId` is also what a
 * plain reload looks like), and nothing is recorded while the journal is off.
 *
 * On by default; `FOUNDRY_AI_CHANGE_JOURNAL=off` disables it. The poll interval is
 * `FOUNDRY_AI_EVENT_POLL_MS`, shared with the event pump; the byte cap is
 * `FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB` (default 64).
 */
import { promises as fsp } from 'fs';

import {
  CHANGE_JOURNAL_MAX_LIMIT,
  CHANGE_JOURNAL_VERSION,
  type ChangeJournalResponse,
  type ChangeRecord,
} from '@gnuminator/shared';

import { DEFAULT_EVENT_POLL_MS, localDateKey } from './event-pump.js';
import type { FoundryClient } from './foundry-client.js';
import type { Logger } from './logger.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

export const CHANGE_PUMP_STATE_FILE = 'changes-pump-state.json';
/** Pages one poll may read: the module buffer holds 5000 records, so 10 pages is everything. */
const MAX_PAGES = 20;
/** Days of journal files kept; the history index (`change-history.ts`) lists the same span. */
export const CHANGE_JOURNAL_RETENTION_DAYS = 7;
/** Default cap on the journal files' total size (`FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB`). */
export const DEFAULT_CHANGE_JOURNAL_MAX_BYTES = 64 * 1024 * 1024;
/** How long after a failed file removal the retention run is tried again. */
export const RETENTION_RETRY_MS = 10 * 60 * 1000;
/** Most action ids `cutActions` keeps (the newest); a cut adds a few. */
export const MAX_CUT_ACTIONS = 200;
/** A temp file of a day's rewrite older than this was left by a crash. */
const STALE_TEMP_MS = 10 * 60 * 1000;

const JOURNAL_FILE = /^changes-(\d{4}-\d{2}-\d{2})\.jsonl$/;

/** Local midnight of a `YYYY-MM-DD` date key, as epoch ms (NaN for anything else). */
export function dateKeyStart(dateKey: string): number {
  const m = /^(\d{4})-(\d{2})-(\d{2})$/.exec(dateKey);
  if (!m) return Number.NaN;
  return new Date(Number(m[1]), Number(m[2]) - 1, Number(m[3])).getTime();
}

/** The date key of the local day after `dateKey` (noon-based, so a DST shift never skips a date). */
function nextDateKey(dateKey: string): string {
  const d = new Date(dateKeyStart(dateKey));
  return localDateKey(new Date(d.getFullYear(), d.getMonth(), d.getDate() + 1, 12).getTime());
}

/** The vault file of one local day's records (area `gm`). */
export function changeJournalFileName(dateKey: string): string {
  return `changes-${dateKey}.jsonl`;
}

/** The date key of a journal file name, or null for any other file. */
export function changeJournalDateOf(file: string): string | null {
  return JOURNAL_FILE.exec(file)?.[1] ?? null;
}

interface ChangePumpState {
  /** The module page load whose buffer `lastSeq` refers to; null before the first poll. */
  clientId: string | null;
  /** The sequence number of the last record the pump has read. */
  lastSeq: number;
  /**
   * The local date (`YYYY-MM-DD`) from which the kept files are complete: the day after the
   * newest file retention removed. Absent until a file was removed.
   */
  historyFrom?: string;
  /**
   * Epoch ms from which the records are complete after the module's ring buffer wrapped before
   * the pump read it: the time of the oldest record the buffer still held (the lost ones came
   * before it). Absent until records were lost. `historyStart` takes the later of the two.
   */
  completeFrom?: number;
  /**
   * Epoch ms after the newest record a day's cap (`capDays`) removed: a record older than it
   * is never written again (after a restart only the file's keys say what was written).
   */
  cappedBefore?: number;
  /**
   * The actions a day's cap cut through (some records removed, some kept, or the newest removed
   * one, which may still be running): the history leaves their other records out, so no part of
   * an action is ever undone on its own. The newest MAX_CUT_ACTIONS.
   */
  cutActions?: string[];
}

interface PumpState extends ChangePumpState {
  worldId: string;
}

export interface ChangeJournalPumpOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  logger: Logger;
  intervalMs?: number;
  /** Most bytes the journal files may hold in all (default DEFAULT_CHANGE_JOURNAL_MAX_BYTES). */
  maxBytes?: number;
  /**
   * Called after a successful non-empty append, with the records written (grouped by
   * date, in pump order). A throwing listener is caught and logged; it never breaks
   * the pump.
   */
  onAppended?: (worldId: string, records: ChangeRecord[]) => void;
  now?: () => number;
}

/** Whether the pump is on, its interval and its byte cap, from the environment. */
export function changeJournalSettings(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  intervalMs: number;
  maxBytes: number;
} {
  const enabled = !/^(off|false|0|no)$/i.test(env.FOUNDRY_AI_CHANGE_JOURNAL?.trim() ?? '');
  const parsed = Number.parseInt(env.FOUNDRY_AI_EVENT_POLL_MS ?? '', 10);
  const intervalMs = Number.isFinite(parsed) ? Math.max(1000, parsed) : DEFAULT_EVENT_POLL_MS;
  const mb = Number.parseFloat(env.FOUNDRY_AI_CHANGE_JOURNAL_MAX_MB ?? '');
  const maxBytes =
    Number.isFinite(mb) && mb > 0 ? Math.round(mb * 1024 * 1024) : DEFAULT_CHANGE_JOURNAL_MAX_BYTES;
  return { enabled, intervalMs, maxBytes };
}

const OPS: readonly unknown[] = ['create', 'update', 'delete'];

/** The fields the history index relies on; anything else is dropped. */
export function isChangeRecord(value: unknown): value is ChangeRecord {
  const r = value as Partial<ChangeRecord> | null;
  return (
    !!r &&
    r.v === CHANGE_JOURNAL_VERSION &&
    typeof r.key === 'string' &&
    typeof r.seq === 'number' &&
    typeof r.t === 'number' &&
    Number.isFinite(r.t) &&
    typeof r.actionId === 'string' &&
    OPS.includes(r.op) &&
    typeof r.uuid === 'string' &&
    typeof r.rootUuid === 'string'
  );
}

export class ChangeJournalPump {
  private readonly foundry: ChangeJournalPumpOptions['foundryClient'];
  private readonly worldIds: ChangeJournalPumpOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly maxBytes: number;
  private readonly onAppended: ChangeJournalPumpOptions['onAppended'];
  private readonly now: () => number;
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<number> | null = null;
  private state: PumpState | null = null;
  /** Keys already on disk for `<worldId>::<dateKey>`, read from the file once per process. */
  private readonly writtenKeys = new Map<string, Set<string>>();
  private lastError: string | null = null;
  /** The world and local day of the last complete retention run (one run per day). */
  private lastRetention: { worldId: string; dateKey: string } | null = null;
  /** Set after a failed removal: no retention run before this time. */
  private retentionRetryAt = 0;

  constructor(options: ChangeJournalPumpOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.logger = options.logger.child({ component: 'ChangeJournalPump' });
    this.intervalMs = options.intervalMs ?? DEFAULT_EVENT_POLL_MS;
    this.maxBytes = options.maxBytes ?? DEFAULT_CHANGE_JOURNAL_MAX_BYTES;
    this.onAppended = options.onAppended;
    this.now = options.now ?? ((): number => Date.now());
  }

  start(): void {
    if (this.timer) return;
    this.timer = setInterval(() => void this.pollOnce(), this.intervalMs);
    this.timer.unref?.();
  }

  stop(): void {
    if (this.timer) clearInterval(this.timer);
    this.timer = null;
  }

  /**
   * Fetch new records and append them. Resolves to the number written; never
   * rejects (a failure is logged once until it recovers).
   */
  pollOnce(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    const run = this.poll()
      .then(written => {
        if (this.lastError) this.logger.info('Change journal recovered');
        this.lastError = null;
        return written;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.lastError) {
          this.logger.warn('Change journal poll failed', { error: message });
        }
        this.lastError = message;
        return 0;
      })
      .finally(() => {
        this.inFlight = null;
      });
    this.inFlight = run;
    return run;
  }

  /**
   * Pull now so a reader sees the newest records. Callers that arrive while a pull is
   * running share it. A no-op while Foundry is not connected; rejects when the pull
   * failed (the records already on disk are still good).
   */
  async pullNow(): Promise<void> {
    await this.pollOnce();
    if (this.lastError) throw new Error(this.lastError);
  }

  /**
   * Epoch ms from which the kept records are complete: local midnight of the first day whose
   * journal file retention left whole, or the time the records were complete from again after
   * the module's buffer wrapped, whichever is later; 0 when neither has happened to this world.
   * The history index and the undo planner treat anything before it as unknown.
   */
  async historyStart(worldId: string): Promise<number> {
    const state = await this.loadState(worldId);
    const fromFiles = state.historyFrom ? dateKeyStart(state.historyFrom) : 0;
    return Math.max(Number.isFinite(fromFiles) ? fromFiles : 0, state.completeFrom ?? 0);
  }

  /** The actions a day's cap cut through (`cutActions`): the history leaves them out. */
  async cutActions(worldId: string): Promise<ReadonlySet<string>> {
    return new Set((await this.loadState(worldId)).cutActions ?? []);
  }

  private async poll(): Promise<number> {
    if (!this.foundry.isConnected()) return 0;
    const worldId = await this.worldIds.current();
    const state = await this.loadState(worldId);
    let written = 0;
    const appended: ChangeRecord[] = [];

    // Pages of at most CHANGE_JOURNAL_MAX_LIMIT records, until one comes back short.
    let sinceSeq = state.lastSeq;
    let restarted = false;
    let lost = false;
    for (let page = 0; page < MAX_PAGES; page++) {
      let response = await this.fetchPage(sinceSeq);
      if (state.clientId !== null && response.clientId !== state.clientId) {
        // A second reload during one poll: the next poll picks it up.
        if (restarted) break;
        restarted = true;
        // The buffer's seq numbering restarted at 1; the cursor we just asked
        // for meant nothing to it. Re-ask for everything it still has.
        state.clientId = response.clientId;
        sinceSeq = 0;
        response = await this.fetchPage(0);
      }
      // The buffer no longer holds the record after the one asked for: records were lost (the
      // ring wrapped before the pump read them, on any page; after a reload or on first contact,
      // before the pump ever saw the new buffer). The lost records all came before the oldest
      // one the buffer still holds (its records are in order of their seq), so the history is
      // complete again from that record's time.
      if (response.oldestSeq > sinceSeq + 1) {
        const oldest = Array.isArray(response.records) ? response.records[0] : undefined;
        const oldestT = (oldest as { t?: unknown } | undefined)?.t;
        const completeFrom = typeof oldestT === 'number' && oldestT > 0 ? oldestT : this.now();
        if (completeFrom > (state.completeFrom ?? 0)) {
          state.completeFrom = completeFrom;
          lost = true;
        }
        this.logger.warn(
          'Change journal records lost: the ring buffer wrapped before the pump read them',
          {
            worldId,
            clientId: response.clientId,
            expectedFrom: sinceSeq + 1,
            oldestSeq: response.oldestSeq,
            completeFrom: new Date(completeFrom).toISOString(),
          }
        );
      }

      const rawRecords = Array.isArray(response.records) ? response.records : [];
      const valid: ChangeRecord[] = [];
      let invalid = 0;
      for (const candidate of rawRecords) {
        if (isChangeRecord(candidate)) valid.push(candidate);
        else invalid += 1;
      }
      if (invalid > 0) {
        this.logger.warn('Change journal dropped invalid records', { worldId, count: invalid });
      }

      const batch = await this.appendByDate(worldId, valid, state.historyFrom, state.cappedBefore);
      written += batch.length;
      appended.push(...batch);
      // A day's file over the cap keeps its newest half; the history is complete after the rest.
      if (await this.capDays(worldId, batch, state)) lost = true;

      // The cursor follows the last record of the page; a short page is the end.
      const lastRead = rawRecords.reduce<number>(
        (max, r) => (typeof r?.seq === 'number' && r.seq > max ? r.seq : max),
        sinceSeq
      );
      const caughtUp = rawRecords.length < CHANGE_JOURNAL_MAX_LIMIT;
      const newSeq = caughtUp ? Math.max(lastRead, response.latestSeq) : lastRead;
      const changed = lost || state.clientId !== response.clientId || state.lastSeq !== newSeq;
      lost = false;
      state.clientId = response.clientId;
      state.lastSeq = newSeq;
      sinceSeq = newSeq;
      if (changed) await this.saveState(worldId);
      if (caughtUp) break;
    }

    if (appended.length > 0) this.notifyAppended(worldId, appended);
    await this.retain(worldId);
    return written;
  }

  /**
   * Remove journal files older than the retention span and, while the rest hold more than
   * `maxBytes`, the oldest ones (the newest file always stays). Runs once per local day; a
   * failure is logged and never fails the poll (the records were already written). A file
   * that could not be removed is tried again after RETENTION_RETRY_MS.
   */
  private async retain(worldId: string): Promise<void> {
    const now = this.now();
    const today = localDateKey(now);
    if (this.lastRetention?.worldId === worldId && this.lastRetention.dateKey === today) return;
    if (now < this.retentionRetryAt) return;
    this.lastRetention = { worldId, dateKey: today };
    try {
      // A crash during a day's cap leaves its temp file (up to half the cap) behind.
      const temps = await this.store.removeStaleTemps(worldId, 'gm', 'changes-', STALE_TEMP_MS);
      if (temps.length > 0) {
        this.logger.info('Change journal temp files removed', { worldId, files: temps });
      }
      const { removed, failed } = await this.removeOldFiles(worldId);
      if (removed.length > 0) {
        this.logger.info('Change journal files removed', { worldId, files: removed });
      }
      if (failed.length > 0) {
        this.lastRetention = null;
        this.retentionRetryAt = now + RETENTION_RETRY_MS;
        this.logger.warn('Change journal files could not be removed; retrying later', {
          worldId,
          files: failed,
        });
      }
    } catch (error) {
      this.logger.warn('Change journal retention failed', {
        worldId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async removeOldFiles(worldId: string): Promise<{ removed: string[]; failed: string[] }> {
    const now = new Date(this.now());
    // Noon, so a daylight-saving shift never moves the date.
    const oldestKept = localDateKey(
      new Date(
        now.getFullYear(),
        now.getMonth(),
        now.getDate() - CHANGE_JOURNAL_RETENTION_DAYS,
        12
      ).getTime()
    );
    // `list` sorts by name, and the names sort by date.
    const files = (await this.store.list(worldId, 'gm'))
      .map(file => ({ file, date: changeJournalDateOf(file) }))
      .filter((f): f is { file: string; date: string } => f.date !== null);
    const sizes = new Map<string, number>();
    for (const { file } of files) {
      try {
        sizes.set(file, (await fsp.stat(this.store.filePath(worldId, 'gm', file))).size);
      } catch {
        sizes.set(file, 0);
      }
    }
    let total = [...sizes.values()].reduce((sum, n) => sum + n, 0);
    const removed: string[] = [];
    const failed: string[] = [];
    const state = await this.loadState(worldId);
    let historyFrom = state.historyFrom;
    for (let i = 0; i < files.length; i += 1) {
      const { file, date } = files[i];
      const last = i === files.length - 1;
      const tooOld = date < oldestKept;
      const tooBig = total > this.maxBytes && !last;
      if (!tooOld && !tooBig) continue;
      try {
        await this.store.remove(worldId, 'gm', file);
      } catch (error) {
        failed.push(`${file}: ${error instanceof Error ? error.message : String(error)}`);
        continue;
      }
      this.writtenKeys.delete(`${worldId}::${date}`);
      total -= sizes.get(file) ?? 0;
      removed.push(file);
      const from = nextDateKey(date);
      if (!historyFrom || from > historyFrom) historyFrom = from;
    }
    if (historyFrom && historyFrom !== state.historyFrom) {
      state.historyFrom = historyFrom;
      await this.saveState(worldId);
    }
    return { removed, failed };
  }

  private async fetchPage(sinceSeq: number): Promise<ChangeJournalResponse> {
    const response = (await this.foundry.query('foundry-mcp-bridge.getChangeJournal', {
      sinceSeq,
      limit: CHANGE_JOURNAL_MAX_LIMIT,
    })) as ChangeJournalResponse;
    if (response?.success === false) {
      throw new Error(response.error ?? 'getChangeJournal refused');
    }
    return response;
  }

  /**
   * Group by local date, drop duplicate keys (against the file and within the batch) and records
   * of days before `historyFrom` (their file was removed; writing them again would recreate a
   * part of it) or from before `cappedBefore` (a day's cap removed them; written again at the
   * end of the file, the next cut would keep them and drop newer ones), append.
   */
  private async appendByDate(
    worldId: string,
    records: ChangeRecord[],
    historyFrom?: string,
    cappedBefore?: number
  ): Promise<ChangeRecord[]> {
    const byDate = new Map<string, ChangeRecord[]>();
    let skipped = 0;
    for (const record of records) {
      const date = localDateKey(record.t);
      const removedDay = historyFrom !== undefined && date < historyFrom;
      const capped = cappedBefore !== undefined && record.t < cappedBefore;
      if (removedDay || capped) {
        skipped += 1;
        continue;
      }
      byDate.set(date, [...(byDate.get(date) ?? []), record]);
    }
    if (skipped > 0) {
      this.logger.info('Change journal skipped records it had removed', {
        worldId,
        count: skipped,
        historyFrom,
        ...(cappedBefore ? { cappedBefore: new Date(cappedBefore).toISOString() } : {}),
      });
    }

    const written: ChangeRecord[] = [];
    for (const [date, batch] of byDate) {
      const keys = await this.loadWrittenKeys(worldId, date);
      const seen = new Set<string>();
      const toAppend: ChangeRecord[] = [];
      for (const record of batch) {
        if (keys.has(record.key) || seen.has(record.key)) continue;
        seen.add(record.key);
        toAppend.push(record);
      }
      if (toAppend.length === 0) continue;
      await this.store.appendLines(worldId, 'gm', changeJournalFileName(date), toAppend);
      // Only mark these as written once the append has actually landed.
      for (const key of seen) keys.add(key);
      written.push(...toAppend);
    }
    return written;
  }

  /**
   * The files the batch was written to that now hold more than `maxBytes` keep their newest
   * half (a heavy day: a world import, a bulk delete with every document's data; retention
   * never removes the newest file). The state's `completeFrom` and `cappedBefore` move past
   * the newest record left out and `cutActions` takes the actions the cut went through; the
   * state is saved before the new file replaces the old one, and put back when that fails (the
   * records are then still there). Returns whether a file was cut. The keys stay in
   * `writtenKeys`, so a re-pull does not write those records again.
   */
  private async capDays(
    worldId: string,
    batch: ChangeRecord[],
    state: PumpState
  ): Promise<boolean> {
    let cut = false;
    for (const date of new Set(batch.map(r => localDateKey(r.t)))) {
      const file = changeJournalFileName(date);
      let size: number;
      try {
        size = (await fsp.stat(this.store.filePath(worldId, 'gm', file))).size;
      } catch {
        continue;
      }
      if (size <= this.maxBytes) continue;
      let from = 0;
      let newest: string | null = null;
      const droppedIds = new Set<string>();
      const through = new Set<string>();
      const before: Pick<ChangePumpState, 'completeFrom' | 'cappedBefore' | 'cutActions'> = {
        ...(state.completeFrom ? { completeFrom: state.completeFrom } : {}),
        ...(state.cappedBefore ? { cappedBefore: state.cappedBefore } : {}),
        ...(state.cutActions ? { cutActions: state.cutActions } : {}),
      };
      try {
        const dropped = await this.store.keepLastLines(
          worldId,
          'gm',
          file,
          Math.floor(this.maxBytes / 2),
          {
            onDropped: value => {
              const r = value as { t?: unknown; actionId?: unknown } | null;
              if (typeof r?.t === 'number' && r.t + 1 > from) from = r.t + 1;
              if (typeof r?.actionId === 'string') {
                droppedIds.add(r.actionId);
                newest = r.actionId;
              }
            },
            onKept: value => {
              const id = (value as { actionId?: unknown } | null)?.actionId;
              if (typeof id === 'string' && droppedIds.has(id)) through.add(id);
            },
            beforeRename: async () => {
              if (newest) through.add(newest);
              if (from > (state.completeFrom ?? 0)) state.completeFrom = from;
              if (from > (state.cappedBefore ?? 0)) state.cappedBefore = from;
              const ids = [...(state.cutActions ?? []).filter(id => !through.has(id)), ...through];
              if (ids.length > 0) state.cutActions = ids.slice(-MAX_CUT_ACTIONS);
              await this.saveState(worldId);
            },
          }
        );
        cut = true;
        this.logger.warn('Change journal day over the size cap: its oldest records were removed', {
          worldId,
          file,
          removed: dropped,
          completeFrom: new Date(from).toISOString(),
          cutActions: through.size,
        });
      } catch (error) {
        // Not cut: the records are all still there.
        delete state.completeFrom;
        delete state.cappedBefore;
        delete state.cutActions;
        Object.assign(state, before);
        await this.saveState(worldId).catch(() => undefined);
        this.logger.warn('Change journal day could not be capped', {
          worldId,
          file,
          error: error instanceof Error ? error.message : String(error),
        });
      }
    }
    return cut;
  }

  private async loadWrittenKeys(worldId: string, date: string): Promise<Set<string>> {
    const cacheKey = `${worldId}::${date}`;
    const cached = this.writtenKeys.get(cacheKey);
    if (cached) return cached;
    // Line by line, keys only: a day's file can hold more than one string can.
    const keys = new Set<string>();
    await this.store.forEachLine(worldId, 'gm', changeJournalFileName(date), line => {
      const key = (line as { key?: unknown } | null)?.key;
      if (typeof key === 'string') keys.add(key);
    });
    this.writtenKeys.set(cacheKey, keys);
    return keys;
  }

  private notifyAppended(worldId: string, records: ChangeRecord[]): void {
    if (!this.onAppended) return;
    try {
      this.onAppended(worldId, records);
    } catch (error) {
      this.logger.warn('onAppended listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async loadState(worldId: string): Promise<PumpState> {
    if (this.state?.worldId === worldId) return this.state;
    const saved = await this.store.read<ChangePumpState>(worldId, 'gm', CHANGE_PUMP_STATE_FILE);
    const clientId = typeof saved?.data.clientId === 'string' ? saved.data.clientId : null;
    const lastSeq = typeof saved?.data.lastSeq === 'number' ? saved.data.lastSeq : 0;
    const historyFrom =
      typeof saved?.data.historyFrom === 'string' &&
      Number.isFinite(dateKeyStart(saved.data.historyFrom))
        ? saved.data.historyFrom
        : undefined;
    const completeFrom =
      typeof saved?.data.completeFrom === 'number' && saved.data.completeFrom > 0
        ? saved.data.completeFrom
        : undefined;
    const cappedBefore =
      typeof saved?.data.cappedBefore === 'number' && saved.data.cappedBefore > 0
        ? saved.data.cappedBefore
        : undefined;
    const cutActions = Array.isArray(saved?.data.cutActions)
      ? saved.data.cutActions.filter((id): id is string => typeof id === 'string')
      : [];
    this.state = {
      worldId,
      clientId,
      lastSeq,
      ...(historyFrom ? { historyFrom } : {}),
      ...(completeFrom ? { completeFrom } : {}),
      ...(cappedBefore ? { cappedBefore } : {}),
      ...(cutActions.length > 0 ? { cutActions } : {}),
    };
    return this.state;
  }

  private async saveState(worldId: string): Promise<void> {
    if (this.state?.worldId !== worldId) return;
    const data: ChangePumpState = {
      clientId: this.state.clientId,
      lastSeq: this.state.lastSeq,
      ...(this.state.historyFrom ? { historyFrom: this.state.historyFrom } : {}),
      ...(this.state.completeFrom ? { completeFrom: this.state.completeFrom } : {}),
      ...(this.state.cappedBefore ? { cappedBefore: this.state.cappedBefore } : {}),
      ...(this.state.cutActions?.length ? { cutActions: this.state.cutActions } : {}),
    };
    await this.store.write(worldId, 'gm', CHANGE_PUMP_STATE_FILE, data);
  }
}
