/** The same guides on the wiki (wiki v1, D-108): one directory per page, README is the section index. */
const WIKI_GM = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/gm/';
const WIKI_FOUNDRY = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/foundry/';

/**
 * Where the open guide page lives on the wiki. A heading's anchor is the same on both sides except
 * for a heading that repeats on a page: the dashboard's help and the wiki (Starlight) both add
 * `-1`, `-2`, so the anchors agree.
 */
export function wikiUrl(page: string, anchor: string): string {
  // A Foundry basics page is `foundry-<name>` in the help and `foundry/<name>/` on the wiki.
  const foundry = page.startsWith('foundry-');
  const name = foundry ? page.slice('foundry-'.length) : page;
  const path = name === 'README' || name === '' ? '' : `${encodeURIComponent(name)}/`;
  return `${foundry ? WIKI_FOUNDRY : WIKI_GM}${path}${anchor ? `#${encodeURIComponent(anchor)}` : ''}`;
}
