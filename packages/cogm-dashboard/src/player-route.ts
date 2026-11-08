/**
 * `POST /mcp/player` (D-136): the read-only player endpoint. A player's Claude Desktop reaches it
 * through the player connector (tools/player-connector), a stdio-to-HTTPS forwarder that adds the
 * player's Cloudflare Access service-token headers. Access checks the token and signs a JWT;
 * this route checks the JWT again, maps its Client ID to one Foundry user and runs one of the
 * five player tools for that user through the backend's `player_tool` control message.
 *
 * - Off unless `FOUNDRY_AI_PLAYER_CONNECTOR=on`: nothing is mounted.
 * - Who: only the `Cf-Access-Jwt-Assertion` header (never the cookie), verified against the
 *   player application's own AUD tag from the config file. A token with an email is a person,
 *   not a player token, and gets nothing (so a GM login never reaches this route).
 * - The user comes from the config file only. Never from the request body. The user must also be
 *   a non-GM user Foundry lists; anything else gets nothing.
 * - Only `initialize`, `ping`, `tools/list` and `tools/call` of the five player tools. No batches.
 * - A refusal is a bare 401 or 403: no body, so nothing to learn from it.
 */
import express, { type Express, type Request, type Response } from 'express';

import { AccessJwtVerifier, type AccessJwtConfig } from './access-jwt.js';
import { isLoopbackHost } from './bind-policy.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { PlayerConnectorOptions } from './player-connector.js';
import type { PlayerDirectory } from './usage-route.js';

/** The only tools this endpoint runs; the backend checks the same list again. */
export const PLAYER_ENDPOINT_TOOLS: readonly string[] = [
  'get-my-character',
  'get-my-level-up-options',
  'search-books',
  'find-book-entries',
  'get-book-entry',
];

export interface PlayerRouteClient {
  readonly isConnected?: boolean;
  listPlayerTools?(): Promise<unknown>;
  playerTool?(userId: string, tool: string, args: unknown): Promise<unknown>;
}

export interface PlayerRouteOptions {
  config: Pick<Config, 'host'>;
  connector: PlayerConnectorOptions;
  client: PlayerRouteClient;
  directory: PlayerDirectory;
  logger: Logger;
  accessFetch?: ConstructorParameters<typeof AccessJwtVerifier>[1];
}

const SUPPORTED_PROTOCOLS = ['2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = '64kb';

type JsonRpcId = string | number | null;

function rpcError(id: JsonRpcId, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** Headers a tunnel adds to every request; their presence means this is not a local dev call. */
function viaTunnel(req: Request): boolean {
  return Boolean(
    req.headers['cf-connecting-ip'] ||
      req.headers['cf-ray'] ||
      req.headers['cf-access-jwt-assertion']
  );
}

export function mountPlayerRoute(app: Express, options: PlayerRouteOptions): void {
  const { connector, client, directory, logger } = options;
  if (!connector.enabled) return;

  const log = logger.child('player-connector');
  let devUser = connector.devUser;
  if (devUser && !isLoopbackHost(options.config.host)) {
    log.warn('FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER is ignored: the dashboard is not on loopback');
    devUser = '';
  }
  if (!devUser && !connector.teamDomain) {
    log.warn('Player connector is on but CF_ACCESS_TEAM_DOMAIN is not set: every login is refused');
  }

  // One verifier per set of AUD tags (the file is read per request, so an edit needs no restart).
  let verifier: { key: string; v: AccessJwtVerifier } | null = null;
  const verifierFor = (audiences: readonly string[]): AccessJwtVerifier | null => {
    if (!connector.teamDomain || audiences.length === 0) return null;
    const key = audiences.join('\n');
    if (verifier?.key !== key) {
      const config: AccessJwtConfig = { teamDomain: connector.teamDomain, audiences };
      verifier = { key, v: new AccessJwtVerifier(config, options.accessFetch) };
    }
    return verifier.v;
  };
  let warnedClaims = false;

  /** The Foundry user id of this request, or the status to refuse with. */
  async function identify(req: Request): Promise<{ userId: string } | { status: 401 | 403 }> {
    if (devUser) {
      // Dev mode is for a bare local server. A request that came through the tunnel or Access
      // is never served as the dev user, and the setting never combines with a real login setup.
      if (viaTunnel(req)) return { status: 403 };
      if (connector.store.read().audiences.length > 0) return { status: 403 };
      return { userId: devUser };
    }
    const raw = req.headers['cf-access-jwt-assertion'];
    const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!token) return { status: 401 };
    const file = connector.store.read();
    const v = verifierFor(file.audiences);
    if (!v) return { status: 401 };
    let result;
    try {
      result = await v.verifyServiceToken(token);
    } catch {
      return { status: 401 };
    }
    if (!result.ok) {
      if (result.reason === 'invalid') return { status: 401 };
      if (result.reason === 'no-client-id' && !warnedClaims) {
        warnedClaims = true;
        log.warn('A valid player token has no common_name claim; its claim names follow', {
          claims: result.claimNames,
        });
      }
      return { status: 403 };
    }
    const userId = connector.store.userFor(result.clientId);
    if (!userId) return { status: 403 };
    return { userId };
  }

  /** A mapped user must still be a non-GM Foundry user (the directory never holds a GM). */
  async function playerStatus(userId: string): Promise<'ok' | 'refused' | 'offline'> {
    if (directory.get(userId)) return 'ok';
    await directory.refreshIfStale();
    if (directory.get(userId)) return 'ok';
    // A table that is off (no bridge, or no user list yet) is not a wrong login: the player is
    // told to try again, not to check their credentials.
    if (client.isConnected === false || directory.list().length === 0) return 'offline';
    return 'refused';
  }

  const parseBody = express.json({ limit: MAX_BODY, type: ['application/json'] });

  app.all('/mcp/player', (req: Request, res: Response, next) => {
    res.set('Cache-Control', 'no-store');
    if (req.method !== 'POST') {
      res.status(405).set('Allow', 'POST').end();
      return;
    }
    parseBody(req, res, err => {
      if (err) {
        res.status(400).end();
        return;
      }
      next();
    });
  });

  app.post('/mcp/player', (req: Request, res: Response) => {
    void handle(req, res).catch(() => {
      if (!res.headersSent) res.status(500).end();
    });
  });

  async function handle(req: Request, res: Response): Promise<void> {
    const who = await identify(req);
    if ('status' in who) {
      res.status(who.status).end();
      return;
    }
    const state = await playerStatus(who.userId);
    if (state !== 'ok') {
      res.status(state === 'offline' ? 503 : 403).end();
      return;
    }

    const body: unknown = req.body;
    if (body === null || typeof body !== 'object' || Array.isArray(body)) {
      res.status(400).end();
      return;
    }
    const msg = body as { id?: unknown; method?: unknown; params?: unknown };
    const hasId = typeof msg.id === 'string' || typeof msg.id === 'number';
    const id: JsonRpcId = hasId ? (msg.id as string | number) : null;
    const method = typeof msg.method === 'string' ? msg.method : '';
    if (!hasId) {
      // A notification (initialized, cancelled): accepted, nothing to answer.
      res.status(202).end();
      return;
    }

    if (method === 'initialize') {
      const asked = (msg.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
      const version =
        typeof asked === 'string' && SUPPORTED_PROTOCOLS.includes(asked)
          ? asked
          : SUPPORTED_PROTOCOLS[0];
      res.json({
        jsonrpc: '2.0',
        id,
        result: {
          protocolVersion: version,
          capabilities: { tools: {} },
          serverInfo: { name: 'foundry-ai-tool-player', version: '1.0.0' },
          instructions:
            'Read-only. Your own characters and the rulebooks your Foundry login can read.',
        },
      });
      return;
    }
    if (method === 'ping') {
      res.json({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    if (method === 'tools/list') {
      if (typeof client.listPlayerTools !== 'function') {
        res.status(503).end();
        return;
      }
      try {
        const raw = (await client.listPlayerTools()) as { tools?: unknown } | undefined;
        const tools = (
          Array.isArray(raw?.tools) ? (raw.tools as Array<{ name?: unknown }>) : []
        ).filter(t => typeof t?.name === 'string' && PLAYER_ENDPOINT_TOOLS.includes(t.name));
        res.json({ jsonrpc: '2.0', id, result: { tools } });
      } catch {
        res.json(rpcError(id, -32000, 'The table is not reachable right now.'));
      }
      return;
    }
    if (method === 'tools/call') {
      const p = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
      if (typeof p.name !== 'string' || !PLAYER_ENDPOINT_TOOLS.includes(p.name)) {
        res.json(rpcError(id, -32602, 'Unknown tool'));
        return;
      }
      if (typeof client.playerTool !== 'function') {
        res.status(503).end();
        return;
      }
      const args =
        p.arguments !== null && typeof p.arguments === 'object' && !Array.isArray(p.arguments)
          ? p.arguments
          : {};
      try {
        const result = await client.playerTool(who.userId, p.name, args);
        res.json({ jsonrpc: '2.0', id, result });
      } catch {
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            isError: true,
            content: [{ type: 'text', text: 'The table could not answer right now. Try again.' }],
          },
        });
      }
      return;
    }
    res.json(rpcError(id, -32601, 'Method not found'));
  }
}
