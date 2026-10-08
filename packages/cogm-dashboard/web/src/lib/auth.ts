// The GM token (Phase 6 player/GM split), as the old page keeps it (public/app.js): open the page
// once with ?token=<GM_DASHBOARD_TOKEN>; it is saved under the same key, so the old and the new
// page share it, and taken out of the address bar once saved. Without the split no token is
// needed. The server enforces the role; this only forwards the credential.

const TOKEN_KEY = 'cogm_token';

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

/** The header the REST routes read the GM token from (none without the split). */
export function authHeaders(): Record<string, string> {
  return token ? { 'X-CoGM-Token': token } : {};
}
