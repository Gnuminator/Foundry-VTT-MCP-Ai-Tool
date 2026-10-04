/**
 * "My character" (I-096): the player's own page and the GM's per-player links.
 *
 * - `GET  /me`                          -> the page (static `me.html`, the players' page CSP)
 * - `GET  /api/me`                      -> the sheets of the characters the player owns; the
 *                                          player's private key comes in the `X-CoGM-Me` header
 *                                          (the page moves it out of the address bar at once,
 *                                          so it never lands in a log or the browser history)
 * - `GET  /api/player-links`            -> GM: each player, with their link if they have one
 * - `POST /api/player-links/:userId`    -> GM: make a new link (the old one stops working)
 * - `DELETE /api/player-links/:userId`  -> GM: remove the player's link
 *
 * The key maps to a Foundry user id on this side only; the bridge's control method
 * `character_sheet` then returns only the character actors that user OWNS.
 */
import type { Express, Request, Response } from 'express';

import type { PlayerLinkStore } from './player-links.js';
import type { PlayerDirectory } from './usage-route.js';

export interface MeClient {
  characterSheet?(userId: string): Promise<unknown>;
}

export interface MeRouteOptions {
  client: MeClient;
  links: PlayerLinkStore;
  directory: PlayerDirectory;
  requireGm: (req: Request, res: Response, next: () => void) => void;
  /** The connected world, or null before it is known. */
  worldId: () => string | null;
  /** The GM's theme for this world (the Fancy view follows it). */
  theme: () => string;
  publicDir: string;
  pageHeaders: (res: Response) => void;
}

const ME_KEY_HEADER = 'x-cogm-me';
const USER_ID = /^[A-Za-z0-9]{16}$/;

export function mountMeRoute(app: Express, options: MeRouteOptions): void {
  const { client, links, directory, requireGm, worldId } = options;

  app.get('/me', (_req: Request, res: Response) => {
    options.pageHeaders(res);
    res.sendFile('me.html', { root: options.publicDir });
  });

  app.get('/api/me', (req: Request, res: Response) => {
    const world = worldId();
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const userId = world ? links.userFor(world, key) : null;
    if (!userId) {
      res
        .status(401)
        .json({ code: 'no-link', error: 'This link is not valid. Ask your GM for a new one.' });
      return;
    }
    if (typeof client.characterSheet !== 'function') {
      res.status(501).json({ error: 'This bridge cannot read character sheets.' });
      return;
    }
    client
      .characterSheet(userId)
      .then(result => res.json({ ...(result as object), theme: options.theme() }))
      .catch((error: unknown) => {
        res.status(502).json({
          error: error instanceof Error ? error.message : 'Could not read the character.',
        });
      });
  });

  app.get('/api/player-links', requireGm, (_req: Request, res: Response) => {
    const world = worldId();
    void directory
      .refreshIfStale()
      .catch(() => undefined)
      .then(() => {
        const byUser = new Map((world ? links.list(world) : []).map(l => [l.userId, l]));
        res.json({
          players: directory.list().map(p => {
            const link = byUser.get(p.userId);
            return {
              userId: p.userId,
              name: p.name,
              link: link ? `/me?k=${link.key}` : null,
              createdAt: link?.createdAt ?? null,
            };
          }),
        });
      });
  });

  app.post('/api/player-links/:userId', requireGm, (req: Request, res: Response) => {
    const world = worldId();
    const userId = String(req.params.userId ?? '');
    if (!world || !USER_ID.test(userId) || !directory.get(userId)) {
      res.status(400).json({ error: 'Not a player of this world.' });
      return;
    }
    links
      .create(world, userId)
      .then(link => res.json({ userId, link: `/me?k=${link.key}`, createdAt: link.createdAt }))
      .catch((error: unknown) =>
        res
          .status(500)
          .json({ error: error instanceof Error ? error.message : 'Could not save the link.' })
      );
  });

  app.delete('/api/player-links/:userId', requireGm, (req: Request, res: Response) => {
    const world = worldId();
    const userId = String(req.params.userId ?? '');
    if (!world || !USER_ID.test(userId)) {
      res.status(400).json({ error: 'Not a player of this world.' });
      return;
    }
    links
      .remove(world, userId)
      .then(removed => res.json({ removed }))
      .catch((error: unknown) =>
        res.status(500).json({ error: error instanceof Error ? error.message : 'Could not save.' })
      );
  });
}
