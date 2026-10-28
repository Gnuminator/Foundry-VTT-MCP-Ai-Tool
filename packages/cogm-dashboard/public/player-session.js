// The player page follows the session (I-111, D-092): during a session the live cards come first
// (combat order, session feed, handouts); between sessions the campaign cards come first (last
// recap, handouts, quests). Pure functions over the projected player state, so they test without a
// browser. Nothing here widens what the server sends.

/**
 * 'live' while a session is open or a fight runs, 'between' once the marker says no session is
 * open and no fight runs. Without a marker (older bridge, not read yet) the fight decides, and
 * with neither the page stays 'live', as it was before this change.
 */
export function sessionPhase(state) {
  const fighting = Boolean(state && state.combat && state.combat.active);
  const marker = state && state.session;
  if (marker && typeof marker.open === 'boolean')
    return marker.open || fighting ? 'live' : 'between';
  return 'live';
}

const RECAP = /\brecap\b/i;
const QUEST = /\bquests?\b/i;

/**
 * Splits the revealed handouts into the last recap (the newest page titled "Recap"), the quest
 * pages and the rest. Matching is on the title only; the HTML is already sanitized server-side.
 */
export function splitHandouts(handouts) {
  const list = Array.isArray(handouts) ? handouts : [];
  const recaps = list.filter(h => RECAP.test(h.title || ''));
  const stamp = h => {
    const t = Date.parse(h.revealedAt || '');
    return Number.isFinite(t) ? t : -1;
  };
  // The newest by reveal time; on a tie (or no times) the later one in the list.
  let recap = null;
  for (const h of recaps) if (!recap || stamp(h) >= stamp(recap)) recap = h;
  const quests = list.filter(
    h => h !== recap && !RECAP.test(h.title || '') && QUEST.test(h.title || '')
  );
  const rest = list.filter(h => h !== recap && !quests.includes(h) && !RECAP.test(h.title || ''));
  return { recap, quests, rest };
}
