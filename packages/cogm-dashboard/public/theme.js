// The theme for the dashboard and the players' page (D-085). The GM picks it once per world
// (/api/theme, the "theme" stream event); each viewer picks how the mist behaves (calm,
// drift or clear air), kept in this browser only.

const root = document.documentElement;
const THEME_CACHE = 'cogm_theme';
const MIST_KEY = 'cogm_mist';
const MISTS = ['calm', 'drift', 'clear'];

function read(key) {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key, value) {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
}

/** Show a theme ('neutral' or 'veil'); unknown values fall back to neutral. */
export function applyTheme(theme) {
  const id = theme === 'veil' ? 'veil' : 'neutral';
  root.dataset.theme = id;
  write(THEME_CACHE, id);
  return id;
}

export function currentMist() {
  const saved = read(MIST_KEY);
  return MISTS.includes(saved) ? saved : 'calm';
}

/** This viewer's mist: 'calm' (default), 'drift' or 'clear' (no mist). */
export function setMist(mist) {
  const id = MISTS.includes(mist) ? mist : 'calm';
  root.dataset.mist = id;
  write(MIST_KEY, id);
  return id;
}

/** Load the world's theme from the server. */
export async function loadTheme(headers = {}) {
  try {
    const res = await fetch('/api/theme', { headers });
    if (res.ok) return applyTheme((await res.json()).theme);
  } catch {
    // Offline or not authorised yet: keep the cached theme.
  }
  return root.dataset.theme;
}

// Before the first paint of anything else: the last theme this browser saw, and its mist.
applyTheme(read(THEME_CACHE));
root.dataset.mist = currentMist();
