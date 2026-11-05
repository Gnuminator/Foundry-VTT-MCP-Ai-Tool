/**
 * What a vault pump (session events, play log) knows about its own health (item play-log-gaps):
 * when it last recorded, its last error, what was lost, and since when it has not been recording.
 * Shown in `get-preflight`. In memory only: a backend restart starts the counts again; the gaps
 * themselves are written into the session log as markers (see {@link gapMarkerLine}).
 */
import { randomBytes } from 'node:crypto';

/** Why a gap marker was written. */
export type GapReason = 'link-down' | 'foundry-reload' | 'ring-wrap';

export interface PumpGap {
  reason: GapReason;
  /** The window that may be missing, ms since epoch. */
  fromMs: number;
  toMs: number;
  /** Records known to be lost (ring wrap), or null when it cannot be known. */
  lost: number | null;
}

export interface PumpHealthSnapshot {
  pump: string;
  /** Last poll that read Foundry and wrote without error, ISO. Null until the first. */
  lastSuccessAt: string | null;
  lastError: { message: string; at: string } | null;
  /** Records known lost since the backend started. */
  lostCount: number;
  /** Gap markers written since the backend started. */
  gapCount: number;
  lastGap: { reason: GapReason; at: string; fromMs: number; toMs: number } | null;
  /** Set while the pump cannot reach Foundry: when it first noticed. */
  notRecordingSince: string | null;
}

export class PumpHealth {
  private lastSuccessMs: number | null = null;
  private lastError: { message: string; at: number } | null = null;
  private lostCount = 0;
  private gapCount = 0;
  private lastGap: { reason: GapReason; at: number; fromMs: number; toMs: number } | null = null;
  private downSinceMs: number | null = null;

  constructor(readonly pump: string) {}

  success(now: number): void {
    this.lastSuccessMs = now;
    this.lastError = null;
    this.downSinceMs = null;
  }

  error(message: string, now: number): void {
    this.lastError = { message, at: now };
  }

  /** The Foundry link was down at this poll; returns when it was first seen down. */
  linkDown(now: number): number {
    this.downSinceMs ??= now;
    return this.downSinceMs;
  }

  /** When the link was first seen down, or null while it is up. */
  get downSince(): number | null {
    return this.downSinceMs;
  }

  /** The link is up again: forgets the outage and returns its start, or null when there was none. */
  linkUp(): number | null {
    const since = this.downSinceMs;
    this.downSinceMs = null;
    return since;
  }

  gap(gap: PumpGap, now: number): void {
    this.gapCount += 1;
    if (gap.lost !== null) this.lostCount += gap.lost;
    this.lastGap = { reason: gap.reason, at: now, fromMs: gap.fromMs, toMs: gap.toMs };
  }

  snapshot(): PumpHealthSnapshot {
    const iso = (ms: number | null): string | null =>
      ms === null ? null : new Date(ms).toISOString();
    return {
      pump: this.pump,
      lastSuccessAt: iso(this.lastSuccessMs),
      lastError: this.lastError
        ? { message: this.lastError.message, at: new Date(this.lastError.at).toISOString() }
        : null,
      lostCount: this.lostCount,
      gapCount: this.gapCount,
      lastGap: this.lastGap
        ? { ...this.lastGap, at: new Date(this.lastGap.at).toISOString() }
        : null,
      notRecordingSince: iso(this.downSinceMs),
    };
  }
}

const REASON_TEXT: Record<GapReason, string> = {
  'link-down': 'the link to Foundry was down',
  'foundry-reload': 'Foundry was reloaded',
  'ring-wrap': 'more happened between two reads than the buffer holds',
};

/** `HH:MM` in the host's local time. */
function clock(ms: number): string {
  const d = new Date(ms);
  const p = (n: number): string => String(n).padStart(2, '0');
  return `${p(d.getHours())}:${p(d.getMinutes())}`;
}

/** The plain words a gap carries in the log and in recaps. */
export function gapDescription(pump: string, gap: PumpGap): string {
  const lost = gap.lost === null ? '' : ` (${gap.lost} lost)`;
  return `Recording gap in the ${pump} log, about ${clock(gap.fromMs)} to ${clock(gap.toMs)}: ${REASON_TEXT[gap.reason]}, so some events may be missing${lost}.`;
}

/**
 * A gap marker as an ordinary line of `sessions/<date>.jsonl`, shaped like the session markers
 * (`eventType`, `timestamp`, `timestampMs`, `description`) so the renderers show it as a row.
 */
export function gapMarkerLine(pump: string, gap: PumpGap, nowMs: number): Record<string, unknown> {
  return {
    id: `gap-${nowMs.toString(36)}-${randomBytes(4).toString('hex')}`,
    timestamp: new Date(nowMs).toISOString(),
    timestampMs: nowMs,
    eventType: 'pump-gap',
    actorName: null,
    description: gapDescription(pump, gap),
    details: {
      source: 'pump',
      pump,
      reason: gap.reason,
      fromMs: gap.fromMs,
      toMs: gap.toMs,
      lost: gap.lost,
    },
  };
}
