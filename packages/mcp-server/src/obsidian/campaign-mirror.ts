/**
 * Campaign journal pages in the Obsidian mirror (D-151). A page made by `plan-campaign-merge`
 * (`campaign/model.ts`) is plain HTML with class markers. The generic converter would show its
 * links as plain text, so this turns the markers into wikilinks:
 *
 * - a relation (`<span class="campaign-link">Ebbe</span>`) becomes `[[Ebbe]]`;
 * - a timeline source (`<a class="campaign-ref" data-ref="transcript.en#^u000556">01:42</a>`)
 *   becomes `[[transcript.en#^u000556|01:42]]`, the exact transcript line;
 * - a session block heading becomes `[[Session 00]]`.
 *
 * Wikilinks would be escaped by the converter, so they travel as placeholder words through it and
 * are put back in the Markdown. The stat block link (`@UUID[...]{name}`) is left to the
 * converter, which already points it at the mirrored NPC or the Library note.
 */

const PAGE_MARK = '<div class="campaign-page"';

export function isCampaignPageHtml(html: string): boolean {
  return html.trimStart().startsWith(PAGE_MARK);
}

function unescapeHtml(text: string): string {
  return text
    .replace(/&quot;/g, '"')
    .replace(/&gt;/g, '>')
    .replace(/&lt;/g, '<')
    .replace(/&amp;/g, '&');
}

/** A wikilink target must not hold the characters that end or split a link. */
function safeTarget(text: string): string {
  return unescapeHtml(text)
    .replace(/[[\]|]/g, ' ')
    .replace(/\s+/g, ' ')
    .trim();
}

export interface PreparedCampaignHtml {
  html: string;
  /** Put the wikilinks into the Markdown the converter made. */
  restore(markdown: string): string;
}

export function prepareCampaignHtml(html: string): PreparedCampaignHtml {
  const links: string[] = [];
  const token = (link: string): string => {
    links.push(link);
    return `CAMPAIGNLINK${links.length - 1}X`;
  };
  const out = html
    .replace(/<span class="campaign-link">([^<]*)<\/span>/g, (_m, name: string) =>
      token(`[[${safeTarget(name)}]]`)
    )
    .replace(
      /<a class="campaign-ref" data-ref="([^"]*)">([^<]*)<\/a>/g,
      (_m, ref: string, time: string) => {
        const target = safeTarget(ref);
        const label = safeTarget(time);
        return token(label && label !== target ? `[[${target}|${label}]]` : `[[${target}]]`);
      }
    )
    .replace(
      /<h4>([^<]*)<\/h4>/g,
      (_m, name: string) => `<h4>${token(`[[${safeTarget(name)}]]`)}</h4>`
    );
  return {
    html: out,
    restore: markdown =>
      markdown.replace(/CAMPAIGNLINK(\d+)X/g, (_m, n: string) => links[Number(n)] ?? ''),
  };
}
