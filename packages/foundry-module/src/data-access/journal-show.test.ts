import { afterEach, beforeEach, describe, expect, it } from 'vitest';
import {
  createTestWorld,
  makeJournalPage,
  type TestWorld,
} from '../test-support/foundry-mock/index.js';
import { showJournalPage } from './journal-show.js';

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
  world.addActor({ id: 'aaaaaaaaaaaaaaaa', name: 'Ireena' });
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
