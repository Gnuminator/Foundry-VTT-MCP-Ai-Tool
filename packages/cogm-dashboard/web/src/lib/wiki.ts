/** The same guides on the wiki (wiki v1, D-108): one directory per page, README is the section index. */
const WIKI_GM = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/';

/** Where the open guide page lives on the wiki (the anchors use the same slugs as the dashboard). */
export function wikiUrl(page: string, anchor: string): string {
  const path = page === 'README' || page === '' ? '' : `${encodeURIComponent(page)}/`;
  return `${WIKI_GM}${path}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}
