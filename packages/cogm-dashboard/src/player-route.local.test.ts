/**
 * The local tools on `/mcp/player` (handouts, play stats): the route binds the verified user id,
 * lists them only with a local source, and refuses them without one.
 */
import type { AddressInfo } from 'net';
import express from 'express';
import { afterEach, describe, expect, it } from 'vitest';

import { config } from './config.js';
import { Logger } from './logger.js';
import { ConnectorStore } from './player-connector.js';
import { PLAYER_LOCAL_TOOLS, type LocalPlayerToolDeps } from './player-local-tools.js';
import { mountPlayerRoute } from './player-route.js';

const servers: Array<{ close(): void }> = [];
afterEach(() => {
  for (const s of servers.splice(0)) s.close();
});

function deps(seen: string[]): LocalPlayerToolDeps {
  return {
    handoutsFor: (userId): never[] => {
      seen.push(userId);
      return [];
    },
    handoutsReady: () => true,
    worldId: () => 'w',
    characterSheet: () => Promise.resolve({}),
    playStats: () => Promise.resolve({}),
  };
}

async function start(local: LocalPlayerToolDeps | undefined): Promise<string> {
  const app = express();
  mountPlayerRoute(app, {
    config: { ...config, host: '127.0.0.1' },
    connector: { enabled: true, store: new ConnectorStore(null), teamDomain: '', devUser: 'u1' },
    client: {
      isConnected: true,
      listPlayerTools: () =>
        Promise.resolve({
          tools: [
            { name: 'get-my-character' },
            { name: 'get-my-handouts' },
            { name: 'get-my-play-stats' },
          ],
        }),
      playerTool: () => Promise.resolve({ content: [{ type: 'text', text: 'bridge' }] }),
    },
    directory: {
      get: () => ({ userId: 'u1', name: 'One' }),
      refreshIfStale: () => Promise.resolve(),
      list: () => [{ userId: 'u1', name: 'One' }],
    } as never,
    logger: new Logger('error', 'test'),
    ...(local ? { local } : {}),
  });
  const server = app.listen(0, '127.0.0.1');
  servers.push(server);
  await new Promise<void>(resolve => server.once('listening', resolve));
  return `http://127.0.0.1:${(server.address() as AddressInfo).port}/mcp/player`;
}

const post = (url: string, method: string, params: unknown): Promise<Response> =>
  fetch(url, {
    method: 'POST',
    headers: { 'content-type': 'application/json' },
    body: JSON.stringify({ jsonrpc: '2.0', id: 1, method, params }),
  });

describe('/mcp/player local tools', () => {
  it('names the two tools the server lists as PLAYER_DASHBOARD_TOOL_NAMES (pinned there too)', () => {
    expect([...PLAYER_LOCAL_TOOLS]).toEqual(['get-my-handouts', 'get-my-play-stats']);
  });

  it('runs a local tool for the verified user, whatever the arguments say', async () => {
    const seen: string[] = [];
    const url = await start(deps(seen));
    const res = await post(url, 'tools/call', {
      name: 'get-my-handouts',
      arguments: { userId: 'u2' },
    });
    expect(res.status).toBe(200);
    expect(seen).toEqual(['u1']);
  });

  it('lists the local tools only with a local source', async () => {
    const names = async (local: LocalPlayerToolDeps | undefined): Promise<string[]> => {
      const body = (await (await post(await start(local), 'tools/list', {})).json()) as {
        result: { tools: Array<{ name: string }> };
      };
      return body.result.tools.map(t => t.name);
    };
    expect(await names(deps([]))).toEqual([
      'get-my-character',
      'get-my-handouts',
      'get-my-play-stats',
    ]);
    expect(await names(undefined)).toEqual(['get-my-character']);
  });

  it('answers 503 for a local tool without a local source and never asks the bridge', async () => {
    const res = await post(await start(undefined), 'tools/call', {
      name: 'get-my-play-stats',
      arguments: {},
    });
    expect(res.status).toBe(503);
  });
});
