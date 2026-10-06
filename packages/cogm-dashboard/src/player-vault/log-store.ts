/**
 * Per-world public session log for the O7 player vault. Holds only events that already went
 * through the player projection (`projectEvent`): the store keeps four fields per event and drops
 * everything else, so nothing GM-side can ride along. Events live in memory and, when a folder is
 * given, in one append-only JSONL file per world, so the log survives a dashboard restart.
 *
 * Sessions are split the way the bridge splits them (`SESSION_GAP_MS` in
 * `packages/mcp-server/src/event-pump.ts`).
 */
import crypto from 'crypto';
import { promises as fsp, readFileSync } from 'fs';
import * as path from 'path';

import type { PlayerEvent } from '@gnuminator/shared';

import type { Logger } from '../logger.js';
import { safeFileName } from './names.js';
import type { VaultSession } from './types.js';

/** Same rule as `SESSION_GAP_MS` in `packages/mcp-server/src/event-pump.ts`. */
export const PLAYER_LOG_SESSION_GAP_MS = 3 * 60 * 60 * 1000;

/** Most events kept per world; the oldest are dropped beyond this. */
export const PLAYER_LOG_MAX_EVENTS = 20_000;

interface WorldLog {
  events: PlayerEvent[];
  ids: Set<string>;
  digest: string | null;
}

/** A clean copy of the four player event fields, or null when the input is not a valid event. */
function cleanEvent(value: unknown): PlayerEvent | null {
  if (typeof value !== 'object' || value === null) return null;
  const v = value as Record<string, unknown>;
  if (typeof v.id !== 'string' || v.id === '') return null;
  if (typeof v.timestampMs !== 'number' || !Number.isFinite(v.timestampMs) || v.timestampMs <= 0) {
    return null;
  }
  if (typeof v.type !== 'string' || typeof v.text !== 'string') return null;
  return { id: v.id, timestampMs: v.timestampMs, type: v.type, text: v.text };
}

function compareEvents(a: PlayerEvent, b: PlayerEvent): number {
  if (a.timestampMs !== b.timestampMs) return a.timestampMs - b.timestampMs;
  return a.id < b.id ? -1 : a.id > b.id ? 1 : 0;
}

function pad2(n: number): string {
  return String(n).padStart(2, '0');
}

/** Local `YYYY-MM-DD` of a timestamp. */
function localDay(ms: number): string {
  const d = new Date(ms);
  return `${d.getFullYear()}-${pad2(d.getMonth() + 1)}-${pad2(d.getDate())}`;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PlayerLogStore {
  private readonly worlds = new Map<string, WorldLog>();
  private readonly gapMs: number;
  private queue: Promise<void> = Promise.resolve();

  /**
   * @param dir the folder for the per-world JSONL files, or null to keep the log in memory only
   * @param options.gapMs the gap that starts a new session (default three hours)
   */
  constructor(
    private readonly dir: string | null,
    private readonly logger: Logger,
    options: { gapMs?: number } = {}
  ) {
    this.gapMs = options.gapMs ?? PLAYER_LOG_SESSION_GAP_MS;
  }

  /**
   * Adds projected events for a world; dedupes by id and returns how many were new. Invalid
   * events are refused. The new events are appended to the world's file.
   */
  append(worldId: string, events: PlayerEvent[]): number {
    const log = this.load(worldId);
    const added: PlayerEvent[] = [];
    for (const raw of events) {
      const event = cleanEvent(raw);
      if (!event || log.ids.has(event.id)) continue;
      log.ids.add(event.id);
      log.events.push(event);
      added.push(event);
    }
    if (added.length === 0) return 0;
    log.digest = null;

    if (log.events.length > PLAYER_LOG_MAX_EVENTS) {
      log.events.sort(compareEvents);
      const dropped = log.events.splice(0, log.events.length - PLAYER_LOG_MAX_EVENTS);
      for (const gone of dropped) log.ids.delete(gone.id);
      this.enqueue(worldId, () => this.rewrite(worldId, [...log.events]));
    } else {
      const lines = `${added.map(e => JSON.stringify(e)).join('\n')}\n`;
      this.enqueue(worldId, () => this.appendLines(worldId, lines));
    }
    return added.length;
  }

  /** True once the world has any stored event (the service backfills only when false). */
  has(worldId: string): boolean {
    return this.load(worldId).events.length > 0;
  }

  /**
   * The world's sessions, oldest first: events sorted by time then id, split where the gap to the
   * previous event exceeds the gap. The label is the local date of the first event; a second
   * session the same day gets `(2)`, a third `(3)`.
   */
  sessions(worldId: string): VaultSession[] {
    const sorted = [...this.load(worldId).events].sort(compareEvents);
    const groups: PlayerEvent[][] = [];
    let prev: PlayerEvent | null = null;
    for (const event of sorted) {
      if (!prev || event.timestampMs - prev.timestampMs > this.gapMs) groups.push([]);
      groups[groups.length - 1].push(event);
      prev = event;
    }
    const perDay = new Map<string, number>();
    return groups.map(events => {
      const day = localDay(events[0].timestampMs);
      const n = (perDay.get(day) ?? 0) + 1;
      perDay.set(day, n);
      return { label: n === 1 ? day : `${day} (${n})`, events };
    });
  }

  /** A short stable hash of the world's stored events (for the service's change check). */
  digest(worldId: string): string {
    const log = this.load(worldId);
    if (log.digest === null) {
      const hash = crypto.createHash('sha1');
      for (const e of [...log.events].sort(compareEvents)) {
        hash.update(JSON.stringify([e.id, e.timestampMs, e.type, e.text]));
        hash.update('\n');
      }
      log.digest = hash.digest('hex').slice(0, 16);
    }
    return log.digest;
  }

  /** Wait for pending writes (tests and shutdown). */
  async flush(): Promise<void> {
    await this.queue;
  }

  private fileFor(worldId: string): string | null {
    if (!this.dir) return null;
    return path.join(this.dir, `${safeFileName(worldId, 'world')}.jsonl`);
  }

  /** The world's log, read from disk the first time it is used. */
  private load(worldId: string): WorldLog {
    const known = this.worlds.get(worldId);
    if (known) return known;
    const log: WorldLog = { events: [], ids: new Set(), digest: null };
    this.worlds.set(worldId, log);

    const file = this.fileFor(worldId);
    if (!file) return log;
    let text: string;
    try {
      text = readFileSync(file, 'utf8');
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Player log file unreadable; starting empty', {
          file,
          error: errorMessage(error),
        });
      }
      return log;
    }
    let malformed = 0;
    for (const line of text.split('\n')) {
      if (line.trim() === '') continue;
      let event: PlayerEvent | null = null;
      try {
        event = cleanEvent(JSON.parse(line));
      } catch {
        event = null;
      }
      if (!event) {
        malformed++;
        continue;
      }
      if (log.ids.has(event.id)) continue;
      log.ids.add(event.id);
      log.events.push(event);
    }
    if (malformed > 0) {
      this.logger.warn('Player log file had malformed lines; skipped them', { file, malformed });
    }
    return log;
  }

  /** Runs disk work one job at a time; a failed job is logged and never stops the next one. */
  private enqueue(worldId: string, job: () => Promise<void>): void {
    this.queue = this.queue.then(job).catch((error: unknown) => {
      this.logger.warn('Player log write failed; keeping the log in memory', {
        worldId,
        error: errorMessage(error),
      });
    });
  }

  private async appendLines(worldId: string, lines: string): Promise<void> {
    const file = this.fileFor(worldId);
    if (!file) return;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    await fsp.appendFile(file, lines, 'utf8');
  }

  private async rewrite(worldId: string, events: PlayerEvent[]): Promise<void> {
    const file = this.fileFor(worldId);
    if (!file) return;
    await fsp.mkdir(path.dirname(file), { recursive: true });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, events.map(e => `${JSON.stringify(e)}\n`).join(''), 'utf8');
    await fsp.rename(tmp, file);
  }
}
