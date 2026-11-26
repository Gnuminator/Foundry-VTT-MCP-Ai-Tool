import type { Express, Request, Response } from 'express';

import type { RouteContext } from './context.js';
import { asRecord, readStr } from './util.js';

/**
 * Who knows what (secret ledger) and the whisper desk. All GM only: the ledger text is private,
 * so none of these routes is on the player or TV lists (the route role ratchet checks that). They
 * go through the bridge's `ledger` and `whisper` control methods, which are not tools: Claude
 * reads the ledger with `get-secret-ledger` but cannot write it or whisper.
 */
export function mountApiLedgerRoutes(app: Express, ctx: RouteContext): void {
  const { client, logger, requireGm } = ctx;

  function ledger(res: Response, action: string, params: Record<string, unknown> = {}): void {
    if (typeof client.ledger !== 'function') {
      res.status(503).json({ error: 'The who-knows-what ledger needs a newer bridge.' });
      return;
    }
    client
      .ledger(action, params)
      .then(result => res.json(result))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug('ledger step failed', { action, error: message });
        res.status(400).json({ error: message });
      });
  }

  app.get('/api/ledger', requireGm, (_req: Request, res: Response) => ledger(res, 'list'));

  app.post('/api/ledger', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    ledger(res, 'add', {
      kind: body.kind,
      text: body.text,
      knownBy: body.knownBy,
      pageId: body.pageId,
      pageName: body.pageName,
    });
  });

  app.post('/api/ledger/known-by', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    ledger(res, 'set-known-by', { id: readStr(body.id, ''), knownBy: body.knownBy });
  });

  app.post('/api/ledger/remove', requireGm, (req: Request, res: Response) => {
    ledger(res, 'remove', { id: readStr(asRecord(req.body).id, '') });
  });

  app.post('/api/whisper', requireGm, (req: Request, res: Response) => {
    if (typeof client.whisper !== 'function') {
      res.status(503).json({ error: 'The whisper desk needs a newer bridge.' });
      return;
    }
    const body = asRecord(req.body);
    client
      .whisper({
        userId: readStr(body.userId, ''),
        name: readStr(body.name, ''),
        text: readStr(body.text, ''),
      })
      .then(result => res.json(result))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug('whisper not sent', { error: message });
        res.status(400).json({ error: message });
      });
  });
}
