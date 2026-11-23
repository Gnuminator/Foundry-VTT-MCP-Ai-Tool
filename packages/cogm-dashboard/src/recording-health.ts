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
  /** Speaking time per person while a recording runs (spotlight balance); absent otherwise. */
  speaking?: SpeakerTime[];
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
const RECENT_GAP_MS = 3 * 60 * 60 * 1000;

/**
 * A time in a detail text goes out as `[[time:<ISO>]]`; the page turns it into the GM's own clock
 * (web/src/lib/health.ts), because this server may run on the Pi, in another time zone.
 */
function clock(iso: string): string {
  return `[[time:${iso}]]`;
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
  let recentGap = false;
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
      recentGap = true;
      lossy.push(`the ${p.pump} log has a gap at ${clock(p.lastGap.at)}${lost}`);
    }
  }
  if (down.length > 0) {
    return { tone: 'bad', text: 'not recording', detail: `${[...down, ...lossy].join('; ')}.` };
  }
  if (lossy.length > 0) {
    const hasError = pumps.some(p => p.lastError);
    return {
      tone: 'warn',
      text: recentGap ? (hasError ? 'gaps and errors' : 'gaps') : 'errors',
      detail: `${lossy.join('; ')}.${recentGap ? ' A gap marker is in the session log.' : ''}`,
    };
  }
  return null;
}

/** "norecord" and "overrun" (item record-start-nudge) show even when no recording runs. */
type ProblemKind = 'silent' | 'stream' | 'rejoin' | 'norecord' | 'overrun';
const KINDS: readonly string[] = ['silent', 'stream', 'rejoin', 'norecord', 'overrun'];

/** The bot's answer (feeds `GET /status`); null = unreachable or unreadable. */
export interface BotAnswer {
  recording: boolean;
  problems: Array<{ kind: ProblemKind; text: string }>;
  /** Estimated speaking time per person (ms); absent from an older bot. */
  speaking?: unknown;
}

/** One person's speaking time as the page gets it (spotlight balance). */
export interface SpeakerTime {
  name: string;
  ms: number;
}

/** The speaking times of a bot answer that is recording; bad entries are dropped. */
export function speakingOf(answer: BotAnswer | null): SpeakerTime[] {
  if (!answer || !answer.recording || !Array.isArray(answer.speaking)) return [];
  const out: SpeakerTime[] = [];
  for (const s of answer.speaking as unknown[]) {
    if (s === null || typeof s !== 'object') continue;
    const o = s as Record<string, unknown>;
    if (typeof o['name'] !== 'string' || typeof o['ms'] !== 'number' || !(o['ms'] > 0)) continue;
    out.push({
      name: o['name'].slice(0, 64),
      ms: Math.max(1000, Math.round(o['ms'] / 1000) * 1000),
    });
  }
  return out;
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
  const problems = answer.recording
    ? answer.problems
    : answer.problems.filter(p => p.kind === 'norecord' || p.kind === 'overrun');
  if (problems.length === 0) return null;
  const rejoin = problems.some(p => p.kind === 'rejoin');
  const first = problems[0].text;
  const more = problems.length - 1;
  return {
    tone: rejoin ? 'bad' : 'warn',
    text: more > 0 ? `${first} (+${more} more)` : first,
    detail: `${problems.map(p => p.text).join('; ')}.`,
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
        typeof q['kind'] === 'string' && KINDS.includes(q['kind']) && typeof q['text'] === 'string'
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
  let speaking: SpeakerTime[] = [];
  if (src.botStatusUrl) {
    const answer = await doFetch(src.botStatusUrl, { signal: AbortSignal.timeout(3000) })
      .then(async res => (res.ok ? ((await res.json()) as unknown) : null))
      .catch(() => null);
    const bot = isBotAnswer(answer) ? answer : null;
    recorder = recorderDot(bot);
    speaking = speakingOf(bot);
  }
  const pumps = await src.readPumps().catch(() => null);
  return {
    recorder,
    playLog: playLogDot(pumps, now),
    ...(speaking.length > 0 ? { speaking } : {}),
  };
}
