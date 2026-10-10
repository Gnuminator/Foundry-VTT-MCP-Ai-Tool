// get-tarokka-reading with placeholder cards: the card names are made up ("Three of Lanterns"),
// not the deck's, and the positions are generic slots.
const page = (n: number): string => `JournalEntry.j1.JournalEntryPage.p${n}`;

const READING = {
  readingId: 'r1',
  source: 'builtin-roll',
  readAt: '2026-10-09T18:00:00Z',
  providerVersion: null,
  positions: [
    {
      position: 'p1',
      label: 'First hearth',
      deck: 'common',
      cardId: 'lanterns-3',
      cardName: 'Three of Lanterns',
      gmNote: 'Kept in the lighthouse',
      links: { journalPageUuid: page(1) },
      linked: true,
      revealed: false,
      revealPageUuid: null,
    },
    {
      position: 'p2',
      label: 'Second lantern',
      deck: 'common',
      cardId: 'keys-7',
      cardName: 'Seven of Keys',
      gmNote: null,
      links: {},
      linked: false,
      revealed: true,
      revealPageUuid: page(6),
    },
    {
      position: 'p3',
      label: 'Third door',
      deck: 'high',
      cardId: 'high-wanderer',
      cardName: 'The Wanderer',
      gmNote: null,
      links: { sceneUuid: 'Scene.s2' },
      linked: true,
      revealed: false,
      revealPageUuid: null,
    },
    {
      position: 'p4',
      label: 'A slot with a name long enough to wrap onto a second line in the card',
      deck: 'high',
      cardId: 'high-lamp',
      cardName: 'The Lamplighter of the Western Harbor and the Seven Bells',
      gmNote: 'A note that is also long, so the card shows how it wraps next to the name.',
      links: { actorUuid: 'Actor.a1' },
      linked: true,
      revealed: false,
      revealPageUuid: null,
    },
  ],
};

export const TAROKKA = {
  available: true,
  reading: READING,
  archivedReadings: 1,
  revealJournalUuid: null,
  note: 'Only the GM sees the vault.',
};

export const TAROKKA_NO_READING = {
  available: true,
  archivedReadings: 0,
  revealJournalUuid: null,
  note: null,
};

export const TAROKKA_UNAVAILABLE = {
  available: false,
  archivedReadings: 0,
  revealJournalUuid: null,
  note: 'No reading provider is installed in this world.',
};
