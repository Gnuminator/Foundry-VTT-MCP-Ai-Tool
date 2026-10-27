/**
 * Full-text rules search (D&D helper, I-152): compendium JournalEntry pages and
 * Item descriptions, limited to an allowlist of packages so a rules question
 * never reaches adventure text. World journals and packs outside the allowlist
 * are searched only when the caller asks. Read-only.
 */

import { MODULE_ID } from '../constants.js';

/** Package names searched when the `rulesSearchPacks` setting is empty. */
export const DEFAULT_RULES_PACKAGES = ['dnd-players-handbook', 'aitool-content', 'dnd5e'];

export const RULES_SEARCH_SETTING = 'rulesSearchPacks';

/** Words that carry no rules meaning in a question like "how does grappling work". */
const STOP_WORDS = new Set([
  'a',
  'an',
  'and',
  'are',
  'as',
  'at',
  'be',
  'by',
  'can',
  'do',
  'does',
  'for',
  'from',
  'how',
  'i',
  'if',
  'in',
  'is',
  'it',
  'my',
  'of',
  'on',
  'or',
  'rule',
  'rules',
  'the',
  'to',
  'what',
  'when',
  'where',
  'while',
  'with',
  'work',
  'works',
]);

const SNIPPET_CHARS = 240;
const MAX_LIMIT = 25;

interface IndexedText {
  source: 'compendium' | 'world';
  packId?: string | undefined;
  packLabel?: string | undefined;
  documentId: string;
  documentType: string;
  name: string;
  pageId?: string | undefined;
  pageName?: string | undefined;
  /** Plain text of the page or item description. */
  text: string;
}

export interface RulesSearchHit {
  source: 'compendium' | 'world';
  packId?: string | undefined;
  packLabel?: string | undefined;
  documentId: string;
  documentType: string;
  name: string;
  pageId?: string | undefined;
  pageName?: string | undefined;
  snippet: string;
  score: number;
  /** The existing reader that returns the full text. */
  readWith: string;
}

export interface RulesSearchResult {
  query: string;
  terms: string[];
  results: RulesSearchHit[];
  totalMatches: number;
  searchedPacks: string[];
  includeWorld: boolean;
  includeOtherBooks: boolean;
  note?: string;
}

export interface RulesSearchParams {
  query: string;
  limit?: number;
  /** Also search world journals (an imported adventure lives there). */
  includeWorld?: boolean;
  /** Also search compendium packs that are not on the allowlist. */
  includeOtherBooks?: boolean;
}

/** HTML to plain text: tags out, entities decoded for the common few, blanks squeezed. */
export function plainText(html: unknown): string {
  if (typeof html !== 'string') return '';
  return html
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, '$1')
    .replace(/<\/(p|div|li|h[1-6]|tr|br)>|<br\s*\/?>/gi, ' ')
    .replace(/<[^>]*>/g, '')
    .replace(/&nbsp;/g, ' ')
    .replace(/&amp;/g, '&')
    .replace(/&lt;/g, '<')
    .replace(/&gt;/g, '>')
    .replace(/&quot;/g, '"')
    .replace(/&#39;|&rsquo;/g, "'")
    .replace(/\s+/g, ' ')
    .trim();
}

/** Lower-case search stem: "grappling", "grappled" and "grapples" all become "grappl". */
export function stem(word: string): string {
  const w = word.toLowerCase();
  const stripped = w.replace(/(ing|ed|es|e|s)$/, '');
  return stripped.length >= 4 ? stripped : w;
}

export function queryTerms(query: string): string[] {
  const words = query
    .toLowerCase()
    .split(/[^a-z0-9']+/)
    .filter(w => w.length > 1 && !STOP_WORDS.has(w));
  return [...new Set(words.map(stem))];
}

/** Allowlist entries are package names ("dnd5e") or full pack ids ("dnd5e.rules"). */
export function parseAllowlist(raw: unknown): string[] {
  if (typeof raw !== 'string') return DEFAULT_RULES_PACKAGES;
  const entries = raw
    .split(/[\s,;]+/)
    .map(e => e.trim())
    .filter(Boolean);
  return entries.length > 0 ? entries : DEFAULT_RULES_PACKAGES;
}

function isAllowed(pack: PackLike, allowlist: string[]): boolean {
  const id: string = pack.metadata?.id ?? pack.collection ?? '';
  const pkg: string = pack.metadata?.packageName ?? id.split('.')[0] ?? '';
  return allowlist.includes(id) || allowlist.includes(pkg);
}

export class RulesSearchDataAccess {
  /** Per-pack text, built on first use. A pack changes only on a module update. */
  private cache = new Map<string, IndexedText[]>();

  clearCache(): void {
    this.cache.clear();
  }

  async searchRules(params: RulesSearchParams): Promise<RulesSearchResult> {
    const query = typeof params?.query === 'string' ? params.query.trim() : '';
    if (query.length < 2) throw new Error('Search query must be at least 2 characters');
    const terms = queryTerms(query);
    if (terms.length === 0) {
      throw new Error(
        'Search query has no searchable words (only filler words like "how" or "the")'
      );
    }
    const limit = Math.min(Math.max(Math.floor(params.limit ?? 10), 1), MAX_LIMIT);
    const includeWorld = params.includeWorld === true;
    const includeOtherBooks = params.includeOtherBooks === true;

    const allowlist = parseAllowlist(game.settings.get(MODULE_ID, RULES_SEARCH_SETTING));
    const searchedPacks: string[] = [];
    const entries: IndexedText[] = [];

    for (const pack of game.packs as unknown as Iterable<PackLike>) {
      const type: string | undefined = pack.documentName ?? pack.metadata?.type;
      if (type !== 'JournalEntry' && type !== 'Item') continue;
      if (!includeOtherBooks && !isAllowed(pack, allowlist)) continue;
      const id: string = pack.metadata.id;
      try {
        entries.push(...(await this.indexPack(pack, id, type)));
        searchedPacks.push(id);
      } catch (error) {
        console.warn(`${MODULE_ID} | rules search: skipping pack ${id}`, error);
      }
    }

    if (includeWorld) {
      entries.push(...this.indexWorldJournals());
      searchedPacks.push('world journals');
    }

    const needed = terms.length <= 2 ? terms.length : Math.ceil(terms.length / 2);
    const hits: RulesSearchHit[] = [];
    for (const entry of entries) {
      const scored = scoreEntry(entry, terms);
      if (scored.matched < needed) continue;
      hits.push({
        source: entry.source,
        packId: entry.packId,
        packLabel: entry.packLabel,
        documentId: entry.documentId,
        documentType: entry.documentType,
        name: entry.name,
        pageId: entry.pageId,
        pageName: entry.pageName,
        snippet: snippetAround(entry.text, scored.firstIndex),
        score: scored.score,
        readWith:
          entry.source === 'world'
            ? 'list-journals (journalId, pageId)'
            : 'get-compendium-item (packId, itemId=documentId)',
      });
    }
    hits.sort((a, b) => b.score - a.score || a.name.localeCompare(b.name));

    return {
      query,
      terms,
      results: hits.slice(0, limit),
      totalMatches: hits.length,
      searchedPacks,
      includeWorld,
      includeOtherBooks,
      ...(hits.length === 0 && !includeWorld && !includeOtherBooks
        ? {
            note: 'Nothing found in the rules packs. Adventure text and world journals are only searched with includeWorld or includeOtherBooks.',
          }
        : {}),
    };
  }

  private async indexPack(pack: PackLike, id: string, type: string): Promise<IndexedText[]> {
    const cached = this.cache.get(id);
    if (cached) return cached;
    const out: IndexedText[] = [];
    const label: string = pack.metadata?.label ?? id;
    const docs = await pack.getDocuments();
    for (const doc of docs) {
      if (type === 'Item') {
        const text = plainText(doc.system?.description?.value);
        if (text) {
          out.push({
            source: 'compendium',
            packId: id,
            packLabel: label,
            documentId: doc.id,
            documentType: doc.type ?? 'Item',
            name: doc.name ?? '',
            text,
          });
        }
        continue;
      }
      for (const page of doc.pages ?? []) {
        const text = plainText(page.text?.content);
        if (!text) continue;
        out.push({
          source: 'compendium',
          packId: id,
          packLabel: label,
          documentId: doc.id,
          documentType: 'JournalEntry',
          name: doc.name ?? '',
          pageId: page.id,
          pageName: page.name ?? '',
          text,
        });
      }
    }
    this.cache.set(id, out);
    return out;
  }

  private indexWorldJournals(): IndexedText[] {
    const out: IndexedText[] = [];
    for (const journal of game.journal as unknown as Iterable<DocLike>) {
      for (const page of journal.pages ?? []) {
        const text = plainText(page.text?.content);
        if (!text) continue;
        out.push({
          source: 'world',
          documentId: journal.id,
          documentType: 'JournalEntry',
          name: journal.name ?? '',
          pageId: page.id,
          pageName: page.name ?? '',
          text,
        });
      }
    }
    return out;
  }
}

function scoreEntry(
  entry: IndexedText,
  terms: string[]
): { matched: number; score: number; firstIndex: number } {
  const title = `${entry.name} ${entry.pageName ?? ''}`.toLowerCase();
  const body = entry.text.toLowerCase();
  let matched = 0;
  let score = 0;
  let firstIndex = -1;
  for (const term of terms) {
    const inTitle = title.includes(term);
    const at = body.indexOf(term);
    if (!inTitle && at < 0) continue;
    matched += 1;
    if (inTitle) score += 20;
    if (at >= 0) {
      score += 1 + Math.min(countOccurrences(body, term), 5);
      if (firstIndex < 0 || at < firstIndex) firstIndex = at;
    }
  }
  return { matched, score: score + matched * 10, firstIndex };
}

function countOccurrences(haystack: string, needle: string): number {
  let count = 0;
  let from = 0;
  while ((from = haystack.indexOf(needle, from)) >= 0) {
    count += 1;
    from += needle.length;
  }
  return count;
}

function snippetAround(text: string, index: number): string {
  if (text.length <= SNIPPET_CHARS) return text;
  const start = Math.max(0, (index < 0 ? 0 : index) - 60);
  const end = Math.min(text.length, start + SNIPPET_CHARS);
  return `${start > 0 ? '...' : ''}${text.slice(start, end).trim()}${end < text.length ? '...' : ''}`;
}

/** The few fields of a Foundry document and compendium pack this search reads. */
interface PageLike {
  id: string;
  name?: string;
  text?: { content?: string };
}
interface DocLike {
  id: string;
  name?: string;
  type?: string;
  system?: { description?: { value?: string } };
  pages?: Iterable<PageLike>;
}
interface PackLike {
  documentName?: string;
  collection?: string;
  metadata: { id: string; label?: string; packageName?: string; type?: string };
  getDocuments(): Promise<DocLike[]>;
}
