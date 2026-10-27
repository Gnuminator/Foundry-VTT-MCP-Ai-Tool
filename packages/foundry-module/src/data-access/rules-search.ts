/**
 * Full-text rules search (D&D helper, I-152): compendium JournalEntry pages and
 * Item descriptions, limited to an allowlist of packages so a rules question
 * never reaches adventure text. World journals and packs outside the allowlist
 * are searched only when the caller asks. Read-only.
 */

import { MODULE_ID } from '../constants.js';

/**
 * Searched when the `rulesSearchPacks` setting is empty: the PHB module, the dnd5e system
 * packs, and the rules packs of `aitool-content` (not its journals or monsters, which hold
 * adventure names).
 */
export const DEFAULT_RULES_PACKAGES = [
  'dnd-players-handbook',
  'dnd5e',
  ...['classes', 'species', 'backgrounds', 'feats', 'spells', 'items'].map(
    p => `aitool-content.${p}`
  ),
];

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
const MAX_EXCERPT = 4000;
const CACHE_TTL_MS = 10 * 60 * 1000;

/** A number from the wire, clamped; a missing or non-numeric value gives the fallback. */
function clampInt(value: unknown, fallback: number, min: number, max: number): number {
  const n = typeof value === 'number' && Number.isFinite(value) ? Math.floor(value) : fallback;
  return Math.min(Math.max(n, min), max);
}
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
  /** Packs that failed to load; their text is missing from the results. */
  skippedPacks?: string[];
  includeWorld: boolean;
  includeOtherBooks: boolean;
  note?: string;
}

export interface RulesSearchParams {
  query: string;
  limit?: number;
  /** Also search world journals (an imported adventure lives there). */
  includeWorld?: boolean;
  /** Length of each hit's text excerpt (default 240); raise it to read a rule without opening the journal. */
  excerptChars?: number;
  /** Also search compendium packs that are not on the allowlist. */
  includeOtherBooks?: boolean;
}

/** HTML to plain text: tags out, entities decoded for the common few, blanks squeezed. */
export function plainText(html: unknown): string {
  if (typeof html !== 'string') return '';
  return (
    html
      // Labelled enrichers keep their label; a bare roll keeps its command and arguments
      // ("[[/damage 2d6 fire]]" reads "damage 2d6 fire"); a bare reference keeps its name.
      .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
      .replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, '$1')
      .replace(/\[\[\s*\/?(\w+)\s*([^\]]*)\]\]/g, '$1 $2')
      .replace(/&(?:amp;)?Reference\[[^\]]*\]\{([^}]*)\}/g, '$1')
      .replace(/&(?:amp;)?Reference\[([^\]=\s]+)[^\]]*\]/g, '$1')
      .replace(/@(?:UUID|Embed)\[[^\]]*\]/g, '')
      .replace(/<\/(p|div|li|h[1-6]|tr|td|th|br)>|<br\s*\/?>/gi, ' ')
      .replace(/<[^>]*>/g, '')
      // Nested input like "<scr<script>ipt>" leaves a stray bracket: no tag survives.
      .replace(/[<>]/g, ' ')
      // &amp; last, so "&amp;lt;" stays the text "&lt;".
      .replace(/&nbsp;/g, ' ')
      .replace(/&lt;/g, '<')
      .replace(/&gt;/g, '>')
      .replace(/&quot;/g, '"')
      .replace(/&rsquo;/g, '’')
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, n: string) => {
        const code = n[0] === 'x' || n[0] === 'X' ? parseInt(n.slice(1), 16) : Number(n);
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      })
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Lower-case search stem: "grappling", "grappled" and "grapples" all become "grappl". */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.endsWith('ss')) return w; // "bless", "class": no plural s to drop
  const stripped = w.replace(/(ing|ed|es|e|s)$/, '');
  if (stripped.length >= 4) return stripped;
  // "saves" would lose too much; drop only the plural s so it still finds "save".
  return w.length > 4 && w.endsWith('s') ? w.slice(0, -1) : w;
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
  /** Per-pack text, built on first use (a pack can change when an importer writes to it). */
  private cache = new Map<string, { at: number; entries: Promise<IndexedText[]> }>();

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
    const limit = clampInt(params.limit, 10, 1, MAX_LIMIT);
    const excerptChars = clampInt(params.excerptChars, SNIPPET_CHARS, 80, MAX_EXCERPT);
    const includeWorld = params.includeWorld === true;
    const includeOtherBooks = params.includeOtherBooks === true;

    const allowlist = parseAllowlist(game.settings.get(MODULE_ID, RULES_SEARCH_SETTING));
    const searchedPacks: string[] = [];
    const skippedPacks: string[] = [];
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
        skippedPacks.push(id);
      }
    }

    if (includeWorld) {
      entries.push(...this.indexWorldJournals());
      searchedPacks.push('world journals');
    }

    const needed = terms.length <= 2 ? terms.length : Math.ceil(terms.length / 2);
    // Rare terms count more than common ones ("grappl" beats "action").
    const patterns = terms.map(termPattern);
    const presence = entries.map(entry => termPresence(entry, terms, patterns));
    const weights = terms.map((_, i) => {
      const df = presence.filter(p => p[i] !== 'none').length;
      return Math.log(1 + entries.length / Math.max(df, 1));
    });
    const packRank = (id: string | undefined): number => {
      const pkg = id?.split('.')[0] ?? '';
      const at = allowlist.findIndex(e => e === id || e === pkg);
      return at < 0 ? allowlist.length : at;
    };
    const seen = new Set<string>();
    const hits: RulesSearchHit[] = [];
    const order = entries.map((_, i) => i);
    const scores = order.map(i => scoreEntry(entries[i], terms, patterns, presence[i], weights));
    order.sort(
      (a, b) =>
        scores[b].score - scores[a].score ||
        packRank(entries[a].packId) - packRank(entries[b].packId)
    );
    for (const i of order) {
      const entry = entries[i];
      const scored = scores[i];
      if (scored.matched < needed) continue;
      // The PHB and the SRD 5.2 carry the same page: list it once, from the first pack.
      const key = `${entry.pageName ?? entry.name}|${entry.text.slice(0, 120)}`;
      if (seen.has(key)) continue;
      seen.add(key);
      hits.push({
        source: entry.source,
        packId: entry.packId,
        packLabel: entry.packLabel,
        documentId: entry.documentId,
        documentType: entry.documentType,
        name: entry.name,
        pageId: entry.pageId,
        pageName: entry.pageName,
        snippet: snippetAround(entry.text, scored.firstIndex, excerptChars),
        score: scored.score,
        readWith:
          entry.source === 'world'
            ? 'list-journals (journalId, pageId)'
            : 'get-compendium-item (packId, itemId=documentId)',
      });
    }

    return {
      query,
      terms,
      results: hits.slice(0, limit),
      totalMatches: hits.length,
      searchedPacks,
      ...(skippedPacks.length > 0 ? { skippedPacks } : {}),
      includeWorld,
      includeOtherBooks,
      ...(searchedPacks.length === 0 && skippedPacks.length === 0 && !includeWorld
        ? {
            note: `No pack matches the "Rules search packs" setting (${allowlist.join(', ')}). Use package names or pack ids such as dnd5e.rules, separated by commas.`,
          }
        : hits.length === 0 && !includeWorld && !includeOtherBooks
          ? {
              note: 'Nothing found in the rules packs. includeWorld also searches world journals, which can hold adventure text; includeOtherBooks searches packs outside the allowlist.',
            }
          : {}),
    };
  }

  /** One build per pack, shared by searches that start together; kept for CACHE_TTL_MS. */
  private indexPack(pack: PackLike, id: string, type: string): Promise<IndexedText[]> {
    const cached = this.cache.get(id);
    if (cached && Date.now() - cached.at < CACHE_TTL_MS) return cached.entries;
    const entries = this.buildPackIndex(pack, id, type);
    this.cache.set(id, { at: Date.now(), entries });
    entries.catch(() => this.cache.delete(id));
    return entries;
  }

  private async buildPackIndex(pack: PackLike, id: string, type: string): Promise<IndexedText[]> {
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

type Presence = 'none' | 'body' | 'title';

/** Per term: in the page or journal title, only in the text, or absent. */
function termPresence(entry: IndexedText, terms: string[], patterns: RegExp[]): Presence[] {
  const title = `${entry.name} ${entry.pageName ?? ''}`;
  return terms.map((_, i) =>
    patterns[i].test(title) ? 'title' : patterns[i].test(entry.text) ? 'body' : 'none'
  );
}

/**
 * A term matches at the start of a word ("grappl" finds "grappling"), never inside one
 * ("rest" not "forest"); a short term ("ac", "dc", "help") must be the whole word, with the
 * endings `stem` removes ("pron" finds "prone", "sav" finds "saves" and "saving").
 */
export function termPattern(term: string): RegExp {
  const short = term.length < 5;
  const base = short && !term.endsWith('ss') ? term.replace(/(ing|ed|es|e|s)$/, '') : term;
  const escaped = (base.length >= 2 ? base : term).replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  return new RegExp(short ? `\\b${escaped}(?:ing|ed|es|e|s)?\\b` : `\\b${escaped}`, 'i');
}

function scoreEntry(
  entry: IndexedText,
  terms: string[],
  patterns: RegExp[],
  presence: Presence[],
  weights: number[]
): { matched: number; score: number; firstIndex: number } {
  let matched = 0;
  let score = 0;
  let firstIndex = -1;
  terms.forEach((_, i) => {
    if (presence[i] === 'none') return;
    matched += 1;
    const at = entry.text.search(patterns[i]);
    const tf = at >= 0 ? 1 + Math.min(countOccurrences(entry.text, patterns[i]), 5) / 5 : 0;
    score += weights[i] * ((presence[i] === 'title' ? 4 : 0) + tf);
    if (at >= 0 && (firstIndex < 0 || at < firstIndex)) firstIndex = at;
  });
  // A short page that matches is a better answer than a long chapter that mentions it.
  const density = Math.min(1, 1500 / Math.max(entry.text.length, 1));
  return { matched, score: Math.round(score * (0.6 + 0.4 * density) * 10) / 10, firstIndex };
}

function countOccurrences(haystack: string, pattern: RegExp): number {
  return haystack.match(new RegExp(pattern.source, 'gi'))?.length ?? 0;
}

function snippetAround(text: string, index: number, chars: number): string {
  if (text.length <= chars) return text;
  // A long excerpt starts at the top of the page when the match is near it.
  const lead = chars > 1000 ? 200 : 60;
  const start = Math.max(0, (index < 0 ? 0 : index) - lead);
  const end = Math.min(text.length, start + chars);
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
