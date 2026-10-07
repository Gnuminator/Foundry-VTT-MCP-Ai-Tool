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
 * Records can be 256 KB each, and the Pi's vault is an SD card.
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

const JOURNAL_FILE = /^changes-(\d{4}-\d{2}-\d{2})\.jsonl$/;

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
  private state: { worldId: string; clientId: string | null; lastSeq: number } | null = null;
  /** Keys already on disk for `<worldId>::<dateKey>`, read from the file once per process. */
  private readonly writtenKeys = new Map<string, Set<string>>();
  private lastError: string | null = null;
  /** The world and local day of the last retention run (one run per day). */
  private lastRetention: { worldId: string; dateKey: string } | null = null;

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

  private async poll(): Promise<number> {
    if (!this.foundry.isConnected()) return 0;
    const worldId = await this.worldIds.current();
    const state = await this.loadState(worldId);
    let written = 0;
    const appended: ChangeRecord[] = [];

    // Pages of at most CHANGE_JOURNAL_MAX_LIMIT records, until one comes back short.
    let sinceSeq = state.lastSeq;
    let restarted = false;
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
      } else if (page === 0 && state.clientId !== null && response.oldestSeq > state.lastSeq + 1) {
        this.logger.warn(
          'Change journal records lost: the ring buffer wrapped before the pump read them',
          {
            worldId,
            clientId: response.clientId,
            expectedFrom: state.lastSeq + 1,
            oldestSeq: response.oldestSeq,
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

      const batch = await this.appendByDate(worldId, valid);
      written += batch.length;
      appended.push(...batch);

      // The cursor follows the last record of the page; a short page is the end.
      const lastRead = rawRecords.reduce<number>(
        (max, r) => (typeof r?.seq === 'number' && r.seq > max ? r.seq : max),
        sinceSeq
      );
      const caughtUp = rawRecords.length < CHANGE_JOURNAL_MAX_LIMIT;
      const newSeq = caughtUp ? Math.max(lastRead, response.latestSeq) : lastRead;
      const changed = state.clientId !== response.clientId || state.lastSeq !== newSeq;
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
   * failure is logged and never fails the poll (the records were already written).
   */
  private async retain(worldId: string): Promise<void> {
    const today = localDateKey(this.now());
    if (this.lastRetention?.worldId === worldId && this.lastRetention.dateKey === today) return;
    this.lastRetention = { worldId, dateKey: today };
    try {
      const removed = await this.removeOldFiles(worldId);
      if (removed.length > 0) {
        this.logger.info('Change journal files removed', { worldId, files: removed });
      }
    } catch (error) {
      this.logger.warn('Change journal retention failed', {
        worldId,
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }

  private async removeOldFiles(worldId: string): Promise<string[]> {
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
    for (let i = 0; i < files.length; i += 1) {
      const { file, date } = files[i];
      const last = i === files.length - 1;
      const tooOld = date < oldestKept;
      const tooBig = total > this.maxBytes && !last;
      if (!tooOld && !tooBig) continue;
      await this.store.remove(worldId, 'gm', file);
      this.writtenKeys.delete(`${worldId}::${date}`);
      total -= sizes.get(file) ?? 0;
      removed.push(file);
    }
    return removed;
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

  /** Group by local date, drop duplicate keys (against the file and within the batch), append. */
  private async appendByDate(worldId: string, records: ChangeRecord[]): Promise<ChangeRecord[]> {
    const byDate = new Map<string, ChangeRecord[]>();
    for (const record of records) {
      const date = localDateKey(record.t);
      byDate.set(date, [...(byDate.get(date) ?? []), record]);
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

  private async loadWrittenKeys(worldId: string, date: string): Promise<Set<string>> {
    const cacheKey = `${worldId}::${date}`;
    const cached = this.writtenKeys.get(cacheKey);
    if (cached) return cached;
    const lines = await this.store.readLines(worldId, 'gm', changeJournalFileName(date));
    const keys = new Set<string>();
    for (const line of lines) {
      const key = (line as { key?: unknown } | null)?.key;
      if (typeof key === 'string') keys.add(key);
    }
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

  private async loadState(
    worldId: string
  ): Promise<{ worldId: string; clientId: string | null; lastSeq: number }> {
    if (this.state?.worldId === worldId) return this.state;
    const saved = await this.store.read<ChangePumpState>(worldId, 'gm', CHANGE_PUMP_STATE_FILE);
    const clientId = typeof saved?.data.clientId === 'string' ? saved.data.clientId : null;
    const lastSeq = typeof saved?.data.lastSeq === 'number' ? saved.data.lastSeq : 0;
    this.state = { worldId, clientId, lastSeq };
    return this.state;
  }

  private async saveState(worldId: string): Promise<void> {
    if (!this.state || this.state.worldId !== worldId) return;
    const data: ChangePumpState = { clientId: this.state.clientId, lastSeq: this.state.lastSeq };
    await this.store.write(worldId, 'gm', CHANGE_PUMP_STATE_FILE, data);
  }
}
