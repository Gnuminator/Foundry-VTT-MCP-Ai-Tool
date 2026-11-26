/**
 * Keepsake ledgers on `/me`: a player's own list, filled from the public play log.
 *
 * - `GET    /api/me/keepsakes`      -> `{ledgers, kinds, eventTypes, persistent}` for the caller
 * - `POST   /api/me/keepsakes`      -> `{character, kind, title, eventType?, unit?}` adds one
 * - `DELETE /api/me/keepsakes/:id`  -> removes one of the caller's own
 *
 * The identity is the player's private key (`X-CoGM-Me`), mapped to a Foundry user id on this
 * side only, so a player reads and changes only their own list. A ledger is built from the
 * player-safe log and stats (`player-vault/keepsake.ts`); nothing GM-side is read here.
 */
import type { Express, Request, Response } from 'express';

import type { PlayerLinkStore } from './player-links.js';
import {
  KEEPSAKE_EVENT_TYPES,
  KEEPSAKE_KINDS,
  type KeepsakeLedger,
  type KeepsakeStore,
} from './player-vault/keepsake.js';

interface KeepsakeRouteOptions {
  links: PlayerLinkStore;
  worldId: () => string | null;
  store: KeepsakeStore;
  /** Null while the player vaults are off: the public log is not kept then. */
  ledgersFor: ((userId: string) => Promise<KeepsakeLedger[]>) | null;
}

const ME_KEY_HEADER = 'x-cogm-me';
const ID_RE = /^[A-Za-z0-9_-]{12}$/;

const MESSAGES: Record<string, string> = {
  'bad-kind': 'Pick what the keepsake should keep.',
  'no-title': 'Give the keepsake a name first.',
  'bad-event': 'That kind of event cannot be counted.',
  full: 'You have all the keepsakes you can keep. Remove one first.',
};

export function mountKeepsakeRoute(app: Express, options: KeepsakeRouteOptions): void {
  const { links, worldId, store, ledgersFor } = options;

  function who(req: Request, res: Response): { world: string; userId: string } | null {
    res.set('Cache-Control', 'no-store');
    if (!ledgersFor) {
      res.status(501).json({ error: 'Keepsakes are not available here.' });
      return null;
    }
    const raw = req.headers[ME_KEY_HEADER];
    const key = Array.isArray(raw) ? raw[0] : raw;
    const world = worldId() ?? links.worldFor(key);
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
    return { world, userId };
  }

  function reply(res: Response, userId: string): void {
    void ledgersFor?.(userId)
      .then(ledgers =>
        res.json({
          ledgers,
          kinds: KEEPSAKE_KINDS,
          eventTypes: KEEPSAKE_EVENT_TYPES,
          persistent: store.persistent,
        })
      )
      .catch(() => res.status(502).json({ error: 'Could not read your keepsakes. Try again.' }));
  }

  app.get('/api/me/keepsakes', (req: Request, res: Response) => {
    const me = who(req, res);
    if (me) reply(res, me.userId);
  });

  app.post('/api/me/keepsakes', (req: Request, res: Response) => {
    const me = who(req, res);
    if (!me) return;
    const body = (req.body ?? {}) as Record<string, unknown>;
    const result = store.add(me.world, me.userId, {
      character: body.character,
      kind: body.kind,
      title: body.title,
      eventType: body.eventType,
      unit: body.unit,
    });
    if (!result.ok) {
      res.status(400).json({ error: MESSAGES[result.code] });
      return;
    }
    reply(res, me.userId);
  });

  app.delete('/api/me/keepsakes/:id', (req: Request, res: Response) => {
    const me = who(req, res);
    if (!me) return;
    const id = String(req.params.id ?? '');
    if (!ID_RE.test(id) || !store.remove(me.world, me.userId, id)) {
      res.status(404).json({ error: 'That keepsake is gone.' });
      return;
    }
    reply(res, me.userId);
  });
}
