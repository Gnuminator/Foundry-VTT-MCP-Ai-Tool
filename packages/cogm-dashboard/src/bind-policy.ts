/**
 * Where the dashboard listens (plan 0.7). Loopback by default, so only this
 * machine (and a local tunnel such as cloudflared) can reach it. Binding any
 * other interface exposes the GM controls to the network, so it is refused
 * unless a GM token is configured: without one every caller is treated as GM.
 * (A Cloudflare Access email header alone is not enough; it is trusted without
 * verifying the Access JWT.)
 */

export function isLoopbackHost(host: string): boolean {
  const h = host.trim().toLowerCase();
  return h === 'localhost' || h === '::1' || h === '[::1]' || /^127(\.\d{1,3}){3}$/.test(h);
}

/** Why binding `host` is refused, or null when it is allowed. */
export function bindRefusal(host: string, gmToken: string): string | null {
  if (isLoopbackHost(host)) return null;
  if (gmToken.trim()) return null;
  return (
    `Refusing to listen on ${host}: that exposes the dashboard beyond this machine, and ` +
    'without GM_DASHBOARD_TOKEN every visitor is treated as the GM. Set GM_DASHBOARD_TOKEN, ' +
    'or keep DASHBOARD_HOST=127.0.0.1 (the default) and reach it through a tunnel.'
  );
}
