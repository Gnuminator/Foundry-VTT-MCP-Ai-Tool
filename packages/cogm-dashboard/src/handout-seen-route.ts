/**
 * `POST /api/player/handout-seen` (I-039): the player page reports that a
 * player opened a handout. The claimed user must be a known non-GM user (the
 * usage log's name pick, D-065); the bridge's control method
 * `record_handout_seen` checks the page is revealed to that player and keeps
 * the first time only. Never throws, never blocks the player page.
 */
import express, { type Express, type Request, type Response } from 'express';

import { resolveRole } from './auth.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { PlayerDirectory } from './usage-route.js';

export interface HandoutSeenClient {
  recordHandoutSeen?(pageId: string, userId: string, name: string): Promise<{ recorded: boolean }>;
}

const PAGE_ID_RE = /^[A-Za-z0-9]{16}$/;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

export interface HandoutSeenRouteOptions {
  config: Config;
  client: HandoutSeenClient;
  logger: Logger;
  directory: PlayerDirectory;
  /** Called after a new first open is recorded (the GM's views refresh). */
  onRecorded?: () => void;
}

export function mountHandoutSeenRoute(app: Express, options: HandoutSeenRouteOptions): void {
  const { config, client, logger, directory, onRecorded } = options;
  const parseBody = express.json({ limit: 2048 });

  app.post('/api/player/handout-seen', playerAuth, parseBody, (req: Request, res: Response) => {
    const body = asRecord(req.body);
    const pageId = typeof body.handoutId === 'string' ? body.handoutId : '';
    const userId = typeof body.userId === 'string' ? body.userId : '';
    void directory
      .refreshIfStale()
      .catch(() => undefined)
      .then(() => record(res, pageId, userId));
  });

  function record(res: Response, pageId: string, userId: string): void {
    const who = directory.get(userId);
    if (!PAGE_ID_RE.test(pageId) || !who) {
      res
        .status(400)
        .json({ code: 'bad-handout-seen', error: 'A handout id and a known player are required.' });
      return;
    }
    if (typeof client.recordHandoutSeen !== 'function') {
      res.json({ recorded: false });
      return;
    }
    client
      .recordHandoutSeen(pageId, who.userId, who.name)
      .then(result => {
        if (result.recorded) onRecorded?.();
        res.json({ recorded: result.recorded === true });
      })
      .catch((error: unknown) => {
        logger.debug('handout seen not recorded', {
          error: error instanceof Error ? error.message : String(error),
        });
        res.json({ recorded: false });
      });
  }

  function playerAuth(req: Request, res: Response, next: () => void): void {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }
}
