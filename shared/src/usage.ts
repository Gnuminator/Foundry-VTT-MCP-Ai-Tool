/**
 * @module usage
 *
 * The usage log (I-084): which controls of the dashboard, the `/player` page
 * and the Foundry module people actually use, and which they never use. Plan:
 * `docs/design/USAGE-LOG.md`.
 *
 * Events are meaningful actions only (a view opened, a control used, a tool
 * run, a shortcut, an error shown), named by fixed control names. They never
 * carry typed text, tool arguments, setting values, document ids or error
 * messages: only the name, the kind, who, and a few numbers or codes.
 *
 * Paths:
 * - dashboard and `/player` → `POST /api/usage` / `POST /api/player/usage` →
 *   the control method `record_usage` → the bridge's `UsageLog`;
 * - Foundry module → a buffer in the GM client (players send theirs over the
 *   module socket) → the query `foundry-mcp-bridge.getUsageRecords` → the
 *   bridge's usage pump → `UsageLog`.
 * `UsageLog` appends to `<dataDir>/<worldId>/sessions/<local-date>.usage.jsonl`.
 *
 * The Foundry module keeps its own copy of these types (it does not import
 * this package at runtime); a contract test compares the constants.
 */

export const USAGE_KINDS = ['view', 'action', 'tool', 'shortcut', 'error'] as const;
export type UsageKind = (typeof USAGE_KINDS)[number];

export const USAGE_SURFACES = ['dashboard', 'player', 'module'] as const;
export type UsageSurface = (typeof USAGE_SURFACES)[number];

/** Name prefix each surface must use (tools use `tool.<tool-name>` on the dashboard). */
export const USAGE_NAME_PREFIX: Record<UsageSurface, readonly string[]> = {
  dashboard: ['dash.', 'tool.'],
  player: ['player.'],
  module: ['module.'],
};

/**
 * Control names: lowercase dot-separated segments, 2 to 5 of them, at most 80
 * characters, e.g. `dash.tarokka.draw`, `player.handouts.open`,
 * `module.chat.roll-button`, `tool.get-world-info`.
 */
export const USAGE_NAME_RE = /^[a-z][a-z0-9-]*(\.[a-z0-9-]+){1,4}$/;
export const USAGE_NAME_MAX = 80;

export const USAGE_OUTCOMES = ['ok', 'error', 'cancelled'] as const;
export type UsageOutcome = (typeof USAGE_OUTCOMES)[number];

/** Error codes: short machine words such as `timeout`, `403`, `gm-required`. */
export const USAGE_CODE_RE = /^[a-z0-9][a-z0-9-]{0,39}$/;

export const USAGE_LIMITS = {
  /** Events per batch (a browser flush or one `record_usage` call). */
  maxBatch: 100,
  /** Serialized batch size. */
  maxBatchBytes: 32 * 1024,
  /** Events kept in memory while no world is known (bridge) or not yet pumped (module). */
  maxBuffered: 5000,
  /** Timestamps further ahead of the receiver's clock than this are clamped. */
  maxClockSkewMs: 5 * 60 * 1000,
  /** A single view report never claims more than this. */
  maxDurationMs: 12 * 60 * 60 * 1000,
  maxCount: 1000,
  maxIdLength: 64,
  maxUserNameLength: 64,
} as const;

export type UsageRole = 'gm' | 'player';

export interface UsageWho {
  role: UsageRole;
  /** Foundry user id when known (module events, a player's name pick). */
  userId: string | null;
  /** Foundry user name when known. */
  name: string | null;
}

export interface UsageEvent {
  v: 1;
  /** `${clientId}:${seq}`: unique per page load, used to drop duplicates. */
  key: string;
  /** Epoch milliseconds. */
  t: number;
  seq: number;
  /** Random id per page load (browser tab or Foundry client). */
  clientId: string;
  surface: UsageSurface;
  kind: UsageKind;
  name: string;
  who: UsageWho;
  /** view only: visible time since the last view report. */
  durationMs?: number;
  /** tool only. */
  outcome?: UsageOutcome;
  /** error only (also a failed tool): a short code, never the message. */
  code?: string;
  /** Repeats of the same event merged within one flush. */
  count?: number;
}

/** Reply of the module query `foundry-mcp-bridge.getUsageRecords` (the `PlayRecordsResponse` shape). */
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

/** File name of one local day's usage log inside the world's `sessions` folder. */
export function usageLogFileName(dateKey: string): string {
  return `${dateKey}.usage.jsonl`;
}

/** Matches a usage log file name and captures its date key. */
export const USAGE_LOG_FILE_RE = /^(\d{4}-\d{2}-\d{2})\.usage\.jsonl$/;

/**
 * Old control names mapped to their current names, so history survives a
 * redesign that renames controls. Keys and values are full names.
 */
export const USAGE_ALIASES: Readonly<Record<string, string>> = {};

/** Resolve a name through {@link USAGE_ALIASES} (one hop). */
export function canonicalUsageName(name: string): string {
  return USAGE_ALIASES[name] ?? name;
}

export function isUsageName(value: unknown): value is string {
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

export interface SanitizeUsageOptions {
  /** Receiver's clock (epoch ms); defaults to `Date.now()`. */
  now?: number;
  /** When given, the event must use this surface (the server decides, not the browser). */
  surface?: UsageSurface;
  /** When given, replaces the event's `who` (the server decides for GM and module events). */
  who?: UsageWho;
}

/**
 * Validate one incoming event and return a clean copy, or `null` when it is
 * not a usage event. Unknown fields are dropped, so nothing free-form survives.
 * Checks: surface and kind known, name format and surface prefix, `tool` kind
 * only on the dashboard, key equal to `${clientId}:${seq}`, numbers bounded,
 * timestamps clamped to the receiver's clock.
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

/**
 * Sanitize a whole batch: at most {@link USAGE_LIMITS.maxBatch} events are
 * looked at; invalid ones are counted as dropped.
 */
export function sanitizeUsageBatch(
  raw: unknown,
  options: SanitizeUsageOptions = {}
): { events: UsageEvent[]; dropped: number } {
  if (!Array.isArray(raw)) return { events: [], dropped: 0 };
  const events: UsageEvent[] = [];
  let dropped = Math.max(0, raw.length - USAGE_LIMITS.maxBatch);
  for (const item of raw.slice(0, USAGE_LIMITS.maxBatch)) {
    const clean = sanitizeUsageEvent(item, options);
    if (clean) events.push(clean);
    else dropped += 1;
  }
  return { events, dropped };
}

/** `record_usage` control-method params and result. */
export interface RecordUsageParams {
  events: UsageEvent[];
}
export interface RecordUsageResult {
  accepted: number;
  dropped: number;
}

/** One entry of the generated control catalogue (`usage-catalog.generated.ts`). */
export interface UsageCatalogEntry {
  name: string;
  kind: UsageKind;
  surface: UsageSurface;
  /** Repo-relative file the name was found in. */
  file: string;
}
