/**
 * Session notes (recap lane, D-087): the GM routes behind the After view's card. The bridge's
 * host-only control method `session_notes` does the work; this module only passes `list`, `get`,
 * `put` and `approve` through (`stage` and `status` stay with the pipeline on the control port).
 *
 * - `GET  /api/session-notes`               -> `{items}` (GM)
 * - `GET  /api/session-notes/:id`           -> the item with page HTML (GM; the page sanitizes
 *                                              the preview again before showing it)
 * - `POST /api/session-notes/:id/put`       -> the applied change plus `item` (GM + GM Actions)
 * - `POST /api/session-notes/:id/approve`   -> the item (GM + GM Actions; body `{by?}`)
 *
 * A refusal is `{error: {message, code}}` with a 4xx: 404 not-found, 409 conflict or not-staged,
 * 403 feature-off, writes-off or gm-actions-disabled, 400 bad-request or no-world, 503
 * not-connected (no GM Foundry client), 502 when the bridge cannot be reached.
 */
import express, { type Express, type Request, type Response } from 'express';

export type SessionNotesAction = 'list' | 'get' | 'put' | 'approve';

export interface SessionNotesClient {
  sessionNotes?(action: SessionNotesAction, params?: Record<string, unknown>): Promise<unknown>;
}

export interface SessionNotesRouteOptions {
  client: SessionNotesClient;
  requireGm: (req: Request, res: Response, next: () => void) => void;
  /** The GM Actions switch (put and approve need it on). */
  gmActionsEnabled: () => boolean;
}

const SESSION_ID = /^[A-Za-z0-9][A-Za-z0-9_-]{0,79}$/;

const STATUS_BY_CODE: Record<string, number> = {
  'not-found': 404,
  conflict: 409,
  'not-staged': 409,
  'feature-off': 403,
  'writes-off': 403,
  'bad-request': 400,
  'no-world': 400,
  'not-connected': 503,
};

function refusal(error: unknown): {
  status: number;
  body: { error: { message: string; code: string } };
} {
  const message = error instanceof Error ? error.message : String(error);
  const code = (error as { code?: unknown } | null)?.code;
  if (typeof code === 'string' && STATUS_BY_CODE[code]) {
    return { status: STATUS_BY_CODE[code], body: { error: { message, code } } };
  }
  return { status: 502, body: { error: { message, code: 'bridge-unreachable' } } };
}

export function mountSessionNotesRoute(app: Express, options: SessionNotesRouteOptions): void {
  const { client, requireGm, gmActionsEnabled } = options;
  const parseBody = express.json({ limit: 2048 });

  function run(
    res: Response,
    action: SessionNotesAction,
    params: Record<string, unknown> = {}
  ): void {
    if (typeof client.sessionNotes !== 'function') {
      res.status(502).json({
        error: { message: 'This bridge has no session notes.', code: 'bridge-unreachable' },
      });
      return;
    }
    client
      .sessionNotes(action, params)
      .then(result => res.json(result))
      .catch((error: unknown) => {
        const { status, body } = refusal(error);
        res.status(status).json(body);
      });
  }

  /** The session id from the path, or a 400 (the response is sent) and null. */
  function sessionIdOf(req: Request, res: Response): string | null {
    const id = req.params.id;
    if (typeof id !== 'string' || !SESSION_ID.test(id)) {
      res.status(400).json({ error: { message: 'Unknown session id.', code: 'bad-request' } });
      return null;
    }
    return id;
  }

  function requireGmActions(_req: Request, res: Response, next: () => void): void {
    if (!gmActionsEnabled()) {
      res.status(403).json({
        error: {
          message: 'GM Actions are off. Turn on the GM Actions switch to change the game.',
          code: 'gm-actions-disabled',
        },
      });
      return;
    }
    next();
  }

  app.get('/api/session-notes', requireGm, (_req: Request, res: Response) => run(res, 'list'));

  app.get('/api/session-notes/:id', requireGm, (req: Request, res: Response) => {
    const sessionId = sessionIdOf(req, res);
    if (sessionId) run(res, 'get', { sessionId });
  });

  app.post(
    '/api/session-notes/:id/put',
    requireGm,
    requireGmActions,
    (req: Request, res: Response) => {
      const sessionId = sessionIdOf(req, res);
      if (sessionId) run(res, 'put', { sessionId });
    }
  );

  app.post(
    '/api/session-notes/:id/approve',
    requireGm,
    requireGmActions,
    parseBody,
    (req: Request, res: Response) => {
      const sessionId = sessionIdOf(req, res);
      if (!sessionId) return;
      const by = (req.body as { by?: unknown } | undefined)?.by;
      run(res, 'approve', { sessionId, ...(typeof by === 'string' && by.trim() ? { by } : {}) });
    }
  );
}
