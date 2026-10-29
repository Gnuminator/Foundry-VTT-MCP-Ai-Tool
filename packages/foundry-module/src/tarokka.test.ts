/**
 * Tarokka, module side: the link-candidate search the dashboard and Claude use to find the
 * document a card should point to. (The reading itself lives in the backend; the table is in
 * tarokka-table-window.ts.)
 */
import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestWorld,
  makeJournal,
  makeJournalPage,
  type TestWorld,
} from './test-support/foundry-mock/index.js';
import { pageHeadings, searchLinkCandidates } from './tarokka.js';

let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld({ foundryVersion: '14.368' });
  restore = world.install();
});
afterEach(() => restore());

describe('searchLinkCandidates', () => {
  it('finds journals, pages, scenes and actors by name', () => {
    world.journal.add(
      makeJournal({
        id: 'j1',
        name: 'Chapter 5: Valmere',
        uuid: 'JournalEntry.j1',
        pages: [
          makeJournalPage({
            id: 'p1',
            name: 'Valmere Overview',
            uuid: 'JournalEntry.j1.JournalEntryPage.p1',
          }),
          makeJournalPage({ id: 'p2', name: 'Other', uuid: 'JournalEntry.j1.JournalEntryPage.p2' }),
        ],
      }) as never
    );
    world.addScene({ id: 's1', name: 'Valmere Town', uuid: 'Scene.s1' });
    world.addActor({ id: 'a1', name: 'Baron of Valmere', uuid: 'Actor.a1' });
    world.addActor({ id: 'a2', name: 'Someone Else', uuid: 'Actor.a2' });

    const { candidates } = searchLinkCandidates({ query: 'valmere' });
    expect(candidates.map(c => [c.documentName, c.uuid])).toEqual([
      ['JournalEntry', 'JournalEntry.j1'],
      ['JournalEntryPage', 'JournalEntry.j1.JournalEntryPage.p1'],
      ['Scene', 'Scene.s1'],
      ['Actor', 'Actor.a1'],
    ]);
    expect(candidates[1].parentName).toBe('Chapter 5: Valmere');
    expect(searchLinkCandidates({ query: 'valmere', limit: 2 }).candidates).toHaveLength(2);
    expect(() => searchLinkCandidates({ query: 'v' })).toThrow(/2 to 100/);
    expect(() => searchLinkCandidates(undefined)).toThrow(/2 to 100/);
  });

  it('finds a name that is only a heading inside a page, with its anchor', () => {
    world.journal.add(
      makeJournal({
        id: 'j2',
        name: 'Chapter 1',
        uuid: 'JournalEntry.j2',
        pages: [
          makeJournalPage({
            id: 'p2',
            name: 'Cast',
            uuid: 'JournalEntry.j2.JournalEntryPage.p2',
            text: {
              content:
                '<h2>Mira <em>Vale</em></h2><p>Mira is nice.</p><h3>Mira Vale</h3><h3>Other &amp; Co</h3>',
            },
          }),
          makeJournalPage({
            id: 'p3',
            name: 'Mira Vale',
            uuid: 'JournalEntry.j2.JournalEntryPage.p3',
            text: { content: '<h2>Mira Vale</h2>' },
          }),
        ],
      })
    );
    const { candidates } = searchLinkCandidates({ query: 'mira vale' });
    expect(candidates.map(c => [c.uuid, c.heading, c.anchor])).toEqual([
      ['JournalEntry.j2.JournalEntryPage.p3', undefined, undefined],
      ['JournalEntry.j2.JournalEntryPage.p2', 'Mira Vale', 'mira-vale'],
      ['JournalEntry.j2.JournalEntryPage.p2', 'Mira Vale', 'mira-vale$1'],
    ]);
    expect(searchLinkCandidates({ query: 'other & co' }).candidates[0].anchor).toBe('other-and-co');
  });

  it('builds anchors like page.toc: hyphens and quotes, own id, data-no-toc, numeric entities', () => {
    expect(
      pageHeadings(
        '<h2>Ez-Zer&#39;s  Hall</h2><h3 id="own-id">Named</h3><h3 data-no-toc>Hidden</h3><h2>Ez-Zer&#x27;s Hall</h2>'
      )
    ).toEqual([
      { text: "Ez-Zer's Hall", slug: 'ez-zers-hall' },
      { text: 'Named', slug: 'own-id' },
      { text: "Ez-Zer's Hall", slug: 'ez-zers-hall$1' },
    ]);
  });

  it('ignores non-heading text and respects the limit', () => {
    world.journal.add(
      makeJournal({
        id: 'j4',
        name: 'Notes',
        uuid: 'JournalEntry.j4',
        pages: [
          makeJournalPage({
            id: 'p4',
            name: 'Body',
            uuid: 'JournalEntry.j4.JournalEntryPage.p4',
            text: { content: '<p>zorblax in body</p><h2>Zorblax</h2><h2>Zorblax II</h2>' },
          }),
        ],
      })
    );
    expect(searchLinkCandidates({ query: 'zorblax' }).candidates).toHaveLength(2);
    expect(searchLinkCandidates({ query: 'zorblax', limit: 1 }).candidates).toHaveLength(1);
  });
});
