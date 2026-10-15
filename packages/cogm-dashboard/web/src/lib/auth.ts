// The GM token (Phase 6 player/GM split), as the old page keeps it (public/app.js): open the page
// once with ?token=<GM_DASHBOARD_TOKEN>; it is saved under the same key, so the old and the new
// page share it, and taken out of the address bar once saved. Without the split no token is
// needed. The server enforces the role; this only forwards the credential.

const TOKEN_KEY = 'cogm_token';
/** The player page's own key (public/player.js). */
const PLAYER_TOKEN_KEY = 'cogm_player_token';

function readToken(): string {
  const fromUrl = new URL(location.href).searchParams.get('token');
  if (fromUrl) {
    let saved = false;
    try {
      localStorage.setItem(TOKEN_KEY, fromUrl);
      saved = true;
    } catch {
      // Private windows may refuse storage; the token then lasts for this page only.
    }
    // Not saved: leave it in the address bar, so a refresh works.
    if (saved) {
      try {
        const url = new URL(location.href);
        url.searchParams.delete('token');
        history.replaceState(history.state, '', url.pathname + url.search + url.hash);
      } catch {
        // Keep the address as it is.
      }
    }
    return fromUrl;
  }
  try {
    return localStorage.getItem(TOKEN_KEY) ?? '';
  } catch {
    return '';
  }
}

const token = readToken();

/** The live stream's address: EventSource sends no headers, so the token goes in the query. */
export function streamUrl(): string {
  return token ? `/api/stream?token=${encodeURIComponent(token)}` : '/api/stream';
}

/** The header the REST routes read the GM token from (none without the split). */
export function authHeaders(): Record<string, string> {
  return token ? { 'X-CoGM-Token': token } : {};
}

/**
 * The player page's address for a visitor the server calls a player. The token this page holds
 * is then a player token: it is copied to the player page's key, so the player page has it too
 * (it stays here as well, so the next visit sends the player on again). Storage refused: it goes
 * along in the address instead.
 */
export function playerPageUrl(): string {
  if (!token) return '/player';
  try {
    localStorage.setItem(PLAYER_TOKEN_KEY, token);
    return '/player';
  } catch {
    return `/player?token=${encodeURIComponent(token)}`;
  }
}

/** True when this page has no token but the player page has one: a player, not a GM. */
export function onlyPlayerToken(): boolean {
  if (token) return false;
  try {
    return Boolean(localStorage.getItem(PLAYER_TOKEN_KEY));
  } catch {
    return false;
  }
}
