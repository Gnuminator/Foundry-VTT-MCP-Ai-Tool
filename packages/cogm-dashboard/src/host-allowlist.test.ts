/**
 * The DNS rebinding guard's rules (host-allowlist.ts), as pure functions. The
 * app-level tests (every path, both modes, raw sockets) are in
 * host-allowlist.app.test.ts.
 */
import { describe, expect, it } from 'vitest';

import {
  allowedHostsWarning,
  bindHostname,
  hostRefusal,
  hostRules,
  isAllowedHost,
  parseAllowedHosts,
  parseHostPort,
  type HostRules,
} from './host-allowlist.js';

const NONE = parseAllowedHosts('');

function allowed(host: string, rules: HostRules): boolean {
  const parsed = parseHostPort(host);
  return parsed !== null && isAllowedHost(parsed, rules);
}

describe('parseHostPort', () => {
  it('parses names, IPv4 and bracketed IPv6, with or without a port', () => {
    const cases: Array<[string, string, number | null]> = [
      ['localhost', 'localhost', null],
      ['LOCALHOST:3100', 'localhost', 3100],
      ['127.0.0.1:1', '127.0.0.1', 1],
      ['127.0.0.1:65535', '127.0.0.1', 65535],
      ['[::1]', '[::1]', null],
      ['[::1]:3100', '[::1]', 3100],
      ['[0:0:0:0:0:0:0:1]:80', '[::1]', 80],
      ['[::FFFF:127.0.0.1]', '[::ffff:7f00:1]', null],
      ['Cogm.Example.COM', 'cogm.example.com', null],
      ['my_host-1.lan:8080', 'my_host-1.lan', 8080],
      ['xn--bcher-kva.example', 'xn--bcher-kva.example', null],
      // A trailing dot is kept: `localhost.` is not `localhost`.
      ['localhost.', 'localhost.', null],
      ['localhost.:3100', 'localhost.', 3100],
    ];
    for (const [value, hostname, port] of cases) {
      expect([value, parseHostPort(value)]).toEqual([value, { hostname, port }]);
    }
  });

  it('refuses everything else', () => {
    for (const value of [
      '',
      ':3100',
      'localhost:',
      'localhost:0',
      'localhost:65536',
      'localhost:123456',
      'localhost:+1',
      'localhost:0x10',
      'evil@127.0.0.1',
      'user:pass@localhost:3100',
      'localhost, evil.example',
      'localhost evil.example',
      ' localhost',
      '::1',
      '[::1',
      '::1]',
      '[::1]x',
      '[::1]:',
      '[fe80::1%25eth0]',
      '[fe80::1%eth0]',
      '[v1.fe]',
      '[127.0.0.1]',
      '*',
      '*.example.com',
      'http://localhost',
      'localhost/x',
      'localhost?x',
      'localhost#x',
      '\\localhost',
      'a..b',
      '.localhost',
      'localhost..',
      '%6cocalhost',
      'bücher.example',
      `${'a'.repeat(64)}.example`,
      `${'a.'.repeat(130)}ex`, // a name longer than 254 characters
      `${'a.'.repeat(150)}example`, // a Host longer than 300 characters
    ]) {
      expect([value, parseHostPort(value)]).toEqual([value, null]);
    }
  });
});

describe('parseAllowedHosts', () => {
  it('is empty when unset or blank', () => {
    expect(parseAllowedHosts('')).toEqual({ entries: [], ignored: [] });
    expect(parseAllowedHosts(' , ,')).toEqual({ entries: [], ignored: [] });
  });

  it('parses names and name:port, case-insensitively', () => {
    expect(parseAllowedHosts('cogm.example.com, PI.local:3000 ,[::1]:8080')).toEqual({
      entries: [
        { hostname: 'cogm.example.com', port: null },
        { hostname: 'pi.local', port: 3000 },
        { hostname: '[::1]', port: 8080 },
      ],
      ignored: [],
    });
  });

  it('ignores wildcards, URLs and user info, and counts them by position', () => {
    expect(
      parseAllowedHosts('https://cogm.example.com,*.example.com,,ok.example,user@x.example')
    ).toEqual({ entries: [{ hostname: 'ok.example', port: null }], ignored: [1, 2, 4] });
  });
});

describe('allowedHostsWarning', () => {
  it('says nothing when every entry is valid', () => {
    expect(allowedHostsWarning(parseAllowedHosts('a.example,b.example:1'))).toBeNull();
  });

  it('names the ignored positions, never the entry text', () => {
    const warning = allowedHostsWarning(
      parseAllowedHosts('ok.example, https://SECRET-CANARY@x.example/?token=abc')
    );
    expect(warning).toContain('DASHBOARD_ALLOWED_HOSTS');
    expect(warning).toContain('entry 2 of 2');
    for (const secret of ['SECRET', 'CANARY', 'token', 'abc', 'x.example', 'ok.example']) {
      expect(warning).not.toContain(secret);
    }
  });
});

describe('bindHostname (DASHBOARD_HOST)', () => {
  it('allows the name of a specific listen address', () => {
    expect(bindHostname('127.0.0.1')).toBe('127.0.0.1');
    expect(bindHostname(' 192.168.1.20 ')).toBe('192.168.1.20');
    expect(bindHostname('Pi.Local')).toBe('pi.local');
    expect(bindHostname('::1')).toBe('[::1]');
    expect(bindHostname('[::1]')).toBe('[::1]');
    expect(bindHostname('fd00::5')).toBe('[fd00::5]');
  });

  it('allows nothing for a wildcard or an unusable value', () => {
    for (const host of [
      '',
      '0.0.0.0',
      '::',
      '[::]',
      '0:0:0:0:0:0:0:0',
      'localhost:3000',
      'fe80::1%eth0',
      'bad host',
    ]) {
      expect([host, bindHostname(host)]).toEqual([host, null]);
    }
  });
});

describe('isAllowedHost', () => {
  it('allows only the loopback names by default, on any port', () => {
    const rules = hostRules('127.0.0.1', NONE);
    for (const host of [
      'localhost',
      'localhost:3100',
      'LOCALHOST:1',
      '127.0.0.1',
      '127.0.0.1:3100',
      '[::1]',
      '[::1]:3100',
      '[0:0:0:0:0:0:0:1]:3100',
    ]) {
      expect([host, allowed(host, rules)]).toEqual([host, true]);
    }
    for (const host of [
      'localhost.:3100',
      'localhost.evil.com:3100',
      '127.0.0.1.nip.io:3100',
      '127.0.0.2:3100',
      '127.1:3100',
      '2130706433:3100',
      '0.0.0.0:3100',
      '[::]:3100',
      '[::2]:3100',
      '[::ffff:127.0.0.1]:3100',
      'evil.example',
      'evil.example:3100',
    ]) {
      expect([host, allowed(host, rules)]).toEqual([host, false]);
    }
  });

  it('adds DASHBOARD_ALLOWED_HOSTS: any port without one, that port with one', () => {
    const rules = hostRules(
      '127.0.0.1',
      parseAllowedHosts('cogm.example.com, pi.local:3000, tunnel.example:443, plain.example:80')
    );
    const expectations: Array<[string, boolean]> = [
      ['cogm.example.com', true],
      ['COGM.EXAMPLE.COM:443', true],
      ['cogm.example.com:8443', true],
      ['www.cogm.example.com', false],
      ['cogm.example.com.evil.example', false],
      ['cogm.example.com.', false],
      ['pi.local:3000', true],
      ['pi.local:3001', false],
      ['pi.local', false],
      // A Host without a port is port 80 or 443 (browsers leave the default port out).
      ['tunnel.example', true],
      ['tunnel.example:443', true],
      ['tunnel.example:444', false],
      ['tunnel.example:80', false],
      ['plain.example', true],
      ['plain.example:80', true],
      ['plain.example:443', false],
    ];
    for (const [host, expected] of expectations) {
      expect([host, allowed(host, rules)]).toEqual([host, expected]);
    }
  });

  it('adds a specific DASHBOARD_HOST, never a wildcard one', () => {
    expect(allowed('192.168.1.20:3000', hostRules('192.168.1.20', NONE))).toBe(true);
    expect(allowed('192.168.1.21:3000', hostRules('192.168.1.20', NONE))).toBe(false);
    expect(allowed('[fd00::5]:3000', hostRules('fd00::5', NONE))).toBe(true);
    expect(allowed('0.0.0.0:3000', hostRules('0.0.0.0', NONE))).toBe(false);
    expect(allowed('192.168.1.20:3000', hostRules('0.0.0.0', NONE))).toBe(false);
    expect(allowed('[::]:3000', hostRules('::', NONE))).toBe(false);
    expect(allowed('localhost:3000', hostRules('0.0.0.0', NONE))).toBe(true);
  });
});

describe('hostRefusal', () => {
  const rules = hostRules('127.0.0.1', NONE);

  it('passes one allowed Host with a path target', () => {
    expect(hostRefusal(['Host', 'localhost:3100'], '/api/health', rules)).toBeNull();
    expect(hostRefusal(['HOST', 'LOCALHOST:3100', 'Accept', '*/*'], '/', rules)).toBeNull();
  });

  it('refuses a missing, repeated or malformed Host', () => {
    expect(hostRefusal([], '/', rules)).toEqual({ reason: 'missing' });
    expect(hostRefusal(['Host'], '/', rules)).toEqual({ reason: 'missing' });
    for (const raw of [
      ['Host', 'localhost', 'Host', 'evil.example'],
      ['Host', 'evil.example', 'host', 'localhost'],
      ['HOST', 'localhost', 'Host', 'localhost'],
    ]) {
      expect(hostRefusal(raw, '/', rules)).toEqual({ reason: 'multiple' });
    }
    for (const value of ['', 'evil@localhost', 'localhost, evil.example', '[::1']) {
      expect([value, hostRefusal(['Host', value], '/', rules)]).toEqual([
        value,
        { reason: 'malformed' },
      ]);
    }
  });

  it('refuses a target that is not a path, and a Host that is not allowed', () => {
    expect(hostRefusal(['Host', 'localhost'], 'http://evil.example/x', rules)).toEqual({
      reason: 'target',
    });
    expect(hostRefusal(['Host', 'localhost'], '*', rules)).toEqual({ reason: 'target' });
    expect(hostRefusal(['Host', 'Evil.Example:3100'], '/', rules)).toEqual({
      reason: 'not-allowed',
      hostname: 'evil.example',
    });
  });
});
