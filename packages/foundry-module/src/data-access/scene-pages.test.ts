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
        { entry: journal, page: pageA },
        { entry: journal, page: pageB },
      ],
    });
    const reply = getScenePages('s1');
    expect(reply.pages.map(p => [p.pageId, p.from])).toEqual([
      ['a', 'scene'],
      ['b', 'note'],
    ]);
    expect(reply.pages[0]?.html).toContain('A');
  });

  it('is empty for a scene with no links and throws for an unknown scene', () => {
    world.addScene({ id: 's1', name: 'Field' });
    expect(getScenePages('s1').pages).toEqual([]);
    expect(() => getScenePages('nope')).toThrow('Scene not found');
  });
});
