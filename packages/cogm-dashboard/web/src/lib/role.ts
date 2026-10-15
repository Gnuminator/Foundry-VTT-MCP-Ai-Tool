// A player on the GM page: with the player/GM split on, anyone the server does not call the GM
// (a player token, or a Cloudflare Access email outside GM_EMAILS) gets the player state and the
// player stream from the GM page's routes (app.ts), so the GM page would stay empty. Such a
// visitor goes to the read-only player view instead. So does one the server turns away who
// brings no token here but has the player page's own: a player whose deployment asks for a
// player token. Two cases stay: the GM (and the single-user mode without a split, where everyone
// is the GM), and a token the server does not know (`unknownToken`), which is a GM's stale or
// mistyped link, since a real player brings no token where none is asked for.

import { authHeaders, onlyPlayerToken, playerPageUrl } from './auth';

/** Sends the browser to the player view when /api/state says this visitor is a player. */
export async function sendPlayersToPlayerPage(
  go: (url: string) => void = url => location.replace(url)
): Promise<void> {
  let answer: { role?: unknown; unknownToken?: unknown };
  try {
    const res = await fetch('/api/state', { headers: authHeaders() });
    if (res.status === 401 && onlyPlayerToken()) {
      go('/player');
      return;
    }
    if (!res.ok) return;
    answer = (await res.json()) as typeof answer;
  } catch {
    // No answer: the page's own panels say so.
    return;
  }
  if (answer.role === 'player' && answer.unknownToken !== true) go(playerPageUrl());
}
