/**
 * `POST /mcp/core`, `/mcp/play`, `/mcp/prep`, `/mcp/build` and `/mcp/admin` (item
 * remote-gm-connector): the GM's tool sets as Claude custom connectors, one path per set, so the
 * Search and tools switches and the per-set token budgets stay as they are with the local
 * installer. Plan, confirm and undo live in the backend's tool routes and are unchanged.
 *
 * - Off unless `FOUNDRY_AI_GM_CONNECTOR=on`: nothing is mounted.
 * - Who: the `Cf-Access-Jwt-Assertion` header (never the cookie), verified against the GM remote
 *   Access application's own AUD tag (Managed OAuth, `type: app`, a verified email). When the
 *   config file lists `gmEmails`, the email must be one of them. A service token (no email) or a
 *   token of any other application gets nothing, so a player's login never reaches these paths.
 * - The set comes from the path only; the backend runs a tool only when that set lists it.
 * - Streamable HTTP, stateless: `initialize`, `ping`, `tools/list`, `tools/call`; no batches,
 *   `405` for GET. A refusal is a bare 401 or 403; a bare 503 means the table is not ready.
 * - Local development (test bridge): `FOUNDRY_AI_GM_CONNECTOR_DEV_EMAIL` lets a bare loopback
 *   request in, only on a loopback bind and only without a team domain.
 */
import { readFileSync } from 'fs';

import express, { type Express, type Request, type Response } from 'express';

import { AccessJwtVerifier } from './access-jwt.js';
import { isLoopbackHost } from './bind-policy.js';
import type { Config } from './config.js';
import type { GmConnectorOptions } from './gm-connector.js';
import type { Logger } from './logger.js';

/** The five paths, one per tool set (the backend checks the same list again). */
const GM_CONNECTOR_SETS = ['core', 'play', 'prep', 'build', 'admin'] as const;

interface GmRouteClient {
  readonly isConnected?: boolean;
  remoteGmList?(set: string): Promise<unknown>;
  remoteGmCall?(set: string, name: string, args: unknown): Promise<unknown>;
}

interface GmRouteOptions {
  config: Pick<Config, 'host'>;
  connector: GmConnectorOptions;
  client: GmRouteClient;
  logger: Logger;
  accessFetch?: ConstructorParameters<typeof AccessJwtVerifier>[1];
}

const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];
const MAX_BODY = '256kb';

const SERVER_VERSION = ((): string => {
  try {
    const pkg = JSON.parse(readFileSync(new URL('../package.json', import.meta.url), 'utf8')) as {
      version?: unknown;
    };
    return typeof pkg.version === 'string' ? pkg.version : '0.0.0';
  } catch {
    return '0.0.0';
  }
})();

type JsonRpcId = string | number | null;

function rpcError(id: JsonRpcId, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** A request from this machine itself: a loopback peer and none of the headers a proxy adds. */
function isBareLocalRequest(req: Request): boolean {
  const peer = req.socket.remoteAddress ?? '';
  const loopbackPeer = peer === '::1' || peer.startsWith('127.') || peer === '::ffff:127.0.0.1';
  if (!loopbackPeer) return false;
  return !Object.keys(req.headers).some(
    h =>
      h.startsWith('cf-') ||
      h.startsWith('tailscale-') ||
      h === 'x-forwarded-for' ||
      h === 'forwarded'
  );
}

export function mountGmRoute(app: Express, options: GmRouteOptions): void {
  const { connector, client } = options;
  if (!connector.enabled) return;
  const log = options.logger.child('gm-connector');

  let devEmail = connector.devEmail;
  if (devEmail) {
    log.warn('FOUNDRY_AI_GM_CONNECTOR_DEV_EMAIL is set: local development only');
    if (!isLoopbackHost(options.config.host) || connector.teamDomain) {
      log.warn('The dev email is ignored: not a bare loopback dashboard');
      devEmail = '';
    }
  }
  if (!devEmail && !connector.teamDomain) {
    log.warn('GM connector is on but CF_ACCESS_TEAM_DOMAIN is not set: every login is refused');
  }

  let verifier: { key: string; v: AccessJwtVerifier } | null = null;
  const verifierFor = (audiences: readonly string[]): AccessJwtVerifier | null => {
    if (!connector.teamDomain || audiences.length === 0) return null;
    const key = audiences.join('\n');
    if (verifier?.key === key) return verifier.v;
    const v = new AccessJwtVerifier(
      { teamDomain: connector.teamDomain, audiences },
      options.accessFetch
    );
    verifier = { key, v };
    return v;
  };

  /** Who this request is (an email), or the status to refuse with. */
  async function identify(req: Request): Promise<{ email: string } | { status: 401 | 403 | 503 }> {
    if (devEmail && isBareLocalRequest(req)) return { email: devEmail };
    const raw = req.headers['cf-access-jwt-assertion'];
    const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!token) return { status: 401 };
    const file = connector.read();
    const v = verifierFor(file.appAudiences);
    // Nothing to check against (no file, audience or team domain): the table's fault.
    if (!v) return { status: 503 };
    let result;
    try {
      result = await v.verifyAppToken(token);
    } catch {
      return { status: 503 };
    }
    if (!result.ok) {
      if (result.reason === 'invalid') return { status: v.hasKeys ? 401 : 503 };
      return { status: 403 };
    }
    if (file.gmEmails.length > 0 && !file.gmEmails.includes(result.email)) return { status: 403 };
    return { email: result.email };
  }

  const parseBody = express.json({ limit: MAX_BODY, type: ['application/json'] });
  const paths = GM_CONNECTOR_SETS.map(s => `/mcp/${s}`);

  app.all(paths, (req: Request, res: Response, next) => {
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

  for (const set of GM_CONNECTOR_SETS) {
    app.post(`/mcp/${set}`, (req: Request, res: Response) => {
      void handle(set, req, res).catch(() => {
        if (!res.headersSent) res.status(500).end();
      });
    });
  }

  async function handle(set: string, req: Request, res: Response): Promise<void> {
    const who = await identify(req);
    if ('status' in who) {
      res.status(who.status).end();
      return;
    }
    if (
      client.isConnected === false ||
      typeof client.remoteGmList !== 'function' ||
      typeof client.remoteGmCall !== 'function'
    ) {
      res.status(503).end();
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
    if (method === '') {
      res.json(rpcError(id, -32600, 'Invalid request'));
      return;
    }

    if (method === 'ping') {
      res.json({ jsonrpc: '2.0', id, result: {} });
      return;
    }
    try {
      if (method === 'initialize') {
        const asked = (msg.params as { protocolVersion?: unknown } | undefined)?.protocolVersion;
        const version =
          typeof asked === 'string' && SUPPORTED_PROTOCOLS.includes(asked)
            ? asked
            : SUPPORTED_PROTOCOLS[0];
        const listed = (await client.remoteGmList(set)) as { instructions?: unknown } | undefined;
        res.json({
          jsonrpc: '2.0',
          id,
          result: {
            protocolVersion: version,
            capabilities: { tools: {} },
            serverInfo: { name: `foundry-ai-tool-${set}`, version: SERVER_VERSION },
            ...(typeof listed?.instructions === 'string'
              ? { instructions: listed.instructions }
              : {}),
          },
        });
        return;
      }
      if (method === 'tools/list') {
        const listed = (await client.remoteGmList(set)) as { tools?: unknown } | undefined;
        res.json({
          jsonrpc: '2.0',
          id,
          result: { tools: Array.isArray(listed?.tools) ? listed.tools : [] },
        });
        return;
      }
      if (method === 'tools/call') {
        const p = (msg.params ?? {}) as { name?: unknown; arguments?: unknown };
        if (typeof p.name !== 'string' || p.name === '') {
          res.json(rpcError(id, -32602, 'Unknown tool'));
          return;
        }
        const result = await client.remoteGmCall(set, p.name, p.arguments ?? {});
        res.json({ jsonrpc: '2.0', id, result });
        return;
      }
    } catch {
      res.json(rpcError(id, -32000, 'The table is not reachable right now.'));
      return;
    }
    res.json(rpcError(id, -32601, 'Method not found'));
  }
}
