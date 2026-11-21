/**
 * The remote GM connector's routes (/mcp/core to /mcp/admin): login (Managed OAuth app token,
 * optional email list), one set per path, bare refusals, and what is forwarded to the backend.
 */
import crypto from 'crypto';
import type { AddressInfo } from 'net';

import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import type { GmConnectorFile, GmConnectorOptions } from './gm-connector.js';
import { parseGmConnectorFile } from './gm-connector.js';
import { mountGmRoute } from './gm-route.js';
import { Logger } from './logger.js';

const TEAM = 'team.cloudflareaccess.com';
const GM_AUD = 'gm-remote-aud';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', kty: 'RSA' }];

function jwt(claims: Record<string, unknown>, aud = GM_AUD): string {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ iss: `https://${TEAM}`, aud: [aud], iat: now, exp: now + 600, ...claims })
  ).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}
const person = (email: string, aud = GM_AUD): string => jwt({ type: 'app', email }, aud);

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map(c => c()));
});

let dashboardGms: string[] = ['a@x.com'];
afterEach(() => {
  dashboardGms = ['a@x.com'];
});

interface Seen {
  lists: string[];
  calls: Array<{ set: string; name: string; args: unknown }>;
}

async function start(
  file: GmConnectorFile = { appAudiences: [GM_AUD], gmEmails: [], gmEmailsBroken: false },
  over: Partial<GmConnectorOptions> = {},
  client: Record<string, unknown> = {},
  slowCallMs?: number
): Promise<{ base: string; seen: Seen }> {
  const seen: Seen = { lists: [], calls: [] };
  const app = express();
  mountGmRoute(app, {
    config: { host: '127.0.0.1', auth: { gmEmails: dashboardGms } },
    connector: { enabled: true, teamDomain: TEAM, devEmail: '', read: () => file, ...over },
    client: {
      isConnected: true,
      remoteGmList: (set: string) => {
        seen.lists.push(set);
        return Promise.resolve({
          tools: [{ name: `tool-of-${set}`, inputSchema: { type: 'object' } }],
          instructions: `instructions for ${set}`,
        });
      },
      remoteGmCall: (set: string, name: string, args: unknown) => {
        seen.calls.push({ set, name, args });
        return Promise.resolve({ content: [{ type: 'text', text: 'done' }] });
      },
      ...client,
    },
    logger: new Logger('error', 'gm-route'),
    slowCallMs,
    accessFetch: () => Promise.resolve({ ok: true, json: () => Promise.resolve({ keys }) }),
  });
  const server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  closers.push(() => new Promise<void>(resolve => server.close(() => resolve())));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, seen };
}

function rpc(
  base: string,
  set: string,
  body: unknown,
  token?: string,
  extra: Record<string, string> = {}
): Promise<Response> {
  return fetch(`${base}/mcp/${set}`, {
    method: 'POST',
    headers: {
      'content-type': 'application/json',
      ...(token ? { 'cf-access-jwt-assertion': token } : {}),
      ...extra,
    },
    body: JSON.stringify(body),
  });
}

describe('gm connector login', () => {
  it('serves a GM whose Access app token verifies', async () => {
    const { base } = await start();
    const res = await rpc(
      base,
      'play',
      { jsonrpc: '2.0', id: 1, method: 'ping' },
      person('a@x.com')
    );
    expect(res.status).toBe(200);
  });

  it('refuses no token (401), a service token (403), another application (401), a player email list miss (403)', async () => {
    const { base } = await start({
      appAudiences: [GM_AUD],
      gmEmails: ['gm@x.com'],
      gmEmailsBroken: false,
    });
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await rpc(base, 'core', body)).status).toBe(401);
    expect((await rpc(base, 'core', body, jwt({ common_name: 'svc.access' }))).status).toBe(403);
    expect((await rpc(base, 'core', body, person('gm@x.com', 'player-aud'))).status).toBe(401);
    expect((await rpc(base, 'core', body, person('other@x.com'))).status).toBe(403);
    expect((await rpc(base, 'core', body, person('GM@x.com'))).status).toBe(200);
  });

  it('fails closed: broken list, no list anywhere, or a login outside GM_EMAILS', async () => {
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    const ok = { appAudiences: [GM_AUD], gmEmails: [], gmEmailsBroken: false };
    // An empty file list falls back to GM_EMAILS: another email the policy admits is refused.
    const fallback = await start(ok);
    expect((await rpc(fallback.base, 'admin', body, person('a@x.com'))).status).toBe(200);
    expect((await rpc(fallback.base, 'admin', body, person('player@x.com'))).status).toBe(403);
    const broken = await start({ ...ok, gmEmailsBroken: true });
    expect((await rpc(broken.base, 'core', body, person('a@x.com'))).status).toBe(503);
    dashboardGms = [];
    const none = await start(ok);
    expect((await rpc(none.base, 'core', body, person('a@x.com'))).status).toBe(503);
  });

  it('a malformed token is 401, not 503', async () => {
    const { base } = await start();
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await rpc(base, 'core', body, 'junk')).status).toBe(401);
  });

  it('answers 503 when no audience is configured and never mounts when off', async () => {
    const none = await start({ appAudiences: [], gmEmails: [], gmEmailsBroken: false });
    expect(
      (await rpc(none.base, 'core', { jsonrpc: '2.0', id: 1, method: 'ping' }, person('a@x.com')))
        .status
    ).toBe(503);
    const off = await start(undefined, { enabled: false });
    expect(
      (await rpc(off.base, 'core', { jsonrpc: '2.0', id: 1, method: 'ping' }, person('a@x.com')))
        .status
    ).toBe(404);
  });

  it('lets a bare loopback request in only as the dev email and without a team domain', async () => {
    const dev = await start(undefined, { devEmail: 'dev@x.com', teamDomain: '' });
    const body = { jsonrpc: '2.0', id: 1, method: 'ping' };
    expect((await rpc(dev.base, 'core', body)).status).toBe(200);
    const real = await start(undefined, { devEmail: 'dev@x.com' });
    expect((await rpc(real.base, 'core', body)).status).toBe(401);
  });

  it('405 on GET', async () => {
    const { base } = await start();
    expect((await fetch(`${base}/mcp/core`)).status).toBe(405);
  });
});

describe('gm connector protocol', () => {
  const token = person('a@x.com');

  it('serves each path its own set, with its instructions', async () => {
    const { base, seen } = await start();
    for (const set of ['core', 'play', 'prep', 'build', 'admin']) {
      const init = (await (
        await rpc(base, set, { jsonrpc: '2.0', id: 1, method: 'initialize', params: {} }, token)
      ).json()) as { result: { instructions: string; serverInfo: { name: string } } };
      expect(init.result.instructions).toBe(`instructions for ${set}`);
      expect(init.result.serverInfo.name).toBe(`foundry-ai-tool-${set}`);
      const list = (await (
        await rpc(base, set, { jsonrpc: '2.0', id: 2, method: 'tools/list' }, token)
      ).json()) as { result: { tools: Array<{ name: string }> } };
      expect(list.result.tools[0]?.name).toBe(`tool-of-${set}`);
    }
    expect(seen.lists.length).toBe(10);
  });

  it('forwards a call with the set from the path, never from the body', async () => {
    const { base, seen } = await start();
    const res = await rpc(
      base,
      'build',
      {
        jsonrpc: '2.0',
        id: 3,
        method: 'tools/call',
        params: { name: 'plan-room-setup', arguments: { set: 'admin', x: 1 } },
      },
      token
    );
    expect(((await res.json()) as { result: { content: unknown[] } }).result.content).toHaveLength(
      1
    );
    expect(seen.calls).toEqual([
      { set: 'build', name: 'plan-room-setup', args: { set: 'admin', x: 1 } },
    ]);
  });

  it('answers with a may-have-landed note when a call outlasts the Cloudflare limit', async () => {
    const { base } = await start(
      undefined,
      {},
      { remoteGmCall: () => new Promise(() => undefined) },
      20
    );
    const res = await rpc(
      base,
      'play',
      { jsonrpc: '2.0', id: 4, method: 'tools/call', params: { name: 'slow-tool' } },
      token
    );
    const body = (await res.json()) as {
      result: { isError: boolean; content: Array<{ text: string }> };
    };
    expect(body.result.isError).toBe(true);
    expect(body.result.content[0]?.text).toMatch(/may still land/);
  });

  it('503 when the bridge is off; notifications get 202; unknown method an error', async () => {
    const off = await start(undefined, {}, { isConnected: false });
    expect(
      (await rpc(off.base, 'core', { jsonrpc: '2.0', id: 1, method: 'tools/list' }, token)).status
    ).toBe(503);
    const { base } = await start();
    expect(
      (await rpc(base, 'core', { jsonrpc: '2.0', method: 'notifications/initialized' }, token))
        .status
    ).toBe(202);
    const unknown = (await (
      await rpc(base, 'core', { jsonrpc: '2.0', id: 9, method: 'resources/list' }, token)
    ).json()) as { error: { code: number } };
    expect(unknown.error.code).toBe(-32601);
  });

  it('a backend failure becomes a JSON-RPC error, not a crash', async () => {
    const { base } = await start(
      undefined,
      {},
      { remoteGmList: () => Promise.reject(new Error('x')) }
    );
    const out = (await (
      await rpc(base, 'core', { jsonrpc: '2.0', id: 4, method: 'tools/list' }, token)
    ).json()) as { error: { code: number } };
    expect(out.error.code).toBe(-32000);
  });
});

describe('parseGmConnectorFile', () => {
  it('reads the audience and lowercases, dedupes and filters the emails', () => {
    expect(
      parseGmConnectorFile({ appAudience: ' a ', gmEmails: ['A@x.com', 'a@x.com', 'bad', 5] })
    ).toEqual({ appAudiences: ['a'], gmEmails: ['a@x.com'], gmEmailsBroken: false });
    expect(parseGmConnectorFile({ gmEmails: 'gm@x.com' }).gmEmailsBroken).toBe(true);
    expect(parseGmConnectorFile({ gmEmails: ['bad'] }).gmEmailsBroken).toBe(true);
    expect(parseGmConnectorFile(null)).toEqual({
      appAudiences: [],
      gmEmails: [],
      gmEmailsBroken: false,
    });
  });
});
