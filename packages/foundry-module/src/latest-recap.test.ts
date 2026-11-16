import { describe, expect, it } from 'vitest';
import { pickLatestRecap, type RecapCandidate } from './latest-recap.js';

function page(over: Partial<RecapCandidate> = {}): RecapCandidate {
  return {
    id: 'p',
    name: 'Recap',
    readable: true,
    copiedFrom: 'JournalEntry.a.JournalEntryPage.b',
    inNotesJournal: false,
    createdTime: 1,
    ...over,
  };
}

describe('pickLatestRecap', () => {
  it('returns null when nothing is revealed', () => {
    expect(pickLatestRecap([])).toBeNull();
    expect(pickLatestRecap([page({ readable: false })])).toBeNull();
  });

  it('takes the newest readable Recap', () => {
    const older = page({ id: 'old', createdTime: 1 });
    const newer = page({ id: 'new', createdTime: 5 });
    expect(pickLatestRecap([newer, older])?.id).toBe('new');
  });

  it('ignores unrelated pages named Recap and unreadable recaps', () => {
    const stray = page({
      id: 'stray',
      copiedFrom: undefined,
      inNotesJournal: false,
      createdTime: 9,
    });
    const hidden = page({ id: 'hidden', readable: false, createdTime: 8 });
    const ok = page({ id: 'ok', createdTime: 2 });
    expect(pickLatestRecap([stray, hidden, ok])?.id).toBe('ok');
  });

  it('accepts the notes page itself when its journal is open to players', () => {
    const own = page({ id: 'own', copiedFrom: undefined, inNotesJournal: true });
    expect(pickLatestRecap([own])?.id).toBe('own');
  });

  it('ignores other page names', () => {
    expect(pickLatestRecap([page({ name: 'GM summary' })])).toBeNull();
  });
});
