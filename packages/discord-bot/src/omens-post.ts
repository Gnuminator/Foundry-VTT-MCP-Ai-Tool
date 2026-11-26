/**
 * Omens by post (I-181): send the omens the GM approved in the dashboard as private messages.
 *
 * Every few minutes the bot asks the dashboard for the approved omens (GM token, because an
 * unsent text is private), claims each one (the bridge flips it from approved to sending, so a
 * crash cannot send it twice), sends it to the player's own Discord account and reports the
 * result. A failed send goes back to approved and is tried again at the next check. The
 * recipient comes from the bridge's player link, never from anything this bot is told.
 */
export const OMENS_POST_INTERVAL_MS = 3 * 60 * 1000;

interface OmenToSend {
  id: string;
  discordId: string;
  text: string;
  /** 'whisper' for a line from the whisper desk; absent for an omen. */
  kind?: string;
}

interface OmensPostOptions {
  /** The dashboard's address, as a full http URL. */
  dashboardUrl: string;
  /** The dashboard's GM token. */
  gmToken: string;
  /** Sends one private message; resolves true when it arrived. */
  send: (discordId: string, text: string) => Promise<boolean>;
  fetch?: typeof fetch;
  log?: (message: string) => void;
}

/** What the player sees: the omen text under a one-line heading. */
export function omenMessage(text: string, kind?: string): string {
  return kind === 'whisper'
    ? `**A whisper from your GM**\n\n${text}`
    : `**An omen for you**\n\n${text}`;
}

export function createOmensPoster(options: OmensPostOptions): () => Promise<number> {
  const doFetch = options.fetch ?? fetch;
  const base = options.dashboardUrl.replace(/\/+$/, '');
  const headers = { 'X-CoGM-Token': options.gmToken, 'Content-Type': 'application/json' };
  let failing = false;

  async function call(path: string, body?: Record<string, unknown>): Promise<unknown> {
    const res = await doFetch(`${base}${path}`, {
      method: body ? 'POST' : 'GET',
      headers,
      ...(body ? { body: JSON.stringify(body) } : {}),
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new Error(`${path} answered ${res.status}`);
    return res.json();
  }

  /** One check; returns how many omens were sent. Never throws. */
  return async () => {
    let sent = 0;
    try {
      const outbox = (await call('/api/omens/outbox')) as { items?: Array<{ id?: unknown }> };
      failing = false;
      for (const item of outbox.items ?? []) {
        if (typeof item.id !== 'string') continue;
        const claim = (await call('/api/omens/claim', { id: item.id })) as {
          item?: OmenToSend | null;
        };
        const omen = claim.item;
        if (!omen) continue;
        let ok = false;
        let error = 'Discord did not take the message';
        try {
          ok = await options.send(omen.discordId, omenMessage(omen.text, omen.kind));
        } catch (err) {
          error = (err as Error).message;
          options.log?.(`Omens: could not send omen ${omen.id} (${error})`);
        }
        if (ok) sent += 1;
        // A failed record must not stop the other omens or hide a message that did go out.
        for (let attempt = 0; attempt < 2; attempt += 1) {
          try {
            await call('/api/omens/finish', { id: omen.id, ok, error });
            break;
          } catch (err) {
            if (attempt === 1) {
              options.log?.(`Omens: could not record omen ${omen.id} (${(err as Error).message})`);
            }
          }
        }
      }
    } catch (err) {
      // Once per outage: a dashboard that is down would log all day.
      if (!failing) {
        failing = true;
        options.log?.(`Omens: could not reach ${base} (${(err as Error).message})`);
      }
    }
    return sent;
  };
}
