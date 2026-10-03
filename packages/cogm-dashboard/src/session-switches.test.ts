/**
 * Ready for session (D3, PB-17): the GM route turns the module's switches and GM Actions on,
 * End turns them off; the parser and the pre-flight row.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { Logger } from './logger.js';
import { parseSessionSwitches, readyCheck, type SessionSwitches } from './session-switches.js';

const GM_TOKEN = 'gm-token-ready';
const PLAYER_TOKEN = 'player-token-ready';

let dashboard: Dashboard | null = null;
let server: Server | null = null;

afterEach(async () => {
  dashboard?.close();
  if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
  dashboard = null;
  server = null;
});

function moduleAnswer(on: boolean, changed: string[] = []): SessionSwitches {
  return {
    switches: [
      { id: 'writes', name: 'Allow Write Operations', on: true },
      { id: 'handouts', name: 'AI Tool: Handouts (writes)', on },
    ],
    ready: on ? { at: 1, turnedOn: ['handouts'] } : null,
    changed,
    failed: [],
  };
}

async function start(
  answer: (action: string) => Promise<unknown>
): Promise<{ base: string; calls: string[] }> {
  const calls: string[] = [];
  const client = {
    isConnected: true,
    listTools: (): Promise<unknown[]> => Promise.resolve([]),
    callTool: <T>(): Promise<T> => Promise.reject(new Error('no tools here')),
    sessionSwitches: (action: string): Promise<unknown> => {
      calls.push(action);
      return answer(action);
    },
  };
  const testConfig: Config = {
    ...config,
    auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
  };
  dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'ready'),
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

function post(base: string, body: unknown, token = GM_TOKEN): Promise<Response> {
  return fetch(`${base}/api/session/switches`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': token },
    body: JSON.stringify(body),
  });
}

async function gmActions(base: string): Promise<boolean> {
  const res = await fetch(`${base}/api/session/switches`, {
    headers: { 'X-CoGM-Token': GM_TOKEN },
  });
  return ((await res.json()) as { gmActionsEnabled: boolean }).gmActionsEnabled;
}

describe('/api/session/switches', () => {
  it('is GM only', async () => {
    const { base, calls } = await start(() => Promise.resolve(moduleAnswer(true)));
    expect((await post(base, { action: 'ready' }, PLAYER_TOKEN)).status).toBe(403);
    expect((await post(base, { action: 'ready' }, 'wrong')).status).toBe(401);
    expect(calls).toEqual([]);
  });

  it('refuses an unknown action', async () => {
    const { base, calls } = await start(() => Promise.resolve(moduleAnswer(true)));
    expect((await post(base, { action: 'get' })).status).toBe(400);
    expect((await post(base, { action: 'all-on' })).status).toBe(400);
    expect(calls).toEqual([]);
  });

  it('Ready turns the module switches and GM Actions on', async () => {
    const { base, calls } = await start(() => Promise.resolve(moduleAnswer(true, ['handouts'])));
    expect(await gmActions(base)).toBe(false);
    const res = await post(base, { action: 'ready' });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({
      ok: true,
      gmActionsEnabled: true,
      gmActionsChanged: true,
      switches: { changed: ['handouts'], ready: { turnedOn: ['handouts'] } },
    });
    expect(calls).toEqual(['get', 'ready']);
    expect(await gmActions(base)).toBe(true);
  });

  it('Ready leaves GM Actions off when the module refuses', async () => {
    const { base } = await start(action =>
      action === 'ready' ? Promise.reject(new Error('Unknown method')) : Promise.resolve(null)
    );
    const res = await post(base, { action: 'ready' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ ok: false, error: 'Unknown method' });
    expect(await gmActions(base)).toBe(false);
  });

  it('End turns GM Actions off even when the module cannot be reached', async () => {
    let reachable = true;
    const { base } = await start(action =>
      reachable || action === 'get'
        ? Promise.resolve(moduleAnswer(action !== 'end'))
        : Promise.reject(new Error('Foundry is not connected'))
    );
    await post(base, { action: 'ready' });
    reachable = false;
    const res = await post(base, { action: 'end' });
    expect(res.status).toBe(502);
    expect(await res.json()).toMatchObject({ gmActionsEnabled: false, gmActionsChanged: true });
    expect(await gmActions(base)).toBe(false);
  });

  it('the pre-flight shows the Ready row instead of the bridge write-switches row', async () => {
    const { base } = await start(() => Promise.resolve(moduleAnswer(false)));
    const res = await fetch(`${base}/api/preflight`, { headers: { 'X-CoGM-Token': GM_TOKEN } });
    const body = (await res.json()) as { checks: Array<{ id: string; status: string }> };
    const ready = body.checks.find(c => c.id === 'ready');
    expect(ready?.status).toBe('warn');
    expect(body.checks.some(c => c.id === 'write-switches')).toBe(false);
  });
});

describe('parseSessionSwitches', () => {
  it('reads the module answer and drops junk', () => {
    expect(
      parseSessionSwitches({
        switches: [{ id: 'writes', name: 'W', on: true }, { name: 'no id' }, 7],
        ready: { at: 5, turnedOn: ['handouts', 3] },
        changed: ['handouts'],
      })
    ).toEqual({
      switches: [{ id: 'writes', name: 'W', on: true }],
      ready: { at: 5, turnedOn: ['handouts'] },
      changed: ['handouts'],
      failed: [],
    });
  });

  it('answers null for anything else', () => {
    expect(parseSessionSwitches(null)).toBeNull();
    expect(parseSessionSwitches({ error: 'Access denied', success: false })).toBeNull();
  });
});

describe('readyCheck', () => {
  it('is ok only when every switch and GM Actions are on', () => {
    expect(readyCheck(moduleAnswer(true), true).status).toBe('ok');
    const off = readyCheck(moduleAnswer(false), false);
    expect(off.status).toBe('warn');
    expect(off.detail).toContain('AI Tool: Handouts (writes), GM Actions');
  });

  it('falls back to GM Actions alone for an old module', () => {
    expect(readyCheck(null, false)).toMatchObject({ id: 'ready', status: 'warn' });
    expect(readyCheck(null, true)).toMatchObject({ id: 'ready', status: 'ok' });
  });
});
