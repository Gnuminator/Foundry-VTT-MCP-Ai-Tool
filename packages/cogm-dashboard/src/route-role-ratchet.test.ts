/**
 * Route role ratchet (Fable review 2026-11-20, Co-GM dashboard 9). Lists every route the built
 * app registers and asks it, with the player token and with no token, who may call it. A route
 * that answers anything but 401/403 must be on a short named list below. A new endpoint is
 * therefore GM-only unless someone writes it onto PUBLIC or PLAYER on purpose.
 *
 * Routes are collected by wrapping `Router.prototype.route`/`use` while the app is built, so
 * every router in every module is seen, whatever file registered it. The split is on, with a
 * player token, so a caller with no GM token is either the player or turned away.
 */
import * as http from 'http';
import type { AddressInfo } from 'net';

import express from 'express';
import { afterAll, beforeAll, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { gmConnectorFromEnv } from './gm-connector.js';
import { playerConnectorFromEnv } from './player-connector.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-for-the-role-ratchet';
const PLAYER_TOKEN = 'player-token-for-the-role-ratchet';

/**
 * Answers with no GM or player token, on purpose: page shells and static files that carry no
 * data, the health check, and the player's own /me routes (they check the player's personal
 * key, not a dashboard token). Each entry is `METHOD path` as registered.
 */
const PUBLIC = new Set<string>([
  'GET /',
  'GET /gm',
  'GET /next',
  'GET /next/',
  'GET /legacy',
  'GET /legacy/',
  'GET /next/assets',
  'GET /open',
  'GET /player',
  'GET /me',
  'GET /api/health',
  'GET /api/me/downtime',
  'POST /api/me/downtime',
  'DELETE /api/me/downtime/:id',
]);

/**
 * Answers to the player token on purpose: the player's redacted state and stream, the theme and
 * the player's own usage, names and handout reports. Everything else is GM only.
 */
const PLAYER = new Set<string>([
  'GET /api/state',
  'GET /api/stream',
  'GET /api/theme',
  'GET /api/player/state',
  'GET /api/player/stream',
  'GET /api/player/names',
  'POST /api/player/usage',
  'POST /api/player/handout-seen',
]);

interface RouteInfo {
  method: string;
  path: string;
}

type RouterProto = Record<string, (...args: unknown[]) => unknown>;

function collectRoutes(build: () => Dashboard): { dashboard: Dashboard; routes: RouteInfo[] } {
  const proto = (express.Router as unknown as { prototype: RouterProto }).prototype;
  const origRoute = proto.route;
  const origUse = proto.use;
  const found: { path: string; route: { methods: Record<string, boolean> } | null }[] = [];
  proto.route = function (this: unknown, p: unknown): unknown {
    const route = origRoute.call(this, p) as { methods: Record<string, boolean> };
    for (const one of String(p).split(',')) found.push({ path: one, route });
    return route;
  };
  proto.use = function (this: unknown, ...a: unknown[]): unknown {
    const first = a[0];
    if (typeof first === 'string') {
      if (first !== '/') found.push({ path: first, route: null });
    } else if (typeof first !== 'function') {
      // An array, RegExp or Router mount would be probed under the wrong path: fail loudly.
      throw new Error('route-role-ratchet: this test cannot read this form of use(); extend it');
    }
    return origUse.apply(this, a);
  };
  try {
    const dashboard = build();
    const routes: RouteInfo[] = [];
    for (const { path, route } of found) {
      if (!route) {
        routes.push({ method: 'GET', path });
        continue;
      }
      for (const m of Object.keys(route.methods)) {
        if (m === '_all') {
          for (const all of ['GET', 'POST', 'PUT', 'DELETE']) routes.push({ method: all, path });
        } else if (m !== 'head' && m !== 'options') {
          routes.push({ method: m.toUpperCase(), path });
        }
      }
    }
    return { dashboard, routes };
  } finally {
    proto.route = origRoute;
    proto.use = origUse;
  }
}

/** Fills `:id` style params so the path matches. */
function concretePath(p: string): string {
  return p.replace(/:[A-Za-z]+/g, 'x');
}

function status(
  port: number,
  method: string,
  path: string,
  headers: Record<string, string>
): Promise<number> {
  return new Promise(resolve => {
    const req = http.request(
      { host: '127.0.0.1', port, method, path, headers: { host: '127.0.0.1', ...headers } },
      res => {
        const code = res.statusCode ?? 0;
        res.destroy();
        resolve(code);
      }
    );
    req.on('error', () => resolve(0));
    req.setTimeout(4000, () => {
      req.destroy();
      resolve(-1);
    });
    if (method === 'POST' || method === 'PUT') {
      req.setHeader('content-type', 'application/json');
      req.write('{}');
    }
    req.end();
  });
}

describe('route roles', () => {
  const AUTH: AuthConfig = {
    ...config.auth,
    splitEnabled: true,
    gmToken: GM_TOKEN,
    playerToken: PLAYER_TOKEN,
    gmEmails: [],
  };
  let routes: RouteInfo[] = [];
  let dashboard: Dashboard;
  let server: http.Server;
  let port = 0;

  beforeAll(async () => {
    const cfg: Config = {
      ...config,
      host: '127.0.0.1',
      allowedHosts: parseAllowedHosts(''),
      stateDir: '',
      auth: AUTH,
    };
    const built = collectRoutes(() =>
      createDashboard({
        config: cfg,
        logger: new Logger('error', 'role-ratchet'),
        // Pinned off from an empty environment, so the /mcp connector routes (they do their own
        // login) do not appear on a PC whose shell has the connector variables set.
        playerConnector: playerConnectorFromEnv({}, () => undefined),
        gmConnector: gmConnectorFromEnv({}, () => undefined),
        client: {
          isConnected: true,
          listTools: (): Promise<unknown[]> => Promise.resolve([]),
          callTool: <T>(): Promise<T> => Promise.resolve({} as T),
        },
      })
    );
    dashboard = built.dashboard;
    routes = built.routes;
    server = dashboard.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server.once('listening', () => resolve()));
    port = (server.address() as AddressInfo).port;
  });

  afterAll(async () => {
    dashboard?.close();
    if (server) await new Promise<void>(resolve => server.close(() => resolve()));
  });

  // A positive control: without it, a broken token or host setup would turn every route away
  // and the ratchet would stay green while testing nothing.
  it('lets the GM token and the player token through where they should', async () => {
    expect(await status(port, 'GET', '/api/features', { 'x-cogm-token': GM_TOKEN })).toBe(200);
    expect(await status(port, 'GET', '/api/features', { 'x-cogm-token': PLAYER_TOKEN })).toBe(403);
    expect(await status(port, 'GET', '/api/features', {})).toBe(401);
    for (const key of PLAYER) {
      const [method, path] = key.split(' ');
      if (method !== 'GET' || path === '/api/stream' || path === '/api/player/stream') continue;
      const code = await status(port, 'GET', path, { 'x-cogm-token': PLAYER_TOKEN });
      expect(code, key).toBe(200);
    }
  });

  it('sees the routes of the app', () => {
    expect(routes.length).toBeGreaterThan(40);
  });

  it('names no route that is gone', () => {
    const have = new Set(routes.map(r => `${r.method} ${r.path}`));
    const stale = [...PUBLIC, ...PLAYER].filter(k => !have.has(k));
    expect(stale, 'remove these from PUBLIC or PLAYER: the route no longer exists').toEqual([]);
  });

  it('turns away a caller without the GM token unless the route is named', async () => {
    const open: string[] = [];
    const report: string[] = [];
    for (const r of routes) {
      const key = `${r.method} ${r.path}`;
      const p = concretePath(r.path);
      const none = await status(port, r.method, p, {});
      const player = await status(port, r.method, p, { 'x-cogm-token': PLAYER_TOKEN });
      report.push(`${key}: none ${none}, player ${player}`);
      const turned = (c: number): boolean => c === 401 || c === 403;
      if (!turned(none) && !PUBLIC.has(key)) open.push(`${key} answers ${none} with no token`);
      if (!turned(player) && !PUBLIC.has(key) && !PLAYER.has(key)) {
        open.push(`${key} answers ${player} to the player token`);
      }
    }
    expect(open, report.join('\n')).toEqual([]);
  }, 60_000);
});
