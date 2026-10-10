// Fixtures for the During layout stories: the saved screen choices (the `prefs` stream event), a
// session with a start time (the hint counts sessions by it) and what the server answers to
// `set-prefs`. Made up, like every fixture here.
import type { FakeRequest, Reply } from '../fakeApi';
import { DEFAULT_PREFS, readPrefs, type DuringPrefs } from '../../lib/prefsModel';

import { PLAY_SESSION_OPEN, WORLD } from './common';

/** Prefs of a GM who already picked a layout (no Before card, no hint). */
export const PICKED: DuringPrefs = { ...DEFAULT_PREFS, layoutPicked: true, hintDismissed: true };

/** Prefs of a world that has not picked a layout yet: the Before card and the hint show. */
export const NOT_PICKED: DuringPrefs = { ...DEFAULT_PREFS };

export const STARTED_AT = '2026-10-08T18:00:00.000Z';

/** An open session with a start time, which the hint needs. */
export const PLAY_SESSION_STARTED = {
  ...PLAY_SESSION_OPEN,
  worldId: WORLD.id,
  startedAt: STARTED_AT,
};

/**
 * A `set-prefs` answer that behaves like the server: it keeps the prefs and answers with them
 * merged, so a click in a story shows its effect. One per story (the state is in the closure).
 */
export function setPrefsEcho(initial: DuringPrefs): (request: FakeRequest) => Reply {
  let stored = initial;
  return request => {
    const body = request.body as { action?: string; value?: Record<string, unknown> } | undefined;
    if (body?.action !== 'set-prefs') return { status: 400, json: { error: 'Unknown action.' } };
    const { hintSession, ...fields } = body.value ?? {};
    stored = readPrefs({
      ...stored,
      ...fields,
      hintSessions:
        typeof hintSession === 'string'
          ? [...stored.hintSessions, hintSession]
          : stored.hintSessions,
    });
    return { json: stored };
  };
}
