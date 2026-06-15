import { describe, it, expect } from 'vitest';
import { resolveRole, extractToken, isGm, type AuthRequest } from './auth.js';
import type { AuthConfig } from './config.js';

function authConfig(overrides: Partial<AuthConfig> = {}): AuthConfig {
  return {
    splitEnabled: true,
    gmToken: 'gm-secret',
    playerToken: '',
    gmEmails: [],
    cfAccessEmailHeader: 'cf-access-authenticated-user-email',
    ...overrides,
  };
}

function req(
  headers: Record<string, string | string[] | undefined> = {},
  query: Record<string, unknown> = {}
): AuthRequest {
  return { headers, query };
}

describe('resolveRole — legacy single-user mode', () => {
  it('returns gm for everyone when the split is disabled', () => {
    const auth = authConfig({ splitEnabled: false, gmToken: '', gmEmails: [] });
    expect(resolveRole(req(), auth)).toBe('gm');
    expect(resolveRole(req({ 'x-cogm-token': 'anything' }), auth)).toBe('gm');
  });
});

describe('resolveRole — GM token', () => {
  it('grants gm for the token in a header', () => {
    expect(resolveRole(req({ 'x-cogm-token': 'gm-secret' }), authConfig())).toBe('gm');
  });

  it('grants gm for the token in the query string (EventSource path)', () => {
    expect(resolveRole(req({}, { token: 'gm-secret' }), authConfig())).toBe('gm');
  });

  it('grants gm for the token in a cookie', () => {
    expect(resolveRole(req({ cookie: 'foo=bar; cogm_token=gm-secret' }), authConfig())).toBe('gm');
  });

  it('rejects a wrong token (falls through to open player view)', () => {
    expect(resolveRole(req({ 'x-cogm-token': 'nope' }), authConfig())).toBe('player');
  });

  it('does not grant gm on a length-mismatched token', () => {
    expect(resolveRole(req({ 'x-cogm-token': 'gm-secret-longer' }), authConfig())).toBe('player');
  });
});

describe('resolveRole — player token required', () => {
  const auth = authConfig({ playerToken: 'player-secret' });

  it('grants player for the correct player token', () => {
    expect(resolveRole(req({ 'x-cogm-token': 'player-secret' }), auth)).toBe('player');
  });

  it('still grants gm for the GM token', () => {
    expect(resolveRole(req({ 'x-cogm-token': 'gm-secret' }), auth)).toBe('gm');
  });

  it('returns null (unauthorized) with no/incorrect token', () => {
    expect(resolveRole(req(), auth)).toBeNull();
    expect(resolveRole(req({ 'x-cogm-token': 'bad' }), auth)).toBeNull();
  });
});

describe('resolveRole — Cloudflare Access email', () => {
  const auth = authConfig({ gmToken: '', gmEmails: ['gm@example.com'] });

  it('grants gm for an allow-listed email (case-insensitive)', () => {
    expect(resolveRole(req({ 'cf-access-authenticated-user-email': 'GM@example.com' }), auth)).toBe(
      'gm'
    );
  });

  it('treats a non-allow-listed email as a player', () => {
    expect(
      resolveRole(req({ 'cf-access-authenticated-user-email': 'someone@example.com' }), auth)
    ).toBe('player');
  });

  it('honours a custom header name', () => {
    const custom = authConfig({
      gmToken: '',
      gmEmails: ['gm@x.io'],
      cfAccessEmailHeader: 'x-email',
    });
    expect(resolveRole(req({ 'x-email': 'gm@x.io' }), custom)).toBe('gm');
  });
});

describe('extractToken precedence', () => {
  it('prefers header over query over cookie', () => {
    expect(extractToken(req({ 'x-cogm-token': 'h', cookie: 'cogm_token=c' }, { token: 'q' }))).toBe(
      'h'
    );
    expect(extractToken(req({ cookie: 'cogm_token=c' }, { token: 'q' }))).toBe('q');
    expect(extractToken(req({ cookie: 'cogm_token=c' }))).toBe('c');
    expect(extractToken(req())).toBeUndefined();
  });
});

describe('isGm', () => {
  it('narrows to gm only', () => {
    expect(isGm('gm')).toBe(true);
    expect(isGm('player')).toBe(false);
    expect(isGm(null)).toBe(false);
  });
});
