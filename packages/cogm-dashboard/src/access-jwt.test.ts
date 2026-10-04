import crypto from 'crypto';
import { describe, expect, it, vi } from 'vitest';

import { AccessJwtVerifier, accessTokenFrom, parseTeamDomain } from './access-jwt.js';
import { resolveAccessConfig } from './config.js';

const TEAM = 'team.cloudflareaccess.com';
const AUD = 'aud-tag-1';
const NOW = 1_800_000_000_000;

const { privateKey, publicKey } = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });
const other = crypto.generateKeyPairSync('rsa', { modulusLength: 2048 });

function jwk(key: crypto.KeyObject, kid: string): Record<string, unknown> {
  return { ...key.export({ format: 'jwk' }), kid, kty: 'RSA', alg: 'RS256' };
}

function sign(
  payload: Record<string, unknown>,
  {
    kid = 'k1',
    key = privateKey,
    alg = 'RS256',
  }: { kid?: string; key?: crypto.KeyObject; alg?: string } = {}
): string {
  const head = Buffer.from(JSON.stringify({ alg, kid, typ: 'JWT' })).toString('base64url');
  const body = Buffer.from(JSON.stringify(payload)).toString('base64url');
  const sig = crypto.sign('RSA-SHA256', Buffer.from(`${head}.${body}`), key).toString('base64url');
  return `${head}.${body}.${sig}`;
}

function claims(extra: Record<string, unknown> = {}): Record<string, unknown> {
  return {
    iss: `https://${TEAM}`,
    aud: [AUD],
    email: 'GM@Example.com',
    exp: NOW / 1000 + 600,
    iat: NOW / 1000 - 10,
    ...extra,
  };
}

function verifier(keys: Record<string, unknown>[] = [jwk(publicKey, 'k1')]): {
  v: AccessJwtVerifier;
  fetch: ReturnType<typeof vi.fn>;
  clock: { now: number };
} {
  const clock = { now: NOW };
  const fetch = vi.fn((_url: string) =>
    Promise.resolve({ ok: true, json: () => Promise.resolve({ keys }) })
  );
  const v = new AccessJwtVerifier({ teamDomain: TEAM, audiences: [AUD] }, fetch, () => clock.now);
  return { v, fetch, clock };
}

describe('AccessJwtVerifier', () => {
  it('accepts a valid token and returns its email in lower case', async () => {
    const { v, fetch } = verifier();
    await expect(v.verify(sign(claims()))).resolves.toEqual({ email: 'gm@example.com' });
    expect(fetch).toHaveBeenCalledWith(`https://${TEAM}/cdn-cgi/access/certs`);
  });

  it('caches the keys between tokens', async () => {
    const { v, fetch } = verifier();
    await v.verify(sign(claims()));
    await v.verify(sign(claims({ email: 'p@example.com' })));
    expect(fetch).toHaveBeenCalledTimes(1);
  });

  it('refuses a wrong signature, audience, issuer, an expired token and a missing email', async () => {
    const { v } = verifier();
    await expect(v.verify(sign(claims(), { key: other.privateKey }))).resolves.toBeNull();
    await expect(v.verify(sign(claims({ aud: ['someone-else'] })))).resolves.toBeNull();
    await expect(
      v.verify(sign(claims({ iss: 'https://evil.cloudflareaccess.com' })))
    ).resolves.toBeNull();
    await expect(v.verify(sign(claims({ exp: NOW / 1000 - 120 })))).resolves.toBeNull();
    await expect(v.verify(sign(claims({ nbf: NOW / 1000 + 600 })))).resolves.toBeNull();
    await expect(v.verify(sign(claims({ email: undefined })))).resolves.toBeNull();
  });

  it('refuses alg none, other algorithms and garbage', async () => {
    const { v } = verifier();
    const head = Buffer.from(JSON.stringify({ alg: 'none', kid: 'k1' })).toString('base64url');
    const body = Buffer.from(JSON.stringify(claims())).toString('base64url');
    await expect(v.verify(`${head}.${body}.`)).resolves.toBeNull();
    await expect(v.verify(sign(claims(), { alg: 'HS256' }))).resolves.toBeNull();
    await expect(v.verify('not.a.token')).resolves.toBeNull();
    await expect(v.verify('abc')).resolves.toBeNull();
  });

  it('accepts a single-string aud and allows 30 s of clock skew', async () => {
    const { v } = verifier();
    await expect(v.verify(sign(claims({ aud: AUD, exp: NOW / 1000 - 10 })))).resolves.toEqual({
      email: 'gm@example.com',
    });
  });

  it('fetches the keys again for an unknown key id (a key rotation), but not more than every 30 s', async () => {
    const keys = [jwk(publicKey, 'k1')];
    const { v, fetch, clock } = verifier(keys);
    await v.verify(sign(claims()));
    // Cloudflare rotates: the new key appears in the next fetch.
    keys.push(jwk(other.publicKey, 'k2'));
    await expect(
      v.verify(sign(claims(), { kid: 'k2', key: other.privateKey }))
    ).resolves.toBeNull();
    expect(fetch).toHaveBeenCalledTimes(1);
    clock.now += 31_000;
    await expect(
      v.verify(sign(claims({ exp: clock.now / 1000 + 600 }), { kid: 'k2', key: other.privateKey }))
    ).resolves.toEqual({
      email: 'gm@example.com',
    });
    expect(fetch).toHaveBeenCalledTimes(2);
  });

  it('refuses everything when the keys cannot be fetched', async () => {
    const fetch = vi.fn(() => Promise.resolve({ ok: false, json: () => Promise.resolve({}) }));
    const v = new AccessJwtVerifier({ teamDomain: TEAM, audiences: [AUD] }, fetch, () => NOW);
    await expect(v.verify(sign(claims()))).resolves.toBeNull();
  });
});

describe('accessTokenFrom', () => {
  it('reads the Cf-Access-Jwt-Assertion header, else the CF_Authorization cookie', () => {
    expect(accessTokenFrom({ 'cf-access-jwt-assertion': 'abc' })).toBe('abc');
    expect(accessTokenFrom({ cookie: 'x=1; CF_Authorization=def; y=2' })).toBe('def');
    expect(accessTokenFrom({})).toBeUndefined();
  });
});

describe('parseTeamDomain and resolveAccessConfig', () => {
  it('accepts only a cloudflareaccess.com team domain, with or without https://', () => {
    expect(parseTeamDomain('https://Team.cloudflareaccess.com/')).toBe('team.cloudflareaccess.com');
    expect(parseTeamDomain('team.cloudflareaccess.com')).toBe('team.cloudflareaccess.com');
    expect(parseTeamDomain('evil.example.com')).toBe('');
    expect(parseTeamDomain('')).toBe('');
  });

  it('needs both the team domain and at least one AUD tag', () => {
    expect(resolveAccessConfig('team.cloudflareaccess.com', 'a, b')).toEqual({
      teamDomain: 'team.cloudflareaccess.com',
      audiences: ['a', 'b'],
    });
    expect(resolveAccessConfig('team.cloudflareaccess.com', '')).toBeNull();
    expect(resolveAccessConfig('', 'a')).toBeNull();
  });
});
