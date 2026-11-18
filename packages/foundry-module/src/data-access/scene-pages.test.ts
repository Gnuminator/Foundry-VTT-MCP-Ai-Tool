import { afterEach, beforeEach, describe, expect, it } from 'vitest';

import {
  createTestWorld,
  makeJournal,
  makeJournalPage,
  type TestWorld,
} from '../test-support/foundry-mock/index.js';

import { getScenePages } from './scene-pages.js';

// Invented page text only.
let world: TestWorld;
let restore: () => void;

beforeEach(() => {
  world = createTestWorld();
  restore = world.install();
});
afterEach(() => restore());

const html = (text: string): { content: string } => ({ content: `<p>${text}</p>` });

describe('getScenePages', () => {
  it('gives every text page of a linked entry when the scene links no single page', () => {
    const journal = makeJournal({
      id: 'j1',
      name: 'Book',
      pages: [
        makeJournalPage({ id: 'a', name: 'Room A', text: html('A') }),
        makeJournalPage({ id: 'img', name: 'Map', type: 'image', src: 'x.png' }),
      ],
    });
    world.addScene({ id: 's1', name: 'Hall', active: true, journal });
    const reply = getScenePages();
    expect(reply.sceneName).toBe('Hall');
    expect(reply.pages.map(p => [p.pageId, p.from])).toEqual([['a', 'scene']]);
  });

  it('gives just the linked page and the pages of map pins, once each', () => {
    const journal = makeJournal({
      id: 'j1',
      name: 'Book',
      pages: [
        makeJournalPage({ id: 'a', name: 'Room A', text: html('A') }),
        makeJournalPage({ id: 'b', name: 'Room B', text: html('B') }),
      ],
    });
    const pageA = journal['pages'].get('a');
    const pageB = journal['pages'].get('b');
    world.addScene({
      id: 's1',
      name: 'Hall',
      journal,
      journalEntryPage: 'a',
      notes: [
        { entry: journal, pageId: 'a', page: pageA },
        { entry: journal, pageId: 'b', page: pageB },
      ],
    });
    const reply = getScenePages('s1');
    expect(reply.pages.map(p => [p.pageId, p.from])).toEqual([
      ['a', 'scene'],
      ['b', 'note'],
    ]);
    expect(reply.pages[0]?.html).toContain('A');
  });

  it('puts named pages before whole-entry pages, and says when the cap cut pages off', () => {
    const pages = Array.from({ length: 14 }, (_, i) =>
      makeJournalPage({ id: `p${i}`, name: `P${i}`, sort: i, text: html(String(i)) })
    );
    const chapter = makeJournal({ id: 'chapter', name: 'Chapter', pages });
    const room = makeJournal({
      id: 'room',
      name: 'Room',
      pages: [makeJournalPage({ id: 'r1', name: 'Pinned', text: html('pin') })],
    });
    world.addScene({
      id: 's1',
      name: 'Hall',
      journal: chapter,
      notes: [{ entry: room, pageId: 'r1', page: room['pages'].get('r1') }],
    });
    const reply = getScenePages('s1');
    expect(reply.totalPages).toBe(15);
    expect(reply.pages).toHaveLength(12);
    expect(reply.pages[0]?.pageId).toBe('r1');
    expect(reply.pages[1]?.pageId).toBe('p0');
  });

  it('gives every text page of a whole entry a pin links, by sort order', () => {
    const journal = makeJournal({
      id: 'j1',
      name: 'Book',
      pages: [
        makeJournalPage({ id: 'b', name: 'B', sort: 2, text: html('B') }),
        makeJournalPage({ id: 'a', name: 'A', sort: 1, text: html('A') }),
      ],
    });
    world.addScene({ id: 's1', name: 'Hall', notes: [{ entry: journal }] });
    expect(getScenePages('s1').pages.map(p => p.pageId)).toEqual(['a', 'b']);
  });

  it('gives nothing for a pin whose page was deleted', () => {
    const journal = makeJournal({
      id: 'j1',
      name: 'Book',
      pages: [makeJournalPage({ id: 'a', name: 'A', text: html('A') })],
    });
    world.addScene({ id: 's1', name: 'Hall', notes: [{ entry: journal, pageId: 'gone' }] });
    expect(getScenePages('s1').pages).toEqual([]);
  });

  it('is empty for a scene with no links and throws for an unknown scene', () => {
    world.addScene({ id: 's1', name: 'Field' });
    expect(getScenePages('s1').pages).toEqual([]);
    expect(() => getScenePages('nope')).toThrow('Scene not found');
  });
});
