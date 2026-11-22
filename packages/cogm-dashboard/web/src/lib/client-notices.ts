// Outdated client pieces (item client-updates, layer 2): which rows of GET /api/client-versions
// the GM sees as a banner. Only the GM's own pieces (connectors, Obsidian plugin) do; a player's
// extension is reported to that player on their own page, and listed in the Versions panel.
import { clientNoticeText, type ClientVersionsView } from '@gnuminator/shared/browser';

interface ClientBanner {
  piece: 'connectors' | 'obsidian';
  da: string;
  en: string;
  link: string | null;
}

export const CLIENT_VERSIONS_KEY = ['client-versions'] as const;
export const CLIENT_VERSIONS_REFETCH_MS = 5 * 60 * 1000;

/** One banner per outdated GM piece, in the order connectors then Obsidian plugin. */
export function clientBanners(view: ClientVersionsView | null | undefined): ClientBanner[] {
  if (!view || !Array.isArray(view.seen)) return [];
  const banners: ClientBanner[] = [];
  for (const piece of ['connectors', 'obsidian'] as const) {
    const row = view.seen.find(s => s.piece === piece && s.behind);
    if (!row) continue;
    const link = view.downloads?.[piece] ?? null;
    const text = clientNoticeText(piece, row.version ?? '?', view.current, link);
    banners.push({ piece, da: text.da, en: text.en, link });
  }
  return banners;
}

/** The notice split around its link, so the link renders as a real anchor. */
export function splitAtLink(line: string, link: string | null): [string, string | null] {
  if (!link) return [line, null];
  const at = line.indexOf(link);
  return at < 0 ? [line, null] : [line.slice(0, at), link];
}
