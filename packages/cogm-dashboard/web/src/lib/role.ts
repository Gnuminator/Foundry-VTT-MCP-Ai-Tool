// A player on the GM page: with the player/GM split on, anyone the server does not call the GM
// (a player token, or a Cloudflare Access email outside GM_EMAILS) gets the player state and the
// player stream from the GM page's routes (app.ts), so the GM page would stay empty. Such a
// visitor goes to the read-only player view instead. So does one the server turns away who
// brings no token here but has the player page's own: a player whose deployment asks for a
// player token. The GM, and the single-user mode without a split, never leave: the page renders
// as before and this only reads the role alongside.

import { authHeaders, onlyPlayerToken, playerPageUrl } from './auth';

/** Sends the browser to the player view when /api/state says this visitor is a player. */
export async function sendPlayersToPlayerPage(
  go: (url: string) => void = url => location.replace(url)
): Promise<void> {
  let role: unknown;
  try {
    const res = await fetch('/api/state', { headers: authHeaders() });
    if (res.status === 401 && onlyPlayerToken()) {
      go('/player');
      return;
    }
    if (!res.ok) return;
    role = ((await res.json()) as { role?: unknown }).role;
  } catch {
    // No answer: the page's own panels say so.
    return;
  }
  if (role === 'player') go(playerPageUrl());
}
