/** The same guides on the wiki (wiki v1, D-108): one directory per page, README is the section index. */
const WIKI_GM = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/';

/**
 * Where the open guide page lives on the wiki. A heading's anchor is the same on both sides except
 * for a heading that repeats on a page: the dashboard's help adds `-1`, `-2`, mkdocs adds `_1`,
 * `_2`, so a link to the second of two same-named headings opens the page at the top.
 */
export function wikiUrl(page: string, anchor: string): string {
  const path = page === 'README' || page === '' ? '' : `${encodeURIComponent(page)}/`;
  return `${WIKI_GM}${path}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}
