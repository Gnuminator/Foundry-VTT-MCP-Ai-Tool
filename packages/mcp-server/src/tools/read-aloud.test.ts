import { describe, expect, it } from 'vitest';

import { makeTools } from '../test-support/make-tool-harness.js';

import { ReadAloudTools, extractReadAloud } from './read-aloud.js';

// Invented text only: no book text in the repo.
describe('extractReadAloud', () => {
  it('finds boxes by class in document order, as plain paragraphs', () => {
    const html =
      '<h2>Room 1</h2><section class="read-aloud-text"><p>A <em>cold</em> hall.</p><p>Drips echo.</p></section>' +
      '<p>Run the room.</p><blockquote class="Boxed-Text x"><p>Second box.</p></blockquote>';
    expect(extractReadAloud(html)).toEqual([
      { text: 'A cold hall.\n\nDrips echo.' },
      { text: 'Second box.' },
    ]);
  });

  it('returns nothing for a page with no boxed text', () => {
    expect(extractReadAloud('<p>Only prose.</p><div class="sidebar">Aside</div>')).toEqual([]);
  });

  it('turns enrichers into plain words and keeps br as a line break', () => {
    const html =
      '<div class="read-aloud-text"><p>See @UUID[JournalEntry.x]{the map}.<br>Roll [[/r 1d6]].</p></div>';
    expect(extractReadAloud(html)).toEqual([{ text: 'See the map.\nRoll 1d6.' }]);
  });

  it('drops empty boxes and scripts inside a box', () => {
    const html =
      '<div class="read-aloud-text"> </div><div class="read-aloud-text"><script>x()</script><p>Hi</p></div>';
    expect(extractReadAloud(html)).toEqual([{ text: 'Hi' }]);
  });
});

describe('ReadAloudTools edge cases', () => {
  it('throws on a refusal from the module instead of answering an empty shelf', async () => {
    const { tools } = makeTools(ReadAloudTools, () => ({ success: false, error: 'Access denied' }));
    await expect(tools.handleGetReadAloud({})).rejects.toThrow('get-read-aloud: Access denied');
  });

  it('reports how many linked pages were read', async () => {
    const { tools } = makeTools(ReadAloudTools, () => ({
      sceneId: 's',
      sceneName: 'N',
      totalPages: 15,
      pages: [],
    }));
    const result = await tools.handleGetReadAloud({});
    expect(result).toMatchObject({ linkedPages: 15, readPages: 0 });
  });

  it('keeps inline rolls and reference enrichers as plain words', () => {
    const html =
      '<div class="read-aloud-text"><p>Take [[1d6]] damage, or be &amp;Reference[prone]{Prone}.</p></div>';
    expect(extractReadAloud(html)).toEqual([{ text: 'Take 1d6 damage, or be Prone.' }]);
  });
});

describe('ReadAloudTools.handleGetReadAloud', () => {
  it('asks the bridge for the scene pages and keeps only pages with boxes', async () => {
    const reply = {
      sceneId: 's1',
      sceneName: 'Hall',
      pages: [
        {
          journalId: 'j1',
          journalName: 'Book',
          pageId: 'p1',
          pageName: 'Room 1',
          from: 'scene',
          html: '<div class="read-aloud-text"><p>Hello.</p></div>',
        },
        {
          journalId: 'j1',
          journalName: 'Book',
          pageId: 'p2',
          pageName: 'Room 2',
          from: 'note',
          html: '<p>none</p>',
        },
      ],
    };
    const { tools, query } = makeTools(ReadAloudTools, () => reply);
    const result = await tools.handleGetReadAloud({ sceneId: 's1' });
    expect(query).toHaveBeenCalledWith('foundry-mcp-bridge.getScenePages', { sceneId: 's1' });
    expect(result.pagesWithoutBoxes).toBe(1);
    expect(result.pages).toHaveLength(1);
    expect(result.pages[0]?.blocks).toEqual([{ text: 'Hello.' }]);
  });

  it('answers an empty shelf for a scene with no linked page', async () => {
    const { tools } = makeTools(ReadAloudTools, () => ({
      sceneId: 's',
      sceneName: 'N',
      pages: [],
    }));
    const result = await tools.handleGetReadAloud({});
    expect(result).toMatchObject({ pages: [], pagesWithoutBoxes: 0 });
  });
});
