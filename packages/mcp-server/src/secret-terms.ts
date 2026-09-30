/**
 * Secret-term detection (plan feature 2, M2): lets a caller (the dashboard's
 * "whisper to chat" guard) check free text against known secret terms before
 * it reaches Foundry, where every client can read a whisper.
 *
 * Term sources are a small registry (`SecretTermSource[]`) so later features
 * (attention, NPC true names, ...) can contribute their own terms without
 * changing the matching logic. The only source today is the current Tarokka
 * reading: the dealt cards' names and the GM's name overrides for them,
 * reusing the Tarokka vault file constants instead of re-parsing the files.
 */
import { TAROKKA_POSITIONS } from './tarokka/deck.js';
import { TAROKKA_CONFIG_FILE, TAROKKA_FILE, type StoredReading } from './tarokka/service.js';
import type { VaultStore } from './vault/store.js';

const MIN_TERM_LENGTH = 3;

export interface SecretTermMatch {
  category: string;
  term: string;
}

/** One source of secret terms: a category label and its current terms. */
export interface SecretTermSource {
  category: string;
  terms(worldId: string): Promise<string[]>;
}

interface TarokkaFileShape {
  current?: StoredReading;
}

interface TarokkaConfigShape {
  cardNames?: Record<string, string>;
}

/** A `current` reading with every position filled (matches TarokkaService's own check). */
function isUsableReading(current: StoredReading | undefined): current is StoredReading {
  if (!current || typeof current !== 'object') return false;
  return TAROKKA_POSITIONS.every(
    position => typeof current.positions?.[position]?.cardId === 'string'
  );
}

/** The current Tarokka reading's dealt card names, plus the GM's overrides for those cards. */
export function tarokkaCardNameSource(store: Pick<VaultStore, 'read'>): SecretTermSource {
  return {
    category: 'tarokka-card',
    async terms(worldId: string): Promise<string[]> {
      const [reading, config] = await Promise.all([
        store.read<TarokkaFileShape>(worldId, 'gm', TAROKKA_FILE),
        store.read<TarokkaConfigShape>(worldId, 'gm', TAROKKA_CONFIG_FILE),
      ]);
      const current = reading?.data?.current;
      if (!isUsableReading(current)) return [];
      const cardNames = config?.data?.cardNames ?? {};
      const found: string[] = [];
      for (const position of TAROKKA_POSITIONS) {
        const stored = current.positions[position];
        if (stored.cardName) found.push(stored.cardName);
        const override = cardNames[stored.cardId];
        if (typeof override === 'string' && override) found.push(override);
      }
      return found;
    },
  };
}

function escapeRegExp(text: string): string {
  return text.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

export interface SecretTermsServiceOptions {
  store: Pick<VaultStore, 'read'>;
  /** Overrides the default registry (tests, or a later feature composing its own). */
  sources?: readonly SecretTermSource[];
}

export class SecretTermsService {
  private readonly sources: readonly SecretTermSource[];

  constructor(options: SecretTermsServiceOptions) {
    this.sources = options.sources ?? [tarokkaCardNameSource(options.store)];
  }

  /** Whole-phrase, case-insensitive matches of any registered term in `text`. */
  async findSecretTerms(worldId: string, text: string): Promise<{ matches: SecretTermMatch[] }> {
    const [matches = []] = await this.findSecretTermsInMany(worldId, [text]);
    return { matches };
  }

  /** `findSecretTerms` for many texts, reading the terms once; one match list per text. */
  async findSecretTermsInMany(
    worldId: string,
    texts: readonly string[]
  ): Promise<SecretTermMatch[][]> {
    const patterns: Array<{ category: string; term: string; pattern: RegExp }> = [];
    for (const source of this.sources) {
      for (const raw of await source.terms(worldId)) {
        const term = raw.trim();
        if (term.length < MIN_TERM_LENGTH) continue;
        patterns.push({
          category: source.category,
          term,
          pattern: new RegExp(`\\b${escapeRegExp(term)}\\b`, 'i'),
        });
      }
    }
    return texts.map(text =>
      patterns.filter(p => p.pattern.test(text)).map(({ category, term }) => ({ category, term }))
    );
  }
}
