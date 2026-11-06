/**
 * What POST /api/tool says when the bridge call fails: a tool's own refusal passes through, a
 * timeout or a lost link sends a fixed sentence (no socket or port text), and a thrown error in the
 * dashboard itself is a 500 with the kind `internal`. The web page words each from its kind.
 */
import type { Server } from 'http';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import { createDashboard, type Dashboard } from './app.js';
import { config, type Config } from './config.js';
import { ChannelError, TimeoutError, ToolError } from './feed/mcp-control-client.js';
import { Logger } from './logger.js';

const GM_TOKEN = 'gm-token-errors';
const PLAYER_TOKEN = 'player-token-errors';

describe('POST /api/tool failures', () => {
  let dashboard: Dashboard | null = null;
  let server: Server | null = null;

  afterEach(async () => {
    dashboard?.close();
    if (server) await new Promise<void>(resolve => server!.close(() => resolve()));
    dashboard = null;
    server = null;
  });

  async function post(failure: Error): Promise<{ status: number; body: Record<string, unknown> }> {
    const testConfig: Config = {
      ...config,
      auth: { ...config.auth, splitEnabled: true, gmToken: GM_TOKEN, playerToken: PLAYER_TOKEN },
    };
    dashboard = createDashboard({
      config: testConfig,
      logger: new Logger('error', 'tool-errors'),
      client: {
        isConnected: true,
        listTools: (): Promise<unknown[]> => Promise.resolve([]),
        callTool: <T>(name: string): Promise<T> => {
          if (name === 'get-world-info') return Promise.reject(new Error('no world'));
          return Promise.reject(failure);
        },
      },
    });
    server = dashboard.app.listen(0, '127.0.0.1');
    await new Promise<void>(resolve => server!.once('listening', () => resolve()));
    const base = `http://127.0.0.1:${(server.address() as AddressInfo).port}`;
    const res = await fetch(`${base}/api/tool`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-CoGM-Token': GM_TOKEN },
      body: JSON.stringify({ name: 'get-prep-digest', args: {} }),
    });
    return { status: res.status, body: (await res.json()) as Record<string, unknown> };
  }

  it('answers a timeout with a fixed sentence and the kind timeout', async () => {
    const { status, body } = await post(
      new TimeoutError('Request "call_tool" timed out after 15000ms')
    );
    expect(status).toBe(502);
    expect(body).toMatchObject({
      ok: false,
      kind: 'timeout',
      error: 'Foundry took too long to answer.',
    });
  });

  it('answers a lost link with a sentence that names the bridge, not Foundry', async () => {
    const { status, body } = await post(new ChannelError('connect ECONNREFUSED 127.0.0.1:31414'));
    expect(status).toBe(502);
    expect(body).toMatchObject({
      kind: 'channel',
      error: 'The dashboard lost its link to the bridge. Check that the AI Tool is running.',
    });
    expect(JSON.stringify(body)).not.toMatch(/ECONNREFUSED|31414/);
  });

  it('passes a tool refusal through as a 422 with the kind tool', async () => {
    const { status, body } = await post(
      new ToolError('That journal is not there.', 'get-prep-digest')
    );
    expect(status).toBe(422);
    expect(body).toMatchObject({ kind: 'tool', error: 'That journal is not there.' });
  });
});
