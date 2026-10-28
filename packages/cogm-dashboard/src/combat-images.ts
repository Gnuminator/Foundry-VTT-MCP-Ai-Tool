/**
 * Token portraits for the initiative ribbon. The module sends each combatant's image as a Foundry
 * path (`tokens/ogre.webp`) because the browser that holds the bridge link may reach Foundry at an
 * address the GM's own browser cannot (the Pi's `127.0.0.1:30000`). The dashboard knows the
 * address the GM can use (`DASHBOARD_FOUNDRY_URL`; not `FOUNDRY_AI_FOUNDRY_URL`, which is where
 * the bridge reaches Foundry and differs on a remote setup), so it joins the two here before the
 * fight goes to the page. Without that setting a relative path is dropped and the ribbon shows
 * initials; an absolute http(s) address is kept.
 */
import type { CombatState, Combatant } from './feed/types.js';

/**
 * `base` without a trailing slash, or '' when it is not a plain http(s) address (credentials, a
 * query or a fragment make it unusable as a base).
 */
export function normalizeFoundryUrl(base: string): string {
  const trimmed = base.trim().replace(/\/+$/, '');
  if (!/^https?:\/\/\S+$/i.test(trimmed)) return '';
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.search || url.hash) return '';
  } catch {
    return '';
  }
  return trimmed;
}

/** The page address of one image path, or null when there is none to show. */
export function portraitUrl(img: unknown, foundryUrl: string): string | null {
  if (typeof img !== 'string' || img === '') return null;
  if (/^https?:\/\//i.test(img)) return img;
  if (foundryUrl === '' || /^[a-z][a-z0-9+.-]*:|^\/\//i.test(img)) return null;
  // Encode each segment (a path may hold spaces or #) without double-encoding what is encoded.
  const path = img
    .replace(/^\/+/, '')
    .split('/')
    .map(part => encodeURIComponent(decodeURIComponentSafe(part)))
    .join('/');
  return `${foundryUrl}/${path}`;
}

function decodeURIComponentSafe(part: string): string {
  try {
    return decodeURIComponent(part);
  } catch {
    return part;
  }
}

/** The fight with every combatant's `img` made loadable from the GM's browser. */
export function withPortraitUrls(
  combat: CombatState | null,
  foundryUrl: string
): CombatState | null {
  if (!combat) return combat;
  const fix = (c: Combatant): Combatant => ({ ...c, img: portraitUrl(c.img, foundryUrl) });
  return {
    ...combat,
    current: combat.current ? fix(combat.current) : null,
    combatants: combat.combatants.map(fix),
  };
}
