// Spotlight balance (I-177): per-player bars from the play log (what each character did) and, while
// the recorder runs, speaking time. Pure rules, so they have unit tests (spotlight.test.ts); the
// card is components/Spotlight.tsx. GM only: the server sends it on the GM stream alone.

/** What the server tallied from the log (src/spotlight.ts). */
interface SpotlightSnapshot {
  players: { name: string; actions: number }[];
  /** True when the counts are for a play session (they start at its start). */
  session: boolean;
}

/** One person's speaking time from the Discord recorder (src/recording-health.ts). */
export interface SpeakerTime {
  name: string;
  ms: number;
}

export interface SpotlightRow {
  name: string;
  actions: number;
  /** Matched speaking time in ms, or null when no speaker is matched to this character. */
  speakingMs: number | null;
  /** 0 to 1, against the busiest character. */
  actionsBar: number;
  speakingBar: number;
}

const EMPTY_SPOTLIGHT: SpotlightSnapshot = { players: [], session: false };

/** Reads the stream's payload; anything unexpected is an empty tally. */
export function readSpotlight(raw: unknown): SpotlightSnapshot {
  const list = (raw as { players?: unknown } | null)?.players;
  if (!Array.isArray(list)) return EMPTY_SPOTLIGHT;
  const players: SpotlightSnapshot['players'] = [];
  for (const p of list as unknown[]) {
    const o = (p ?? {}) as Record<string, unknown>;
    if (typeof o['name'] === 'string' && typeof o['actions'] === 'number') {
      players.push({ name: o['name'], actions: o['actions'] });
    }
  }
  return { players, session: (raw as { session?: unknown }).session === true };
}

/** The card's small print: which stretch of play the numbers cover. */
export function spotlightScope(session: boolean): string {
  return session
    ? 'GM only. Actions from the play log this session.'
    : 'GM only. Actions from the play log since the dashboard started.';
}

const norm = (s: string): string => s.trim().toLowerCase();

/**
 * The speaker for a character: the Discord name equal to the character's name, else to its first
 * word ("Ebbe Stonefist" is "Ebbe"). A speaker nobody matches (the GM) is left out of the bars.
 */
function speakerFor(name: string, speakers: readonly SpeakerTime[]): SpeakerTime | undefined {
  const full = norm(name);
  const first = full.split(/\s+/)[0] ?? full;
  return (
    speakers.find(s => norm(s.name) === full) ??
    speakers.find(s => norm(s.name).split(/\s+/)[0] === first)
  );
}

/** The roster name a log name stands for: equal, else the same first word when only one fits. */
function rosterName(name: string, roster: readonly string[]): string {
  const full = norm(name);
  const exact = roster.find(r => norm(r) === full);
  if (exact) return exact;
  const first = full.split(/\s+/)[0];
  const same = roster.filter(r => norm(r).split(/\s+/)[0] === first);
  return same.length === 1 ? same[0] : name;
}

/** One row per character: the party roster plus anyone the log counted; busiest first. */
export function buildSpotlight(
  snapshot: Pick<SpotlightSnapshot, 'players'>,
  roster: readonly string[],
  speakers: readonly SpeakerTime[]
): SpotlightRow[] {
  const actions = new Map<string, number>();
  for (const name of roster) actions.set(name, 0);
  for (const p of snapshot.players) {
    // The log names the chat speaker ("Ebbe"), the roster the actor ("Ebbe Stonefist"): one row.
    const name = rosterName(p.name, roster);
    actions.set(name, (actions.get(name) ?? 0) + p.actions);
  }
  const used = new Set<SpeakerTime>();
  const base = [...actions.entries()].map(([name, n]) => {
    const s = speakerFor(
      name,
      speakers.filter(x => !used.has(x))
    );
    if (s) used.add(s);
    return { name, actions: n, speakingMs: s ? s.ms : null };
  });
  const maxActions = Math.max(0, ...base.map(r => r.actions));
  const maxMs = Math.max(0, ...base.map(r => r.speakingMs ?? 0));
  return base
    .map(r => ({
      ...r,
      actionsBar: maxActions > 0 ? r.actions / maxActions : 0,
      speakingBar: maxMs > 0 ? (r.speakingMs ?? 0) / maxMs : 0,
    }))
    .sort((a, b) => b.actions - a.actions || a.name.localeCompare(b.name));
}

/** How many actions the party must have taken before the card may hint; the GM sets it (0 = never). */
export const DEFAULT_HINT_AFTER = 20;

/** A quiet character is under this share of an even split of all actions. */
const QUIET_SHARE_OF_EVEN = 0.5;

/**
 * The hint line, or null. Only once the party has taken `hintAfter` actions between them, and
 * only for a character under half of an even share. `hintAfter` 0 turns hints off.
 */
export function spotlightHint(rows: readonly SpotlightRow[], hintAfter: number): string | null {
  if (hintAfter <= 0 || rows.length < 2) return null;
  const total = rows.reduce((sum, r) => sum + r.actions, 0);
  if (total < hintAfter) return null;
  const even = total / rows.length;
  const quiet = rows.filter(r => r.actions < even * QUIET_SHARE_OF_EVEN).map(r => r.name);
  if (quiet.length === 0) return null;
  const who =
    quiet.length === 1
      ? quiet[0]
      : `${quiet.slice(0, -1).join(', ')} and ${quiet[quiet.length - 1]}`;
  return `${who} ${quiet.length === 1 ? 'has' : 'have'} had little spotlight so far. A moment for them could help.`;
}

/** "1 h 5 min", "7 min", "40 s". */
export function speakingText(ms: number): string {
  const s = Math.round(ms / 1000);
  if (s < 60) return `${s} s`;
  const m = Math.round(s / 60);
  return m < 60 ? `${m} min` : `${Math.floor(m / 60)} h ${m % 60} min`;
}

/** The GM's threshold from the text of its setting; a bad value is the default. */
export function readHintAfter(raw: string | null): number {
  const n = raw === null || raw.trim() === '' ? NaN : Number(raw);
  return Number.isInteger(n) && n >= 0 && n <= 999 ? n : DEFAULT_HINT_AFTER;
}
