/** The same guides on the wiki (wiki v1, D-108): one directory per page, README is the section index. */
const WIKI = 'https://gnuminator.github.io/Foundry-VTT-MCP-Ai-Tool/';
const WIKI_GM = `${WIKI}gm/`;
const WIKI_FOUNDRY = `${WIKI}foundry/`;
/** The Danish twins of the GM guides (docs/da/gm). The Foundry basics have none. */
const WIKI_DA_GM = `${WIKI}da/gm/`;

export type HelpLang = 'en' | 'da';

const LANG_KEY = 'cogm.help.lang';

/**
 * The language the help opens in: Danish when the browser's language is Danish, English
 * otherwise. `localStorage['cogm.help.lang']` ('da' or 'en') overrides the browser, for a Danish
 * GM on an English browser.
 */
export function helpLang(): HelpLang {
  try {
    const saved = localStorage.getItem(LANG_KEY);
    if (saved === 'da' || saved === 'en') return saved;
  } catch {
    // Storage blocked: the browser language decides.
  }
  return typeof navigator !== 'undefined' && /^da\b/i.test(navigator.language) ? 'da' : 'en';
}

/**
 * Where the open guide page lives on the wiki. A heading's anchor is the same on both sides except
 * for a heading that repeats on a page: the dashboard's help and the wiki (Starlight) both add
 * `-1`, `-2`, so the anchors agree. In Danish the heading slugs differ from the English ones the
 * callers know, so a Danish link goes to the page, not to a heading. A Foundry basics page has no
 * Danish twin and stays English.
 */
export function wikiUrl(page: string, anchor: string, lang: HelpLang = 'en'): string {
  // A Foundry basics page is `foundry-<name>` in the help and `foundry/<name>/` on the wiki.
  const foundry = page.startsWith('foundry-');
  const name = foundry ? page.slice('foundry-'.length) : page;
  const path = name === 'README' || name === '' ? '' : `${encodeURIComponent(name)}/`;
  const danish = lang === 'da' && !foundry;
  const hash = !danish && anchor ? `#${encodeURIComponent(anchor)}` : '';
  return `${foundry ? WIKI_FOUNDRY : danish ? WIKI_DA_GM : WIKI_GM}${path}${hash}`;
}
