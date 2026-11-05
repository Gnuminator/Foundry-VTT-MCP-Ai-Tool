/**
 * Backend event pump (plan step 0.6).
 *
 * The Foundry module keeps session events in an in-memory buffer that is lost
 * on reload. The backend polls it and appends every event to the vault, one
 * JSON line per event, in `<dataDir>/<worldId>/sessions/<local-date>.jsonl`, so
 * later features (attention, recap) have the history even when no dashboard was
 * open.
 *
 * Cursor: the newest event timestamp seen. The module filters strictly after
 * `sinceTimestamp`, and several events can share a millisecond, so the pump
 * asks from one millisecond before the cursor and drops ids it already wrote.
 * The cursor and the ids at the boundary are kept per world in
 * `sessions/pump-state.json`, so a backend restart neither loses nor
 * duplicates events.
 *
 * On by default; `FOUNDRY_AI_EVENT_LOG=off` disables it and
 * `FOUNDRY_AI_EVENT_POLL_MS` sets the interval (default 5000, minimum 1000).
 */
import { errorMessage } from '@gnuminator/shared';

import type { FoundryClient } from './foundry-client.js';
import type { Logger } from './logger.js';
import { PumpHealth, gapMarkerLine, type PumpGap } from './pump-health.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

export const PUMP_STATE_FILE = 'pump-state.json';
export const DEFAULT_EVENT_POLL_MS = 5000;
/** The module's buffer holds 1000 events; ask for all of them after the cursor. */
const FETCH_LIMIT = 1000;
/**
 * Session grouping gap (Obsidian plan O2 contract 3): a group with no logged
 * event for longer than this is closed, and the next event opens a new one.
 * Shared with `get-play-session` (tools/play-session.ts) and the renderer.
 */
export const SESSION_GAP_MS = 3 * 60 * 60 * 1000;

interface SessionEvent {
  id: string;
  timestamp: string;
  timestampMs?: number;
  [key: string]: unknown;
}

interface RecentEventsResponse {
  success?: boolean;
  error?: string;
  events?: unknown;
}

interface PumpState {
  /** Newest event time written (ms since epoch), or null before the first event. */
  cursorMs: number | null;
  /** Ids already written whose time is at or after `cursorMs - 1`. */
  boundaryIds: string[];
  /** Highest `evt-...-<n>` counter written; a lower one later means Foundry reloaded. */
  lastSeq?: number | null;
}

/** An outage shorter than this is a blip, not a gap worth a marker. */
export const LINK_GAP_MIN_MS = 15_000;

/** The module's per-load event counter from an id like `evt-lx2k9a-17`, or null. */
export function eventSeq(id: string): number | null {
  const m = /^evt-(?:[0-9a-z]+-)?(\d+)$/.exec(id);
  return m ? Number(m[1]) : null;
}

export interface EventPumpOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  logger: Logger;
  intervalMs?: number;
  /**
   * Called after a successful non-empty append, with the number of events
   * written. A throwing listener is caught and logged; it never breaks the
   * pump.
   */
  onAppended?: (worldId: string, count: number) => void;
  /**
   * Called with the events just written (oldest first), for the wait-for-game-event hub. Same
   * failure rule as `onAppended`.
   */
  onEvents?: (worldId: string, events: readonly unknown[]) => void;
}

/** Whether the pump is on, and its interval, from the environment. */
export function eventPumpSettings(env: NodeJS.ProcessEnv = process.env): {
  enabled: boolean;
  intervalMs: number;
} {
  const enabled = !/^(off|false|0|no)$/i.test(env.FOUNDRY_AI_EVENT_LOG?.trim() ?? '');
  const parsed = Number.parseInt(env.FOUNDRY_AI_EVENT_POLL_MS ?? '', 10);
  const intervalMs = Number.isFinite(parsed) ? Math.max(1000, parsed) : DEFAULT_EVENT_POLL_MS;
  return { enabled, intervalMs };
}

/** `YYYY-MM-DD` in the backend host's local time zone. */
export function localDateKey(ms: number): string {
  const d = new Date(ms);
  const pad = (n: number): string => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}`;
}

function eventTime(event: SessionEvent): number {
  if (typeof event.timestampMs === 'number' && Number.isFinite(event.timestampMs)) {
    return event.timestampMs;
  }
  return Date.parse(event.timestamp);
}

function isEvent(value: unknown): value is SessionEvent {
  const e = value as Partial<SessionEvent> | null;
  return (
    !!e &&
    typeof e.id === 'string' &&
    typeof e.timestamp === 'string' &&
    Number.isFinite(eventTime(e as SessionEvent))
  );
}

export class EventPump {
  private readonly foundry: EventPumpOptions['foundryClient'];
  private readonly worldIds: EventPumpOptions['worldIds'];
  private readonly store: VaultStore;
  private readonly logger: Logger;
  private readonly intervalMs: number;
  private readonly onAppended: EventPumpOptions['onAppended'];
  private readonly onEvents: EventPumpOptions['onEvents'];
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<number> | null = null;
  private state: {
    worldId: string;
    cursorMs: number | null;
    boundary: Map<string, number>;
    lastSeq: number | null;
  } | null = null;
  private lastError: string | null = null;
  readonly health = new PumpHealth('session events');

  constructor(options: EventPumpOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.logger = options.logger.child({ component: 'EventPump' });
    this.intervalMs = options.intervalMs ?? DEFAULT_EVENT_POLL_MS;
    this.onAppended = options.onAppended;
    this.onEvents = options.onEvents;
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
   * Fetch new events and append them. Resolves to the number of events
   * written; never rejects (a failure is logged once until it recovers).
   */
  pollOnce(): Promise<number> {
    if (this.inFlight) return this.inFlight;
    const run = this.poll()
      .then(written => {
        if (this.lastError) this.logger.info('Event log recovered');
        this.lastError = null;
        return written;
      })
      .catch((error: unknown) => {
        const message = errorMessage(error);
        this.health.error(message, Date.now());
        if (message !== this.lastError) {
          this.logger.warn('Event log poll failed', { error: message });
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
    if (!this.foundry.isConnected()) {
      this.health.linkDown(Date.now());
      return 0;
    }
    const worldId = await this.worldIds.current();
    const state = await this.loadState(worldId);

    const args: Record<string, unknown> = { limit: FETCH_LIMIT };
    if (state.cursorMs !== null) {
      args.sinceTimestamp = new Date(state.cursorMs - 1).toISOString();
    }
    const response = (await this.foundry.query(
      'foundry-mcp-bridge.getRecentEvents',
      args
    )) as RecentEventsResponse;
    if (response?.success === false) {
      throw new Error(response.error ?? 'getRecentEvents refused');
    }
    const received = (Array.isArray(response?.events) ? response.events : []).filter(isEvent);
    const events = received
      .filter(e => !state.boundary.has(e.id))
      .sort((a, b) => eventTime(a) - eventTime(b));

    const now = Date.now();
    const { gaps, reloaded } = this.detectGaps(state, received.length, events, now);
    for (const gap of gaps) {
      await this.store.appendLines(worldId, 'sessions', `${localDateKey(now)}.jsonl`, [
        gapMarkerLine(this.health.pump, gap, now),
      ]);
      this.health.gap(gap, now);
      this.logger.warn('Event log gap', { worldId, reason: gap.reason });
    }
    const seqs = events.map(e => eventSeq(e.id)).filter((n): n is number => n !== null);
    if (seqs.length > 0) {
      const top = Math.max(...seqs);
      state.lastSeq = reloaded || state.lastSeq === null ? top : Math.max(state.lastSeq, top);
    }
    if (events.length === 0) {
      if (gaps.length > 0) await this.saveState(worldId);
      this.health.success(now);
      return 0;
    }

    const byDate = new Map<string, SessionEvent[]>();
    for (const event of events) {
      const key = localDateKey(eventTime(event));
      byDate.set(key, [...(byDate.get(key) ?? []), event]);
    }
    for (const [date, batch] of byDate) {
      await this.store.appendLines(worldId, 'sessions', `${date}.jsonl`, batch);
    }

    const newest = Math.max(state.cursorMs ?? -Infinity, ...events.map(eventTime));
    for (const event of events) state.boundary.set(event.id, eventTime(event));
    for (const [id, ms] of state.boundary) if (ms < newest - 1) state.boundary.delete(id);
    state.cursorMs = newest;
    await this.saveState(worldId);
    this.health.success(now);
    this.notifyAppended(worldId, events.length);
    this.notifyEvents(worldId, events);
    return events.length;
  }

  /**
   * What this read shows was lost: more events than the module's buffer returns at once (ring
   * wrap), a counter that went backwards (Foundry reloaded), or an outage of the link that lasted
   * past a blip. At most one of reload and outage, since the reload explains the outage.
   */
  private detectGaps(
    state: { cursorMs: number | null; lastSeq: number | null },
    receivedCount: number,
    fresh: SessionEvent[],
    now: number
  ): { gaps: PumpGap[]; reloaded: boolean } {
    const gaps: PumpGap[] = [];
    const outageStart = this.health.linkUp();
    const first = fresh[0];
    const to = first ? eventTime(first) : now;
    // A new night is not a gap: Foundry closed and reopened days later restarts the counter and
    // drops the link for hours. Only a break within one session's reach (SESSION_GAP_MS of the last
    // good read) can have cost events that were still to be read.
    const lastGood = this.health.lastSuccess ?? state.cursorMs;
    const sameSession = lastGood !== null && now - lastGood < SESSION_GAP_MS;
    if (state.cursorMs !== null && receivedCount >= FETCH_LIMIT) {
      gaps.push({ reason: 'ring-wrap', fromMs: state.cursorMs, toMs: to, lost: null });
    }
    const seqs = fresh.map(e => eventSeq(e.id)).filter((n): n is number => n !== null);
    const reloaded =
      state.lastSeq !== null && seqs.length > 0 && Math.min(...seqs) <= state.lastSeq;
    if (reloaded) {
      if (sameSession) {
        gaps.push({ reason: 'foundry-reload', fromMs: lastGood ?? to, toMs: to, lost: null });
      }
    } else if (sameSession && outageStart !== null && now - outageStart >= LINK_GAP_MIN_MS) {
      gaps.push({ reason: 'link-down', fromMs: lastGood ?? outageStart, toMs: now, lost: null });
    }
    return { gaps, reloaded };
  }

  private notifyEvents(worldId: string, events: readonly SessionEvent[]): void {
    if (!this.onEvents) return;
    try {
      this.onEvents(worldId, events);
    } catch (error) {
      this.logger.warn('onEvents listener failed', {
        error: errorMessage(error),
      });
    }
  }

  private notifyAppended(worldId: string, count: number): void {
    if (!this.onAppended) return;
    try {
      this.onAppended(worldId, count);
    } catch (error) {
      this.logger.warn('onAppended listener failed', {
        error: errorMessage(error),
      });
    }
  }

  private async loadState(worldId: string): Promise<{
    worldId: string;
    cursorMs: number | null;
    boundary: Map<string, number>;
    lastSeq: number | null;
  }> {
    if (this.state?.worldId === worldId) return this.state;
    const saved = await this.store.read<PumpState>(worldId, 'sessions', PUMP_STATE_FILE);
    const cursorMs = typeof saved?.data.cursorMs === 'number' ? saved.data.cursorMs : null;
    const boundary = new Map<string, number>();
    for (const id of saved?.data.boundaryIds ?? []) {
      if (typeof id === 'string' && cursorMs !== null) boundary.set(id, cursorMs);
    }
    const lastSeq = typeof saved?.data.lastSeq === 'number' ? saved.data.lastSeq : null;
    this.state = { worldId, cursorMs, boundary, lastSeq };
    return this.state;
  }

  private async saveState(worldId: string): Promise<void> {
    if (this.state?.worldId !== worldId) return;
    const data: PumpState = {
      cursorMs: this.state.cursorMs,
      boundaryIds: [...this.state.boundary.keys()],
      lastSeq: this.state.lastSeq,
    };
    await this.store.write(worldId, 'sessions', PUMP_STATE_FILE, data);
  }
}
