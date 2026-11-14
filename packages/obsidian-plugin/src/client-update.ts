/**
 * The update notice (item client-updates, layer 2). The plugin tells the dashboard its version in
 * the `x-foundry-client` header and asks `GET /api/client-versions` which version the table runs;
 * an older plugin shows one small status bar notice with the download link.
 *
 * The plugin bundle does not import the shared package, so the compare and the wording are copied
 * here. Source of truth: `shared/src/client-versions.ts` (compareClientVersions, clientNoticeText,
 * CLIENT_HEADER). Keep the two in step.
 */

/** Mirror of the shared CLIENT_HEADER. */
export const CLIENT_HEADER = 'x-foundry-client';

/** How often the plugin asks again after the first check at load (6 hours). */
export const CLIENT_CHECK_INTERVAL_MS = 6 * 3600 * 1000;

/** The header value for this plugin build: `obsidian/<manifest version>`. */
export function clientHeaderValue(version: string): string {
  return `obsidian/${version}`;
}

/** Numeric per dot segment; -1 when a is older, 1 when newer, 0 when equal. */
export function compareVersions(a: string, b: string): number {
  const pa = a.split('.').map(p => Number.parseInt(p, 10) || 0);
  const pb = b.split('.').map(p => Number.parseInt(p, 10) || 0);
  for (let i = 0; i < Math.max(pa.length, pb.length); i += 1) {
    const d = (pa[i] ?? 0) - (pb[i] ?? 0);
    if (d !== 0) return d < 0 ? -1 : 1;
  }
  return 0;
}

export interface UpdateNotice {
  /** The short status bar text. */
  text: string;
  /** Danish line, then English line (hover text). */
  title: string;
  /** Where a click goes; null when the table gave no link. */
  link: string | null;
}

/**
 * The notice for a plugin at `own` when the table runs `current`, or null when the plugin is up to
 * date or the answer is not usable. Only an http(s) link is kept.
 */
export function updateNotice(
  own: string,
  current: unknown,
  obsidianLink: unknown
): UpdateNotice | null {
  if (typeof current !== 'string' || !/^\d+(\.\d+){0,3}$/.test(current)) return null;
  if (!/^\d+(\.\d+){0,3}/.test(own) || compareVersions(own, current) >= 0) return null;
  const link =
    typeof obsidianLink === 'string' && /^https?:\/\//i.test(obsidianLink) ? obsidianLink : null;
  const da = `Opdatering klar: dit Obsidian-plugin er ${own}, bordet kører ${current}. Hent det her: ${link ?? ''}`;
  const en = `Update available: your Obsidian plugin is ${own}, the table runs ${current}. Download: ${link ?? ''}`;
  return {
    text: `Foundry AI Tool: opdatering ${current}`,
    title: `${da.trim()}\n${en.trim()}`,
    link,
  };
}
