/**
 * The "session is over" post (I-111): when a play session ends, the bot posts a link to the player
 * page in one configured channel. Off unless DISCORD_SESSION_POST_CHANNEL_ID is set.
 *
 * The bot reads the dashboard's player state (`/api/player/state`, the same projection players
 * get, so nothing GM-only passes through here) and watches its `session` flag. Rules, kept in
 * `SessionPostNotifier` (no Discord and no network in it, so tests run it with fakes):
 * - the first reading only records where things stand, so a restart never reposts an old session;
 * - one post per session end: when the flag is closed and its end time is newer than the one last
 *   seen (an end time that was missing before counts as new only if a session was seen open);
 * - a missing or unreadable state says nothing and changes nothing;
 * - if the post fails, nothing is recorded, so the next check tries again.
 * The state lives in memory: a session that ends while the bot is down is not announced.
 */

export const SESSION_POST_INTERVAL_MS = 2 * 60 * 1000;

/** What the dashboard's player state says about the session (shared `PlayerSession`). */
export interface SessionFlag {
  open: boolean;
  endedAt: string | null;
}

export function sessionFlagFrom(state: unknown): SessionFlag | null {
  if (state === null || typeof state !== 'object') return null;
  const s = (state as { session?: unknown }).session;
  if (s === null || typeof s !== 'object') return null;
  const { open, endedAt } = s as { open?: unknown; endedAt?: unknown };
  if (typeof open !== 'boolean') return null;
  return { open, endedAt: typeof endedAt === 'string' && endedAt ? endedAt : null };
}

export function sessionPostMessage(pageUrl: string): string {
  return `The session is over. Recap, handouts and quests are on the player page: ${pageUrl}`;
}

export interface SessionPostOptions {
  /** Posts the text; true when it went out. */
  send: (text: string) => Promise<boolean>;
  /** The player page link players get. */
  pageUrl: string;
}

export class SessionPostNotifier {
  private seen = false;
  private sawOpen = false;
  private lastEndedAt: string | null = null;
  private sending = false;

  constructor(private readonly options: SessionPostOptions) {}

  /** Look at one reading; returns true when it posted. A check during a slow send does nothing. */
  async check(flag: SessionFlag | null): Promise<boolean> {
    if (flag === null || this.sending) return false;
    if (!this.seen) {
      this.seen = true;
      this.sawOpen = flag.open;
      this.lastEndedAt = flag.endedAt;
      return false;
    }
    if (flag.open) {
      this.sawOpen = true;
      return false;
    }
    const newer =
      flag.endedAt !== null &&
      (this.lastEndedAt === null
        ? this.sawOpen
        : Date.parse(flag.endedAt) > Date.parse(this.lastEndedAt));
    if (!newer) return false;
    this.sending = true;
    let sent: boolean;
    try {
      sent = await this.options.send(sessionPostMessage(this.options.pageUrl));
    } finally {
      this.sending = false;
    }
    if (!sent) return false;
    this.sawOpen = false;
    this.lastEndedAt = flag.endedAt;
    return true;
  }
}

export interface SessionStateReaderOptions {
  /** The dashboard's address, for example `http://127.0.0.1:3100`. */
  dashboardUrl: string;
  /** The dashboard's player token, when the deployment sets one. */
  token?: string | undefined;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

/** Reads the session flag from the dashboard; null on any failure (the notifier then waits). */
export function createSessionFlagReader(
  options: SessionStateReaderOptions
): () => Promise<SessionFlag | null> {
  const doFetch = options.fetch ?? fetch;
  const url = `${options.dashboardUrl.replace(/\/+$/, '')}/api/player/state`;
  let failing = false;
  return async () => {
    try {
      const res = await doFetch(url, {
        headers: options.token ? { 'X-CoGM-Token': options.token } : {},
        signal: AbortSignal.timeout(10_000),
      });
      if (!res.ok) return null;
      const flag = sessionFlagFrom(await res.json());
      failing = false;
      return flag;
    } catch (err) {
      // Once per outage, not every check: a dashboard that is down would log all day.
      if (failing) return null;
      failing = true;
      options.log?.(`Session post: could not read ${url} (${(err as Error).message})`);
      return null;
    }
  };
}
