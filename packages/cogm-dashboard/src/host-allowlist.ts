/**
 * DNS rebinding guard: the dashboard answers only requests addressed to a host
 * name it knows.
 *
 * A page on `http://attacker.example:3000` can make its host name resolve to
 * 127.0.0.1 after it loaded ("DNS rebinding"). The browser then treats the
 * dashboard as that page's own origin, so it can read the GM state and call the
 * GM endpoints (in legacy mode every caller is the GM). Every such request still
 * carries `Host: attacker.example:3000`, so refusing unknown host names stops
 * it. The port is left out of the default check: the attacker's port is the
 * dashboard's port, so checking it adds nothing.
 *
 * Allowed (`hostRules`):
 * - `localhost`, `127.0.0.1` and `[::1]`, on any port;
 * - the host name of `DASHBOARD_HOST` when it names one address (not
 *   `0.0.0.0` or `::`), on any port;
 * - each `DASHBOARD_ALLOWED_HOSTS` entry: a name without a port allows any
 *   port; `name:port` allows only that port (a Host without a port counts as
 *   port 80 or 443, the ports browsers leave out).
 * Names compare case-insensitively and exactly otherwise: no wildcards, no
 * suffix match, and a trailing dot is not stripped (`localhost.` is a DNS name
 * that may resolve anywhere, so it is refused unless listed as written).
 * IPv6 addresses compare in their canonical form (`[0:0:0:0:0:0:0:1]` is
 * `[::1]`).
 *
 * Refused with 421 `host-not-allowed`, before any other route: no Host, more
 * than one Host, a malformed Host (user info, a list, a zone id, anything
 * outside host names and IP addresses), a request target that is not a path
 * (absolute form: its authority would bypass the Host check), and every host
 * name not allowed above.
 */
import * as net from 'net';

import type { Request, RequestHandler, Response } from 'express';

import type { Logger } from './logger.js';

/** A parsed Host header value or allowlist entry. */
export interface HostName {
  /** Lowercase name, IPv4 address, or canonical IPv6 address in brackets. */
  readonly hostname: string;
  /** The port, or null when none was given. */
  readonly port: number | null;
}

/** `DASHBOARD_ALLOWED_HOSTS`, parsed. */
export interface AllowedHosts {
  readonly entries: readonly HostName[];
  /** 1-based positions (among the non-empty entries) of the entries that were ignored. */
  readonly ignored: readonly number[];
}

/** What the guard accepts, built once. */
export interface HostRules {
  /** Host names allowed on any port. */
  readonly anyPort: ReadonlySet<string>;
  /** Entries allowed on their own port only. */
  readonly withPort: readonly HostName[];
}

export const HOST_NOT_ALLOWED = 'host-not-allowed';
export const HOST_NOT_ALLOWED_MESSAGE =
  'This dashboard only answers to its own host names (localhost, 127.0.0.1, [::1] and its ' +
  'DASHBOARD_HOST address). To reach it under another name, such as a tunnel, a proxy or a ' +
  'LAN address, add that name to DASHBOARD_ALLOWED_HOSTS and restart the dashboard.';

/** Allowed on any port, in every configuration. */
export const LOOPBACK_HOSTNAMES: readonly string[] = ['localhost', '127.0.0.1', '[::1]'];

const MAX_HOST_LENGTH = 300;
const MAX_NAME_LENGTH = 254;
const LABEL = /^[a-z0-9_-]{1,63}$/;
const NAME_WITH_PORT = /^([a-z0-9_.-]+)(?::([0-9]{1,5}))?$/;
const IPV6_WITH_PORT = /^\[([0-9a-f:.]+)\](?::([0-9]{1,5}))?$/;
const DEFAULT_PORTS: readonly number[] = [80, 443];
/** At most this many distinct refused hosts are logged (a rebinding page may retry a lot). */
const MAX_REPORTED = 20;

function parsePort(text: string | undefined): number | null | undefined {
  if (text === undefined) return null;
  const port = Number(text);
  return port >= 1 && port <= 65535 ? port : undefined;
}

/** A DNS-style name or IPv4 address (dot-separated labels, one optional trailing dot). */
function isName(name: string): boolean {
  if (name.length > MAX_NAME_LENGTH) return false;
  const body = name.endsWith('.') ? name.slice(0, -1) : name;
  return body !== '' && body.split('.').every(label => LABEL.test(label));
}

/** The canonical bracketed form of an IPv6 address, or null. */
function canonicalIpv6(address: string): string | null {
  if (!net.isIPv6(address)) return null;
  try {
    return new URL(`http://[${address}]/`).hostname;
  } catch {
    return null;
  }
}

/**
 * Parse one Host header value (or allowlist entry): `name`, `name:port`,
 * `[ipv6]` or `[ipv6]:port`. Null for anything else.
 */
export function parseHostPort(value: string): HostName | null {
  if (value === '' || value.length > MAX_HOST_LENGTH) return null;
  const text = value.toLowerCase();
  const ipv6 = IPV6_WITH_PORT.exec(text);
  const plain = ipv6 ? null : NAME_WITH_PORT.exec(text);
  const match = ipv6 ?? plain;
  if (!match) return null;
  const hostname = ipv6 ? canonicalIpv6(match[1] ?? '') : (match[1] ?? '');
  const port = parsePort(match[2]);
  if (hostname === null || port === undefined) return null;
  if (!ipv6 && !isName(hostname)) return null;
  return { hostname, port };
}

/** Parse `DASHBOARD_ALLOWED_HOSTS` (comma-separated); invalid entries are ignored and counted. */
export function parseAllowedHosts(raw: string): AllowedHosts {
  const entries: HostName[] = [];
  const ignored: number[] = [];
  const items = raw
    .split(',')
    .map(item => item.trim())
    .filter(item => item !== '');
  items.forEach((item, index) => {
    const parsed = parseHostPort(item);
    if (parsed) entries.push(parsed);
    else ignored.push(index + 1);
  });
  return { entries, ignored };
}

/** The startup warning for ignored entries: positions only, never the entry text. */
export function allowedHostsWarning(allowed: AllowedHosts): string | null {
  if (allowed.ignored.length === 0) return null;
  const total = allowed.entries.length + allowed.ignored.length;
  const which = allowed.ignored.join(', ');
  return (
    `DASHBOARD_ALLOWED_HOSTS: ignored entry ${which} of ${total}. Each entry must be a host ` +
    'name, an IPv4 address or an [IPv6] address, optionally with :port, without a scheme, ' +
    'path, user name or wildcard.'
  );
}

/** The host name `DASHBOARD_HOST` allows, or null for a wildcard or unusable address. */
export function bindHostname(bindHost: string): string | null {
  const text = bindHost.trim();
  if (text === '') return null;
  const parsed = parseHostPort(net.isIPv6(text) ? `[${text}]` : text);
  if (parsed?.port !== null) return null;
  if (parsed.hostname === '0.0.0.0' || parsed.hostname === '[::]') return null;
  return parsed.hostname;
}

export function hostRules(bindHost: string, allowed: AllowedHosts): HostRules {
  const anyPort = new Set(LOOPBACK_HOSTNAMES);
  const bind = bindHostname(bindHost);
  if (bind !== null) anyPort.add(bind);
  const withPort: HostName[] = [];
  for (const entry of allowed.entries) {
    if (entry.port === null) anyPort.add(entry.hostname);
    else withPort.push(entry);
  }
  return { anyPort, withPort };
}

export function isAllowedHost(host: HostName, rules: HostRules): boolean {
  if (rules.anyPort.has(host.hostname)) return true;
  return rules.withPort.some(
    entry =>
      entry.hostname === host.hostname &&
      (host.port === null
        ? entry.port !== null && DEFAULT_PORTS.includes(entry.port)
        : entry.port === host.port)
  );
}

export type HostRefusal = 'missing' | 'multiple' | 'malformed' | 'not-allowed' | 'target';

/**
 * Why a request is refused, or null. `rawHeaders` is Node's flat name/value
 * list: `req.headers.host` keeps only the first of several Host headers.
 */
export function hostRefusal(
  rawHeaders: readonly string[],
  url: string,
  rules: HostRules
): { reason: HostRefusal; hostname?: string } | null {
  const values: string[] = [];
  for (let i = 0; i + 1 < rawHeaders.length; i += 2) {
    if (rawHeaders[i]?.toLowerCase() === 'host') values.push(rawHeaders[i + 1] ?? '');
  }
  if (values.length === 0) return { reason: 'missing' };
  if (values.length > 1) return { reason: 'multiple' };
  const host = parseHostPort(values[0] ?? '');
  if (!host) return { reason: 'malformed' };
  if (!url.startsWith('/')) return { reason: 'target' };
  if (!isAllowedHost(host, rules)) return { reason: 'not-allowed', hostname: host.hostname };
  return null;
}

export interface HostAllowlistOptions {
  /** The listen address (`DASHBOARD_HOST`). */
  readonly bindHost: string;
  readonly allowedHosts: AllowedHosts;
  readonly logger: Logger;
}

/** The guard middleware; mount it before every other handler. */
export function hostAllowlist(options: HostAllowlistOptions): RequestHandler {
  const { logger } = options;
  const rules = hostRules(options.bindHost, options.allowedHosts);
  const warning = allowedHostsWarning(options.allowedHosts);
  if (warning) logger.warn(warning);
  const reported = new Set<string>();

  function report(refusal: { reason: HostRefusal; hostname?: string }): void {
    const key = `${refusal.reason} ${refusal.hostname ?? ''}`;
    if (reported.has(key) || reported.size > MAX_REPORTED) return;
    reported.add(key);
    if (reported.size > MAX_REPORTED) {
      logger.warn('Refused more requests for hosts that are not allowed; not logging them all');
      return;
    }
    logger.warn('Refused a request by the Host check (see DASHBOARD_ALLOWED_HOSTS)', {
      reason: refusal.reason,
      ...(refusal.hostname !== undefined ? { host: refusal.hostname } : {}),
    });
  }

  return (req: Request, res: Response, next: () => void): void => {
    const refusal = hostRefusal(req.rawHeaders, req.url, rules);
    if (refusal === null) {
      next();
      return;
    }
    report(refusal);
    res
      .status(421)
      .set('Cache-Control', 'no-store')
      .json({ code: HOST_NOT_ALLOWED, error: HOST_NOT_ALLOWED_MESSAGE });
  };
}
