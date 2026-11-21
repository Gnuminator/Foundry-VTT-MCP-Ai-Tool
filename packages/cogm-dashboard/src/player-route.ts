/**
 * `POST /mcp/player` (D-136): the read-only player endpoint. A player's Claude Desktop reaches it
 * through the player connector (tools/player-connector), a stdio-to-HTTPS forwarder that adds the
 * player's Cloudflare Access service-token headers. Access checks the token and signs a JWT;
 * this route checks the JWT again, maps its Client ID to one Foundry user and runs one of the
 * five player tools for that user through the backend's `player_tool` control message.
 *
 * - Off unless `FOUNDRY_AI_PLAYER_CONNECTOR=on`: nothing is mounted.
 * - Who: only the `Cf-Access-Jwt-Assertion` header (never the cookie), verified against the
 *   player application's own AUD tag from the config file. On that application a token with an
 *   email is a person, not a player token, and gets nothing.
 * - Remote connector: the 'Player remote' Access application (Managed OAuth) signs an app token
 *   with the person's email. It is checked against its own AUD tag (`appAudience`) and the
 *   verified email maps to one Foundry user through `emailPlayers`. An email that is not listed,
 *   or that maps to a GM (the directory never holds one), gets a bare 403.
 * - The user comes from the config file only. Never from the request body. The user must also be
 *   a non-GM user Foundry lists; anything else gets nothing.
 * - Only `initialize`, `ping`, `tools/list` and `tools/call` of the five player tools. No batches.
 * - A refusal is a bare 401 or 403: no body, so nothing to learn from it. A bare 503 means the
 *   table is not ready (no config file or audience, no key fetched from Cloudflare, the bridge or
 *   the user list is off, or the player tools are not available): try again, not "check your login".
 */
import { readFileSync } from 'fs';

import {
  TOOL_VERSION,
  clientToolNotice,
  isClientBehind,
  playerExtensionVersion,
} from '@gnuminator/shared';
import express, { type Express, type Request, type Response } from 'express';

import { AccessJwtVerifier, type AccessJwtConfig } from './access-jwt.js';
import { isLoopbackHost } from './bind-policy.js';
import type { ClientRegistry } from './client-versions.js';
import type { Config } from './config.js';
import type { Logger } from './logger.js';
import type { PlayerConnectorOptions } from './player-connector.js';
import {
  PLAYER_LOCAL_TOOLS,
  runLocalPlayerTool,
  type LocalPlayerToolDeps,
} from './player-local-tools.js';
import type { PlayerDirectory } from './usage-route.js';

/** The only tools this endpoint runs; the backend checks the same list again. */
const PLAYER_ENDPOINT_TOOLS: readonly string[] = [
  'get-my-character',
  'get-my-level-up-options',
  'search-books',
  'find-book-entries',
  'get-book-entry',
  'get-player-skill-guide',
  ...PLAYER_LOCAL_TOOLS,
];

export interface PlayerRouteClient {
  readonly isConnected?: boolean;
  listPlayerTools?(): Promise<unknown>;
  playerTool?(userId: string, tool: string, args: unknown): Promise<unknown>;
  /** The player's extension and Claude client versions, for the "who uses what" page (D-146). */
  recordClient?(entry: Record<string, unknown>): Promise<unknown>;
  /** A call the dashboard answered itself, for the bridge's tool call log (names and sizes only). */
  recordCall?(entry: Record<string, unknown>): Promise<unknown>;
}

export interface PlayerRouteOptions {
  config: Pick<Config, 'host'>;
  connector: PlayerConnectorOptions;
  client: PlayerRouteClient;
  directory: PlayerDirectory;
  logger: Logger;
  /** What the dashboard answers itself (handouts, play stats); without it those tools are not listed. */
  local?: LocalPlayerToolDeps;
  /** Client versions seen (item client-updates); absent on fakes. */
  clients?: ClientRegistry;
  accessFetch?: ConstructorParameters<typeof AccessJwtVerifier>[1];
}

const SUPPORTED_PROTOCOLS = ['2025-11-25', '2025-06-18', '2025-03-26', '2024-11-05'];

/** The dashboard's own version (package.json sits one level above src/ and dist/). */
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
const MAX_BODY = '64kb';

type JsonRpcId = string | number | null;

/** A successful tool result with a content array: the only kind that gets the outdated line. */
function canCarryNotice(result: unknown): result is { content: unknown[] } {
  if (result === null || typeof result !== 'object') return false;
  const r = result as { isError?: unknown; content?: unknown };
  return r.isError !== true && Array.isArray(r.content);
}

/** One more text item on a successful tool result; an error or odd-shaped result is left alone. */
function withNotice(result: unknown, text: string): unknown {
  if (!canCarryNotice(result)) return result;
  return { ...result, content: [...result.content, { type: 'text', text }] };
}

function rpcError(id: JsonRpcId, code: number, message: string): object {
  return { jsonrpc: '2.0', id, error: { code, message } };
}

/** A token with the shape of an Access JWT: three parts and a header naming RS256 and a key id. */
function looksSigned(token: string): boolean {
  const parts = token.split('.');
  if (parts.length !== 3) return false;
  try {
    const head = JSON.parse(Buffer.from(parts[0], 'base64url').toString('utf8')) as {
      alg?: unknown;
      kid?: unknown;
    };
    return head.alg === 'RS256' && typeof head.kid === 'string';
  } catch {
    return false;
  }
}

/**
 * A request from this machine itself: a loopback peer and none of the headers a tunnel, Access
 * or a proxy adds. Dev mode serves only these.
 */
function isBareLocalRequest(req: Request): boolean {
  const peer = req.socket.remoteAddress ?? '';
  const loopbackPeer = peer === '::1' || peer.startsWith('127.') || peer === '::ffff:127.0.0.1';
  if (!loopbackPeer) return false;
  return !Object.keys(req.headers).some(
    h =>
      // The player connector wrapper always sends its service-token pair, also to a local
      // dashboard in dev-user mode. The edge and cloudflared add other cf- headers (ray,
      // connecting-ip), so the pair alone does not make a request look proxied.
      (h.startsWith('cf-') && h !== 'cf-access-client-id' && h !== 'cf-access-client-secret') ||
      h.startsWith('tailscale-') ||
      h === 'x-forwarded-for' ||
      h === 'forwarded'
  );
}

export function mountPlayerRoute(app: Express, options: PlayerRouteOptions): void {
  const { connector, client, directory, logger } = options;
  if (!connector.enabled) return;

  const log = logger.child('player-connector');
  let devUser = connector.devUser;
  if (devUser) {
    // The Pi binds loopback too, so loopback alone proves nothing: a real login setup (a team
    // domain) always wins, and the setting is announced every start.
    log.warn('FOUNDRY_AI_PLAYER_CONNECTOR_DEV_USER is set: local development only');
    if (!isLoopbackHost(options.config.host)) {
      log.warn('The dev user is ignored: the dashboard is not on loopback');
      devUser = '';
    } else if (connector.teamDomain || connector.teamDomainRaw) {
      log.warn(
        'The dev user is ignored: CF_ACCESS_TEAM_DOMAIN is set (a real login setup, even if malformed)'
      );
      devUser = '';
    }
  }
  if (!devUser && !connector.teamDomain) {
    log.warn(
      'Player connector is on but CF_ACCESS_TEAM_DOMAIN is not set or does not parse: every login is refused'
    );
  }

  // One verifier per set of AUD tags (the file is read per request, so an edit needs no restart).
  const verifiers = new Map<string, { key: string; v: AccessJwtVerifier }>();
  const verifierFor = (
    slot: 'service' | 'app',
    audiences: readonly string[]
  ): AccessJwtVerifier | null => {
    if (!connector.teamDomain || audiences.length === 0) return null;
    const key = audiences.join('\n');
    const have = verifiers.get(slot);
    if (have?.key === key) return have.v;
    const config: AccessJwtConfig = { teamDomain: connector.teamDomain, audiences };
    const v = new AccessJwtVerifier(config, options.accessFetch);
    verifiers.set(slot, { key, v });
    return v;
  };
  let warnedClaims = false;

  /** The Foundry user id of this request, or the status to refuse with. */
  async function identify(req: Request): Promise<{ userId: string } | { status: 401 | 403 | 503 }> {
    // Dev mode is for a bare local server: no login, loopback peer, no proxy or tunnel headers,
    // and no Access application named in the file. Anything else goes through the real check.
    if (devUser && isBareLocalRequest(req)) {
      const named = connector.store.read();
      if (named.audiences.length === 0 && named.appAudiences.length === 0) {
        return { userId: devUser };
      }
    }
    const raw = req.headers['cf-access-jwt-assertion'];
    const token = (Array.isArray(raw) ? raw[0] : raw)?.trim();
    if (!token) return { status: devUser ? 403 : 401 };
    const file = connector.store.read();
    // The remote connector first: its own application and AUD tag. A token that is not a valid
    // token of that application falls through to the service-token check below.
    const appV = verifierFor('app', file.appAudiences);
    if (appV) {
      let app;
      try {
        app = await appV.verifyAppToken(token);
      } catch {
        return { status: 503 };
      }
      if (app.ok) {
        const mapped = connector.store.userForEmail(app.email);
        return mapped ? { userId: mapped } : { status: 403 };
      }
      if (app.reason !== 'invalid') return { status: 403 };
      if (file.audiences.length === 0) {
        return { status: appV.hasKeys || !looksSigned(token) ? 401 : 503 };
      }
    }
    const v = verifierFor('service', file.audiences);
    // Nothing to check against (no file, audience or team domain): the table's fault, not theirs.
    if (!v) return { status: 503 };
    let result;
    try {
      result = await v.verifyServiceToken(token);
    } catch {
      return { status: 503 };
    }
    if (!result.ok) {
      // A token that cannot even be read is the caller's; a readable one that no key could be
      // fetched for is ours (Cloudflare unreachable): try again, not "check your login".
      if (result.reason === 'invalid') {
        // Both applications' keys must be loaded before "invalid" is the caller's fault: an app
        // token fails here too when only the app verifier could not fetch its keys.
        const keysOk = v.hasKeys && (!appV || appV.hasKeys);
        return { status: keysOk || !looksSigned(token) ? 401 : 503 };
      }
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

  /**
   * A mapped user must still be a non-GM Foundry user (the directory never holds a GM). This is
   * only a first filter: the module's own refusal (a GM or unknown user) is authoritative.
   */
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

    // Auth has passed: remember which extension version this player runs (the version only).
    const extVersion = playerExtensionVersion(req.headers['user-agent']);
    // Keyed by the Foundry user id (stable, unique); the name is only the GM list's label.
    const playerKey = who.userId;
    if (extVersion && options.clients) {
      const label = directory.get(who.userId)?.name ?? who.userId;
      options.clients.record('player-extension', playerKey, extVersion, Date.now(), label);
    }
    // Kept by the bridge too (survives a restart): the version only, keyed by the Foundry user id.
    if (extVersion && typeof client.recordClient === 'function') {
      void client
        .recordClient({ piece: 'player-extension', who: who.userId, version: extVersion })
        .catch(() => undefined);
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
    if (hasId && method === '') {
      // A request needs a method.
      res.json(rpcError(id, -32600, 'Invalid request'));
      return;
    }
    if (!hasId) {
      // A notification (initialized, cancelled): accepted, nothing to answer.
      res.status(202).end();
      return;
    }

    if (method === 'initialize') {
      const initParams = msg.params as
        | { protocolVersion?: unknown; clientInfo?: { name?: unknown; version?: unknown } }
        | undefined;
      // Which Claude app this player uses (its name and version, as the client says them).
      if (
        typeof client.recordClient === 'function' &&
        typeof initParams?.clientInfo?.name === 'string'
      ) {
        void client
          .recordClient({
            piece: 'claude',
            who: who.userId,
            name: initParams.clientInfo.name,
            version: initParams.clientInfo.version,
          })
          .catch(() => undefined);
      }
      const asked = initParams?.protocolVersion;
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
          serverInfo: { name: 'foundry-ai-tool-player', version: SERVER_VERSION },
          instructions:
            'Read-only. Your own characters and the rulebooks your Foundry login can read. Before your first answer, call get-player-skill-guide first, with no arguments, and follow it.',
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
        const tools = (Array.isArray(raw?.tools) ? (raw.tools as Array<{ name?: unknown }>) : [])
          .filter(t => typeof t?.name === 'string' && PLAYER_ENDPOINT_TOOLS.includes(t.name))
          // A dashboard with no local source cannot answer these two, so it does not list them.
          .filter(
            t => options.local !== undefined || !PLAYER_LOCAL_TOOLS.includes(t.name as string)
          );
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
      const isLocal = PLAYER_LOCAL_TOOLS.includes(p.name);
      if (isLocal ? !options.local : typeof client.playerTool !== 'function') {
        res.status(503).end();
        return;
      }
      const args =
        p.arguments !== null && typeof p.arguments === 'object' && !Array.isArray(p.arguments)
          ? p.arguments
          : {};
      try {
        const startedAt = Date.now();
        const result =
          isLocal && options.local
            ? await runLocalPlayerTool(options.local, p.name, args, who.userId)
            : await client.playerTool!(who.userId, p.name, args);
        // The bridge logs the tools it runs itself; the two the dashboard answers are logged here.
        if (isLocal && typeof client.recordCall === 'function') {
          const r = result as { isError?: unknown; content?: unknown } | null;
          const size = Array.isArray(r?.content)
            ? (r.content as { text?: unknown }[]).reduce(
                (sum, c) => sum + (typeof c?.text === 'string' ? c.text.length : 0),
                0
              )
            : 0;
          void client
            .recordCall({
              tool: p.name,
              userId: who.userId,
              ms: Date.now() - startedAt,
              size,
              ok: r?.isError !== true,
            })
            .catch(() => undefined);
        }
        // Only a result that can carry the line spends this player's six-hour slot.
        const notice =
          extVersion &&
          options.clients &&
          isClientBehind(extVersion, TOOL_VERSION) &&
          canCarryNotice(result) &&
          options.clients.shouldNotify(`player-extension:${playerKey}`, Date.now())
            ? clientToolNotice('player-extension', extVersion, TOOL_VERSION)
            : null;
        res.json({ jsonrpc: '2.0', id, result: notice ? withNotice(result, notice) : result });
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
