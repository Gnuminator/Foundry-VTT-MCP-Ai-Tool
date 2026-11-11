/**
 * "Download my helper" failure paths: a builder that throws with the secret in its message must
 * never reach the response or any log, and a missing endpoint is a fixed sentence.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { mountMeRoute, type MeRouteOptions } from './me-route.js';

const SECRET = 'secret-must-not-leak-0123456789';
const USER = 'user000000000001';
let server: Server | null = null;

afterEach(async () => {
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  server = null;
});

async function start(
  buildPreset: MeRouteOptions['buildPreset'],
  endpoint: string | null = 'https://player.example.org/mcp/player'
): Promise<{ base: string; warn: ReturnType<typeof vi.fn> }> {
  const warn = vi.fn();
  const app = express();
  mountMeRoute(app, {
    client: {},
    links: { userFor: (_w: string, key?: string) => (key === 'good' ? USER : null) } as never,
    directory: {
      refreshIfStale: () => Promise.resolve(),
      get: (id: string) => ({ userId: id, name: 'Ebbe' }),
      list: () => [],
    } as never,
    requireGm: (_req, _res, next) => next(),
    logger: { warn },
    connector: {
      credentialsFor: () => ({ endpoint, clientId: 'id.access', clientSecret: SECRET }),
    },
    buildPreset,
    worldId: () => 'world',
    theme: () => 'neutral',
    publicDir: '.',
    pageHeaders: () => undefined,
  });
  server = app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  return { base: `http://127.0.0.1:${(server.address() as AddressInfo).port}`, warn };
}

describe('/api/me/helper.mcpb failures', () => {
  it('answers a fixed sentence when the builder throws with the secret in its message', async () => {
    const { base, warn } = await start(() => {
      throw new Error(`broke on ${SECRET}`);
    });
    const res = await fetch(`${base}/api/me/helper.mcpb`, { headers: { 'X-CoGM-Me': 'good' } });
    expect(res.status).toBe(503);
    expect(res.headers.get('cache-control')).toBe('no-store');
    expect(await res.text()).not.toContain(SECRET);
    expect(JSON.stringify(warn.mock.calls)).not.toContain(SECRET);
  });

  it('is 503 with no endpoint and passes the player name and id to the builder', async () => {
    const none = await start(() => Buffer.from('x'), null);
    const res = await fetch(`${none.base}/api/me/helper.mcpb`, {
      headers: { 'X-CoGM-Me': 'good' },
    });
    expect(res.status).toBe(503);
    expect(await res.text()).not.toContain(SECRET);
    await new Promise<void>(resolve => server!.close(() => resolve()));
    const seen: unknown[] = [];
    const ok = await start(p => {
      seen.push(p);
      return Buffer.from('zipbytes');
    });
    const good = await fetch(`${ok.base}/api/me/helper.mcpb`, { headers: { 'X-CoGM-Me': 'good' } });
    expect(good.status).toBe(200);
    expect(await good.text()).toBe('zipbytes');
    expect(seen).toEqual([
      expect.objectContaining({ playerName: 'Ebbe', userId: USER, clientSecret: SECRET }),
    ]);
  });
});
