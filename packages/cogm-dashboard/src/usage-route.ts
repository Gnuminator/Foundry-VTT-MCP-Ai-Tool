/**
 * The usage log's HTTP side (I-084, docs/design/USAGE-LOG.md): which controls of the dashboard
 * and the `/player` page people use. Two write-only routes and a name list:
 * - `POST /api/usage`: the GM page (GM role only). The server decides the surface
 *   (`dashboard`) and who (`gm`), whatever the body says.
 * - `POST /api/player/usage`: the player page (any resolved role; a GM token still counts as a
 *   player here). The server forces the surface (`player`, so only `player.*` names) and sets
 *   `who` from the claimed user id only when it is a known non-GM user.
 * - `GET /api/player/names`: the non-GM user names the page offers for its one-time name pick.
 * There is no route that returns usage data. Accepted events go on to the bridge with the
 * control method `record_usage`; a backend without it is noted once and the events dropped.
 */
import express, { type Express, type Request, type Response } from 'express';
import {
  USAGE_LIMITS,
  sanitizeUsageBatch,
  type RecordUsageResult,
  type UsageEvent,
  type UsageWho,
} from '@gnuminator/shared';

import { resolveRole } from './auth.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';

/** What the usage routes need from the bridge client (the MCP control client satisfies it). */
export interface UsageClient {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
  recordUsage?(events: UsageEvent[]): Promise<RecordUsageResult>;
  readonly isConnected?: boolean;
}

export interface PlayerName {
  userId: string;
  name: string;
}

const USER_ID_RE = /^[A-Za-z0-9_-]{1,64}$/;
const NAME_MAX = 64;
/** How long a world-info read is reused before `GET /api/player/names` asks the bridge again. */
const NAMES_REFRESH_MS = 30_000;
/** The name pick never waits longer than this for the bridge. */
const NAMES_WAIT_MS = 3_000;

function asRecord(value: unknown): Record<string, unknown> {
  return value !== null && typeof value === 'object' ? (value as Record<string, unknown>) : {};
}

/**
 * The non-GM users the dashboard has seen since it started (from `get-world-info`'s
 * `playerUsers`, which lists offline players too, and `activeUsers`). GMs are never
 * listed, and a user seen as a GM later is removed.
 */
export class PlayerDirectory {
  private readonly users = new Map<string, string>();
  private refreshedAt = 0;
  private inflight: Promise<void> | null = null;

  constructor(
    private readonly client: UsageClient,
    private readonly logger: Logger,
    private readonly now: () => number = Date.now
  ) {}

  /** Learn users from a `get-world-info` answer. */
  harvest(raw: unknown): void {
    const record = asRecord(raw);
    // `playerUsers` (every non-GM user) from newer bridges; `activeUsers` as a fallback.
    const listed: unknown[] = Array.isArray(record.playerUsers) ? record.playerUsers : [];
    const active: unknown[] = Array.isArray(record.activeUsers) ? record.activeUsers : [];
    for (const item of [...listed, ...active]) {
      const u = asRecord(item);
      if (typeof u.id !== 'string' || !USER_ID_RE.test(u.id)) continue;
      if (u.isGM === true) {
        this.users.delete(u.id);
        continue;
      }
      if (typeof u.name !== 'string') continue;
      // eslint-disable-next-line no-control-regex
      const name = u.name.replace(/[\u0000-\u001f]/g, '').trim();
      if (name) this.users.set(u.id, name.slice(0, NAME_MAX));
    }
  }

  list(): PlayerName[] {
    return [...this.users.entries()]
      .map(([userId, name]) => ({ userId, name }))
      .sort((a, b) => a.name.localeCompare(b.name));
  }

  get(userId: string): PlayerName | null {
    const name = this.users.get(userId);
    return name === undefined ? null : { userId, name };
  }

  /** Ask the bridge for the active users, at most once per {@link NAMES_REFRESH_MS}. */
  async refreshIfStale(): Promise<void> {
    if (this.client.isConnected === false) return;
    if (this.now() - this.refreshedAt < NAMES_REFRESH_MS) return;
    if (!this.inflight) {
      this.refreshedAt = this.now();
      this.inflight = this.client
        .callTool('get-world-info')
        .then(raw => this.harvest(raw))
        .catch((error: unknown) => {
          this.logger.debug('player names: world info failed', {
            error: error instanceof Error ? error.message : String(error),
          });
        })
        .finally(() => {
          this.inflight = null;
        });
    }
    let timer: NodeJS.Timeout | undefined;
    const limit = new Promise<void>(resolve => {
      timer = setTimeout(resolve, NAMES_WAIT_MS);
      timer.unref();
    });
    await Promise.race([this.inflight, limit]);
    if (timer) clearTimeout(timer);
  }
}

/** The `who` the server records for a player page batch (a claimed id must be a known non-GM user). */
export function playerWho(claim: unknown, directory: PlayerDirectory): UsageWho {
  const userId = asRecord(claim).userId;
  const known = typeof userId === 'string' ? directory.get(userId) : null;
  return { role: 'player', userId: known?.userId ?? null, name: known?.name ?? null };
}

export interface UsageRouteOptions {
  config: Config;
  client: UsageClient;
  logger: Logger;
  directory: PlayerDirectory;
  /** The dashboard's 401/403 guard for the GM role. */
  requireGm: (req: Request, res: Response, next: () => void) => void;
}

/** Mount the usage routes. Call before the app-wide JSON parser: these parse their own body. */
export function mountUsageRoute(app: Express, options: UsageRouteOptions): void {
  const { config, client, logger, directory, requireGm } = options;
  const parseBody = express.json({
    limit: USAGE_LIMITS.maxBatchBytes,
    // sendBeacon may label a string body text/plain.
    type: ['application/json', 'text/plain'],
  });
  let warnedUnknownMethod = false;

  /** Hand clean events to the bridge; never throws. */
  async function forward(events: UsageEvent[]): Promise<RecordUsageResult> {
    if (events.length === 0) return { accepted: 0, dropped: 0 };
    if (typeof client.recordUsage !== 'function') return { accepted: 0, dropped: events.length };
    try {
      return await client.recordUsage(events);
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error);
      if (/unknown method/i.test(message)) {
        if (!warnedUnknownMethod) {
          warnedUnknownMethod = true;
          logger.warn(
            'The bridge does not know record_usage (older backend): usage events are dropped'
          );
        }
      } else {
        logger.debug('usage events not delivered', { error: message });
      }
      return { accepted: 0, dropped: events.length };
    }
  }

  async function respond(
    res: Response,
    body: unknown,
    options: { surface: 'dashboard' | 'player'; who: UsageWho }
  ): Promise<void> {
    const payload = asRecord(body);
    if (!Array.isArray(payload.events)) {
      res.status(400).json({ code: 'bad-usage-batch', error: 'A list of "events" is required.' });
      return;
    }
    const { events, dropped } = sanitizeUsageBatch(payload.events, {
      surface: options.surface,
      who: options.who,
    });
    const result = await forward(events);
    res.json({ accepted: result.accepted, dropped: dropped + result.dropped });
  }

  app.post('/api/usage', requireGm, parseBody, (req: Request, res: Response) => {
    void respond(res, req.body, {
      surface: 'dashboard',
      who: { role: 'gm', userId: null, name: null },
    });
  });

  app.post('/api/player/usage', playerAuth, parseBody, (req: Request, res: Response) => {
    void respond(res, req.body, {
      surface: 'player',
      who: playerWho(asRecord(req.body).who, directory),
    });
  });

  app.get('/api/player/names', playerAuth, (_req: Request, res: Response) => {
    void directory
      .refreshIfStale()
      .catch(() => undefined)
      .then(() => res.json(directory.list()));
  });

  /** Any resolved role (GM or player) may use the player page's routes. */
  function playerAuth(req: Request, res: Response, next: () => void): void {
    if (!resolveRole(req, config.auth)) {
      res.status(401).json({ error: 'Unauthorized' });
      return;
    }
    next();
  }
}
