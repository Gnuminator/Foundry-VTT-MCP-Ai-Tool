/**
 * Per-world public session log for the O7 player vault. Holds only events that already went
 * through the player projection (`projectEvent`): the store keeps four fields per event and drops
 * everything else, so nothing GM-side can ride along. Events live in memory and, when a folder is
 * given, in append-only JSONL files (one folder per world, one file per UTC day of the event), so
 * the log survives a dashboard restart.
 *
 * Every finished session is kept (a campaign runs 30 to 50 sessions). An append only appends the
 * new lines to their day files. Only a session that grows past
 * {@link PLAYER_LOG_MAX_SESSION_EVENTS} loses its oldest events: it is trimmed with some headroom
 * (so this happens rarely), only the day files of that session are rewritten, and the session
 * starts with a note that says how many events were left out.
 *
 * Sessions are split the way the bridge splits them (`SESSION_GAP_MS` in
 * `packages/mcp-server/src/event-pump.ts`).
 */
import crypto from 'crypto';
import { promises as fsp, readdirSync, readFileSync } from 'fs';
import * as path from 'path';

import type { PlayerEvent } from '@gnuminator/shared';

import type { Logger } from '../logger.js';
import { safeFileName } from './names.js';
import type { VaultSession } from './types.js';

/** Same rule as `SESSION_GAP_MS` in `packages/mcp-server/src/event-pump.ts`. */
export const PLAYER_LOG_SESSION_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * Most events kept per session. A long, busy evening has a few thousand; beyond this the oldest
 * events of that session are dropped (other sessions are never touched).
 */
export const PLAYER_LOG_MAX_SESSION_EVENTS = 10_000;

/** The event type of the note at the start of a trimmed session. */
export const PLAYER_LOG_TRIMMED_TYPE = 'log-trimmed';

const TRIMMED_ID_PREFIX = 'log-trimmed-';

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

/** The storage file key of an event: its UTC day (stable whatever the machine's time zone). */
function fileDay(ms: number): string {
  return new Date(ms).toISOString().slice(0, 10);
}

function isTrimNote(event: PlayerEvent): boolean {
  return event.type === PLAYER_LOG_TRIMMED_TYPE && event.id.startsWith(TRIMMED_ID_PREFIX);
}

function trimNoteText(dropped: number, cap: number): string {
  const what = dropped === 1 ? '1 earlier event' : `${dropped} earlier events`;
  return `${what} of this session were left out (the log keeps the last ${cap} per session).`;
}

/** The dropped count a trim note carries (it starts with the number, or "1 earlier event"). */
function droppedIn(note: PlayerEvent): number {
  const n = Number.parseInt(note.text, 10);
  return Number.isFinite(n) && n > 0 ? n : 0;
}

function errorMessage(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

export class PlayerLogStore {
  private readonly worlds = new Map<string, WorldLog>();
  private readonly gapMs: number;
  private readonly maxSessionEvents: number;
  private queue: Promise<void> = Promise.resolve();

  /**
   * @param dir the folder for the per-world log folders, or null to keep the log in memory only
   * @param options.gapMs the gap that starts a new session (default three hours)
   * @param options.maxSessionEvents most events kept per session (default
   *   {@link PLAYER_LOG_MAX_SESSION_EVENTS})
   */
  constructor(
    private readonly dir: string | null,
    private readonly logger: Logger,
    options: { gapMs?: number; maxSessionEvents?: number } = {}
  ) {
    this.gapMs = options.gapMs ?? PLAYER_LOG_SESSION_GAP_MS;
    this.maxSessionEvents = Math.max(1, options.maxSessionEvents ?? PLAYER_LOG_MAX_SESSION_EVENTS);
  }

  /**
   * Adds projected events for a world; dedupes by id and returns how many were new. Invalid
   * events are refused. Only the new events are written, appended to their day files.
   */
  append(worldId: string, events: PlayerEvent[]): number {
    const log = this.load(worldId);
    const byDay = new Map<string, PlayerEvent[]>();
    let added = 0;
    for (const raw of events) {
      const event = cleanEvent(raw);
      if (!event || log.ids.has(event.id)) continue;
      log.ids.add(event.id);
      log.events.push(event);
      added++;
      const day = fileDay(event.timestampMs);
      const list = byDay.get(day);
      if (list) list.push(event);
      else byDay.set(day, [event]);
    }
    if (added === 0) return 0;
    log.digest = null;
    for (const [day, list] of byDay) {
      const lines = `${list.map(e => JSON.stringify(e)).join('\n')}\n`;
      this.enqueue(worldId, () => this.appendLines(worldId, day, lines));
    }
    return added;
  }

  /** True once the world has any stored event (the service backfills only when false). */
  has(worldId: string): boolean {
    return this.load(worldId).events.length > 0;
  }

  /**
   * The world's sessions, oldest first: events sorted by time then id, split where the gap to the
   * previous event exceeds the gap. The label is the local date of the first event; a second
   * session the same day gets `(2)`, a third `(3)`. A session over the per-session cap is trimmed
   * here (oldest events first, a note in front) and its day files are rewritten.
   */
  sessions(worldId: string): VaultSession[] {
    const log = this.load(worldId);
    let groups = this.group([...log.events].sort(compareEvents));
    if (groups.some(g => this.countReal(g) > this.maxSessionEvents)) {
      for (const g of groups) {
        if (this.countReal(g) > this.maxSessionEvents) this.trim(worldId, log, g);
      }
      groups = this.group([...log.events].sort(compareEvents));
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

  private group(sorted: PlayerEvent[]): PlayerEvent[][] {
    const groups: PlayerEvent[][] = [];
    let prev: PlayerEvent | null = null;
    for (const event of sorted) {
      if (!prev || event.timestampMs - prev.timestampMs > this.gapMs) groups.push([]);
      groups[groups.length - 1].push(event);
      prev = event;
    }
    return groups;
  }

  private countReal(group: PlayerEvent[]): number {
    let n = 0;
    for (const e of group) if (!isTrimNote(e)) n++;
    return n;
  }

  /**
   * Drops the oldest events of one too-big session down to 90% of the cap (headroom, so the next
   * trim is thousands of events away), puts one note in front with the total left out, and
   * rewrites the day files that session touched.
   */
  private trim(worldId: string, log: WorldLog, group: PlayerEvent[]): void {
    const real = group.filter(e => !isTrimNote(e));
    const oldNotes = group.filter(isTrimNote);
    const keepCount = Math.max(1, Math.floor(this.maxSessionEvents * 0.9));
    const dropped = real.slice(0, real.length - keepCount);
    const kept = real.slice(real.length - keepCount);
    const total = dropped.length + oldNotes.reduce((sum, n) => sum + droppedIn(n), 0);
    const note: PlayerEvent = {
      id: `${TRIMMED_ID_PREFIX}${kept[0].timestampMs}`,
      timestampMs: kept[0].timestampMs - 1,
      type: PLAYER_LOG_TRIMMED_TYPE,
      text: trimNoteText(total, this.maxSessionEvents),
    };

    const remove = new Set([...dropped, ...oldNotes].map(e => e.id));
    log.events = log.events.filter(e => !remove.has(e.id));
    // Dropped ids stay known, so a backfill in this process does not bring them back.
    for (const old of oldNotes) log.ids.delete(old.id);
    log.events.push(note);
    log.ids.add(note.id);
    log.digest = null;
    this.logger.info('Player log: trimmed a very long session', {
      worldId,
      dropped: dropped.length,
      kept: kept.length,
    });

    const days = new Set(group.map(e => fileDay(e.timestampMs)));
    days.add(fileDay(note.timestampMs));
    for (const day of days) {
      const snapshot = log.events
        .filter(e => fileDay(e.timestampMs) === day)
        .sort(compareEvents)
        .map(e => `${JSON.stringify(e)}\n`)
        .join('');
      this.enqueue(worldId, () => this.rewriteDay(worldId, day, snapshot));
    }
  }

  private worldDir(worldId: string): string | null {
    if (!this.dir) return null;
    return path.join(this.dir, safeFileName(worldId, 'world'));
  }

  /** The world's log, read from disk the first time it is used. */
  private load(worldId: string): WorldLog {
    const known = this.worlds.get(worldId);
    if (known) return known;
    const log: WorldLog = { events: [], ids: new Set(), digest: null };
    this.worlds.set(worldId, log);

    const dir = this.worldDir(worldId);
    if (!dir) return log;
    let names: string[];
    try {
      names = readdirSync(dir).filter(n => /^\d{4}-\d{2}-\d{2}\.jsonl$/.test(n));
    } catch (error) {
      if ((error as NodeJS.ErrnoException).code !== 'ENOENT') {
        this.logger.warn('Player log folder unreadable; starting empty', {
          dir,
          error: errorMessage(error),
        });
      }
      return log;
    }
    let malformed = 0;
    for (const name of names.sort()) {
      const file = path.join(dir, name);
      let text: string;
      try {
        text = readFileSync(file, 'utf8');
      } catch (error) {
        this.logger.warn('Player log file unreadable; skipped it', {
          file,
          error: errorMessage(error),
        });
        continue;
      }
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
    }
    if (malformed > 0) {
      this.logger.warn('Player log files had malformed lines; skipped them', { dir, malformed });
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

  private async appendLines(worldId: string, day: string, lines: string): Promise<void> {
    const dir = this.worldDir(worldId);
    if (!dir) return;
    await fsp.mkdir(dir, { recursive: true });
    await fsp.appendFile(path.join(dir, `${day}.jsonl`), lines, 'utf8');
  }

  /** Replaces one day file (only after a trim); an empty day loses its file. */
  private async rewriteDay(worldId: string, day: string, content: string): Promise<void> {
    const dir = this.worldDir(worldId);
    if (!dir) return;
    const file = path.join(dir, `${day}.jsonl`);
    if (content === '') {
      await fsp.rm(file, { force: true });
      return;
    }
    await fsp.mkdir(dir, { recursive: true });
    const tmp = `${file}.tmp`;
    await fsp.writeFile(tmp, content, 'utf8');
    await fsp.rename(tmp, file);
  }
}
