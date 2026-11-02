import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestWorld,
  makeJournalPage,
  type TestWorld,
} from '../test-support/foundry-mock/index.js';
import { handoutNoticeContent, postHandoutNotice, showJournalPage } from './journal-show.js';

let world: TestWorld;
let restore: () => void;
let pageUuid: string;
let entryUuid: string;

beforeEach(() => {
  world = createTestWorld({ foundryVersion: '14.368' });
  const page = makeJournalPage({ id: 'pppppppppppppppp', name: 'Letter' });
  const entry = world.addJournal({ id: 'jjjjjjjjjjjjjjjj', pages: [page] });
  entryUuid = `JournalEntry.${entry.id}`;
  pageUuid = `${entryUuid}.JournalEntryPage.pppppppppppppppp`;
  world.addActor({ id: 'aaaaaaaaaaaaaaaa', name: 'Ilvara' });
  restore = world.install();
});

afterEach(() => restore());

describe('showJournalPage', () => {
  it('shows a page with force false to everyone when no users are given', async () => {
    const result = await showJournalPage({ uuid: pageUuid });
    expect(result).toEqual({ shown: true, uuid: pageUuid, users: [] });
    expect(world.journalShows).toHaveLength(1);
    expect(world.journalShows[0].doc.id).toBe('pppppppppppppppp');
    expect(world.journalShows[0].options).toEqual({ force: false, users: [] });
  });

  it('passes the given players through', async () => {
    const result = await showJournalPage({ uuid: pageUuid, userIds: ['u1', 'u2'] });
    expect(result.users).toEqual(['u1', 'u2']);
    expect(world.journalShows[0].options).toEqual({ force: false, users: ['u1', 'u2'] });
  });

  it('also accepts a whole journal', async () => {
    await showJournalPage({ uuid: entryUuid });
    expect(world.journalShows[0].doc.id).toBe('jjjjjjjjjjjjjjjj');
  });

  it('refuses a document that is not a journal page or journal', async () => {
    await expect(showJournalPage({ uuid: 'Actor.aaaaaaaaaaaaaaaa' })).rejects.toThrow(
      /journal page or journal/
    );
    expect(world.journalShows).toHaveLength(0);
  });

  it('refuses a missing document', async () => {
    await expect(
      showJournalPage({ uuid: 'JournalEntry.zzzzzzzzzzzzzzzz.JournalEntryPage.yyyyyyyyyyyyyyyy' })
    ).rejects.toThrow(/not found/);
    expect(world.journalShows).toHaveLength(0);
  });

  it('refuses a bad payload', async () => {
    await expect(showJournalPage({})).rejects.toThrow(/needs a uuid/);
    await expect(showJournalPage({ uuid: pageUuid, userIds: 'u1' })).rejects.toThrow(/userIds/);
    await expect(showJournalPage({ uuid: pageUuid, userIds: [''] })).rejects.toThrow(/userIds/);
  });
});

describe('postHandoutNotice', () => {
  const messages = (): Array<{ content: string; whisper?: string[] }> =>
    [...world.messages.values()].map(m => m as { content: string; whisper?: string[] });
  const setPageOwnership = (ownership: Record<string, number>): void => {
    world.journal.get('jjjjjjjjjjjjjjjj')!.pages.get('pppppppppppppppp')!.ownership = ownership;
  };

  beforeEach(() => {
    world.addUser({ id: 'gm1', name: 'Danni', isGM: true });
    world.addUser({ id: 'anna', name: 'Anna' });
    world.addUser({ id: 'bo', name: 'Bo' });
  });

  it('whispers the title and a link to the players named, and no page text', async () => {
    const result = await postHandoutNotice({ uuid: pageUuid, userIds: ['anna'] });
    expect(result).toEqual({ posted: true, uuid: pageUuid, users: ['anna'] });
    expect(messages()).toHaveLength(1);
    expect(messages()[0].whisper).toEqual(['anna']);
    expect(messages()[0].content).toBe(
      `<p>A handout was revealed to you: @UUID[${pageUuid}]{Letter}</p>`
    );
  });

  it('with no players named tells every non-GM who can observe the page', async () => {
    setPageOwnership({ default: 0, anna: 2 });
    const result = await postHandoutNotice({ uuid: pageUuid });
    expect(result.users).toEqual(['anna']);
    expect(messages()[0].whisper).toEqual(['anna']);
  });

  it('posts nothing, never a public message, when nobody can see the page', async () => {
    setPageOwnership({ default: 0 });
    const result = await postHandoutNotice({ uuid: pageUuid });
    expect(result).toEqual({ posted: false, uuid: pageUuid, users: [] });
    expect(messages()).toHaveLength(0);
  });

  it('refuses a bad payload and a document that is not a journal page', async () => {
    await expect(postHandoutNotice({})).rejects.toThrow(/needs a uuid/);
    await expect(postHandoutNotice({ uuid: pageUuid, userIds: 'anna' })).rejects.toThrow(/userIds/);
    await expect(postHandoutNotice({ uuid: 'Actor.aaaaaaaaaaaaaaaa' })).rejects.toThrow(
      /journal page or journal/
    );
  });
});

describe('handoutNoticeContent', () => {
  it('drops the characters that would end the link or inject markup from a title', () => {
    expect(handoutNoticeContent('JournalEntry.j.JournalEntryPage.p', 'A]{b} <i>"c" & d')).toBe(
      '<p>A handout was revealed to you: @UUID[JournalEntry.j.JournalEntryPage.p]{Ab ic d}</p>'
    );
    expect(handoutNoticeContent('JournalEntry.j', '  ')).toContain('{a handout}');
  });
});
