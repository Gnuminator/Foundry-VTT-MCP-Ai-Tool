/**
 * Session notes routes (recap lane, D-087): GM only, put and approve behind GM Actions, the
 * bridge's refusal codes passed through with a matching status.
 */
import { mkdirSync, mkdtempSync, rmSync, writeFileSync } from 'node:fs';
import type { Server } from 'http';
import type { AddressInfo } from 'net';
import { tmpdir } from 'node:os';
import { join } from 'node:path';

import express from 'express';
import { afterEach, describe, expect, it, vi } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { ChannelError } from './feed/mcp-control-client.js';
import { Logger } from './logger.js';
import { mountSessionNotesRoute } from './session-notes-route.js';

const GM_TOKEN = 'gm-token-notes';
const PLAYER_TOKEN = 'player-token-notes';
const ID = '2026-10-03_0913-rehearsal';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

type Answer = (action: string, params: Record<string, unknown>) => Promise<unknown>;

async function start(
  answer: Answer,
  withMethod = true
): Promise<{ base: string; calls: Array<[string, Record<string, unknown>]> }> {
  const calls: Array<[string, Record<string, unknown>]> = [];
  const client = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(): Promise<T> => Promise.reject(new Error('no tools here')),
    ...(withMethod
      ? {
          sessionNotes: (
            action: string,
            params: Record<string, unknown> = {}
          ): Promise<unknown> => {
            calls.push([action, params]);
            return answer(action, params);
          },
        }
      : {}),
  };
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'notes'),
    client,
    coGm: {
      enabled: false,
      isBusy: false,
      setWorld: (): void => undefined,
      abortActive: (): void => undefined,
      stream: () => Promise.reject(new Error('off')),
    } as never,
  });
  server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server!.once('listening', () => resolve()));
  const { port } = server.address() as AddressInfo;
  return { base: `http://127.0.0.1:${port}`, calls };
}

function req(
  base: string,
  path: string,
  options: { method?: string; body?: unknown; token?: string } = {}
): Promise<Response> {
  return fetch(`${base}${path}`, {
    method: options.method ?? 'GET',
    headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': options.token ?? GM_TOKEN },
    ...(options.body !== undefined ? { body: JSON.stringify(options.body) } : {}),
  });
}

async function gmActionsOn(base: string): Promise<void> {
  const res = await req(base, '/api/control', {
    method: 'POST',
    body: { action: 'set-gm-actions', value: true },
  });
  expect(res.status).toBe(200);
}

describe('/api/session-notes', () => {
  it('is GM only', async () => {
    const { base, calls } = await start(() => Promise.resolve({ items: [] }));
    expect((await req(base, '/api/session-notes', { token: PLAYER_TOKEN })).status).toBe(403);
    expect((await req(base, `/api/session-notes/${ID}`, { token: 'wrong' })).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('lists and gets through the bridge', async () => {
    const { base, calls } = await start(action =>
      Promise.resolve(action === 'list' ? { items: [{ sessionId: ID }] } : { sessionId: ID })
    );
    expect(await (await req(base, '/api/session-notes')).json()).toEqual({
      items: [{ sessionId: ID }],
    });
    expect((await req(base, `/api/session-notes/${ID}`)).status).toBe(200);
    expect((await req(base, '/api/session-notes/..%2Fx')).status).toBe(400);
    expect(calls).toEqual([
      ['list', {}],
      ['get', { sessionId: ID }],
    ]);
  });

  it('needs GM Actions for put and approve', async () => {
    const { base, calls } = await start(() => Promise.resolve({ changeId: 'chg-1' }));
    const off = await req(base, `/api/session-notes/${ID}/put`, { method: 'POST' });
    expect(off.status).toBe(403);
    expect(((await off.json()) as { error: { code: string } }).error.code).toBe(
      'gm-actions-disabled'
    );
    expect(calls).toEqual([]);
    await gmActionsOn(base);
    expect((await req(base, `/api/session-notes/${ID}/put`, { method: 'POST' })).status).toBe(200);
    expect(
      (
        await req(base, `/api/session-notes/${ID}/approve`, {
          method: 'POST',
          body: { by: 'Danni' },
        })
      ).status
    ).toBe(200);
    expect(calls).toEqual([
      ['put', { sessionId: ID }],
      ['approve', { sessionId: ID, by: 'Danni' }],
    ]);
  });

  it('passes the refusal code through with a matching status', async () => {
    const codes = [
      'feature-off',
      'writes-off',
      'not-staged',
      'not-found',
      'conflict',
      'not-connected',
    ];
    let next = '';
    const { base } = await start(() => Promise.reject(new ChannelError(`refused: ${next}`, next)));
    await gmActionsOn(base);
    const statuses: Record<string, number> = {};
    for (const code of codes) {
      next = code;
      const res = await req(base, `/api/session-notes/${ID}/put`, { method: 'POST' });
      const body = (await res.json()) as { error: { message: string; code: string } };
      expect(body.error).toEqual({ message: `refused: ${code}`, code });
      statuses[code] = res.status;
    }
    expect(statuses).toEqual({
      'feature-off': 403,
      'writes-off': 403,
      'not-staged': 409,
      'not-found': 404,
      conflict: 409,
      'not-connected': 503,
    });
  });

  it('answers 502 when the bridge cannot be reached or has no session notes', async () => {
    const down = await start(() => Promise.reject(new ChannelError('Control channel closed')));
    const res = await req(down.base, '/api/session-notes');
    expect(res.status).toBe(502);
    expect(((await res.json()) as { error: { code: string } }).error.code).toBe(
      'bridge-unreachable'
    );
    dashboard?.close();
    await new Promise<void>(resolve => server!.close(() => resolve()));
    server = null;
    const old = await start(() => Promise.resolve(null), false);
    expect((await req(old.base, '/api/session-notes')).status).toBe(502);
  });
});

describe('GET /api/session-notes/pipeline', () => {
  const tmp: string[] = [];
  afterEach(() => {
    vi.unstubAllEnvs();
    for (const d of tmp.splice(0)) rmSync(d, { recursive: true, force: true });
  });
  function sessionsWith(name: string, status: string): string {
    const root = mkdtempSync(join(tmpdir(), 'pipeline-route-'));
    tmp.push(root);
    mkdirSync(join(root, name, 'notes'), { recursive: true });
    writeFileSync(join(root, name, 'notes', 'status.json'), status);
    return root;
  }

  it('is GM only and answers before the :id route can take "pipeline" for a session id', async () => {
    vi.stubEnv(
      'FVTT_SESSIONS_DIR',
      sessionsWith(ID, '{"state":"incomplete","message":"2 scenes raw"}')
    );
    const { base, calls } = await start(() => Promise.resolve({ sessionId: 'from-the-bridge' }));
    expect((await req(base, '/api/session-notes/pipeline', { token: PLAYER_TOKEN })).status).toBe(
      403
    );
    expect((await req(base, '/api/session-notes/pipeline', { token: 'wrong' })).status).toBe(401);
    const res = await req(base, '/api/session-notes/pipeline');
    expect(res.status).toBe(200);
    expect(await res.json()).toEqual({
      pipeline: { session: ID, state: 'incomplete', message: '2 scenes raw' },
    });
    // "pipeline" is a valid session id: had `/:id` come first, the bridge would have been asked.
    expect(calls).toEqual([]);
  });

  it('is {pipeline: null} when the sessions folder has nothing', async () => {
    vi.stubEnv('FVTT_SESSIONS_DIR', join(tmpdir(), 'no-such-sessions-dir-route'));
    const { base } = await start(() => Promise.resolve({ items: [] }));
    expect(await (await req(base, '/api/session-notes/pipeline')).json()).toEqual({
      pipeline: null,
    });
  });

  it('reads the sessionsDir option before FVTT_SESSIONS_DIR', async () => {
    vi.stubEnv('FVTT_SESSIONS_DIR', sessionsWith('2026-01-01_0000-env', '{"state":"done"}'));
    const fromOption = sessionsWith('2026-02-02_0000-option', '{"state":"published"}');
    const app = express();
    mountSessionNotesRoute(app, {
      client: {},
      requireGm: (_req, _res, next) => next(),
      gmActionsEnabled: () => false,
      sessionsDir: fromOption,
    });
    const listener = app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => listener.once('listening', () => resolve()));
    try {
      const { port } = listener.address() as AddressInfo;
      const res = await fetch(`http://127.0.0.1:${port}/api/session-notes/pipeline`);
      expect(await res.json()).toEqual({
        pipeline: { session: '2026-02-02_0000-option', state: 'published', message: '' },
      });
    } finally {
      await new Promise<void>(resolve => listener.close(() => resolve()));
    }
  });
});
