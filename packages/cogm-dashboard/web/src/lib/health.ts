// The GM health line (item gm-health-line): four parts, each a dot and a few words, built from what
// the page already knows about the stream and the bridge. Pure, so the words are tested without a page.
import {
  STREAM_DROP_GRACE_MS,
  type BridgeStatus,
  type RecordingDot,
  type RecordingHealth,
  type StreamLink,
} from './stream';

/** No status event (the server repeats it every ~17 s) for this long: the page calls itself not live. */
export const STREAM_WATCHDOG_MS = 45_000;
/** A last good poll older than this is amber. */
export const UPDATE_STALE_MS = 30_000;

export type HealthTone = 'ok' | 'warn' | 'bad' | 'unknown';

export interface HealthPart {
  key: 'dashboard' | 'bridge' | 'foundry' | 'update' | 'recorder' | 'playlog';
  label: string;
  tone: HealthTone;
  text: string;
  /** Longer plain words for hover (only the Recorder and Play log dots carry one). */
  detail?: string;
}

export interface HealthInput {
  link: StreamLink | undefined;
  /** When the last status event (the heartbeat) arrived, ms since the epoch; null before the first. */
  heardAt: number | null;
  status: BridgeStatus | undefined;
  now: number;
  /** The Recorder and Play log dots from the server; each null or absent when all is well. */
  recording?: RecordingHealth | undefined;
}

/** "12 s ago", "3 min ago", "2 h ago". */
export function ageText(ms: number): string {
  const s = Math.max(0, Math.round(ms / 1000));
  if (s < 90) return `${s} s ago`;
  const m = Math.round(s / 60);
  if (m < 90) return `${m} min ago`;
  return `${Math.round(m / 60)} h ago`;
}

function clock(iso: string | null): string | null {
  if (!iso) return null;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return null;
  return d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

function dashboardPart({ link, heardAt, now }: HealthInput): HealthPart {
  const base = { key: 'dashboard', label: 'Dashboard' } as const;
  if (!link) return { ...base, tone: 'unknown', text: 'connecting' };
  if (link.state === 'closed') return { ...base, tone: 'bad', text: 'closed, reload the page' };
  if (link.state === 'dropped') {
    // A blink reconnects in seconds: amber inside the same grace the header mark uses, red after.
    const tone = now - link.since < STREAM_DROP_GRACE_MS ? 'warn' : 'bad';
    return { ...base, tone, text: 'reconnecting' };
  }
  if (heardAt !== null && now - heardAt > STREAM_WATCHDOG_MS) {
    return {
      ...base,
      tone: 'bad',
      text: `not live, silent for ${Math.round((now - heardAt) / 1000)} s, reload the page`,
    };
  }
  return {
    ...base,
    tone: heardAt === null ? 'unknown' : 'ok',
    text: heardAt === null ? 'connecting' : 'live',
  };
}

function bridgePart({ status }: HealthInput): HealthPart {
  const base = { key: 'bridge', label: 'Bridge' } as const;
  if (!status) return { ...base, tone: 'unknown', text: 'waiting' };
  return status.controlChannel === 'connected'
    ? { ...base, tone: 'ok', text: 'connected' }
    : { ...base, tone: 'bad', text: 'away' };
}

function foundryPart({ status }: HealthInput): HealthPart {
  const base = { key: 'foundry', label: 'Foundry' } as const;
  if (!status) return { ...base, tone: 'unknown', text: 'waiting' };
  if (status.foundry === 'reachable') return { ...base, tone: 'ok', text: 'reachable' };
  if (status.foundry === 'unreachable') {
    const since = clock(status.foundryDownSince);
    return { ...base, tone: 'bad', text: since ? `down since ${since}` : 'down' };
  }
  return { ...base, tone: 'warn', text: 'not sure' };
}

function updatePart({ status, now }: HealthInput): HealthPart {
  const base = { key: 'update', label: 'Last update' } as const;
  const at = status?.lastPollAt ? Date.parse(status.lastPollAt) : NaN;
  if (Number.isNaN(at)) return { ...base, tone: 'unknown', text: 'none yet' };
  const age = now - at;
  return { ...base, tone: age > UPDATE_STALE_MS ? 'warn' : 'ok', text: ageText(age) };
}

function extraPart(
  key: 'recorder' | 'playlog',
  label: string,
  dot: RecordingDot | null | undefined
): HealthPart[] {
  return dot ? [{ key, label, tone: dot.tone, text: dot.text, detail: dot.detail }] : [];
}

/**
 * The four parts in order: Dashboard, Bridge, Foundry, Last update; then Recorder and Play log,
 * each only while it has something to say (nothing extra when all is well).
 */
export function healthParts(input: HealthInput): HealthPart[] {
  return [
    dashboardPart(input),
    bridgePart(input),
    foundryPart(input),
    updatePart(input),
    ...extraPart('recorder', 'Recorder', input.recording?.recorder),
    ...extraPart('playlog', 'Play log', input.recording?.playLog),
  ];
}

/** True when any part is red (the line carries `data-trouble` then). */
export function healthTrouble(parts: readonly HealthPart[]): boolean {
  return parts.some(p => p.tone === 'bad');
}
