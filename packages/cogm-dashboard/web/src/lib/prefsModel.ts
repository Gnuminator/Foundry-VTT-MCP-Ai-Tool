// The GM's screen choices for a world (dashboard-prefs.ts on the server), as plain data and
// rules: the types, the defaults, how an answer is read, how a change shows at once, and when the
// layout hint shows. No React and no fetch here, so the rules have unit tests (duringTrial.test.ts);
// prefs.ts has the hooks.

export const DURING_LAYOUTS = ['layered', 'toggle', 'auto'] as const;
export type DuringLayout = (typeof DURING_LAYOUTS)[number];

/** How many sessions the quiet "try the other layouts" hint shows in (as the server counts). */
export const LAYOUT_HINT_SESSIONS = 3;

export interface DuringPrefs {
  duringLayout: DuringLayout;
  /** Simple/Full: the Full view instead of Simple. */
  duringFull: boolean;
  /** Damage / Heal, Condition and Clear in the turn-order strip. */
  combatButtons: boolean;
  /** The GM picked a layout (the trial, or the switch): the Before card goes away. */
  layoutPicked: boolean;
  /** The During hint was dismissed. */
  hintDismissed: boolean;
  /** The session start times the hint has shown in. */
  hintSessions: string[];
}

/** What the server starts a world with; the page uses it only to fill a gap in an answer. */
export const DEFAULT_PREFS: DuringPrefs = {
  duringLayout: 'layered',
  duringFull: false,
  combatButtons: false,
  layoutPicked: false,
  hintDismissed: false,
  hintSessions: [],
};

/** One change, as `set-prefs` takes it. `hintSession` counts a session for the hint. */
export type PrefsChange = Partial<Omit<DuringPrefs, 'hintSessions'>> & { hintSession?: string };

/** A prefs object from the wire, checked field by field; anything else is the default. */
export function readPrefs(raw: unknown): DuringPrefs {
  const r = raw && typeof raw === 'object' ? (raw as Record<string, unknown>) : {};
  const layout = DURING_LAYOUTS.find(l => l === r['duringLayout']);
  return {
    duringLayout: layout ?? DEFAULT_PREFS.duringLayout,
    duringFull: r['duringFull'] === true,
    combatButtons: r['combatButtons'] === true,
    layoutPicked: r['layoutPicked'] === true,
    hintDismissed: r['hintDismissed'] === true,
    hintSessions: Array.isArray(r['hintSessions'])
      ? r['hintSessions'].filter((s): s is string => typeof s === 'string')
      : [],
  };
}

/**
 * The prefs after a change, as the page shows them at once, before the server answers.
 * `hintSession` is a count the server keeps, not a field of the prefs, so it is left out.
 */
export function applyPrefsChange(prefs: DuringPrefs, change: PrefsChange): DuringPrefs {
  const { hintSession: _count, ...fields } = change;
  return { ...prefs, ...fields };
}

/** The key that counts a session for the hint: its start time, or null without an open session. */
export function hintSessionKey(session: {
  open: boolean;
  startedAt: string | null;
}): string | null {
  return session.open && session.startedAt ? session.startedAt : null;
}

/**
 * Whether the quiet "three layouts" hint shows. Only on During, outside the trial, in a session
 * with a start time, until a layout is picked or the hint is dismissed, and for the first
 * LAYOUT_HINT_SESSIONS sessions (the one on screen counts if it is already counted). Not before
 * the prefs are known: it would flash for a GM who already picked.
 */
export function showLayoutHint(input: {
  duringOnScreen: boolean;
  trialRunning: boolean;
  sessionKey: string | null;
  prefs: DuringPrefs | undefined;
}): boolean {
  const { duringOnScreen, trialRunning, sessionKey, prefs } = input;
  if (!prefs || !duringOnScreen || trialRunning || !sessionKey) return false;
  if (prefs.layoutPicked || prefs.hintDismissed) return false;
  return (
    prefs.hintSessions.includes(sessionKey) || prefs.hintSessions.length < LAYOUT_HINT_SESSIONS
  );
}
