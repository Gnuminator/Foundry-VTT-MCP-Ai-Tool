/**
 * Tarokka, module side. Read-only: this file never writes world data. The reading is stored by
 * the backend in its vault through the guarded plan/apply flow, and the card table
 * (tarokka-table-window.ts) shows it at the table. The community module `tarokka-reading` is no
 * longer read here (D-130: our own table replaces it).
 *
 * What is left is the search for documents a card can be linked to; the GM confirms every link.
 * Nothing here contains adventure text.
 */

export const TAROKKA_FEATURE_ID = 'tarokka';

// ---------------------------------------------------------------------------
// Link candidates (the GM confirms; no card meanings are known here)
// ---------------------------------------------------------------------------

export interface LinkCandidate {
  uuid: string;
  documentName: 'JournalEntryPage' | 'JournalEntry' | 'Scene' | 'Actor';
  name: string;
  parentName?: string;
  /** Set when the match is a heading inside the page: the heading text and its anchor slug. */
  heading?: string;
  anchor?: string;
}

const NAMED_ENTITIES: Record<string, string> = {
  amp: '&',
  lt: '<',
  gt: '>',
  quot: '"',
  apos: "'",
  nbsp: ' ',
};

/** Tags removed until none is left (the text is only matched and slugged, never rendered). */
function stripTags(html: string): string {
  let out = html;
  for (let prev = ''; prev !== out; ) {
    prev = out;
    out = out.replace(/<[^<>]*>/g, '');
  }
  return out;
}

function decodeEntities(text: string): string {
  return text.replace(
    /&(?:#(\d{1,7})|#x([0-9a-f]{1,6})|([a-z]+));/gi,
    (whole: string, dec: string | undefined, hex: string | undefined, name: string | undefined) => {
      if (name) return NAMED_ENTITIES[name.toLowerCase()] ?? whole;
      const code = dec ? Number(dec) : parseInt(hex ?? '', 16);
      return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
    }
  );
}

/**
 * Headings (h1 to h6) in page HTML with the anchor slugs of `JournalEntryPage#toc`: Foundry's
 * `slugify` (when the page runs in Foundry), quotes removed, 64 characters, an own `id` wins, a
 * repeat gets `$1`, `$2`. Headings marked `data-no-toc` are skipped.
 */
export function pageHeadings(html: string): Array<{ text: string; slug: string }> {
  const out: Array<{ text: string; slug: string }> = [];
  const used = new Set<string>();
  for (const m of html.matchAll(/<h([1-6])\b([^>]*)>([\s\S]*?)<\/h\1>/gi)) {
    if (/\bdata-no-toc\b/i.test(m[2])) continue;
    const text = decodeEntities(stripTags(m[3])).replace(/\s+/g, ' ').trim();
    if (!text) continue;
    const id = /\bid\s*=\s*(?:"([^"]*)"|'([^']*)')/i.exec(m[2]);
    const own = id?.[1] ?? id?.[2];
    const slugify = (text as unknown as { slugify?: () => string }).slugify;
    const plain =
      typeof slugify === 'function'
        ? slugify.call(text)
        : text
            .replace(/&/g, 'and')
            .trim()
            .toLowerCase()
            .replace(/[\s-]+/g, '-');
    let slug = own || plain.replace(/["']/g, '').substring(0, 64);
    if (used.has(slug)) {
      let i = 1;
      while (used.has(`${slug}$${i}`)) i++;
      slug = `${slug}$${i}`;
    }
    used.add(slug);
    out.push({ text, slug });
  }
  return out;
}

/**
 * World journal pages, journals, scenes and actors whose name contains `query`, plus journal
 * pages with a heading that contains it (`heading` and `anchor` set; the anchor is information for
 * the GM, the link itself is still the page uuid).
 */
export function searchLinkCandidates(data: { query?: unknown; limit?: unknown } | undefined): {
  query: string;
  candidates: LinkCandidate[];
} {
  const query = typeof data?.query === 'string' ? data.query.trim() : '';
  if (query.length < 2 || query.length > 100) {
    throw new Error('query must be 2 to 100 characters');
  }
  const limit = Math.min(Math.max(Number(data?.limit) || 20, 1), 50);
  const needle = query.toLowerCase();
  const matches = (name: unknown): name is string =>
    typeof name === 'string' && name.toLowerCase().includes(needle);
  const out: LinkCandidate[] = [];
  const push = (c: LinkCandidate): boolean => {
    out.push(c);
    return out.length >= limit;
  };

  for (const entry of game.journal.contents) {
    if (
      matches(entry.name) &&
      push({ uuid: entry.uuid, documentName: 'JournalEntry', name: entry.name })
    ) {
      break;
    }
    let full = false;
    for (const page of entry.pages?.contents ?? []) {
      if (!matches(page.name)) continue;
      full = push({
        uuid: page.uuid,
        documentName: 'JournalEntryPage',
        name: page.name ?? '',
        parentName: entry.name,
      });
      if (full) break;
    }
    // NPCs often live only as a heading inside a page: listed after the title matches.
    for (const page of full ? [] : (entry.pages?.contents ?? [])) {
      const html = page.type === 'text' ? page.text?.content : undefined;
      if (typeof html !== 'string' || matches(page.name)) continue;
      for (const h of pageHeadings(html)) {
        if (!matches(h.text)) continue;
        full = push({
          uuid: page.uuid,
          documentName: 'JournalEntryPage',
          name: page.name ?? '',
          parentName: entry.name,
          heading: h.text,
          anchor: h.slug,
        });
        if (full) break;
      }
      if (full) break;
    }
    if (full) break;
  }
  for (const scene of out.length < limit ? game.scenes.contents : []) {
    if (
      matches(scene.name) &&
      push({ uuid: scene.uuid, documentName: 'Scene', name: scene.name })
    ) {
      break;
    }
  }
  for (const actor of out.length < limit ? game.actors.contents : []) {
    if (
      matches(actor.name) &&
      push({ uuid: actor.uuid, documentName: 'Actor', name: actor.name })
    ) {
      break;
    }
  }
  return { query, candidates: out };
}
