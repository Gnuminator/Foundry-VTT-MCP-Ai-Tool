// The GM health line (item gm-health-line): four parts, each a dot and a few words, built from what
// the page already knows about the stream and the bridge. Pure, so the words are tested without a page.
import type { BridgeStatus, StreamLink } from './stream';

/** No status event (the server repeats it every ~17 s) for this long: the page calls itself not live. */
export const STREAM_WATCHDOG_MS = 45_000;
/** A last good poll older than this is amber. */
export const UPDATE_STALE_MS = 30_000;

export type HealthTone = 'ok' | 'warn' | 'bad' | 'unknown';

export interface HealthPart {
  key: 'dashboard' | 'bridge' | 'foundry' | 'update';
  label: string;
  tone: HealthTone;
  text: string;
}

export interface HealthInput {
  link: StreamLink | undefined;
  /** When the last status event (the heartbeat) arrived, ms since the epoch; null before the first. */
  heardAt: number | null;
  status: BridgeStatus | undefined;
  now: number;
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
  if (link.state === 'dropped') return { ...base, tone: 'bad', text: 'reconnecting' };
  if (heardAt !== null && now - heardAt > STREAM_WATCHDOG_MS) {
    return {
      ...base,
      tone: 'bad',
      text: `not live, silent for ${Math.round((now - heardAt) / 1000)} s`,
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

/** The four parts in order: Dashboard, Bridge, Foundry, Last update. */
export function healthParts(input: HealthInput): HealthPart[] {
  return [dashboardPart(input), bridgePart(input), foundryPart(input), updatePart(input)];
}

/** True when any part is red: the line then says so in its first words for a screen reader. */
export function healthTrouble(parts: readonly HealthPart[]): boolean {
  return parts.some(p => p.tone === 'bad');
}
