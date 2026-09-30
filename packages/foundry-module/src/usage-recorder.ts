import { MODULE_ID } from './constants.js';
import { isBridgeUser } from './settings.js';

/**
 * UsageRecorder: the module's side of the usage log (I-084, plan in
 * `docs/design/USAGE-LOG.md`, contract in `shared/src/usage.ts`).
 *
 * It records which Foundry-side controls people use (roll buttons, the Tarokka
 * offer, the settings menus, status toggles, error notices), by fixed control
 * name only: never typed text, setting values, document ids or error messages.
 *
 * Paths:
 * - Every client collects its own events in an outbox and flushes it every
 *   10 s (and when the page is hidden).
 * - A GM client that holds the bridge link (`isBridgeUser`, see `settings.ts`)
 *   moves its own events straight into a 2,000-event ring buffer (Foundry does
 *   not deliver a client's own socket emit back to it). Everyone else, and a GM
 *   when another GM may hold the link ("Any GM" with a second GM online),
 *   emits the batch on the module socket: `{ type: 'usageEvents', userId,
 *   events }`.
 * - The holder's socket handler (`main.ts`) passes a received batch to
 *   {@link UsageRecorder.receive}, which sanitizes it and sets `who` from
 *   `game.users`. The sender argument Foundry passes to a socket handler is the
 *   authenticated user id (the server appends `this.user.id`), so it wins over
 *   the `userId` in the payload.
 * - The GM-gated query `foundry-mcp-bridge.getUsageRecords` returns the buffer
 *   in the `PlayRecordsResponse` shape; the bridge's usage pump uses the
 *   response's `clientId`, `oldestSeq` and `latestSeq` as its cursor (the
 *   buffer's own numbering, see {@link UsageRecorder.getUsageRecords}).
 *
 * The module does not import `shared` at runtime (a bare package specifier
 * cannot load in the browser), so the contract below is copied and a contract
 * test (`usage-recorder.contract.test.ts`) pins it to `shared/src/usage.ts`.
 */

// ---------------------------------------------------------------------------
// Copy of the shared contract (pinned by usage-recorder.contract.test.ts)
// ---------------------------------------------------------------------------

export const USAGE_KINDS = ['view', 'action', 'tool', 'shortcut', 'error'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const USAGE_SURFACES = ['dashboard', 'player', 'module'] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];

export const USAGE_NAME_PREFIX: Record<UsageSurface, readonly string[]> = {
  dashboard: ['dash.', 'tool.'],
  player: ['player.'],
  module: ['module.'],
};

export const USAGE_NAME_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+){1,4}$/;
export const USAGE_NAME_MAX = 80;

export const USAGE_OUTCOMES = ['ok', 'error', 'cancelled'] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

export const USAGE_CODE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const USAGE_LIMITS = {
  maxBatch: 100,
  maxBatchBytes: 32 * 1024,
  maxBuffered: 5000,
  maxClockSkewMs: 5 * 60 * 1000,
  maxDurationMs: 12 * 60 * 60 * 1000,
  maxCount: 1000,
  maxIdLength: 64,
  maxUserNameLength: 64,
} as const;

export type UsageRole = 'gm' | 'player';

export interface UsageWho {
  role: UsageRole;
  userId: string | null;
  name: string | null;
}

export interface UsageEvent {
  v: 1;
  key: string;
  t: number;
  seq: number;
  clientId: string;
  surface: UsageSurface;
  kind: UsageKind;
  name: string;
  who: UsageWho;
  durationMs?: number;
  outcome?: UsageOutcome;
  code?: string;
  count?: number;
}

/** Response of the module query `foundry-mcp-bridge.getUsageRecords` (the `PlayRecordsResponse` shape). */
export interface UsageRecordsResponse {
  success: boolean;
  error?: string;
  /** Random per page load; a new id means the sequence restarted. */
  clientId: string;
  /** Events with buffer seq above `sinceSeq`, oldest first, at most `limit`. */
  records: UsageEvent[];
  oldestSeq: number;
  latestSeq: number;
}

interface SanitizeUsageOptions {
  now?: number;
  surface?: UsageSurface;
  who?: UsageWho;
}

function isUsageName(value: unknown): value is string {
  return typeof value === 'string' && value.length <= USAGE_NAME_MAX && USAGE_NAME_RE.test(value);
}

function isSafeId(value: unknown): value is string {
  return (
    typeof value === 'string' &&
    value.length > 0 &&
    value.length <= USAGE_LIMITS.maxIdLength &&
    /^[A-Za-z0-9_-]+$/.test(value)
  );
}

function boundedInt(value: unknown, min: number, max: number): number | undefined {
  if (typeof value !== 'number' || !Number.isFinite(value)) return undefined;
  const n = Math.round(value);
  if (n < min) return undefined;
  return Math.min(n, max);
}

function cleanUserName(value: unknown): string | null {
  if (typeof value !== 'string') return null;
  // eslint-disable-next-line no-control-regex
  const trimmed = value.replace(/[\u0000-\u001f]/g, '').trim();
  return trimmed ? trimmed.slice(0, USAGE_LIMITS.maxUserNameLength) : null;
}

/**
 * Validate one incoming event and return a clean copy, or null (copy of
 * `sanitizeUsageEvent` in `shared/src/usage.ts`; unknown fields are dropped).
 */
export function sanitizeUsageEvent(
  raw: unknown,
  options: SanitizeUsageOptions = {}
): UsageEvent | null {
  if (!raw || typeof raw !== 'object') return null;
  const r = raw as Record<string, unknown>;
  const surface = options.surface ?? r.surface;
  if (typeof surface !== 'string' || !(USAGE_SURFACES as readonly string[]).includes(surface)) {
    return null;
  }
  const s = surface as UsageSurface;
  if (typeof r.kind !== 'string' || !(USAGE_KINDS as readonly string[]).includes(r.kind)) {
    return null;
  }
  const kind = r.kind as UsageKind;
  if (kind === 'tool' && s !== 'dashboard') return null;
  if (!isUsageName(r.name)) return null;
  const name = r.name;
  if (!USAGE_NAME_PREFIX[s].some(prefix => name.startsWith(prefix))) return null;
  if (kind === 'tool' && !name.startsWith('tool.')) return null;
  if (kind !== 'tool' && name.startsWith('tool.')) return null;

  if (!isSafeId(r.clientId)) return null;
  const seq = boundedInt(r.seq, 0, Number.MAX_SAFE_INTEGER);
  if (seq === undefined) return null;
  const key = `${r.clientId}:${seq}`;

  const now = options.now ?? Date.now();
  let t = typeof r.t === 'number' && Number.isFinite(r.t) ? Math.round(r.t) : now;
  if (t > now + USAGE_LIMITS.maxClockSkewMs) t = now;
  if (t < 0) t = now;

  let who: UsageWho;
  if (options.who) {
    who = { ...options.who };
  } else {
    const w = (r.who ?? {}) as Record<string, unknown>;
    const role: UsageRole = w.role === 'gm' ? 'gm' : 'player';
    who = {
      role,
      userId: isSafeId(w.userId) ? w.userId : null,
      name: cleanUserName(w.name),
    };
  }

  const event: UsageEvent = {
    v: 1,
    key,
    t,
    seq,
    clientId: r.clientId,
    surface: s,
    kind,
    name,
    who,
  };
  if (kind === 'view') {
    const d = boundedInt(r.durationMs, 0, USAGE_LIMITS.maxDurationMs);
    if (d !== undefined) event.durationMs = d;
  }
  if (kind === 'tool' && typeof r.outcome === 'string') {
    if ((USAGE_OUTCOMES as readonly string[]).includes(r.outcome)) {
      event.outcome = r.outcome as UsageOutcome;
    }
  }
  if ((kind === 'error' || kind === 'tool') && typeof r.code === 'string') {
    if (USAGE_CODE_RE.test(r.code)) event.code = r.code;
  }
  const count = boundedInt(r.count, 1, USAGE_LIMITS.maxCount);
  if (count !== undefined && count > 1) event.count = count;
  return event;
}

/** Copy of `sanitizeUsageBatch` in the shared contract. */
export function sanitizeUsageBatch(
  raw: unknown,
  options: SanitizeUsageOptions = {}
): { events: UsageEvent[]; dropped: number } {
  if (!Array.isArray(raw)) return { events: [], dropped: 0 };
  const events: UsageEvent[] = [];
  let dropped = Math.max(0, raw.length - USAGE_LIMITS.maxBatch);
  for (const item of (raw as unknown[]).slice(0, USAGE_LIMITS.maxBatch)) {
    const clean = sanitizeUsageEvent(item, options);
    if (clean) events.push(clean);
    else dropped += 1;
  }
  return { events, dropped };
}

// ---------------------------------------------------------------------------
// Recorder
// ---------------------------------------------------------------------------

/** The module socket channel (`module.<module id>`). */
export const USAGE_SOCKET_CHANNEL = `module.${MODULE_ID}`;
/** `type` of the socket message that carries a client's usage events. */
export const USAGE_SOCKET_TYPE = 'usageEvents';

/** Ring buffer size on the GM client that holds the bridge link. */
export const USAGE_BUFFER_MAX = 2000;
/** How often every client flushes its own events. */
export const USAGE_FLUSH_INTERVAL_MS = 10_000;
/** Events per socket message (well under `USAGE_LIMITS.maxBatch` and the byte limit). */
const SOCKET_CHUNK = 50;
const DEFAULT_LIMIT = 2000;
const MAX_LIMIT = 5000;

const UNKNOWN_WHO: UsageWho = { role: 'player', userId: null, name: null };

/** Optional fields of a tracked event. */
export interface UsageExtra {
  durationMs?: number;
  outcome?: UsageOutcome;
  /** A short machine word (`timeout`, `save-failed`), never a message. */
  code?: string;
}

interface BufferEntry {
  /** The buffer's own sequence number (what `sinceSeq` / `latestSeq` mean). */
  bseq: number;
  event: UsageEvent;
}

function num(v: unknown): number | undefined {
  return typeof v === 'number' && Number.isFinite(v) ? v : undefined;
}

function str(v: unknown): string | undefined {
  return typeof v === 'string' && v.length > 0 ? v : undefined;
}

function randomClientId(): string {
  try {
    if (typeof foundry !== 'undefined') return foundry.utils.randomID(16);
  } catch {
    // fall through
  }
  return `ur-${Date.now().toString(36)}-${Math.random().toString(36).slice(2, 10)}`;
}

export class UsageRecorder {
  private readonly clientId = randomClientId();
  private seq = 0;
  /** This client's own events, waiting for the next flush (identical neighbours merged). */
  private outbox: UsageEvent[] = [];
  /** Holder only: own and received events, oldest first. */
  private buffer: BufferEntry[] = [];
  private bufferSeq = 0;
  private readonly bufferKeys = new Set<string>();
  private timer: ReturnType<typeof setInterval> | null = null;
  private pageListenersAdded = false;

  // -------------------------------------------------------------------------
  // Who am I
  // -------------------------------------------------------------------------

  /** The signed-in user as a `who`, or null before `game.user` exists. */
  private ownWho(): UsageWho | null {
    const user = game?.user;
    if (!user) return null;
    return {
      role: user.isGM ? 'gm' : 'player',
      userId: str(user.id) ?? null,
      name: cleanUserName(user.name),
    };
  }

  /**
   * Whether this client keeps the buffer the backend polls: a GM whose browser
   * is the bridge user (or any GM while the `bridgeUserId` setting is "Any GM").
   */
  isBufferHolder(): boolean {
    if (game?.user?.isGM !== true) return false;
    try {
      return isBridgeUser(game.settings.get(MODULE_ID, 'bridgeUserId'), game.user.id);
    } catch {
      return true;
    }
  }

  /** Whether a second GM may hold the buffer too, so a GM's own events should also go over the socket. */
  private peersMayHold(): boolean {
    try {
      const setting: unknown = game.settings.get(MODULE_ID, 'bridgeUserId');
      const any = typeof setting !== 'string' || setting === '';
      if (!any) return false;
      return game.users.some(u => u.isGM && u.active && u.id !== game.user?.id);
    } catch {
      return false;
    }
  }

  private anotherGmIsActive(): boolean {
    try {
      return game.users.some(u => u.isGM && u.active && u.id !== game.user?.id);
    } catch {
      return false;
    }
  }

  // -------------------------------------------------------------------------
  // Recording
  // -------------------------------------------------------------------------

  /**
   * Record one use of a control. `name` must be a fixed `module.*` control name
   * written as a literal at the call site (`trackUsage('action', 'module.x.y')`),
   * so the catalogue script can find it. Invalid input is dropped; this never throws.
   */
  trackUsage(kind: UsageKind, name: string, extra: UsageExtra = {}): void {
    try {
      const last = this.outbox[this.outbox.length - 1];
      if (
        last &&
        kind !== 'view' &&
        last.kind === kind &&
        last.name === name &&
        last.code === extra.code &&
        last.outcome === extra.outcome &&
        last.durationMs === undefined &&
        extra.durationMs === undefined
      ) {
        last.count = Math.min((last.count ?? 1) + 1, USAGE_LIMITS.maxCount);
        return;
      }
      const raw: Record<string, unknown> = {
        clientId: this.clientId,
        seq: this.seq + 1,
        t: Date.now(),
        kind,
        name,
        ...extra,
      };
      const event = sanitizeUsageEvent(raw, { surface: 'module', who: UNKNOWN_WHO });
      if (!event) return;
      this.seq += 1;
      this.outbox.push(event);
      if (this.outbox.length > USAGE_LIMITS.maxBuffered) {
        this.outbox.splice(0, this.outbox.length - USAGE_LIMITS.maxBuffered);
      }
    } catch (error) {
      console.warn(`[${MODULE_ID}] UsageRecorder failed to record an event:`, error);
    }
  }

  // -------------------------------------------------------------------------
  // Flush
  // -------------------------------------------------------------------------

  /** Start the 10 s flush timer and flush when the page is hidden (safe to call twice). */
  start(): void {
    if (this.timer === null) {
      this.timer = setInterval(() => this.flush(), USAGE_FLUSH_INTERVAL_MS);
    }
    if (!this.pageListenersAdded && typeof window !== 'undefined' && window.addEventListener) {
      this.pageListenersAdded = true;
      window.addEventListener('pagehide', () => this.flush());
      if (typeof document !== 'undefined') {
        document.addEventListener('visibilitychange', () => {
          if (document.visibilityState === 'hidden') this.flush();
        });
      }
    }
  }

  stop(): void {
    if (this.timer !== null) {
      clearInterval(this.timer);
      this.timer = null;
    }
  }

  /**
   * Send this client's waiting events on their way. The holder moves them into
   * its buffer; a non-holder emits them on the module socket and, while no other
   * GM is online to receive them, keeps them for the next flush.
   */
  flush(): void {
    try {
      if (this.outbox.length === 0) return;
      const who = this.ownWho();
      if (!who) return;

      if (this.isBufferHolder()) {
        const events = this.outbox;
        this.outbox = [];
        for (const event of events) this.addToBuffer({ ...event, who });
        if (this.peersMayHold()) this.emit(events);
        return;
      }

      if (!this.anotherGmIsActive()) return; // nobody to receive it yet; try again later
      const events = this.outbox;
      this.outbox = [];
      this.emit(events);
    } catch (error) {
      console.warn(`[${MODULE_ID}] UsageRecorder flush failed:`, error);
    }
  }

  private emit(events: UsageEvent[]): void {
    const socket = game?.socket;
    const userId = game?.user?.id;
    if (!socket || !userId) return;
    for (let i = 0; i < events.length; i += SOCKET_CHUNK) {
      const chunk = events.slice(i, i + SOCKET_CHUNK).map(e => {
        // `who` is not sent: the receiver sets it from the authenticated sender.
        const out: Record<string, unknown> = {
          clientId: e.clientId,
          seq: e.seq,
          t: e.t,
          kind: e.kind,
          name: e.name,
        };
        if (e.count !== undefined) out.count = e.count;
        if (e.code !== undefined) out.code = e.code;
        if (e.outcome !== undefined) out.outcome = e.outcome;
        if (e.durationMs !== undefined) out.durationMs = e.durationMs;
        return out;
      });
      socket.emit(USAGE_SOCKET_CHANNEL, { type: USAGE_SOCKET_TYPE, userId, events: chunk });
    }
  }

  // -------------------------------------------------------------------------
  // Holder side: buffer, receive, query
  // -------------------------------------------------------------------------

  private addToBuffer(event: UsageEvent): void {
    if (this.bufferKeys.has(event.key)) return; // a peer GM already forwarded it
    this.bufferSeq += 1;
    this.buffer.push({ bseq: this.bufferSeq, event });
    this.bufferKeys.add(event.key);
    if (this.buffer.length > USAGE_BUFFER_MAX) {
      const removed = this.buffer.splice(0, this.buffer.length - USAGE_BUFFER_MAX);
      for (const entry of removed) this.bufferKeys.delete(entry.event.key);
    }
  }

  /**
   * The socket handler's `usageEvents` branch: runs only on the GM client that
   * holds the buffer. `senderId` is the second argument Foundry passes to a
   * socket handler (the authenticated sender); the payload's `userId` is used
   * only when it is missing. Returns how many events were accepted.
   */
  receive(data: unknown, senderId?: unknown): number {
    try {
      if (!this.isBufferHolder()) return 0;
      const payload =
        data !== null && typeof data === 'object' ? (data as Record<string, unknown>) : {};
      const userId = str(senderId) ?? str(payload.userId);
      if (!userId || userId === game.user?.id) return 0;
      const user = game.users.get(userId);
      if (!user) return 0;
      const who: UsageWho = {
        role: user.isGM ? 'gm' : 'player',
        userId: str(user.id) ?? userId,
        name: cleanUserName(user.name),
      };
      const { events } = sanitizeUsageBatch(payload.events, { surface: 'module', who });
      for (const event of events) this.addToBuffer(event);
      return events.length;
    } catch (error) {
      console.warn(`[${MODULE_ID}] UsageRecorder failed to read a usage message:`, error);
      return 0;
    }
  }

  /**
   * Module query `foundry-mcp-bridge.getUsageRecords` (GM-gated by the caller).
   * Same cursor as `getPlayRecords`: `clientId` (this page load), `oldestSeq`
   * and `latestSeq` are the buffer's own numbering, not the events' `seq`
   * (events from other clients carry their own client id and seq; `key` is what
   * the backend de-duplicates on).
   */
  getUsageRecords(data: { sinceSeq?: unknown; limit?: unknown } | undefined): UsageRecordsResponse {
    const sinceSeqRaw = num(data?.sinceSeq);
    const sinceSeq = sinceSeqRaw !== undefined && sinceSeqRaw >= 0 ? Math.trunc(sinceSeqRaw) : 0;
    const requested = num(data?.limit) ?? DEFAULT_LIMIT;
    const limit = Math.min(Math.max(Math.trunc(requested), 1), MAX_LIMIT);
    // Own events still waiting for the flush are included, so a poll never lags by 10 s.
    if (this.isBufferHolder()) this.flush();
    const records = this.buffer
      .filter(e => e.bseq > sinceSeq)
      .slice(0, limit)
      .map(e => e.event);
    return {
      success: true,
      clientId: this.clientId,
      records,
      oldestSeq: this.buffer[0]?.bseq ?? 0,
      latestSeq: this.buffer[this.buffer.length - 1]?.bseq ?? 0,
    };
  }
}

export const usageRecorder = new UsageRecorder();

/**
 * Record one use of a module control. Call sites pass literals
 * (`trackUsage('action', 'module.chat.roll-button')`) so `scripts/usage-catalog.mjs`
 * can list every control.
 */
export function trackUsage(kind: UsageKind, name: string, extra?: UsageExtra): void {
  usageRecorder.trackUsage(kind, name, extra);
}
