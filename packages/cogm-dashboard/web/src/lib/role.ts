// A player on the GM page: with the player/GM split on, anyone the server does not call the GM
// (a player token, or a Cloudflare Access email outside GM_EMAILS) gets the player state and the
// player stream from the GM page's routes (app.ts), so the GM page would stay empty. Such a
// visitor goes to the read-only player view instead. So does one the server turns away who
// brings no token here but has the player page's own: a player whose deployment asks for a
// player token. Three cases stay: the GM (and the single-user mode without a split, where everyone
// is the GM), a token the server does not know (`unknownToken`), which is a GM's stale or
// mistyped link, since a real player brings no token where none is asked for, and an Access token
// the server could not verify (`accessUnverified`: keys did not load or rotated, or GM_EMAILS has
// no CF_ACCESS settings), which may be a GM. The last two leave a one-line notice (RoleNotice),
// since the GM page is empty for them.

import { authHeaders, onlyPlayerToken, playerPageUrl } from './auth';

const NOTICES = {
  unknownToken: "This browser's GM link is not accepted any more. Open the GM link again.",
  accessUnverified:
    'The Cloudflare sign-in could not be checked. Reload the page; if it stays like this, check the Access setup of the dashboard.',
};

let notice: string | null = null;
const listeners = new Set<() => void>();

/** The notice for a GM page that stays empty (useSyncExternalStore: components/RoleNotice.tsx). */
export function getRoleNotice(): string | null {
  return notice;
}

export function subscribeRoleNotice(listener: () => void): () => void {
  listeners.add(listener);
  return () => listeners.delete(listener);
}

function setNotice(text: string | null): void {
  if (text === notice) return;
  notice = text;
  for (const listener of listeners) listener();
}

/** Sends the browser to the player view when /api/state says this visitor is a player. */
export async function sendPlayersToPlayerPage(
  go: (url: string) => void = url => location.replace(url)
): Promise<void> {
  setNotice(null);
  let answer: { role?: unknown; unknownToken?: unknown; accessUnverified?: unknown };
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
  if (answer.role !== 'player') return;
  if (answer.unknownToken === true) setNotice(NOTICES.unknownToken);
  else if (answer.accessUnverified === true) setNotice(NOTICES.accessUnverified);
  else go(playerPageUrl());
}
