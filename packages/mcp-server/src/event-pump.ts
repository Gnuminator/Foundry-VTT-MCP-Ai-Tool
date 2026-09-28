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
import type { FoundryClient } from './foundry-client.js';
import type { Logger } from './logger.js';
import type { VaultStore } from './vault/store.js';
import type { WorldIdResolver } from './vault/world-id.js';

export const PUMP_STATE_FILE = 'pump-state.json';
export const DEFAULT_EVENT_POLL_MS = 5000;
/** The module's buffer holds 1000 events; ask for all of them after the cursor. */
const FETCH_LIMIT = 1000;

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
}

export interface EventPumpOptions {
  foundryClient: Pick<FoundryClient, 'query' | 'isConnected'>;
  worldIds: Pick<WorldIdResolver, 'current'>;
  store: VaultStore;
  logger: Logger;
  intervalMs?: number;
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
  private timer: NodeJS.Timeout | null = null;
  private inFlight: Promise<number> | null = null;
  private state: {
    worldId: string;
    cursorMs: number | null;
    boundary: Map<string, number>;
  } | null = null;
  private lastError: string | null = null;

  constructor(options: EventPumpOptions) {
    this.foundry = options.foundryClient;
    this.worldIds = options.worldIds;
    this.store = options.store;
    this.logger = options.logger.child({ component: 'EventPump' });
    this.intervalMs = options.intervalMs ?? DEFAULT_EVENT_POLL_MS;
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
        const message = error instanceof Error ? error.message : String(error);
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
    if (!this.foundry.isConnected()) return 0;
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
    const events = (Array.isArray(response?.events) ? response.events : [])
      .filter(isEvent)
      .filter(e => !state.boundary.has(e.id))
      .sort((a, b) => eventTime(a) - eventTime(b));
    if (events.length === 0) return 0;

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
    return events.length;
  }

  private async loadState(
    worldId: string
  ): Promise<{ worldId: string; cursorMs: number | null; boundary: Map<string, number> }> {
    if (this.state?.worldId === worldId) return this.state;
    const saved = await this.store.read<PumpState>(worldId, 'sessions', PUMP_STATE_FILE);
    const cursorMs = typeof saved?.data.cursorMs === 'number' ? saved.data.cursorMs : null;
    const boundary = new Map<string, number>();
    for (const id of saved?.data.boundaryIds ?? []) {
      if (typeof id === 'string' && cursorMs !== null) boundary.set(id, cursorMs);
    }
    this.state = { worldId, cursorMs, boundary };
    return this.state;
  }

  private async saveState(worldId: string): Promise<void> {
    if (!this.state || this.state.worldId !== worldId) return;
    const data: PumpState = {
      cursorMs: this.state.cursorMs,
      boundaryIds: [...this.state.boundary.keys()],
    };
    await this.store.write(worldId, 'sessions', PUMP_STATE_FILE, data);
  }
}
