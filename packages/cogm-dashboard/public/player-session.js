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

// What the tools really write: create-quest-journal makes a journal whose first page is titled
// "Quest Details" (extra pages are named by the caller), and the session-recap prompt leaves the
// recap as a draft the GM pastes into a page of their own naming, so the recap match is a
// convention on the page title (English or Danish), not a fixed name.
const RECAP = /(^|[^\p{L}])(recap|opsummering|resum[eé])(?![\p{L}])/iu;
const QUEST = /(^|[^\p{L}])(quests?|opgaver?)(?![\p{L}])/iu;

/**
 * Splits the revealed handouts into the last recap (the newest page titled like a recap), the quest
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
  // Older recaps stay visible: they fall through to the handouts, never hidden.
  const quests = list.filter(
    h => h !== recap && !RECAP.test(h.title || '') && QUEST.test(h.title || '')
  );
  const rest = list.filter(h => h !== recap && !quests.includes(h));
  return { recap, quests, rest };
}

const GENERIC_QUEST_TITLE = /^\s*quest details\s*$/i;
const ENTITIES = {
  '&amp;': '&',
  '&lt;': '<',
  '&gt;': '>',
  '&quot;': '"',
  '&#39;': "'",
  '&nbsp;': ' ',
};

/**
 * What a handout is called on the page. create-quest-journal names every quest's first page
 * "Quest Details" and puts the quest's own title in an h1 at the top of the page, so a page with
 * that generic name shows the h1 text instead. The h1 comes from the already sanitized HTML and
 * the result is plain text (the caller escapes it); any other page keeps its page title.
 */
export function handoutTitle(h) {
  const title = (h && h.title) || '';
  if (!GENERIC_QUEST_TITLE.test(title)) return title;
  const m = /<h1>([\s\S]*?)<\/h1>/i.exec((h && h.html) || '');
  if (!m) return title;
  // Strip tags until none is left, then drop any stray angle bracket, before entities are decoded.
  let plain = m[1];
  for (let prev = ''; prev !== plain; ) {
    prev = plain;
    plain = plain.replace(/<[^>]*>/g, '');
  }
  const text = plain
    .replace(/[<>]/g, '')
    .replace(/&(?:amp|lt|gt|quot|#39|nbsp);/g, e => ENTITIES[e])
    .replace(/\s+/g, ' ')
    .trim();
  return text || title;
}
