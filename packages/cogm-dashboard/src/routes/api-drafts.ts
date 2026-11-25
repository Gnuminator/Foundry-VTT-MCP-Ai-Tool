import type { Express, Request, Response } from 'express';

import type { RouteContext } from './context.js';
import { asRecord, readStr } from './util.js';

/**
 * Draft tray (I-069). All GM only: the list and the edit, discard, reopen and publish buttons for
 * the GM page. Everything goes through the bridge's `drafts` control method, which is not a tool,
 * so Claude can draft but never publish.
 */
export function mountApiDraftsRoutes(app: Express, ctx: RouteContext): void {
  const { client, logger, requireGm } = ctx;

  function run(res: Response, action: string, params: Record<string, unknown> = {}): void {
    if (typeof client.drafts !== 'function') {
      res.status(503).json({ error: 'The draft tray needs a newer bridge.' });
      return;
    }
    client
      .drafts(action, params)
      .then(result => res.json(result))
      .catch((error: unknown) => {
        const message = error instanceof Error ? error.message : String(error);
        logger.debug('drafts step failed', { action, error: message });
        res.status(400).json({ error: message });
      });
  }

  app.get('/api/drafts', requireGm, (_req: Request, res: Response) => run(res, 'list'));

  app.post('/api/drafts/edit', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    run(res, 'edit', {
      id: readStr(body.id, ''),
      text: typeof body.text === 'string' ? body.text : undefined,
      speaker: typeof body.speaker === 'string' ? body.speaker : undefined,
      whisperTo: typeof body.whisperTo === 'string' ? body.whisperTo : undefined,
    });
  });

  app.post('/api/drafts/discard', requireGm, (req: Request, res: Response) => {
    run(res, 'discard', { id: readStr(asRecord(req.body).id, '') });
  });

  app.post('/api/drafts/reopen', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    run(res, 'reopen', {
      id: readStr(body.id, ''),
      confirmUnsure: body.confirmUnsure === true,
    });
  });

  app.post('/api/drafts/publish', requireGm, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    run(res, 'publish', {
      id: readStr(body.id, ''),
      rev: typeof body.rev === 'number' ? body.rev : undefined,
      confirmedTerms: Array.isArray(body.confirmedTerms) ? body.confirmedTerms : [],
    });
  });
}
