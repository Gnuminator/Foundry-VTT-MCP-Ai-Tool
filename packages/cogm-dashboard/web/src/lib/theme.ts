// The theme (D-085), as public/theme.js does it for the old pages: the GM picks it per world
// (/api/theme), each viewer keeps a mist choice in this browser. Same storage keys, so both pages
// agree. The mist picker itself moves here with the settings menu.

const root = document.documentElement;
const THEME_CACHE = 'cogm_theme';
const MIST_KEY = 'cogm_mist';
const MISTS = ['calm', 'drift', 'clear'];

function read(key: string): string | null {
  try {
    return localStorage.getItem(key);
  } catch {
    return null;
  }
}

function write(key: string, value: string): void {
  try {
    localStorage.setItem(key, value);
  } catch {
    // Private windows may refuse storage; the choice then lasts for this page only.
  }
}

/** Show a theme ('neutral' or 'veil'); unknown values fall back to neutral. */
export function applyTheme(theme: unknown): string {
  const id = theme === 'veil' ? 'veil' : 'neutral';
  root.dataset.theme = id;
  write(THEME_CACHE, id);
  return id;
}

function currentMist(): string {
  const saved = read(MIST_KEY);
  return saved !== null && MISTS.includes(saved) ? saved : 'calm';
}

/** Before the first paint: the last theme this browser saw, and its mist. */
export function applyCachedTheme(): void {
  applyTheme(read(THEME_CACHE));
  root.dataset.mist = currentMist();
}
