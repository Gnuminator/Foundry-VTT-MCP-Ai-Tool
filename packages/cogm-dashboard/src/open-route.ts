/**
 * "Open in Foundry" links (Obsidian O4, docs/design/OBSIDIAN-O4-DESIGN.md section 6).
 *
 * - `GET /open?uuid=...` serves `public/open.html`, a static shell with no data,
 *   to every caller. It never authenticates and never calls the bridge: a click
 *   in Obsidian is a top-level navigation that carries no credential, and link
 *   previews and scanners fetch URLs too.
 * - `POST /api/open {uuid, userId?}` acts: it calls the `open-in-foundry` tool
 *   once. Every check runs inside the POST handler, in this order: cross-site
 *   guard, the `X-CoGM-Request: open` header, GM auth (token from the
 *   `X-CoGM-Token` header only), the JSON body, the rate limit. There is no
 *   OPTIONS handler and no `Access-Control-*` header (the P1 plugin adds those
 *   later, section 6.4), so browsers keep blocking every cross-origin call.
 *
 * The confirm page shares an origin with the GM token (localStorage
 * `cogm_token`), so it gets a strict CSP, no framing, no referrer and no
 * caching, on every URL that reaches its files (see `openPageStaticHeaders`).
 */
import type { IncomingHttpHeaders, ServerResponse } from 'http';

import {
  OPEN_REQUEST_HEADER,
  OPEN_REQUEST_VALUE,
  isFoundryUuid,
  type OpenLinkError,
  type OpenLinkErrorCode,
  type OpenLinkResult,
} from '@gnuminator/shared';
import express, { type Express, type Request, type Response } from 'express';

import { resolveRole, isGm, type AuthRequest } from './auth.js';
import type { AuthConfig } from './config.js';
import { ChannelError, TimeoutError } from './feed/mcp-control-client.js';
import type { Logger } from './logger.js';
import { staticHeaders, type StaticHeaderGroup, type StaticSetHeaders } from './static-headers.js';

/** Headers on the confirm page (stricter than the player page's CSP). */
export const OPEN_PAGE_CSP =
  "default-src 'none'; script-src 'self'; connect-src 'self'; style-src 'self'; " +
  "base-uri 'none'; form-action 'none'; frame-ancestors 'none'";

/** The confirm page's static files; each is served with the page headers. */
export const OPEN_PAGE_FILES: readonly string[] = ['open.html', 'open.js', 'open.css'];

/** At most `max` opens per `windowMs`, across the process (counted after auth). */
export const OPEN_RATE_LIMIT = { max: 10, windowMs: 10_000 } as const;

const USER_ID = /^[A-Za-z0-9]{16}$/;
const BODY_LIMIT = '4kb';
const GM_NAME_MAX = 100;
const BRIDGE_MESSAGE_MAX = 200;
/** A drive, UNC or multi-segment path, a file URL, or a stack frame: never shown. */
const INTERNALS =
  /[A-Za-z]:[\\/]|\\\\|\bfile:\/\/|(?:^|[\s(])\/[\w.-]+\/|\bat\s+\S+\s+\(|\bat\s+\//;

/** The bridge calls this route makes (the dashboard's control client satisfies it). */
export interface OpenRouteClient {
  callTool<T = unknown>(name: string, args?: Record<string, unknown>): Promise<T>;
}

/** Options `createDashboard` passes through (P1 fills `allowedOrigins` from config). */
export interface OpenRouteOptions {
  /**
   * Origins that pass the cross-site check (and only that check), e.g.
   * `app://obsidian.md` for the P1 plugin. Default: none.
   */
  allowedOrigins?: readonly string[];
  /** Clock for the rate limit (tests). */
  now?: () => number;
}

export interface OpenRouteDeps extends OpenRouteOptions {
  config: { readonly auth: AuthConfig; readonly publicDir: string };
  client: OpenRouteClient;
  logger: Logger;
}

function setOpenPageHeaders(res: ServerResponse): void {
  res.setHeader('Content-Security-Policy', OPEN_PAGE_CSP);
  res.setHeader('Referrer-Policy', 'no-referrer');
  res.setHeader('Cache-Control', 'no-store');
}

/** The confirm page's files and their headers, for the shared static hook. */
export const OPEN_PAGE_HEADERS: StaticHeaderGroup = {
  files: OPEN_PAGE_FILES,
  apply: setOpenPageHeaders,
};

/**
 * The `express.static` `setHeaders` hook for the confirm page alone: the page
 * headers on its files, whatever URL spelling reached them (`/OPEN.HTML`,
 * `/open%2Ehtml`, `/x/../open.html`, a Windows short name; see
 * `static-headers.ts`). The app combines `OPEN_PAGE_HEADERS` with its other
 * groups into one hook.
 */
export function openPageStaticHeaders(publicDir: string): StaticSetHeaders {
  return staticHeaders(publicDir, [OPEN_PAGE_HEADERS]);
}

function single(value: string | string[] | undefined): string | undefined {
  return Array.isArray(value) ? value[0] : value;
}

/** True when `origin` names the same host as the request's `Host` header. */
function sameOriginAsHost(origin: string, host: string | undefined): boolean {
  if (!host || !/^[A-Za-z0-9.:[\]-]+$/.test(host)) return false;
  let originUrl: URL;
  let hostUrl: URL;
  try {
    originUrl = new URL(origin);
    if (originUrl.protocol !== 'http:' && originUrl.protocol !== 'https:') return false;
    // A browser sends the bare serialized origin; anything else is not one.
    if (originUrl.origin !== origin) return false;
    // Parse the Host with the origin's scheme so default ports compare equal.
    hostUrl = new URL(`${originUrl.protocol}//${host}`);
  } catch {
    return false;
  }
  return originUrl.host === hostUrl.host;
}

/**
 * The cross-site guard (section 6.4): why the request is refused, or null.
 * An Origin in `allowedOrigins` passes this check (and only this check).
 * Refused: `Sec-Fetch-Site` other than `same-origin` or `none` (so `cross-site`
 * and `same-site`), `Origin: null`, and an Origin whose host is not the
 * request's `Host`. No Origin and no `Sec-Fetch-Site` (curl, old clients)
 * passes: the custom header and the token still apply.
 */
export function crossSiteRefusal(
  headers: IncomingHttpHeaders,
  allowedOrigins: readonly string[]
): string | null {
  const origin = single(headers.origin);
  if (origin !== undefined && allowedOrigins.includes(origin)) return null;
  const site = single(headers['sec-fetch-site'])?.trim().toLowerCase();
  if (site !== undefined && site !== 'same-origin' && site !== 'none') {
    return 'Cross-site requests cannot open documents. Open the link in your browser.';
  }
  if (origin !== undefined && !sameOriginAsHost(origin, single(headers.host))) {
    return 'Requests from another site cannot open documents. Open the link in your browser.';
  }
  return null;
}

/**
 * GM auth with the token from the `X-CoGM-Token` header only: the query string
 * and the cookie are stripped before the role is resolved, so a token in a URL
 * (history, logs, Referer) or an ambient cookie never authorizes an open.
 * 401 when no GM credential was presented, 403 for a valid player token.
 */
function authStatus(req: Request, auth: AuthConfig): 200 | 401 | 403 {
  const headers: Record<string, string | string[] | undefined> = { ...req.headers };
  delete headers.cookie;
  const accessEmail = (req as Request & AuthRequest).accessEmail;
  const view: AuthRequest = { headers, query: {}, ...(accessEmail ? { accessEmail } : {}) };
  const role = resolveRole(view, auth);
  if (isGm(role)) return 200;
  return role === 'player' && auth.playerToken !== '' ? 403 : 401;
}

function asRecord(value: unknown): Record<string, unknown> | null {
  return value !== null && typeof value === 'object' && !Array.isArray(value)
    ? (value as Record<string, unknown>)
    : null;
}

function toResult(raw: unknown): OpenLinkResult {
  const r = asRecord(raw) ?? {};
  return {
    opened: r.opened === true,
    documentName: typeof r.documentName === 'string' ? r.documentName : '',
    name: typeof r.name === 'string' ? r.name : null,
    userId: typeof r.userId === 'string' ? r.userId : '',
  };
}

function errorText(error: unknown): string {
  return error instanceof Error ? error.message : String(error);
}

/** The tool's "Several GMs are logged in (...); pass userId" error. */
function isChooseGm(error: unknown): boolean {
  return /several gms are logged in/i.test(errorText(error));
}

/** A short, safe message for a failed open: never a stack or a path. */
export function bridgeMessage(error: unknown): string {
  if (error instanceof TimeoutError) return 'The bridge did not answer in time. Is Foundry open?';
  if (error instanceof ChannelError) return 'The dashboard is not connected to the bridge.';
  const line = (errorText(error).split(/\r?\n/, 1)[0] ?? '')
    .replace(/^Error:\s*/i, '')
    .replace(/^Query \S+ failed:\s*/i, '')
    .replace(/^Failed to open document:\s*/i, '')
    .trim();
  if (line === '' || line.length > BRIDGE_MESSAGE_MAX || INTERNALS.test(line)) {
    return 'Foundry could not open it.';
  }
  return `Foundry could not open it: ${line}`;
}

/** Sliding-window limiter; `take()` records an attempt or returns the wait in ms. */
class RateLimiter {
  private stamps: number[] = [];

  constructor(
    private readonly max: number,
    private readonly windowMs: number,
    private readonly now: () => number
  ) {}

  take(): number {
    const t = this.now();
    this.stamps = this.stamps.filter(s => t - s < this.windowMs);
    const oldest = this.stamps[0];
    if (this.stamps.length >= this.max && oldest !== undefined) {
      return Math.max(1, this.windowMs - (t - oldest));
    }
    this.stamps.push(t);
    return 0;
  }
}

function send(
  res: Response,
  status: number,
  code: OpenLinkErrorCode,
  error: string,
  gms?: Array<{ id: string; name: string }>
): void {
  const body: OpenLinkError = gms ? { code, error, gms } : { code, error };
  res.status(status).json(body);
}

/**
 * Mount `GET /open` and `POST /api/open`. Mount it before the app's global
 * `express.json()`: the POST parses its own (small) body after its guards, so
 * a malformed or oversized body still gets a JSON error with a `code`.
 */
export function mountOpenRoute(app: Express, deps: OpenRouteDeps): void {
  const { config, client, logger } = deps;
  const allowedOrigins = deps.allowedOrigins ?? [];
  const limiter = new RateLimiter(
    OPEN_RATE_LIMIT.max,
    OPEN_RATE_LIMIT.windowMs,
    deps.now ?? Date.now
  );
  const parseJson = express.json({ limit: BODY_LIMIT, strict: true });

  // The confirm page: static, the same for every caller, never calls the bridge.
  app.get('/open', (_req: Request, res: Response) => {
    setOpenPageHeaders(res);
    res.sendFile('open.html', { root: config.publicDir });
  });

  /** The GMs to pick from (online ones), or undefined when the lookup fails. */
  async function listGms(): Promise<Array<{ id: string; name: string }> | undefined> {
    try {
      const raw = await client.callTool('list-ref-choices', {
        kind: 'user',
        filter: { role: 'gm' },
      });
      const choices = asRecord(raw)?.choices;
      const gms = (Array.isArray(choices) ? choices : [])
        .map(asRecord)
        .filter((c): c is Record<string, unknown> => c !== null)
        // The listing marks each user online or offline in `detail`.
        .filter(c => !(typeof c.detail === 'string' && /\boffline\b/i.test(c.detail)))
        .flatMap(c =>
          typeof c.id === 'string' && USER_ID.test(c.id) && typeof c.name === 'string'
            ? [{ id: c.id, name: c.name.slice(0, GM_NAME_MAX) }]
            : []
        );
      return gms.length > 0 ? gms : undefined;
    } catch (error) {
      logger.warn('Open in Foundry: could not list the GMs', { error: errorText(error) });
      return undefined;
    }
  }

  async function handleOpen(req: Request, res: Response): Promise<void> {
    res.setHeader('Cache-Control', 'no-store');

    // a. Cross-site guard.
    const refusal = crossSiteRefusal(req.headers, allowedOrigins);
    if (refusal) {
      logger.warn('Open in Foundry refused: cross-site', {
        origin: single(req.headers.origin) ?? null,
        site: single(req.headers['sec-fetch-site']) ?? null,
      });
      send(res, 403, 'cross-site', refusal);
      return;
    }

    // b. The custom header (forces a CORS preflight the dashboard never grants).
    if (single(req.headers[OPEN_REQUEST_HEADER])?.trim() !== OPEN_REQUEST_VALUE) {
      send(res, 403, 'cross-site', 'Missing the X-CoGM-Request: open header.');
      return;
    }

    // c. GM auth, token from the X-CoGM-Token header only.
    const auth = authStatus(req, config.auth);
    if (auth !== 200) {
      send(
        res,
        auth,
        'gm-required',
        auth === 401
          ? 'GM sign-in is required. Open the dashboard once in this browser.'
          : 'Only the GM can open documents in Foundry.'
      );
      return;
    }

    // d. JSON body: {uuid, userId?}.
    if (!req.is('application/json')) {
      send(res, 400, 'bad-request', 'Send a JSON body (Content-Type: application/json).');
      return;
    }
    const parseError = await new Promise<unknown>(resolve => {
      parseJson(req, res, (error?: unknown) => resolve(error));
    });
    const body = parseError ? null : asRecord(req.body as unknown);
    if (!body) {
      send(res, 400, 'bad-request', 'The body must be a JSON object: {"uuid": "..."}.');
      return;
    }
    const uuid = body.uuid;
    if (!isFoundryUuid(uuid)) {
      send(res, 400, 'bad-uuid', 'That is not a Foundry document uuid.');
      return;
    }
    const userId = body.userId;
    if (userId !== undefined && (typeof userId !== 'string' || !USER_ID.test(userId))) {
      send(res, 400, 'bad-request', 'userId must be a 16-character Foundry user id.');
      return;
    }

    // e. Rate limit (after auth, so unauthenticated noise cannot starve the GM).
    const waitMs = limiter.take();
    if (waitMs > 0) {
      res.setHeader('Retry-After', String(Math.ceil(waitMs / 1000)));
      send(res, 429, 'rate-limited', 'Too many opens in a short time. Wait a few seconds.');
      return;
    }

    // f. Open, once.
    const args: Record<string, unknown> = userId === undefined ? { uuid } : { uuid, userId };
    try {
      const result = toResult(await client.callTool('open-in-foundry', args));
      logger.info('Opened in Foundry', { uuid, userId: result.userId });
      res.json(result);
    } catch (error) {
      if (isChooseGm(error)) {
        send(
          res,
          409,
          'choose-gm',
          'Several GMs are logged in. Choose whose Foundry screen to use.',
          await listGms()
        );
        return;
      }
      logger.warn('Open in Foundry failed', { uuid, error: errorText(error) });
      send(res, 502, 'bridge', bridgeMessage(error));
    }
  }

  app.post('/api/open', (req: Request, res: Response) => {
    handleOpen(req, res).catch((error: unknown) => {
      logger.error('Open in Foundry: unexpected error', { error: errorText(error) });
      if (!res.headersSent) send(res, 500, 'bridge', 'Internal error.');
    });
  });
}
