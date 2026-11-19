/**
 * "Downtime inbox" (I-180): what a player does between sessions, on their own `/me` page.
 *
 * - `GET    /api/me/downtime`      -> the caller's own entries
 * - `POST   /api/me/downtime`      -> `{text, id?}` adds an entry, or edits the caller's own
 * - `DELETE /api/me/downtime/:id`  -> removes one of the caller's own entries
 *
 * The identity is the player's private key (`X-CoGM-Me`), mapped to a Foundry user id on this
 * side only, so a player can never read or change another player's entry. The bridge keeps them
 * in its vault, marked "from player" (the prep digest quotes them as wishes, not as canon).
 */
import type { Express, Request, Response } from 'express';

import type { PlayerLinkStore } from './player-links.js';
import type { PlayerDirectory } from './usage-route.js';

export interface DowntimeClient {
  downtime?(params: Record<string, unknown>): Promise<unknown>;
}

interface DowntimeRouteOptions {
  client: DowntimeClient;
  links: PlayerLinkStore;
  directory: PlayerDirectory;
  worldId: () => string | null;
}

const ME_KEY_HEADER = 'x-cogm-me';
const ENTRY_ID = /^[a-f0-9]{16}$/;

export function mountDowntimeRoute(app: Express, options: DowntimeRouteOptions): void {
  const { client, links, directory, worldId } = options;
  let lastWorld: string | null = null;

  function who(req: Request, res: Response): string | null {
    res.set('Cache-Control', 'no-store');
    // The inbox is for the time between sessions: with no GM client joined the live world is
    // null, so the last world seen stands in, or after a restart the world that holds the key.
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const live = worldId();
    if (live) lastWorld = live;
    const world = live ?? links.worldFor(key) ?? lastWorld;
    if (!world) {
      res.status(503).json({ error: 'The table is offline right now. Try again later.' });
      return null;
    }
    const userId = links.userFor(world, key);
    if (!userId) {
      res
        .status(401)
        .json({ code: 'no-link', error: 'This link is not valid. Ask your GM for a new one.' });
      return null;
    }
    if (typeof client.downtime !== 'function') {
      res.status(501).json({ error: 'The downtime inbox is not available here. Ask your GM.' });
      return null;
    }
    return userId;
  }

  function run(res: Response, params: Record<string, unknown>): void {
    void client
      .downtime?.(params)
      .then(result => {
        const entries = (result as { entries?: unknown } | null)?.entries;
        res.json({ entries: Array.isArray(entries) ? entries : [] });
      })
      .catch((error: unknown) => {
        // The bridge's own sentences ("Write something first.") are table words; show them.
        const message = error instanceof Error ? error.message : '';
        if (/Unknown method/i.test(message)) {
          res.status(501).json({ error: 'The downtime inbox is not available here. Ask your GM.' });
          return;
        }
        const known = /^(Write something first|Keep it under|You can keep|That entry is gone)/.test(
          message
        );
        res
          .status(known ? 400 : 502)
          .json({ error: known ? message : 'Could not reach the table. Try again in a moment.' });
      });
  }

  app.get('/api/me/downtime', (req: Request, res: Response) => {
    const userId = who(req, res);
    if (userId) run(res, { action: 'list', userId });
  });

  app.post('/api/me/downtime', (req: Request, res: Response) => {
    const userId = who(req, res);
    if (!userId) return;
    const body = (req.body ?? {}) as { text?: unknown; id?: unknown };
    if (typeof body.text !== 'string') {
      res.status(400).json({ error: 'Write something first.' });
      return;
    }
    if (body.id !== undefined && !(typeof body.id === 'string' && ENTRY_ID.test(body.id))) {
      res.status(400).json({ error: 'That entry is gone.' });
      return;
    }
    const id = typeof body.id === 'string' ? body.id : undefined;
    void directory
      .refreshIfStale()
      .catch(() => undefined)
      .then(() =>
        run(res, {
          action: 'save',
          userId,
          name: directory.get(userId)?.name ?? '',
          text: body.text,
          ...(id ? { id } : {}),
        })
      );
  });

  app.delete('/api/me/downtime/:id', (req: Request, res: Response) => {
    const userId = who(req, res);
    if (!userId) return;
    const id = String(req.params.id ?? '');
    if (!ENTRY_ID.test(id)) {
      res.status(400).json({ error: 'That entry is gone.' });
      return;
    }
    run(res, { action: 'delete', userId, id });
  });
}
