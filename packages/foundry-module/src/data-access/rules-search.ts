/**
 * Full-text rules search (D&D helper, I-152): compendium JournalEntry pages and
 * Item descriptions, limited to an allowlist of packages so a rules question
 * never reaches adventure text. World journals and packs outside the allowlist
 * are searched only when the caller asks. Read-only.
 */

import { stripSecrets } from '../character-sheet-fields.js';
import { MODULE_ID } from '../constants.js';

/**
 * Searched when the `rulesSearchPacks` setting is empty: the PHB module, the dnd5e system
 * packs, and the rules packs of `aitool-content`, including its "Books" journals (the DMG 2024
 * and the other rulebooks; not its monsters, which hold adventure names).
 */
export const DEFAULT_RULES_PACKAGES = [
  'dnd-players-handbook',
  'dnd5e',
  ...['classes', 'species', 'backgrounds', 'feats', 'spells', 'items', 'journals'].map(
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
/** After a failed background rebuild, the stale index is served this long before the next try. */
const REFRESH_RETRY_MS = 60 * 1000;
/** A background rebuild that has not settled by then counts as failed, so one hung pack cannot stall the chain. */
const REFRESH_TIMEOUT_MS = 60 * 1000;

/** Rejects when the promise has not settled within ms; the timer is always cleared. */
function withTimeout<T>(promise: Promise<T>, ms: number, what: string): Promise<T> {
  let timer: ReturnType<typeof setTimeout> | undefined;
  const timeout = new Promise<never>((_, reject) => {
    timer = setTimeout(() => reject(new Error(`${what} timed out after ${ms} ms`)), ms);
  });
  return Promise.race([promise, timeout]).finally(() => clearTimeout(timer));
}

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

/** An item's description as a player sees it: an unidentified item shows only its unidentified text. */
export function itemDescription(doc: {
  system?: {
    identified?: boolean;
    description?: { value?: string };
    unidentified?: { description?: string };
  };
}): string {
  const s = doc.system;
  if (s?.identified === false) return s.unidentified?.description ?? '';
  return s?.description?.value ?? '';
}

/** HTML to plain text: tags out, entities decoded for the common few, blanks squeezed. */
export function plainText(html: unknown): string {
  if (typeof html !== 'string') return '';
  let text = html
    // Labelled enrichers keep their label; a bare roll keeps its command and arguments
    // ("[[/damage 2d6 fire]]" reads "damage 2d6 fire"); a bare reference keeps its name.
    .replace(/@UUID\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/\[\[[^\]]*\]\]\{([^}]*)\}/g, '$1')
    .replace(/\[\[\s*\/?(\w+)\s*([^\]]*)\]\]/g, '$1 $2')
    .replace(/&(?:amp;)?Reference\[[^\]]*\]\{([^}]*)\}/g, '$1')
    .replace(/&(?:amp;)?Reference\[([^\]=\s]+)[^\]]*\]/g, '$1')
    .replace(/@(?:UUID|Embed)\[[^\]]*\]/g, '')
    .replace(/<\/(p|div|li|h[1-6]|tr|td|th|br)>|<br\s*\/?>/gi, ' ');
  // Strip tags until none is left, so nested input like "<scr<script>ipt>" cannot rebuild one.
  let previous: string;
  do {
    previous = text;
    text = text.replace(/<[^>]*>/g, '');
  } while (text !== previous);
  return (
    text
      // &amp; last, so "&amp;lt;" stays the text "&lt;".
      .replace(/&nbsp;/g, ' ')
      // Comparison signs read as single angle quotes, so "AC &lt; 15" stays "AC ‹ 15" and the
      // bracket strip below never sees them.
      .replace(/&lt;/g, '‹')
      .replace(/&gt;/g, '›')
      .replace(/&quot;/g, '"')
      .replace(/&rsquo;/g, '’')
      .replace(/&#(x[0-9a-f]+|\d+);/gi, (whole, n: string) => {
        const code = n[0] === 'x' || n[0] === 'X' ? parseInt(n.slice(1), 16) : Number(n);
        if (code === 60) return '‹';
        if (code === 62) return '›';
        return code > 0 && code <= 0x10ffff ? String.fromCodePoint(code) : whole;
      })
      // After decoding: nested input like "<scr<script>ipt>" can leave a bracket, so none
      // survives (search text only; a literal "<" reads as a space).
      .replace(/[<>]/g, ' ')
      .replace(/&amp;/g, '&')
      .replace(/\s+/g, ' ')
      .trim()
  );
}

/** Lower-case search stem: "grappling", "grappled" and "grapples" all become "grappl". */
export function stem(word: string): string {
  const w = word.toLowerCase();
  if (w.length > 4 && w.endsWith('ies')) return `${w.slice(0, -3)}y`; // "allies" finds "ally"
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
  private cache = new Map<
    string,
    { at: number; entries: Promise<IndexedText[]>; refreshing?: boolean }
  >();

  /** Background rebuilds of stale packs run through this chain, one after another. */
  private refreshChain: Promise<void> = Promise.resolve();

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

    const packRank = (id: string | undefined): number => {
      const pkg = id?.split('.')[0] ?? '';
      const at = allowlist.findIndex(e => e === id || e === pkg);
      return at < 0 ? allowlist.length : at;
    };
    const hits = await this.rankHits(entries, terms, packRank, excerptChars);

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
            note: `No rules pack matched the configured list (${allowlist.join(', ')}). The list takes package names or pack ids such as dnd5e.rules, separated by commas.`,
          }
        : hits.length === 0 && !includeWorld && !includeOtherBooks
          ? {
              note: 'Nothing found in the rules packs. includeWorld also searches the world journals, which hold the imported adventure text (do not use it for a plain rules question); includeOtherBooks searches packs outside the allowlist.',
            }
          : {}),
    };
  }

  /**
   * Player search: the same ranking as `searchRules`, but over exactly the packs the caller
   * passes (already limited to the packs one player may observe; in Foundry 14 only the pack
   * controls access, its documents follow it). It never reads world journals, the allowlist
   * setting or any client flag. The text is indexed without GM secret blocks (a separate cache
   * entry from the GM's search). `entryAllowed` is an extra, harmless check on each candidate,
   * and the search stops at `limit` allowed hits.
   */
  async searchRulesScoped(params: ScopedSearchParams): Promise<ScopedSearchResult> {
    const query = typeof params?.query === 'string' ? params.query.trim() : '';
    if (query.length < 2) throw new Error('Search query must be at least 2 characters');
    const terms = queryTerms(query);
    if (terms.length === 0) {
      throw new Error(
        'Search query has no searchable words (only filler words like "how" or "the")'
      );
    }
    const limit = clampInt(params.limit, 5, 1, 10);
    const excerptChars = clampInt(params.excerptChars, SNIPPET_CHARS, 80, 600);
    const entries: IndexedText[] = [];
    const order = new Map<string, number>();
    for (const pack of params.packs) {
      const type: string | undefined = pack.documentName ?? pack.metadata?.type;
      if (type !== 'JournalEntry' && type !== 'Item') continue;
      const id: string = pack.metadata.id;
      try {
        entries.push(...(await this.indexPack(pack, id, type, true)));
        order.set(id, order.size);
      } catch (error) {
        console.warn(`${MODULE_ID} | rules search: skipping pack ${id}`, error);
      }
    }
    const hits = await this.rankHits(
      entries,
      terms,
      id => order.get(id ?? '') ?? order.size,
      excerptChars,
      params.entryAllowed,
      limit
    );
    return {
      query,
      results: hits.map(h => ({
        packId: h.packId,
        packLabel: h.packLabel,
        documentId: h.documentId,
        documentType: h.documentType,
        name: h.name,
        pageId: h.pageId,
        pageName: h.pageName,
        snippet: h.snippet,
      })),
      ...(hits.length === 0 ? { note: 'Nothing found in the books you can read.' } : {}),
    };
  }

  /** Score, order and de-duplicate the entries; `accept` filters a hit before it counts. */
  private async rankHits(
    entries: IndexedText[],
    terms: string[],
    packRank: (id: string | undefined) => number,
    excerptChars: number,
    accept?: (hit: RulesSearchHit) => Promise<boolean>,
    max = Infinity
  ): Promise<RulesSearchHit[]> {
    const needed = terms.length <= 2 ? terms.length : Math.ceil(terms.length / 2);
    // Rare terms count more than common ones ("grappl" beats "action").
    const patterns = terms.map(termPattern);
    const presence = entries.map(entry => termPresence(entry, terms, patterns));
    const weights = terms.map((_, i) => {
      const df = presence.filter(p => p[i] !== 'none').length;
      return Math.log(1 + entries.length / Math.max(df, 1));
    });
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
      if (hits.length >= max) break;
      const entry = entries[i];
      const scored = scores[i];
      if (scored.matched < needed) continue;
      // The PHB and the SRD 5.2 carry the same page: list it once, from the first pack.
      const key = `${entry.pageName ?? entry.name}|${entry.text.slice(0, 120)}`;
      if (seen.has(key)) continue;
      const hit: RulesSearchHit = {
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
      };
      // A hit the caller may not read must not hide a readable duplicate, so it is not recorded.
      if (accept && !(await accept(hit))) continue;
      seen.add(key);
      hits.push(hit);
    }
    return hits;
  }

  /**
   * One build per pack, shared by searches that start together. After CACHE_TTL_MS the old index
   * is still served while one background rebuild runs, so no search waits for a whole pack
   * (a cold build can pass the dashboard's 15 s timeout).
   */
  private indexPack(
    pack: PackLike,
    id: string,
    type: string,
    forPlayer = false
  ): Promise<IndexedText[]> {
    // A player's index has the GM secret blocks removed and lives under its own cache key.
    const cacheKey = forPlayer ? `player:${id}` : id;
    const cached = this.cache.get(cacheKey);
    if (cached) {
      if (Date.now() - cached.at >= CACHE_TTL_MS && !cached.refreshing) {
        cached.refreshing = true;
        // One pack at a time, so the rebuilds never load every pack at once during play.
        this.refreshChain = this.refreshChain.then(() =>
          withTimeout(
            this.buildPackIndex(pack, id, type, forPlayer),
            REFRESH_TIMEOUT_MS,
            `refresh of ${id}`
          ).then(
            fresh => {
              this.cache.set(cacheKey, { at: Date.now(), entries: Promise.resolve(fresh) });
            },
            error => {
              console.warn(`${MODULE_ID} | rules search: refresh of ${id} failed`, error);
              cached.refreshing = false;
              cached.at = Date.now() - CACHE_TTL_MS + REFRESH_RETRY_MS;
            }
          )
        );
      }
      return cached.entries;
    }
    const entries = this.buildPackIndex(pack, id, type, forPlayer);
    this.cache.set(cacheKey, { at: Date.now(), entries });
    entries.catch(() => this.cache.delete(cacheKey));
    return entries;
  }

  private async buildPackIndex(
    pack: PackLike,
    id: string,
    type: string,
    forPlayer = false
  ): Promise<IndexedText[]> {
    const out: IndexedText[] = [];
    const label: string = pack.metadata?.label ?? id;
    const docs = await pack.getDocuments();
    const clean = (html: unknown): string =>
      plainText(forPlayer && typeof html === 'string' ? stripSecrets(html) : html);
    for (const doc of docs) {
      if (type === 'Item') {
        const text = clean(forPlayer ? itemDescription(doc) : doc.system?.description?.value);
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
        const text = clean(page.text?.content);
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
  const escape = (text: string): string => text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
  if (term.length >= 3 && term.endsWith('y')) {
    // "ally" finds "allies" (see `stem`): the y ending is the plural pair, not a suffix to strip.
    const root = escape(term.slice(0, -1));
    return new RegExp(short ? `\\b${root}(?:y|ys|ying|ied|ies)\\b` : `\\b${root}(?:y|ie)`, 'i');
  }
  const base = short && !term.endsWith('ss') ? term.replace(/(ing|ed|es|e|s)$/, '') : term;
  // A stripped short term needs one of the endings back ("cone" finds cone and cones, not "Con"),
  // unless only a plural s came off a word of three letters or more ("hits" still finds "hit").
  const pluralOnly = term.endsWith('s') && !term.endsWith('es') && base === term.slice(0, -1);
  const stripped = short && base !== term && base.length >= 2 && !(pluralOnly && base.length >= 3);
  const escaped = escape(base.length >= 2 ? base : term);
  return new RegExp(
    short ? `\\b${escaped}(?:ing|ed|es|e|s)${stripped ? '' : '?'}\\b` : `\\b${escaped}`,
    'i'
  );
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
export interface PageLike {
  id: string;
  name?: string;
  text?: { content?: string };
  testUserPermission?(user: unknown, level: string): boolean;
}
export interface DocLike {
  id: string;
  name?: string;
  type?: string;
  system?: {
    identified?: boolean;
    description?: { value?: string };
    unidentified?: { description?: string };
  };
  pages?: Iterable<PageLike>;
  testUserPermission?(user: unknown, level: string): boolean;
}
export interface PackLike {
  documentName?: string;
  collection?: string;
  metadata: {
    id: string;
    label?: string;
    packageName?: string;
    type?: string;
    packageType?: string;
  };
  getDocuments(): Promise<DocLike[]>;
  getDocument?(id: string): Promise<DocLike | null | undefined>;
  getIndex?(options?: { fields?: string[] }): Promise<Iterable<IndexRow>>;
  index?: Iterable<IndexRow>;
  testUserPermission?(user: unknown, level: string): boolean;
}
export interface IndexRow {
  _id?: string;
  id?: string;
  name?: string;
  type?: string;
}

export interface ScopedSearchParams {
  query: string;
  limit?: number;
  excerptChars?: number;
  /** Already filtered to the packs one player may read. */
  packs: PackLike[];
  /** Per-entry permission check; a hit that fails it is dropped. */
  entryAllowed: (hit: RulesSearchHit) => Promise<boolean>;
}

export interface ScopedSearchResult {
  query: string;
  results: Array<{
    packId?: string | undefined;
    packLabel?: string | undefined;
    documentId: string;
    documentType: string;
    name: string;
    pageId?: string | undefined;
    pageName?: string | undefined;
    snippet: string;
  }>;
  note?: string;
}
