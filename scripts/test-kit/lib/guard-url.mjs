/**
 * The URL guard every kit target goes through: it refuses the live bridge ports always, and
 * anything that is not on this machine unless the caller says the target may be remote (only
 * the opt-in `pi` target does, see lib/pi-target.mjs).
 */
import { LIVE_BRIDGE_PORTS } from './contract.mjs';
import { EnvError } from './errors.mjs';

export const LOOPBACK_HOSTS = ['127.0.0.1', 'localhost', '[::1]'];

/**
 * Parses a URL, refuses the live bridge ports, and (by default) anything but loopback.
 * `loopbackOnly: false` lets a remote host through; it is for the pi target only, and the live
 * port check still applies to it.
 * @param {string} raw
 * @param {{label: string, loopbackOnly?: boolean, port?: number}} opts
 * @returns {string} normalised `http://host:port` (localhost becomes 127.0.0.1)
 */
export function guardUrl(raw, { label, loopbackOnly = true, port: onlyPort }) {
  let url;
  try {
    url = new URL(raw);
  } catch {
    throw new EnvError(`REFUSED: ${label} "${raw}" is not a URL.`);
  }
  const port = Number(url.port || (url.protocol === 'https:' ? 443 : 80));
  if (LIVE_BRIDGE_PORTS.includes(port)) {
    throw new EnvError(
      `REFUSED: port ${port} is the live bridge. The test kit never uses it (${label}).`
    );
  }
  if (loopbackOnly && !LOOPBACK_HOSTS.includes(url.hostname)) {
    throw new EnvError(`REFUSED: ${label} ${url.host} is not on this machine (loopback only).`);
  }
  if (onlyPort !== undefined && port !== onlyPort) {
    throw new EnvError(
      `REFUSED: ${label} ${url.host} is not the test dashboard. Only port ${onlyPort} is allowed.`
    );
  }
  // 127.0.0.1 rather than localhost: localhost tries IPv6 first and is slow on Windows.
  const host = url.hostname === 'localhost' ? '127.0.0.1' : url.hostname;
  return `${url.protocol}//${host}:${port}`;
}
