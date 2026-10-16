/**
 * Cloudflare Access in the real app (I-022): a GM route opens for a verified Access token whose
 * email is on GM_EMAILS, and never for the plain email header (P-038).
 */
import crypto from 'crypto';
import type { AddressInfo } from 'net';

import { afterEach, describe, expect, it } from 'vitest';

import type { CoGm } from './ai/anthropic-co-gm.js';
import { createDashboard } from './app.js';
import { config, type AuthConfig, type Config } from './config.js';
import { parseAllowedHosts } from './host-allowlist.js';
import { Logger } from './logger.js';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-for-the-app-test';
const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function token(email: string, aud = AUD): string {
  const now = Math.floor(Date.now() / 1000);
  const head = Buffer.from(JSON.stringify({ alg: 'RS256', kid: 'k1' })).toString('base64url');
  const body = Buffer.from(
    JSON.stringify({ iss: `https://${TEAM}`, aud: [aud], email, iat: now, exp: now + 600 })
  ).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), privateKey);
  return `${head}.${body}.${sig.toString('base64url')}`;
}

const keys = [{ ...publicKey.export({ format: 'jwk' }), kid: 'k1', kty: 'RSA' }];

const fakeCoGm = {
  enabled: false,
  isBusy: false,
  setWorld: (): void => undefined,
  abortActive: (): void => undefined,
} as unknown as CoGm;

const bridge = {
  isConnected: true,
  listTools: (): Promise<unknown[]> => Promise.resolve([]),
  callTool: <T>(): Promise<T> => Promise.resolve({} as T),
};

const closers: Array<() => Promise<void>> = [];
afterEach(async () => {
  await Promise.all(closers.splice(0).map(c => c()));
});

type KeyFetch = NonNullable<Parameters<typeof createDashboard>[0]['accessFetch']>;
const goodKeys: KeyFetch = () =>
  Promise.resolve({ ok: true, json: () => Promise.resolve({ keys }) });

async function start(
  options: { accessFetch?: KeyFetch; access?: AuthConfig['access'] } = {}
): Promise<number> {
  const auth: AuthConfig = {
    ...config.auth,
    splitEnabled: true,
    gmToken: 'gm-token-not-used-here',
    playerToken: '',
    gmEmails: ['gm@example.com'],
    access: 'access' in options ? (options.access ?? null) : { teamDomain: TEAM, audiences: [AUD] },
  };
  const testConfig: Config = {
    ...config,
    host: '127.0.0.1',
    allowedHosts: parseAllowedHosts(''),
    auth,
  };
  const dashboard = createDashboard({
    config: testConfig,
    logger: new Logger('error', 'access-test'),
    client: bridge,
    coGm: fakeCoGm,
    accessFetch: options.accessFetch ?? goodKeys,
  });
  const server = dashboard.app.listen(0, '127.0.0.1');
  await new Promise<void>(resolve => server.once('listening', () => resolve()));
  closers.push(
    () =>
      new Promise<void>(resolve => {
        dashboard.close();
        server.close(() => resolve());
      })
  );
  return (server.address() as AddressInfo).port;
}

async function status(port: number, headers: Record<string, string>): Promise<number> {
  const res = await fetch(`http://127.0.0.1:${port}/api/tools`, { headers });
  return res.status;
}

describe('Cloudflare Access in the app (I-022)', () => {
  it('opens a GM route for a verified token with a GM email', async () => {
    const port = await start();
    expect(await status(port, { 'cf-access-jwt-assertion': token('GM@example.com') })).toBe(200);
    expect(await status(port, { cookie: `CF_Authorization=${token('gm@example.com')}` })).toBe(200);
  });

  it('keeps it closed for the plain email header, another email or another app', async () => {
    const port = await start();
    expect(await status(port, { 'cf-access-authenticated-user-email': 'gm@example.com' })).toBe(
      403
    );
    expect(await status(port, { 'cf-access-jwt-assertion': token('player@example.com') })).toBe(
      403
    );
    expect(
      await status(port, { 'cf-access-jwt-assertion': token('gm@example.com', 'other') })
    ).toBe(403);
  });
});

describe('/api/state for a token Access could not verify (#346 L1)', () => {
  const state = async (port: number, headers: Record<string, string>): Promise<unknown> =>
    (await fetch(`http://127.0.0.1:${port}/api/state`, { headers })).json();

  it('marks a token that does not verify, so the GM page stays', async () => {
    const port = await start();
    const answer = await state(port, { 'cf-access-jwt-assertion': 'not.a.token' });
    expect(answer).toMatchObject({ role: 'player', accessUnverified: true });
    expect(
      await state(port, { cookie: `CF_Authorization=${token('gm@example.com', 'other')}` })
    ).toMatchObject({ role: 'player', accessUnverified: true });
  });

  it('marks a token when the keys cannot be fetched', async () => {
    const port = await start({ accessFetch: () => Promise.reject(new Error('offline')) });
    const answer = await state(port, { 'cf-access-jwt-assertion': token('gm@example.com') });
    expect(answer).toMatchObject({ role: 'player', accessUnverified: true });
  });

  it('marks a token when GM_EMAILS is set without the CF_ACCESS settings', async () => {
    const port = await start({ access: null });
    const answer = await state(port, { 'cf-access-jwt-assertion': token('gm@example.com') });
    expect(answer).toMatchObject({ role: 'player', accessUnverified: true });
  });

  it('does not mark a verified GM, a verified player, or a request without a token', async () => {
    const port = await start();
    const gm = await state(port, { 'cf-access-jwt-assertion': token('gm@example.com') });
    expect(gm).toMatchObject({ role: 'gm' });
    expect(gm).not.toHaveProperty('accessUnverified');
    const player = await state(port, { 'cf-access-jwt-assertion': token('player@example.com') });
    expect(player).toMatchObject({ role: 'player' });
    expect(player).not.toHaveProperty('accessUnverified');
    expect(await state(port, {})).not.toHaveProperty('accessUnverified');
  });
});
