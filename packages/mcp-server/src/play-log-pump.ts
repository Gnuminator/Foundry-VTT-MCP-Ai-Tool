/**
 * Backend play-log pump (Obsidian plan O3, contracts 2 and 3).
 *
 * The Foundry module's play recorder keeps a ring buffer of up to 5000
 * `PlayRecord`s per page load, lost on reload. The backend polls it and
 * appends every record to the vault, one JSON line per record, in
 * `<dataDir>/<worldId>/sessions/<local-date>.play.jsonl` (local date of the
 * record's `t`), so the raw facts survive a browser reload and later
 * features (stats, session notes) have the full history even when no
 * dashboard was open. The day's ordinary session-log file
 * (`<date>.jsonl`, `event-pump.ts`) is untouched.
 *
 * Cursor: the module hands out a random `clientId` per page load and
 * restarts its `seq` numbering at 1 each time. The pump keeps
 * `{ clientId, lastSeq }` per world in `sessions/play-pump-state.json`. A
 * response whose `clientId` differs from the saved one means the module
 * reloaded: the saved `lastSeq` means nothing to the new buffer, so the pump
 * re-asks from `sinceSeq: 0` to get everything the new buffer still holds.
 * When the client is unchanged but the module's `oldestSeq` has moved past
 * `lastSeq + 1`, the ring buffer wrapped before the pump could read some
 * records, and that loss is logged (there is nothing left to recover).
 *
 * Records are deduplicated by their deterministic `key` (contract 4): against
 * duplicates already written to the day's file (a key set read from the file
 * the first time the process touches it, then kept up to date) and against
 * duplicates inside the same batch. This also covers two GM clients recording
 * the same underlying change: whichever one the pump reads first wins, and
 * the other's matching key is dropped even though it arrives with a
 * different `clientId`/`seq`.
 *
 * On by default; `FOUNDRY_AI_PLAY_LOG=off` disables it. The poll interval is
 * `FOUNDRY_AI_EVENT_POLL_MS`, shared with the event pump.
 */
import {
  isBridgeRefusal,
  playLogFileName,
  type PlayRecord,
  type PlayRecordsResponse,
} from '@gnuminator/shared';

import { DEFAULT_EVENT_POLL_MS, localDateKey } from './event-pump.js';
import type { FoundryClient } from './foundry-client.js';
import type { Logger } from './logger.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

export const PLAY_PUMP_STATE_FILE = 'play-pump-state.json';
/** The module's ring buffer holds 5000 records; ask for as many as it allows. */
const FETCH_LIMIT = 5000;

interface PlayPumpState {
  /** The module page load whose buffer `lastSeq` refers to; null before the first poll. */
  clientId: string | null;
  /** The highest sequence number the pump has already asked for. */
  lastSeq: number;
}

export interface PlayLogPumpOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  logger: Logger;
  intervalMs?: number;
  /**
   * Called after a successful non-empty append, with the number of records
   * written. A throwing listener is caught and logged; it never breaks the
   * pump.
   */
  onAppended?: (worldId: string, count: number) => void;
}

/** Whether the pump is on, and its interval, from the environment. */
export function playLogSettings(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  intervalMs: number;
} {
  const enabled = !/^(off|false|0|no)$/i.test(env.FOUNDRY_AI_PLAY_LOG?.trim() ?? '');
  const parsed = Number.parseInt(env.FOUNDRY_AI_EVENT_POLL_MS ?? '', 10);
  const intervalMs = Number.isFinite(parsed) ? Math.max(1000, parsed) : DEFAULT_EVENT_POLL_MS;
  return { enabled, intervalMs };
}

/** `v: 2`, a string `key`, a finite `t` and a string `kind`; anything else is dropped. */
function isPlayRecord(value: unknown): value is PlayRecord {
  const r = value as Partial<PlayRecord> | null;
  return (
    !!r &&
    r.v === 2 &&
    typeof r.key === 'string' &&
    typeof r.t === 'number' &&
    Number.isFinite(r.t) &&
    typeof r.kind === 'string'
  );
}

export class PlayLogPump {
  private readonly foundry: PlayLogPumpOptions['foundryClient'];
  private readonly worldIds: PlayLogPumpOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly onAppended: PlayLogPumpOptions['onAppended'];
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<number> | null = null;
  private state: { worldId: string; clientId: string | null; lastSeq: number } | null = null;
  /** Keys already on disk for `<worldId>::<dateKey>`, read from the file once per process. */
  private readonly writtenKeys = new Map<string, Set<string>>();
  private lastError: string | null = null;

  constructor(options: PlayLogPumpOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.logger = options.logger.child({ component: 'PlayLogPump' });
    this.intervalMs = options.intervalMs ?? DEFAULT_EVENT_POLL_MS;
    this.onAppended = options.onAppended;
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
        if (this.lastError) this.logger.info('Play log recovered');
        this.lastError = null;
        return written;
      })
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        if (message !== this.lastError) {
          this.logger.warn('Play log poll failed', { error: message });
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

  private async poll(): Promise<number> {
    if (!this.foundry.isConnected()) return 0;
    const worldId = await this.worldIds.current();
    const state = await this.loadState(worldId);

    let response = await this.fetchRecords(state.lastSeq);
    const restarted = state.clientId !== null && response.clientId !== state.clientId;
    if (restarted) {
      // The buffer's seq numbering restarted at 1; the cursor we just asked
      // for meant nothing to it. Re-ask for everything it still has.
      response = await this.fetchRecords(0);
    } else if (state.clientId !== null && response.oldestSeq > state.lastSeq + 1) {
      this.logger.warn('Play log records lost: the ring buffer wrapped before the pump read them', {
        worldId,
        clientId: response.clientId,
        expectedFrom: state.lastSeq + 1,
        oldestSeq: response.oldestSeq,
      });
    }

    const rawRecords = Array.isArray(response.records) ? response.records : [];
    const valid: PlayRecord[] = [];
    let invalid = 0;
    for (const candidate of rawRecords) {
      if (isPlayRecord(candidate)) valid.push(candidate);
      else invalid += 1;
    }
    if (invalid > 0) {
      this.logger.warn('Play log dropped invalid records', { worldId, count: invalid });
    }

    const written = await this.appendByDate(worldId, valid);

    const changed = state.clientId !== response.clientId || state.lastSeq !== response.latestSeq;
    state.clientId = response.clientId;
    state.lastSeq = response.latestSeq;
    if (changed) await this.saveState(worldId);

    if (written > 0) this.notifyAppended(worldId, written);
    return written;
  }

  private async fetchRecords(sinceSeq: number): Promise<PlayRecordsResponse> {
    const response = await this.foundry.query('foundry-mcp-bridge.getPlayRecords', {
      sinceSeq,
      limit: FETCH_LIMIT,
    });
    if (isBridgeRefusal(response)) {
      throw new Error(response.error ?? 'getPlayRecords refused');
    }
    return response;
  }

  /** Group by local date, drop duplicate keys (against the file and within the batch), append. */
  private async appendByDate(worldId: string, records: PlayRecord[]): Promise<number> {
    const byDate = new Map<string, PlayRecord[]>();
    for (const record of records) {
      const date = localDateKey(record.t);
      byDate.set(date, [...(byDate.get(date) ?? []), record]);
    }

    let written = 0;
    for (const [date, batch] of byDate) {
      const keys = await this.loadWrittenKeys(worldId, date);
      const seen = new Set<string>();
      const toAppend: PlayRecord[] = [];
      for (const record of batch) {
        if (keys.has(record.key) || seen.has(record.key)) continue;
        seen.add(record.key);
        toAppend.push(record);
      }
      if (toAppend.length === 0) continue;
      await this.store.appendLines(worldId, 'sessions', playLogFileName(date), toAppend);
      // Only mark these as written once the append has actually landed.
      for (const key of seen) keys.add(key);
      written += toAppend.length;
    }
    return written;
  }

  private async loadWrittenKeys(worldId: string, date: string): Promise<Set<string>> {
    const cacheKey = `${worldId}::${date}`;
    const cached = this.writtenKeys.get(cacheKey);
    if (cached) return cached;
    const lines = await this.store.readLines(worldId, 'sessions', playLogFileName(date));
    const keys = new Set<string>();
    for (const line of lines) {
      const key = (line as { key?: unknown } | null)?.key;
      if (typeof key === 'string') keys.add(key);
    }
    this.writtenKeys.set(cacheKey, keys);
    return keys;
  }

  private notifyAppended(worldId: string, count: number): void {
    if (!this.onAppended) return;
    try {
      this.onAppended(worldId, count);
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
    const saved = await this.store.read<PlayPumpState>(worldId, 'sessions', PLAY_PUMP_STATE_FILE);
    const clientId = typeof saved?.data.clientId === 'string' ? saved.data.clientId : null;
    const lastSeq = typeof saved?.data.lastSeq === 'number' ? saved.data.lastSeq : 0;
    this.state = { worldId, clientId, lastSeq };
    return this.state;
  }

  private async saveState(worldId: string): Promise<void> {
    if (this.state?.worldId !== worldId) return;
    const data: PlayPumpState = { clientId: this.state.clientId, lastSeq: this.state.lastSeq };
    await this.store.write(worldId, 'sessions', PLAY_PUMP_STATE_FILE, data);
  }
}
