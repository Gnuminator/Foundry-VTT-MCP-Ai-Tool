/**
 * Where the dashboard listens (plan 0.7). Loopback by default, so only this
 * machine (and a local tunnel such as cloudflared) can reach it. Binding any
 * other interface exposes the GM controls to the network, so it is refused
 * unless a GM token of at least MIN_GM_TOKEN_LENGTH characters is configured:
 * without one every caller is treated as GM, and a short one can be guessed.
 * (A Cloudflare Access email header alone is not enough; it is trusted without
 * verifying the Access JWT.)
 */

/** 24 random bytes in base64 (the Pi's set-dashboard-access.sh) are exactly 32 characters. */
export const MIN_GM_TOKEN_LENGTH = 32;

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127(\.\d{1,3}){3}$/.test(h);
}

/** Why binding `host` is refused, or null when it is allowed. Never echoes the token. */
export function bindRefusal(host: string, gmToken: string): string | null {
  if (isLoopbackHost(host)) return null;
  const token = gmToken.trim();
  if (!token) {
    return (
      `Refusing to listen on ${host}: that exposes the dashboard beyond this machine, and ` +
      'without GM_DASHBOARD_TOKEN every visitor is treated as the GM. Set GM_DASHBOARD_TOKEN, ' +
      'or keep DASHBOARD_HOST=127.0.0.1 (the default) and reach it through a tunnel.'
    );
  }
  if (token.length < MIN_GM_TOKEN_LENGTH) {
    return (
      `Refusing to listen on ${host}: GM_DASHBOARD_TOKEN is ${token.length} characters, and a ` +
      `dashboard reachable beyond this machine needs at least ${MIN_GM_TOKEN_LENGTH}. Make a ` +
      'random one (for example `openssl rand -hex 32`), or keep DASHBOARD_HOST=127.0.0.1 (the ' +
      'default) and reach it through a tunnel.'
    );
  }
  return null;
}
