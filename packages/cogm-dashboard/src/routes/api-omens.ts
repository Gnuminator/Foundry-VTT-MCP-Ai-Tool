import type { Express, Request, Response } from 'express';

import type { RouteContext } from './context.js';
import { asRecord, readStr } from './util.js';

/**
 * Omens by post (I-181). All GM only: the list and the approve, reject and reopen buttons for
 * the GM page, and the three steps the Discord bot takes to send approved omens (outbox, claim,
 * finish). The bot needs the GM token for these (FOUNDRY_AI_GM_TOKEN in its env file), because
 * the text of an unsent omen is private. Everything goes through the bridge's `omens` control
 * method, which is not a tool, so Claude can draft but never approve.
 */
export function mountApiOmensRoutes(app: Express, ctx: RouteContext): void {
  const { client, logger, requireGm } = ctx;

  function run(
    res: Response,
    action: string,
    params: Record<string, unknown> = {},
    shape: (result: unknown) => unknown = r => r
  ): void {
    if (typeof client.omens !== 'function') {
      res.status(503).json({ error: 'The omens list needs a newer bridge.' });
      return;
    }
    client
      .omens(action, params)
      .then(result => res.json(shape(result)))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug('omens step failed', { action, error: message });
        res.status(400).json({ error: message });
      });
  }

  app.get('/api/omens', requireGm, (_req: Request, res: Response) => run(res, 'list'));

  app.post('/api/omens/decide', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    run(res, 'decide', {
      id: readStr(body.id, ''),
      decision: readStr(body.decision, ''),
      confirmFlagged: body.confirmFlagged === true,
      confirmUnsure: body.confirmUnsure === true,
    });
  });

  app.post('/api/omens/player', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    run(res, 'set-player', {
      userId: readStr(body.userId, ''),
      discordId: typeof body.discordId === 'string' ? body.discordId : null,
    });
  });

  app.get('/api/omens/outbox', requireGm, (_req: Request, res: Response) => run(res, 'outbox'));

  app.post('/api/omens/claim', requireGm, (req: Request, res: Response) => {
    run(res, 'claim', { id: readStr(asRecord(req.body).id, '') });
  });

  app.post('/api/omens/finish', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    run(res, 'finish', {
      id: readStr(body.id, ''),
      ok: body.ok === true,
      error: readStr(body.error, ''),
    });
  });
}
