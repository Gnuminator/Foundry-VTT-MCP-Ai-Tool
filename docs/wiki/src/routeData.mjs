// One sidebar per side (the user, 2026-11-02). scripts/wiki/stage.mjs writes the GM groups and the
// player groups into one sidebar; this keeps only the groups of the side the visitor is on, so a
// player never sees a GM page in the sidebar or in the previous/next links. The home page (splash)
// has no sidebar. Plain .mjs: the repo's ESLint type project does not cover docs/wiki.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

const BASE = '/Foundry-VTT-MCP-Ai-Tool';

/** The side a path belongs to: 'player' pages (with or without a language prefix), else 'gm'. */
export function sideOf(pathname) {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const parts = rest.split('/').filter(Boolean);
  if (parts[0] === 'da') parts.shift();
  if (parts.length === 0) return null;
  return parts[0] === 'player' ? 'player' : 'gm';
}

/** The sidebar entries (groups and links) of one side; the home link has no side and stays. */
function keep(entries, side) {
  const out = [];
  for (const entry of entries) {
    if (entry.type === 'group') {
      const inner = keep(entry.entries, side);
      if (inner.length > 0) out.push({ ...entry, entries: inner });
    } else {
      const entrySide = sideOf(entry.href);
      if (entrySide === null || entrySide === side) out.push(entry);
    }
  }
  return out;
}

function flatten(entries) {
  return entries.flatMap(entry => (entry.type === 'group' ? flatten(entry.entries) : [entry]));
}

export const onRequest = defineRouteMiddleware(context => {
  const route = context.locals.starlightRoute;
  const side = sideOf(context.url.pathname);
  if (side === null) return;
  const kept = keep(route.sidebar, side);
  route.sidebar = kept;
  // The previous/next links come from the whole sidebar: rebuild them from this side's pages, so
  // the first player page never points back at a GM page.
  const links = flatten(kept);
  const at = links.findIndex(link => link.isCurrent === true);
  if (at !== -1) route.pagination = { prev: links[at - 1], next: links[at + 1] };
});
