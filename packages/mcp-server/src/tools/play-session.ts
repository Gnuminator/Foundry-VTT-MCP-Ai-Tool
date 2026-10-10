import { randomBytes } from 'crypto';

import { PLAY_LOG_FILE } from '@gnuminator/shared';
import { z } from 'zod';

import { SESSION_GAP_MS, localDateKey } from '../event-pump.js';
import type { Logger } from '../logger.js';
import type { VaultStore } from '../vault/store.js';
import type { WorldIdResolver } from '../vault/world-id.js';

interface ToolDefinition {
  name: string;
  description: string;
  inputSchema: {
    type: 'object';
    properties: Record<string, unknown>;
    required?: string[];
  };
}

export interface PlaySessionToolsOptions {
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  logger: Logger;
  /** Tests only. */
  now?: () => number;
  /**
   * Called after a marker is appended. A throwing listener is caught and
   * logged; it never breaks the tool call.
   */
  onMarked?: (worldId: string) => void;
}

export interface MarkPlaySessionResult {
  success: true;
  worldId: string;
  action: 'start' | 'end';
  markedAt: string;
}

export interface GetPlaySessionResult {
  success: true;
  worldId: string;
  open: boolean;
  startedAt: string | null;
  lastEventAt: string | null;
  /**
   * When the newest session ended, for a closed one: its end marker, or its last logged event
   * or play record when it went quiet without one. Null while open or with no marker at all.
   */
  endedAt: string | null;
}

/** Contract 1 (Obsidian plan O2): a session marker line in `sessions/<date>.jsonl`. */
interface SessionMarker {
  id: string;
  timestamp: string;
  timestampMs: number;
  eventType: 'session-start' | 'session-end';
  actorName: null;
  description: string;
  details: { source: 'mark-play-session'; note?: string };
}

/** Any logged line with a time: session events and markers alike. */
interface LoggedEvent {
  timestamp: string;
  timestampMs?: number;
  eventType?: string;
}

const MAX_NOTE_LENGTH = 200;
/** `get-play-session` gives up after this many session-log files (newest first). */
const MAX_SCAN_FILES = 60;
const SESSION_FILE_NAME = /^\d{4}-\d{2}-\d{2}\.jsonl$/;

function newMarkerId(nowMs: number): string {
  return `mark-${nowMs.toString(36)}-${randomBytes(4).toString('hex')}`;
}

function isLoggedEvent(value: unknown): value is LoggedEvent {
  const e = value as Partial<LoggedEvent> | null;
  return !!e && typeof e.timestamp === 'string';
}

function eventTimeOf(event: LoggedEvent): number {
  if (typeof event.timestampMs === 'number' && Number.isFinite(event.timestampMs)) {
    return event.timestampMs;
  }
  return Date.parse(event.timestamp);
}

function isMarker(event: LoggedEvent): boolean {
  return event.eventType === 'session-start' || event.eventType === 'session-end';
}

/**
 * Newest `t` in the newest `<date>.play.jsonl` file (O3 contract 3), or null
 * when there is none. Only the newest play-log file is read: since records
 * are filed by the local date of `t`, it always holds the most recent ones.
 */
async function newestPlayRecordTime(store: VaultStore, worldId: string): Promise<number | null> {
  const files = (await store.list(worldId, 'sessions'))
    .filter(name => PLAY_LOG_FILE.test(name))
    .sort()
    .reverse();
  const newest = files[0];
  if (!newest) return null;
  let max: number | null = null;
  for (const line of await store.readLines(worldId, 'sessions', newest)) {
    const t = (line as { t?: unknown } | null)?.t;
    if (typeof t === 'number' && Number.isFinite(t) && (max === null || t > max)) max = t;
  }
  return max;
}

/**
 * `mark-play-session` / `get-play-session` (Obsidian plan O2, contracts 1 and
 * 5): GM-only markers of when the table is playing, written as ordinary lines
 * in the bridge vault's own session log. This never touches game state or
 * Foundry; the dashboard treats `mark-play-session` like a read.
 *
 * `get-play-session`'s open check also looks at the newest play-log file
 * (`sessions/<date>.play.jsonl`, O3 contract 3, written by `play-log-pump.ts`)
 * so a table still generating play records, but with no other logged event,
 * is not reported as gone quiet.
 */
export class PlaySessionTools {
  private readonly worldIds: PlaySessionToolsOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly logger: Logger;
  private readonly now: () => number;
  private readonly onMarked: PlaySessionToolsOptions['onMarked'];

  constructor(options: PlaySessionToolsOptions) {
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.logger = options.logger.child({ component: 'PlaySessionTools' });
    this.now = options.now ?? ((): number => Date.now());
    this.onMarked = options.onMarked;
  }

  getToolDefinitions(): ToolDefinition[] {
    return [
      {
        name: 'mark-play-session',
        description:
          "GM ONLY. Mark the start or end of a play session by appending a line to the bridge vault's own session log (sessions/<date>.jsonl). Touches only that log, never game state or Foundry. Used to group session notes and stats.",
        inputSchema: {
          type: 'object',
          properties: {
            action: {
              type: 'string',
              enum: ['start', 'end'],
              description: 'Mark the table starting or ending a play session.',
            },
            note: {
              type: 'string',
              description: 'Optional note kept with the marker (up to 200 characters).',
            },
          },
          required: ['action'],
        },
      },
      {
        name: 'get-play-session',
        description:
          "GM ONLY. Whether a play session is currently open, from the bridge vault's own session and play logs only (never game state): true when the newest marker is a session start and no logged event or play record is more than 3 hours old since. A closed session also gives endedAt: its end marker, or its last activity when it went quiet.",
        inputSchema: { type: 'object', properties: {} },
      },
    ];
  }

  async handleMarkPlaySession(args: unknown): Promise<MarkPlaySessionResult> {
    const params = z
      .object({
        action: z.enum(['start', 'end']),
        note: z.string().trim().max(MAX_NOTE_LENGTH).optional(),
      })
      .parse(args ?? {});
    const worldId = await this.worldIds.current();
    const nowMs = this.now();
    const marker: SessionMarker = {
      id: newMarkerId(nowMs),
      timestamp: new Date(nowMs).toISOString(),
      timestampMs: nowMs,
      eventType: params.action === 'start' ? 'session-start' : 'session-end',
      actorName: null,
      description: params.action === 'start' ? 'Play session started' : 'Play session ended',
      details: {
        source: 'mark-play-session',
        ...(params.note ? { note: params.note } : {}),
      },
    };
    await this.store.appendLines(worldId, 'sessions', `${localDateKey(nowMs)}.jsonl`, [marker]);
    this.notifyMarked(worldId);
    return { success: true, worldId, action: params.action, markedAt: marker.timestamp };
  }

  async handleGetPlaySession(_args: unknown): Promise<GetPlaySessionResult> {
    const worldId = await this.worldIds.current();
    const nowMs = this.now();
    const files = (await this.store.list(worldId, 'sessions'))
      .filter(name => SESSION_FILE_NAME.test(name))
      .sort()
      .reverse()
      .slice(0, MAX_SCAN_FILES);

    let lastEventAtMs: number | null = null;
    let newestMarker: LoggedEvent | null = null;

    for (const file of files) {
      const events = (await this.store.readLines(worldId, 'sessions', file))
        .filter(isLoggedEvent)
        .filter(e => Number.isFinite(eventTimeOf(e)));
      if (events.length === 0) continue;
      if (lastEventAtMs === null) {
        lastEventAtMs = Math.max(...events.map(eventTimeOf));
      }
      const markers = events.filter(isMarker);
      if (markers.length > 0) {
        newestMarker = markers.reduce((a, b) => (eventTimeOf(b) > eventTimeOf(a) ? b : a));
        break;
      }
    }

    const playMs = await newestPlayRecordTime(this.store, worldId);
    if (playMs !== null && (lastEventAtMs === null || playMs > lastEventAtMs)) {
      lastEventAtMs = playMs;
    }

    const open =
      newestMarker !== null &&
      newestMarker.eventType === 'session-start' &&
      lastEventAtMs !== null &&
      nowMs - lastEventAtMs <= SESSION_GAP_MS;

    let endedAt: string | null = null;
    if (!open && newestMarker !== null) {
      endedAt =
        newestMarker.eventType === 'session-end'
          ? newestMarker.timestamp
          : lastEventAtMs === null
            ? null
            : new Date(lastEventAtMs).toISOString();
    }

    return {
      success: true,
      worldId,
      open,
      startedAt: open ? newestMarker!.timestamp : null,
      lastEventAt: lastEventAtMs === null ? null : new Date(lastEventAtMs).toISOString(),
      endedAt,
    };
  }

  private notifyMarked(worldId: string): void {
    if (!this.onMarked) return;
    try {
      this.onMarked(worldId);
    } catch (error) {
      this.logger.warn('onMarked listener failed', {
        error: error instanceof Error ? error.message : String(error),
      });
    }
  }
}
