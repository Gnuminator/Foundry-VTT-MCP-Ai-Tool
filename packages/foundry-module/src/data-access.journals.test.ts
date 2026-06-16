/**
 * Characterization tests for the journal read methods of `FoundryDataAccess`,
 * driven through the Phase 9 Foundry-mock harness.
 *
 * Methods under test (data-access.ts):
 *   - listJournals          (~line 2471)
 *   - getJournalContent     (~line 2499)
 *   - getJournalPageContent (~line 2542)
 *
 * These pin the current (upstream-derived) behavior so a from-scratch
 * reimplementation can be verified to parity.
 */

import { afterEach, beforeEach, describe, expect, it, vi } from 'vitest';
import {
  createTestWorld,
  makeJournal,
  makeJournalPage,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { FoundryDataAccess } from './data-access.js';

let world: TestWorld;
let restore: () => void;
let da: FoundryDataAccess;

beforeEach(() => {
  vi.spyOn(console, 'warn').mockImplementation(() => {});
  vi.spyOn(console, 'log').mockImplementation(() => {});
  vi.spyOn(console, 'error').mockImplementation(() => {});
  world = createTestWorld();
  restore = world.install();
  da = new FoundryDataAccess();
});

afterEach(() => {
  restore();
  vi.restoreAllMocks();
});

// ---------------------------------------------------------------------------
// listJournals
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — listJournals', () => {
  it('returns an empty array when there are no journals', async () => {
    expect(await da.listJournals()).toEqual([]);
  });

  it('maps a single-page journal to the expected shape', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Lore of the Frost',
      pages: [makeJournalPage({ id: 'p1', name: 'Chapter 1', type: 'text' })],
    });

    const result = await da.listJournals();

    expect(result).toEqual([
      {
        id: 'j1',
        name: 'Lore of the Frost',
        type: 'JournalEntry',
        pageCount: 1,
        pages: [{ id: 'p1', name: 'Chapter 1', type: 'text' }],
      },
    ]);
  });

  it('maps a multi-page journal including an image page', async () => {
    world.addJournal({
      id: 'j2',
      name: 'Quest Log',
      pages: [
        makeJournalPage({ id: 'p1', name: 'Overview', type: 'text' }),
        makeJournalPage({ id: 'p2', name: 'Map', type: 'image', src: 'map.webp' }),
      ],
    });

    const result = await da.listJournals();

    expect(result).toEqual([
      {
        id: 'j2',
        name: 'Quest Log',
        type: 'JournalEntry',
        pageCount: 2,
        pages: [
          { id: 'p1', name: 'Overview', type: 'text' },
          { id: 'p2', name: 'Map', type: 'image' },
        ],
      },
    ]);
  });

  it('falls back page.type to "text" when type is missing', async () => {
    // Build a page without a type field via spread override.
    const page = { ...makeJournalPage({ id: 'p1', name: 'Untitled' }), type: undefined as any };
    world.journal.add(makeJournal({ id: 'j1', name: 'Typeless', pages: [page] }));

    const result = await da.listJournals();

    expect(result[0].pages[0].type).toBe('text');
  });

  it('reports pageCount of 0 for a journal with no pages', async () => {
    world.addJournal({ id: 'j1', name: 'Empty Journal', pages: [] });

    const result = await da.listJournals();

    expect(result).toEqual([
      { id: 'j1', name: 'Empty Journal', type: 'JournalEntry', pageCount: 0, pages: [] },
    ]);
  });

  it('lists multiple journals in insertion order', async () => {
    world.addJournal({ id: 'j1', name: 'Alpha' });
    world.addJournal({ id: 'j2', name: 'Beta' });

    const result = await da.listJournals();

    expect(result.map(j => j.id)).toEqual(['j1', 'j2']);
  });
});

// ---------------------------------------------------------------------------
// getJournalContent
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getJournalContent', () => {
  it('returns null for an unknown journal id', async () => {
    expect(await da.getJournalContent('no-such-journal')).toBeNull();
  });

  it('returns {content:"", allPages, pageCount} when journal has no text page', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Image Only',
      pages: [makeJournalPage({ id: 'p1', name: 'Cover Art', type: 'image', src: 'cover.webp' })],
    });

    const result = await da.getJournalContent('j1');

    expect(result).toEqual({
      content: '',
      allPages: [{ id: 'p1', name: 'Cover Art', type: 'image' }],
      pageCount: 1,
    });
    // No currentPage or note present when there is no text page.
    expect(result).not.toHaveProperty('currentPage');
    expect(result).not.toHaveProperty('note');
  });

  it('returns content from the first text page when there is exactly one page', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Single Page Journal',
      pages: [
        makeJournalPage({
          id: 'p1',
          name: 'Intro',
          type: 'text',
          text: { content: '<p>Hello</p>' },
        }),
      ],
    });

    const result = await da.getJournalContent('j1');

    expect(result).toEqual({
      content: '<p>Hello</p>',
      currentPage: { id: 'p1', name: 'Intro' },
      allPages: [{ id: 'p1', name: 'Intro', type: 'text' }],
      pageCount: 1,
      note: undefined,
    });
  });

  it('note is undefined (not present) when pageCount === 1', async () => {
    world.addJournal({
      id: 'j1',
      name: 'One Pager',
      pages: [makeJournalPage({ id: 'p1', name: 'Solo', type: 'text', text: { content: 'x' } })],
    });

    const result = await da.getJournalContent('j1');

    expect(result!.note).toBeUndefined();
  });

  it('returns note string when journal has more than one page', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Multi',
      pages: [
        makeJournalPage({ id: 'p1', name: 'Intro', type: 'text', text: { content: 'Start.' } }),
        makeJournalPage({ id: 'p2', name: 'Details', type: 'text', text: { content: 'More.' } }),
      ],
    });

    const result = await da.getJournalContent('j1');

    expect(result!.note).toBe(
      'This journal has 2 pages. Use list-journals with journalId and pageId to read other pages: "Intro" (p1), "Details" (p2)'
    );
  });

  it('note string lists all pages (text + image) for a 3-page journal', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Big Journal',
      pages: [
        makeJournalPage({ id: 'p1', name: 'Chapter 1', type: 'text', text: { content: 'Body.' } }),
        makeJournalPage({ id: 'p2', name: 'Illustration', type: 'image', src: 'art.webp' }),
        makeJournalPage({ id: 'p3', name: 'Appendix', type: 'text', text: { content: 'End.' } }),
      ],
    });

    const result = await da.getJournalContent('j1');

    expect(result!.note).toBe(
      'This journal has 3 pages. Use list-journals with journalId and pageId to read other pages: "Chapter 1" (p1), "Illustration" (p2), "Appendix" (p3)'
    );
    // First text page is returned
    expect(result!.content).toBe('Body.');
    expect(result!.currentPage).toEqual({ id: 'p1', name: 'Chapter 1' });
  });

  it('skips non-text pages to find the first text page', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Image First',
      pages: [
        makeJournalPage({ id: 'p1', name: 'Cover', type: 'image', src: 'cover.webp' }),
        makeJournalPage({
          id: 'p2',
          name: 'Story',
          type: 'text',
          text: { content: 'Once upon...' },
        }),
      ],
    });

    const result = await da.getJournalContent('j1');

    expect(result!.content).toBe('Once upon...');
    expect(result!.currentPage).toEqual({ id: 'p2', name: 'Story' });
  });

  it('content falls back to empty string when text.content is absent', async () => {
    // Simulate a text page with no content string.
    const page = { ...makeJournalPage({ id: 'p1', name: 'Blank', type: 'text' }), text: {} };
    world.journal.add(makeJournal({ id: 'j1', name: 'Blanks', pages: [page] }));

    const result = await da.getJournalContent('j1');

    expect(result!.content).toBe('');
  });

  it('allPages maps page.type to "text" when type is missing', async () => {
    const page = { ...makeJournalPage({ id: 'p1', name: 'Untyped' }), type: undefined as any };
    world.journal.add(makeJournal({ id: 'j1', name: 'Untyped Journal', pages: [page] }));

    const result = await da.getJournalContent('j1');

    expect(result!.allPages[0].type).toBe('text');
  });
});

// ---------------------------------------------------------------------------
// getJournalPageContent
// ---------------------------------------------------------------------------

describe('FoundryDataAccess — getJournalPageContent', () => {
  it('returns null when the journal does not exist', async () => {
    expect(await da.getJournalPageContent('no-journal', 'p1')).toBeNull();
  });

  it('returns null when the journal exists but the page does not', async () => {
    world.addJournal({ id: 'j1', name: 'Empty Journal', pages: [] });

    expect(await da.getJournalPageContent('j1', 'no-page')).toBeNull();
  });

  it('returns content for a text page', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Lore',
      pages: [
        makeJournalPage({
          id: 'p1',
          name: 'History',
          type: 'text',
          text: { content: '<p>Old tales</p>' },
        }),
      ],
    });

    const result = await da.getJournalPageContent('j1', 'p1');

    expect(result).toEqual({
      id: 'p1',
      name: 'History',
      type: 'text',
      content: '<p>Old tales</p>',
    });
  });

  it('returns src as content for an image page', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Gallery',
      pages: [
        makeJournalPage({ id: 'p1', name: 'Battle Map', type: 'image', src: 'battle-map.webp' }),
      ],
    });

    const result = await da.getJournalPageContent('j1', 'p1');

    expect(result).toEqual({
      id: 'p1',
      name: 'Battle Map',
      type: 'image',
      content: 'battle-map.webp',
    });
  });

  it('falls back content to empty string for a text page with no text.content', async () => {
    const page = { ...makeJournalPage({ id: 'p1', name: 'Blank' }), text: {} };
    world.journal.add(makeJournal({ id: 'j1', name: 'Sparse', pages: [page] }));

    const result = await da.getJournalPageContent('j1', 'p1');

    expect(result!.content).toBe('');
  });

  it('falls back content to empty string for an image page with no src', async () => {
    const page = makeJournalPage({ id: 'p1', name: 'Nosrc', type: 'image' });
    // No src key at all.
    world.journal.add(makeJournal({ id: 'j1', name: 'Nosrc Journal', pages: [page] }));

    const result = await da.getJournalPageContent('j1', 'p1');

    expect(result!.content).toBe('');
  });

  it('falls back type to "text" when page.type is missing', async () => {
    const page = { ...makeJournalPage({ id: 'p1', name: 'Untyped' }), type: undefined as any };
    world.journal.add(makeJournal({ id: 'j1', name: 'Untyped', pages: [page] }));

    const result = await da.getJournalPageContent('j1', 'p1');

    expect(result!.type).toBe('text');
  });

  it('retrieves a specific page by id from a multi-page journal', async () => {
    world.addJournal({
      id: 'j1',
      name: 'Big Book',
      pages: [
        makeJournalPage({ id: 'p1', name: 'Intro', type: 'text', text: { content: 'First.' } }),
        makeJournalPage({ id: 'p2', name: 'Middle', type: 'text', text: { content: 'Second.' } }),
        makeJournalPage({ id: 'p3', name: 'End', type: 'text', text: { content: 'Third.' } }),
      ],
    });

    const result = await da.getJournalPageContent('j1', 'p2');

    expect(result).toEqual({ id: 'p2', name: 'Middle', type: 'text', content: 'Second.' });
  });
});
