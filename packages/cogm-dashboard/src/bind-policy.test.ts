import { describe, expect, it } from 'vitest';

import { MIN_GM_TOKEN_LENGTH, bindRefusal, isLoopbackHost } from './bind-policy.js';

describe('dashboard bind policy', () => {
  it('recognises loopback hosts', () => {
    for (const h of ['127.0.0.1', '127.1.2.3', 'localhost', 'LOCALHOST', '::1', '[::1]']) {
      expect(isLoopbackHost(h)).toBe(true);
    }
    for (const h of ['0.0.0.0', '::', '192.168.1.20', 'pi.local', '1127.0.0.1']) {
      expect(isLoopbackHost(h)).toBe(false);
    }
  });

  const longToken = 'x'.repeat(MIN_GM_TOKEN_LENGTH);

  it('allows loopback always, and other interfaces only with a GM token', () => {
    expect(bindRefusal('127.0.0.1', '')).toBeNull();
    expect(bindRefusal('0.0.0.0', longToken)).toBeNull();
    expect(bindRefusal('0.0.0.0', '')).toMatch(/Refusing to listen on 0.0.0.0/);
    expect(bindRefusal('192.168.1.20', '   ')).toMatch(/GM_DASHBOARD_TOKEN/);
  });

  it('refuses a short GM token on other interfaces, without echoing it', () => {
    const short = 'secret-but-short';
    const refusal = bindRefusal('0.0.0.0', short);
    expect(refusal).toMatch(/GM_DASHBOARD_TOKEN is 16 characters/);
    expect(refusal).toMatch(/at least 32/);
    expect(refusal).not.toContain(short);
    expect(bindRefusal('0.0.0.0', 'x'.repeat(MIN_GM_TOKEN_LENGTH - 1))).not.toBeNull();
    // Surrounding spaces do not count towards the length.
    expect(bindRefusal('0.0.0.0', `  ${'x'.repeat(MIN_GM_TOKEN_LENGTH - 1)}  `)).not.toBeNull();
    // A short token is fine on loopback (local tests, the smoke scripts).
    expect(bindRefusal('127.0.0.1', short)).toBeNull();
  });

  it("accepts the Pi's set-dashboard-access.sh token shape (24 random bytes, base64url, no padding)", () => {
    const token = Buffer.from(Array.from({ length: 24 }, (_, i) => (i * 37 + 251) % 256))
      .toString('base64')
      .replace(/\+/g, '-')
      .replace(/\//g, '_')
      .replace(/=+$/, '');
    expect(token).toHaveLength(32);
    expect(bindRefusal('0.0.0.0', token)).toBeNull();
    // openssl rand -hex 32 (deploy/README.md) is 64 characters.
    expect(bindRefusal('0.0.0.0', 'ab'.repeat(32))).toBeNull();
  });
});
