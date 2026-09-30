/**
 * The usage log (I-084, `docs/design/USAGE-LOG.md`): which controls of the
 * dashboard, the `/player` page and the Foundry module people use.
 *
 * `UsageLog.append(worldId, events)` writes one JSON line per event to
 * `<dataDir>/<worldId>/sessions/<local-date>.usage.jsonl` (local date of the
 * event's `t`), dropping a `key` the day's file already holds (two page loads
 * never share a key; a replayed batch or a pump restart would). The keys of a
 * day are read from its file the first time the process touches it, then kept
 * up to date.
 *
 * While no world id is known (Foundry not connected yet) events wait in memory,
 * at most `USAGE_LIMITS.maxBuffered` (the oldest are dropped first). They are
 * written by the next `append` or `flushPending` that finds a world.
 *
 * On by default; `FOUNDRY_AI_USAGE_LOG=off` turns everything off. After an
 * append the Obsidian auto-render is triggered, like the play log does.
 */
import {
  USAGE_LIMITS,
  sanitizeUsageBatch,
  usageLogFileName,
  type RecordUsageResult,
  type UsageEvent,
} from '@gnuminator/shared';

import { localDateKey } from './event-pump.js';
import type { Logger } from './logger.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

/** Whether the usage log is on, from the environment. */
export function usageLogEnabled(env: NodeJS.ProcessEnv = process.env): boolean {
  return !/^(off|false|0|no)$/i.test(env.FOUNDRY_AI_USAGE_LOG?.trim() ?? '');
}

export interface UsageLogOptions {
  store: VaultStore;
  worldIds: Pick<WorldIdResolver, 'current'>;
  logger: Logger;
  /** Default: from `FOUNDRY_AI_USAGE_LOG`. */
  enabled?: boolean;
  /** Called after a successful non-empty append; a throwing listener is caught and logged. */
  onAppended?: (worldId: string, count: number) => void;
}

export class UsageLog {
  private readonly store: VaultStore;
  private readonly worldIds: UsageLogOptions['worldIds'];
  private readonly logger: Logger;
  private readonly onAppended: UsageLogOptions['onAppended'];
  readonly enabled: boolean;
  /** Events waiting for a known world, oldest first. */
  private pending: UsageEvent[] = [];
  /** Keys already on disk for `<worldId>::<dateKey>`. */
  private readonly writtenKeys = new Map<string, Set<string>>();
  /** Appends run one at a time so two batches never write the same key twice. */
  private queue: Promise<unknown> = Promise.resolve();

  constructor(options: UsageLogOptions) {
    this.store = options.store;
    this.worldIds = options.worldIds;
    this.logger = options.logger.child({ component: 'UsageLog' });
    this.onAppended = options.onAppended;
    this.enabled = options.enabled ?? usageLogEnabled();
  }

  /** Events currently held in memory because no world was known. */
  get pendingCount(): number {
    return this.pending.length;
  }

  /**
   * Append events. `worldId` null means "unknown": the current world is asked
   * for, and when Foundry is not connected the events wait in memory. Resolves
   * to the number of lines written; never rejects.
   */
  append(worldId: string | null, events: readonly UsageEvent[]): Promise<number> {
    if (!this.enabled) return Promise.resolve(0);
    return this.enqueue(async () => {
      const id = worldId ?? (await this.tryCurrentWorld());
      if (id === null) {
        this.hold(events);
        return 0;
      }
      const batch = [...this.pending, ...events];
      this.pending = [];
      return this.write(id, batch);
    });
  }

  /** Write the events that waited for a world, when one is known now. */
  flushPending(worldId: string | null = null): Promise<number> {
    if (!this.enabled || this.pending.length === 0) return Promise.resolve(0);
    return this.append(worldId, []);
  }

  private enqueue<T>(job: () => Promise<T>): Promise<T> {
    const run = this.queue.then(job, job);
    this.queue = run.catch(() => undefined);
    return run;
  }

  private async tryCurrentWorld(): Promise<string | null> {
    try {
      return await this.worldIds.current();
    } catch {
      return null;
    }
  }

  private hold(events: readonly UsageEvent[]): void {
    if (events.length === 0) return;
    this.pending.push(...events);
    const overflow = this.pending.length - USAGE_LIMITS.maxBuffered;
    if (overflow > 0) {
      this.pending.splice(0, overflow);
      this.logger.warn('Usage log buffer full while no world is known: oldest events dropped', {
        dropped: overflow,
      });
    }
  }

  private async write(worldId: string, events: UsageEvent[]): Promise<number> {
    const byDate = new Map<string, UsageEvent[]>();
    for (const event of events) {
      const date = localDateKey(event.t);
      const list = byDate.get(date);
      if (list) list.push(event);
      else byDate.set(date, [event]);
    }
    let written = 0;
    for (const [date, batch] of byDate) {
      try {
        const keys = await this.loadWrittenKeys(worldId, date);
        const seen = new Set<string>();
        const toAppend: UsageEvent[] = [];
        for (const event of batch) {
          if (keys.has(event.key) || seen.has(event.key)) continue;
          seen.add(event.key);
          toAppend.push(event);
        }
        if (toAppend.length === 0) continue;
        await this.store.appendLines(worldId, 'sessions', usageLogFileName(date), toAppend);
        for (const key of seen) keys.add(key);
        written += toAppend.length;
      } catch (error) {
        this.logger.warn('Usage log write failed; events kept for a retry', {
          date,
          error: error instanceof Error ? error.message : String(error),
        });
        this.hold(batch);
      }
    }
    if (written > 0) this.notify(worldId, written);
    return written;
  }

  private async loadWrittenKeys(worldId: string, date: string): Promise<Set<string>> {
    const cacheKey = `${worldId}::${date}`;
    const cached = this.writtenKeys.get(cacheKey);
    if (cached) return cached;
    const lines = await this.store.readLines(worldId, 'sessions', usageLogFileName(date));
    const keys = new Set<string>();
    for (const line of lines) {
      const key = (line as { key?: unknown } | null)?.key;
      if (typeof key === 'string') keys.add(key);
    }
    this.writtenKeys.set(cacheKey, keys);
    return keys;
  }

  private notify(worldId: string, count: number): void {
    if (!this.onAppended) return;
    try {
      this.onAppended(worldId, count);
    } catch (error) {
      this.logger.warn('onAppended listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}

/**
 * The control method `record_usage` (`{events}` to `{accepted, dropped}`): the
 * dashboard already forced surface and who, so they are kept as sent; the
 * batch is sanitized again (names, numbers, key, clock).
 */
export async function handleRecordUsage(
  usageLog: Pick<UsageLog, 'append'>,
  params: unknown
): Promise<RecordUsageResult> {
  const raw = (params as { events?: unknown } | null | undefined)?.events;
  const clean = sanitizeUsageBatch(raw);
  await usageLog.append(null, clean.events);
  return { accepted: clean.events.length, dropped: clean.dropped };
}
