/**
 * Secret-term matching: case-insensitive, whole-phrase, against the Tarokka
 * vault files directly (the same shape TarokkaService writes), plus the
 * length floor and the custom-registry seam tested against a stub source.
 */
import { promises as fsp } from 'fs';
import * as os from 'os';
import * as path from 'path';
import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import { TAROKKA_CONFIG_FILE, TAROKKA_FILE, type StoredReading } from './tarokka/service.js';
import {
  SecretTermsService,
  tarokkaCardNameSource,
  type SecretTermSource,
} from './secret-terms.js';
import { VaultStore } from './vault/store.js';

const WORLD = 'curse-of-strahd';

let dataDir: string;
let store: VaultStore;

const READING: StoredReading = {
  readingId: 'roll-abc',
  source: 'builtin-roll',
  readAt: '2026-09-28T20:00:00.000Z',
  providerVersion: null,
  positions: {
    tome: { cardName: 'Seven of Swords', cardId: 'swords-7', gmNote: null, revealed: false },
    holySymbol: {
      cardName: 'Master of Coins',
      cardId: 'coins-master',
      gmNote: null,
      revealed: false,
    },
    sunsword: { cardName: 'Two of Glyphs', cardId: 'glyphs-2', gmNote: null, revealed: false },
    ally: { cardName: 'Ghost', cardId: 'ghost', gmNote: null, revealed: false },
    strahdLocation: { cardName: 'Raven', cardId: 'raven', gmNote: null, revealed: false },
  },
};

beforeEach(async () => {
  dataDir = await fsp.mkdtemp(path.join(os.tmpdir(), 'secret-terms-'));
  store = new VaultStore({ dataDir });
});

afterEach(async () => {
  await fsp.rm(dataDir, { recursive: true, force: true });
});

describe('tarokkaCardNameSource (via SecretTermsService default registry)', () => {
  it('has no matches when there is no reading', async () => {
    const service = new SecretTermsService({ store });
    expect(await service.findSecretTerms(WORLD, 'Seven of Swords, Ghost, Raven')).toEqual({
      matches: [],
    });
  });

  it('has no matches when the stored reading is incomplete (undone import)', async () => {
    await store.write(WORLD, 'gm', TAROKKA_FILE, { current: { positions: {} } });
    const service = new SecretTermsService({ store });
    expect(await service.findSecretTerms(WORLD, 'Seven of Swords')).toEqual({ matches: [] });
  });

  it('matches a dealt card name, case-insensitively', async () => {
    await store.write(WORLD, 'gm', TAROKKA_FILE, { current: READING });
    const service = new SecretTermsService({ store });
    expect(
      await service.findSecretTerms(WORLD, 'The book waits, the SEVEN OF SWORDS foretold.')
    ).toEqual({ matches: [{ category: 'tarokka-card', term: 'Seven of Swords' }] });
  });

  it('matches only whole phrases, not a substring inside a longer word', async () => {
    await store.write(WORLD, 'gm', TAROKKA_FILE, { current: READING });
    const service = new SecretTermsService({ store });
    expect(await service.findSecretTerms(WORLD, 'Ravenous wolves circle the camp.')).toEqual({
      matches: [],
    });
    expect(await service.findSecretTerms(WORLD, 'A raven lands on the sill.')).toEqual({
      matches: [{ category: 'tarokka-card', term: 'Raven' }],
    });
  });

  it('also matches the GM override name for a dealt card, alongside its stored name', async () => {
    await store.write(WORLD, 'gm', TAROKKA_FILE, { current: READING });
    await store.write(WORLD, 'gm', TAROKKA_CONFIG_FILE, { cardNames: { ghost: 'The Abbot' } });
    const service = new SecretTermsService({ store });
    expect(await service.findSecretTerms(WORLD, 'The Abbot smiled.')).toEqual({
      matches: [{ category: 'tarokka-card', term: 'The Abbot' }],
    });
    expect(await service.findSecretTerms(WORLD, 'A ghost passed through the wall.')).toEqual({
      matches: [{ category: 'tarokka-card', term: 'Ghost' }],
    });
  });

  it('ignores an override for a card that was not dealt in the current reading', async () => {
    await store.write(WORLD, 'gm', TAROKKA_FILE, { current: READING });
    await store.write(WORLD, 'gm', TAROKKA_CONFIG_FILE, {
      cardNames: { 'swords-1': 'The Burgomaster' },
    });
    const service = new SecretTermsService({ store });
    expect(await service.findSecretTerms(WORLD, 'The Burgomaster spoke.')).toEqual({ matches: [] });
  });

  it('finds every matching position, not just the first', async () => {
    await store.write(WORLD, 'gm', TAROKKA_FILE, { current: READING });
    const service = new SecretTermsService({ store });
    const result = await service.findSecretTerms(WORLD, 'Ghost and Raven both appear tonight.');
    expect(result.matches.sort((a, b) => a.term.localeCompare(b.term))).toEqual([
      { category: 'tarokka-card', term: 'Ghost' },
      { category: 'tarokka-card', term: 'Raven' },
    ]);
  });
});

describe('length floor and the source registry seam', () => {
  const stub = (terms: string[]): SecretTermSource => ({
    category: 'test',
    terms: (): Promise<string[]> => Promise.resolve(terms),
  });

  it('ignores terms shorter than 3 characters, even when they appear in the text', async () => {
    const service = new SecretTermsService({ store, sources: [stub(['Ox', 'ok', 'Wolf'])] });
    const result = await service.findSecretTerms(WORLD, 'An Ox stands near a wolf.');
    expect(result.matches).toEqual([{ category: 'test', term: 'Wolf' }]);
  });

  it('trims a term before matching and reporting it', async () => {
    const service = new SecretTermsService({ store, sources: [stub(['  Barovia  '])] });
    expect(await service.findSecretTerms(WORLD, 'Welcome to Barovia.')).toEqual({
      matches: [{ category: 'test', term: 'Barovia' }],
    });
  });

  it('composes several sources', async () => {
    const service = new SecretTermsService({
      store,
      sources: [stub(['Barovia']), tarokkaCardNameSource(store)],
    });
    await store.write(WORLD, 'gm', TAROKKA_FILE, { current: READING });
    const result = await service.findSecretTerms(WORLD, 'Barovia holds a Raven.');
    expect(result.matches.map(m => m.category).sort()).toEqual(['tarokka-card', 'test']);
  });
});
