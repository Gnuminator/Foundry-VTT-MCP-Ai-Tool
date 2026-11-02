// One sidebar per side (the user, 2026-11-02). scripts/wiki/stage.mjs writes the GM groups and the
// player groups into one sidebar; this keeps only the groups of the side the visitor is on, so a
// player never sees a GM page in the sidebar. The home page (splash) has no sidebar.
import { defineRouteMiddleware } from '@astrojs/starlight/route-data';

const BASE = '/Foundry-VTT-MCP-Ai-Tool';

type Entry = { type: 'link'; href: string } | { type: 'group'; entries: Entry[]; label: string };

/** The side a path belongs to: player pages (with or without a language prefix), else GM. */
export function sideOf(pathname: string): 'player' | 'gm' | null {
  const rest = pathname.startsWith(BASE) ? pathname.slice(BASE.length) : pathname;
  const parts = rest.split('/').filter(Boolean);
  if (parts[0] === 'da') parts.shift();
  if (parts.length === 0) return null;
  return parts[0] === 'player' ? 'player' : 'gm';
}

function keep(entries: Entry[], side: 'player' | 'gm'): Entry[] {
  const out: Entry[] = [];
  for (const entry of entries) {
    if (entry.type === 'group') {
      const inner = keep(entry.entries, side);
      if (inner.length > 0) out.push({ ...entry, entries: inner });
    } else if (
      sideOf(entry.href) === null ||
      (sideOf(entry.href) === 'player') === (side === 'player')
    ) {
      out.push(entry);
    }
  }
  return out;
}

export const onRequest = defineRouteMiddleware(context => {
  const route = context.locals.starlightRoute;
  const side = sideOf(context.url.pathname);
  if (side === null) return;
  const kept = keep(route.sidebar as Entry[], side);
  route.sidebar = kept as typeof route.sidebar;
  // The previous/next links come from the whole sidebar: rebuild them from this side's pages, so
  // the first player page never points back at a GM page.
  const links = flatten(kept);
  const at = links.findIndex(link => (link as { isCurrent?: boolean }).isCurrent === true);
  if (at !== -1) {
    route.pagination = {
      prev: links[at - 1] as typeof route.pagination.prev,
      next: links[at + 1] as typeof route.pagination.next,
    };
  }
});

function flatten(entries: Entry[]): Entry[] {
  return entries.flatMap(entry => (entry.type === 'group' ? flatten(entry.entries) : [entry]));
}
