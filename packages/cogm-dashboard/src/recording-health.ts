/**
 * The Recorder and Play log dots of the GM health line (item health-line-dots). Each is hidden
 * (null) when all is well, and shows plain words when something is wrong. A source that cannot be
 * reached shows "unknown", never OK: a silent bot must not look like a healthy one.
 *
 * - Recorder: the Discord bot's status endpoint (`DASHBOARD_BOT_STATUS_URL`), only while a
 *   recording runs; no URL configured means no dot.
 * - Play log: the session events and play log pumps' health, read through `get-preflight` with
 *   `action: "pumps"`.
 */

export type DotTone = 'warn' | 'bad' | 'unknown';

export interface HealthDot {
  tone: DotTone;
  /** The words after the label in the line, short. */
  text: string;
  /** The full words for hover. */
  detail: string;
}

/** What the page receives (GM stream event `recording-health`). Null: nothing to show. */
export interface RecordingHealth {
  recorder: HealthDot | null;
  playLog: HealthDot | null;
}

/** A pump's health as `get-preflight` action "pumps" returns it (mcp-server pump-health.ts). */
export interface PumpSnapshot {
  pump: string;
  lastSuccessAt: string | null;
  lastError: { message: string; at: string } | null;
  lostCount: number;
  gapCount: number;
  lastGap: { reason: string; at: string; fromMs: number; toMs: number } | null;
  notRecordingSince: string | null;
}

/** A gap older than this no longer keeps the dot on (the same 3 h as the pre-flight check). */
export const RECENT_GAP_MS = 3 * 60 * 60 * 1000;

function clock(iso: string): string {
  const d = new Date(iso);
  return Number.isNaN(d.getTime())
    ? iso
    : d.toLocaleTimeString([], { hour: '2-digit', minute: '2-digit' });
}

/** The Play log dot from the pumps' snapshots; null reading = the bridge could not be asked. */
export function playLogDot(pumps: PumpSnapshot[] | null, now: number): HealthDot | null {
  if (pumps === null) {
    return {
      tone: 'unknown',
      text: 'unknown',
      detail: 'The play log cannot be checked right now (the bridge did not answer).',
    };
  }
  const down: string[] = [];
  const lossy: string[] = [];
  for (const p of pumps) {
    if (p.notRecordingSince) {
      down.push(`the ${p.pump} log has not been recording since ${clock(p.notRecordingSince)}`);
    } else if (p.lastError) {
      lossy.push(
        `the ${p.pump} log had an error at ${clock(p.lastError.at)}: ${p.lastError.message}`
      );
    }
    if (p.lastGap && now - Date.parse(p.lastGap.at) < RECENT_GAP_MS) {
      const lost = p.lostCount > 0 ? `, ${p.lostCount} lost` : '';
      lossy.push(`the ${p.pump} log has a gap at ${clock(p.lastGap.at)}${lost}`);
    }
  }
  if (down.length > 0) {
    return { tone: 'bad', text: 'not recording', detail: `${[...down, ...lossy].join('; ')}.` };
  }
  if (lossy.length > 0) {
    return {
      tone: 'warn',
      text: 'gaps',
      detail: `${lossy.join('; ')}. A gap marker is in the session log.`,
    };
  }
  return null;
}

/** The bot's answer (feeds `GET /status`); null = unreachable or unreadable. */
export interface BotAnswer {
  recording: boolean;
  problems: Array<{ kind: 'silent' | 'stream' | 'rejoin'; text: string }>;
}

/** The Recorder dot; null when no recording runs or all is well. */
export function recorderDot(answer: BotAnswer | null): HealthDot | null {
  if (answer === null) {
    return {
      tone: 'unknown',
      text: 'unknown',
      detail:
        'The recording bot does not answer, so it cannot be seen whether a recording is healthy.',
    };
  }
  if (!answer.recording || answer.problems.length === 0) return null;
  const rejoin = answer.problems.some(p => p.kind === 'rejoin');
  const first = answer.problems[0].text;
  const more = answer.problems.length - 1;
  return {
    tone: rejoin ? 'bad' : 'warn',
    text: more > 0 ? `${first} (+${more} more)` : first,
    detail: `${answer.problems.map(p => p.text).join('; ')}.`,
  };
}

function isBotAnswer(v: unknown): v is BotAnswer {
  if (v === null || typeof v !== 'object') return false;
  const o = v as Record<string, unknown>;
  const problems = o['problems'];
  return (
    typeof o['recording'] === 'boolean' &&
    Array.isArray(problems) &&
    problems.every(p => {
      if (p === null || typeof p !== 'object') return false;
      const q = p as Record<string, unknown>;
      return (
        (q['kind'] === 'silent' || q['kind'] === 'stream' || q['kind'] === 'rejoin') &&
        typeof q['text'] === 'string'
      );
    })
  );
}

export interface RecordingHealthSources {
  /** The bot's status URL; empty means there is no Recorder dot. */
  botStatusUrl: string;
  /** Pump snapshots, or null when the bridge cannot be asked. */
  readPumps: () => Promise<PumpSnapshot[] | null>;
  fetchImpl?: typeof fetch;
  now?: () => number;
}

/** Asks the bot and the bridge once and builds what the page shows. */
export async function readRecordingHealth(src: RecordingHealthSources): Promise<RecordingHealth> {
  const doFetch = src.fetchImpl ?? fetch;
  const now = (src.now ?? Date.now)();
  let recorder: HealthDot | null = null;
  if (src.botStatusUrl) {
    const answer = await doFetch(src.botStatusUrl, { signal: AbortSignal.timeout(3000) })
      .then(async res => (res.ok ? ((await res.json()) as unknown) : null))
      .catch(() => null);
    recorder = recorderDot(isBotAnswer(answer) ? answer : null);
  }
  const pumps = await src.readPumps().catch(() => null);
  return { recorder, playLog: playLogDot(pumps, now) };
}
